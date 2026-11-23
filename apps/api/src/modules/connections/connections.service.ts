import type {
  ActivateConnectionRequestRequest,
  ConnectionDetail,
  ConnectionRequest,
  ConnectionRequestListQuery,
  CreateAgreementRequest,
  CreateConnectionRequestRequest,
  CreatePreexistingConnectionRequest,
  PaginationQuery,
  ResolveConnectionRequestRequest,
} from '@bella-vista/shared';
import { type Actor, writeAudit } from '../../db/audit.js';
import type { Database, Transaction } from '../../db/client.js';
import { businessDate } from '../../lib/dates.js';
import { AppError, errors } from '../../lib/errors.js';
import { dateToPeriod, periodOf, periodToDate } from '../../lib/periods.js';
import type { AuthenticatedAccount } from '../../plugins/auth.js';
import { assertInScope, blockScope } from '../../plugins/permissions.js';
import { loadDebts, NO_DEBT } from '../billing/account-statements.js';
import { lockBlock } from '../organization/organization.repository.js';
import {
  findPerson,
  insertUnitWithHolder,
  unitsOfConnection,
} from '../registry/registry.repository.js';
import { personBasic } from '../registry/registry.service.js';
import * as repo from './connections.repository.js';

// Connections (CU-08, CU-09; RF-PAD-05, RF-TOM; D-12, D-13, D-18): pre-existing connections
// with their first unit, meeting agreements, and connection requests from application to
// installation. The opening fee is charged when the request is approved and must be paid
// (API step 6) before the connection is activated.

export interface ConnectionsServiceDeps {
  db: Database;
  now: () => Date;
  timeZone: string;
}

type Executor = Database | Transaction;

const notFound = (what: string) => new AppError('NOT_FOUND', 404, `No existe ${what}.`);

export const connectionErrors = {
  feeWithoutAmount: (feeName: string, on: string) =>
    new AppError(
      'FEE_WITHOUT_AMOUNT',
      422,
      `El concepto "${feeName}" no tiene importe vigente; el tesorero debe capturarlo antes de aprobar.`,
      { fee: feeName, on },
    ),
  openingNotPaid: () =>
    new AppError(
      'OPENING_NOT_PAID',
      422,
      'La cuota de apertura no está pagada; no se puede activar la toma.',
    ),
  duplicateRequest: (open: { id: number; folio: string }) =>
    new AppError(
      'DUPLICATE_CONNECTION_REQUEST',
      409,
      `Esta persona ya tiene la solicitud ${open.folio} abierta para esa dirección.`,
      { requestId: open.id, folio: open.folio },
    ),
  invalidField: (path: string, message: string) =>
    errors.validation({ issues: [{ path, message }] }),
};

const STATUS_LABELS: Record<string, string> = {
  requested: 'solicitada',
  approved_pending_payment: 'aprobada pendiente de pago',
  pending_installation: 'pendiente de instalación',
  rejected: 'rechazada',
  cancelled: 'cancelada',
  installed: 'instalada',
};

function nextCursor<T extends { id: number }>(rows: T[], limit: number) {
  const data = rows.slice(0, limit);
  return { data, next: rows.length > limit ? String(data.at(-1)?.id) : null };
}

export function createConnectionsService(deps: ConnectionsServiceDeps) {
  const { db } = deps;
  const today = () => businessDate(deps.now(), deps.timeZone);

  async function toRequests(
    executor: Executor,
    rows: repo.RequestRow[],
  ): Promise<ConnectionRequest[]> {
    const charges = await repo.openingCharges(
      executor,
      rows.map((row) => row.id),
    );
    const byRequest = new Map(charges.map((charge) => [charge.requestId, charge]));
    return rows.map((row) => {
      const charge = byRequest.get(row.id);
      return {
        id: row.id,
        folio: row.folio,
        status: row.status,
        applicant: personBasic(row.applicant),
        address: row.address,
        blockId: row.blockId,
        blockCode: row.blockCode,
        requestedOn: row.requestedOn,
        agreement:
          row.agreement?.id != null && row.agreement.folio && row.agreement.result
            ? { id: row.agreement.id, folio: row.agreement.folio, result: row.agreement.result }
            : null,
        resolutionReason: row.resolutionReason,
        cancelledOn: row.cancelledOn,
        cancellationReason: row.cancellationReason,
        openingCharge: charge
          ? {
              id: charge.id,
              feeName: charge.feeName,
              amount: charge.amount,
              chargedOn: charge.chargedOn,
              cancelledOn: charge.cancelledOn,
            }
          : null,
        connectionId: row.connectionId,
      };
    });
  }

  async function requestOrThrow(executor: Executor, viewer: AuthenticatedAccount, id: number) {
    const row = await repo.findRequest(executor, id);
    if (!row) throw notFound('esa solicitud de toma');
    assertInScope(viewer, row.blockId);
    const [request] = await toRequests(executor, [row]);
    return request as ConnectionRequest;
  }

  async function connectionDetail(
    executor: Executor,
    viewer: AuthenticatedAccount,
    id: number,
  ): Promise<ConnectionDetail> {
    const row = await repo.findConnection(executor, id);
    if (!row) throw notFound('esa toma');
    assertInScope(viewer, row.blockId);
    const units = await unitsOfConnection(executor, id);
    const debts = await loadDebts(
      executor,
      units.map((u) => u.id),
      deps.now(),
      deps.timeZone,
    );
    return {
      ...row,
      totalDue: units.reduce((sum, u) => sum + (debts.get(u.id)?.totalDue ?? 0), 0),
      units: units.map((u) => ({
        id: u.id,
        folio: u.folio,
        reference: u.reference,
        status: u.status,
        billingStartPeriod: u.billingStartPeriod ? dateToPeriod(u.billingStartPeriod) : null,
        holder:
          u.holder?.id != null && u.holder.folio && u.holder.givenNames
            ? personBasic({
                id: u.holder.id,
                folio: u.holder.folio,
                givenNames: u.holder.givenNames,
                paternalSurname: u.holder.paternalSurname ?? '',
                maternalSurname: u.holder.maternalSurname,
                distinguishingNote: u.holder.distinguishingNote,
              })
            : null,
        debt: debts.get(u.id) ?? NO_DEBT,
      })),
    };
  }

  /** Locks the block and checks it exists, is active and is in the viewer's scope. */
  async function usableBlock(tx: Transaction, viewer: AuthenticatedAccount, blockId: number) {
    const target = await lockBlock(tx, blockId);
    if (!target) throw notFound('esa manzana');
    assertInScope(viewer, blockId);
    if (!target.active) {
      throw connectionErrors.invalidField('body.blockId', 'La manzana está inactiva.');
    }
    return target;
  }

  /** Locks a request in the viewer's scope; throws INVALID_STATE unless its status allows `action`. */
  async function requestFor(
    tx: Transaction,
    viewer: AuthenticatedAccount,
    id: number,
    action: string,
    allowed: string[],
  ) {
    const current = await repo.lockRequest(tx, id);
    if (!current) throw notFound('esa solicitud de toma');
    assertInScope(viewer, current.blockId);
    if (!allowed.includes(current.status)) {
      throw errors.invalidState(
        `La solicitud está ${STATUS_LABELS[current.status] ?? current.status}.`,
        current.status,
        action,
      );
    }
    return current;
  }

  return {
    // --- Connections ------------------------------------------------------------------------

    /** A connection that existed at startup, with its first unit (D-18). */
    async createPreexisting(
      actor: Actor,
      viewer: AuthenticatedAccount,
      input: CreatePreexistingConnectionRequest,
    ) {
      return db.transaction(async (tx) => {
        await usableBlock(tx, viewer, input.blockId);
        if (!(await findPerson(tx, input.unit.holderPersonId))) throw notFound('esa persona');
        const activatedOn = input.activatedOn ?? today();
        const registeredOn = input.unit.registeredOn ?? today();
        if (registeredOn < activatedOn) {
          throw connectionErrors.invalidField(
            'body.unit.registeredOn',
            'La unidad no puede registrarse antes de la activación de la toma.',
          );
        }
        const connectionId = await repo.insertConnection(tx, {
          connectionRequestId: null,
          address: input.address,
          activatedOn,
          blockId: input.blockId,
          createdBy: actor.userAccountId,
        });
        const unitId = await insertUnitWithHolder(tx, {
          connectionId,
          reference: input.unit.reference,
          registeredOn,
          activatedOn: registeredOn,
          billingStartPeriod: periodToDate(input.unit.billingStartPeriod),
          holderPersonId: input.unit.holderPersonId,
          createdBy: actor.userAccountId,
        });
        await writeAudit(tx, actor, {
          action: 'create_preexisting',
          table: 'connection',
          recordId: connectionId,
          after: { ...input, activatedOn, unitId },
        });
        return { connection: await connectionDetail(tx, viewer, connectionId) };
      });
    },

    async getConnection(viewer: AuthenticatedAccount, id: number) {
      return { connection: await connectionDetail(db, viewer, id) };
    },

    // --- Agreements -------------------------------------------------------------------------

    async listAgreements(page: PaginationQuery) {
      return nextCursor(await repo.listAgreements(db, page), page.limit);
    },

    async createAgreement(actor: Actor, input: CreateAgreementRequest) {
      return db.transaction(async (tx) => {
        if (input.correctsId !== null && !(await repo.findAgreement(tx, input.correctsId))) {
          throw notFound('el acuerdo que se corrige');
        }
        const row = await repo.insertAgreement(tx, { ...input, createdBy: actor.userAccountId });
        await writeAudit(tx, actor, {
          action: 'create',
          table: 'agreement',
          recordId: row.id,
          after: row,
        });
        return { agreement: row };
      });
    },

    // --- Connection requests ----------------------------------------------------------------

    async listRequests(viewer: AuthenticatedAccount, query: ConnectionRequestListQuery) {
      const scope = blockScope(viewer);
      if (scope !== null && query.blockId !== undefined && query.blockId !== scope) {
        throw errors.outOfScope();
      }
      const rows = await repo.listRequests(db, {
        blockId: scope ?? query.blockId ?? null,
        status: query.status,
        limit: query.limit,
        cursor: query.cursor,
      });
      const { data, next } = nextCursor(rows, query.limit);
      return { data: await toRequests(db, data), next };
    },

    async getRequest(viewer: AuthenticatedAccount, id: number) {
      return { request: await requestOrThrow(db, viewer, id) };
    },

    async createRequest(
      actor: Actor,
      viewer: AuthenticatedAccount,
      input: CreateConnectionRequestRequest,
    ) {
      return db.transaction(async (tx) => {
        await usableBlock(tx, viewer, input.blockId);
        if (!(await findPerson(tx, input.applicantId))) throw notFound('esa persona');
        // One open request per applicant and address: the same request is not registered twice.
        await repo.lockApplicantRequests(tx, input.applicantId);
        const open = await repo.findOpenRequestFor(tx, input.applicantId, input.address);
        if (open) throw connectionErrors.duplicateRequest(open);
        const id = await repo.insertRequest(tx, {
          applicantId: input.applicantId,
          address: input.address,
          blockId: input.blockId,
          requestedOn: input.requestedOn ?? today(),
          createdBy: actor.userAccountId,
        });
        await writeAudit(tx, actor, {
          action: 'create',
          table: 'connection_request',
          recordId: id,
          after: { ...input },
        });
        return { request: await requestOrThrow(tx, viewer, id) };
      });
    },

    /**
     * Resolves a request with its meeting agreement (RF-TOM-03). Approving charges the opening
     * fee at the amount in force today, which stays fixed (D-13); rejecting needs a reason.
     */
    async resolveRequest(
      actor: Actor,
      viewer: AuthenticatedAccount,
      id: number,
      input: ResolveConnectionRequestRequest,
    ) {
      const on = today();
      return db.transaction(async (tx) => {
        await requestFor(tx, viewer, id, 'resolve', ['requested']);
        const resolution = await repo.findAgreement(tx, input.agreementId);
        if (!resolution) throw notFound('ese acuerdo');
        const approved = resolution.result === 'approved_by_majority';
        if (!approved && input.resolutionReason === null) {
          throw connectionErrors.invalidField(
            'body.resolutionReason',
            'Escriba el motivo del rechazo.',
          );
        }
        let chargeId: number | null = null;
        if (approved) {
          const opening = await repo.openingFee(tx);
          if (!opening) throw connectionErrors.feeWithoutAmount('Apertura de toma', on);
          if ((await repo.amountInForce(tx, opening.id, on)) === null) {
            throw connectionErrors.feeWithoutAmount(opening.name, on);
          }
          await repo.setResolution(tx, id, {
            agreementId: input.agreementId,
            resolutionReason: input.resolutionReason,
          });
          chargeId = await repo.insertOpeningCharge(tx, {
            feeId: opening.id,
            connectionRequestId: id,
            chargedOn: on,
            createdBy: actor.userAccountId,
          });
        } else {
          await repo.setResolution(tx, id, {
            agreementId: input.agreementId,
            resolutionReason: input.resolutionReason,
          });
        }
        await writeAudit(tx, actor, {
          action: approved ? 'approve' : 'reject',
          table: 'connection_request',
          recordId: id,
          after: { agreementId: input.agreementId, openingChargeId: chargeId },
          reason: input.resolutionReason,
        });
        return { request: await requestOrThrow(tx, viewer, id) };
      });
    },

    /**
     * Installs the connection (RF-TOM-06): only with the opening fee paid. Creates the
     * connection in the request's block and its first unit, held by the applicant and billed
     * from the activation month (RF-MEN-02).
     */
    async activateRequest(
      actor: Actor,
      viewer: AuthenticatedAccount,
      id: number,
      input: ActivateConnectionRequestRequest,
    ) {
      return db.transaction(async (tx) => {
        const current = await repo.lockRequest(tx, id);
        if (!current) throw notFound('esa solicitud de toma');
        assertInScope(viewer, current.blockId);
        if (current.status === 'approved_pending_payment') throw connectionErrors.openingNotPaid();
        if (current.status !== 'pending_installation') {
          throw errors.invalidState(
            `La solicitud está ${STATUS_LABELS[current.status] ?? current.status}.`,
            current.status,
            'activate',
          );
        }
        const activatedOn = input.activatedOn ?? today();
        if (activatedOn < current.requestedOn) {
          throw connectionErrors.invalidField(
            'body.activatedOn',
            'La activación no puede ser anterior a la solicitud.',
          );
        }
        const connectionId = await repo.insertConnection(tx, {
          connectionRequestId: id,
          address: input.address ?? current.address,
          activatedOn,
          blockId: current.blockId,
          createdBy: actor.userAccountId,
        });
        const unitId = await insertUnitWithHolder(tx, {
          connectionId,
          reference: input.reference,
          registeredOn: activatedOn,
          activatedOn,
          billingStartPeriod: periodToDate(periodOf(activatedOn)),
          holderPersonId: current.applicant.id,
          createdBy: actor.userAccountId,
        });
        await writeAudit(tx, actor, {
          action: 'activate',
          table: 'connection_request',
          recordId: id,
          after: { connectionId, unitId, activatedOn },
        });
        return {
          request: await requestOrThrow(tx, viewer, id),
          connection: await connectionDetail(tx, viewer, connectionId),
        };
      });
    },

    /**
     * D-12: a request is cancelled when withdrawn or when the opening fee is not paid in
     * time. Only before payment; the opening charge is cancelled with it.
     */
    async cancelRequest(actor: Actor, viewer: AuthenticatedAccount, id: number, reason: string) {
      const on = today();
      return db.transaction(async (tx) => {
        const current = await repo.lockRequest(tx, id);
        if (!current) throw notFound('esa solicitud de toma');
        assertInScope(viewer, current.blockId);
        if (current.status === 'pending_installation') {
          throw errors.invalidState(
            'La cuota de apertura ya está pagada; la solicitud no se puede cancelar.',
            current.status,
            'cancel',
          );
        }
        if (!['requested', 'approved_pending_payment'].includes(current.status)) {
          throw errors.invalidState(
            `La solicitud está ${STATUS_LABELS[current.status] ?? current.status}.`,
            current.status,
            'cancel',
          );
        }
        await repo.setCancellation(tx, id, { cancelledOn: on, cancellationReason: reason });
        await repo.cancelOpeningCharge(tx, id, on);
        await writeAudit(tx, actor, {
          action: 'cancel',
          table: 'connection_request',
          recordId: id,
          before: { status: current.status },
          after: { status: 'cancelled', cancelledOn: on },
          reason,
        });
        return { request: await requestOrThrow(tx, viewer, id) };
      });
    },
  };
}

export type ConnectionsService = ReturnType<typeof createConnectionsService>;
