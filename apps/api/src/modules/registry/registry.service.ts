import type {
  CreatePersonRequest,
  CreateSuspensionRequest,
  CreateUnitRequest,
  PersonBasic,
  PersonDetail,
  PersonMatchesQuery,
  SearchResponse,
  Suspension,
  SuspensionListItem,
  SuspensionListQuery,
  UnitDetail,
  UnitHolderChangeRequest,
} from '@bella-vista/shared';
import { type Actor, writeAudit } from '../../db/audit.js';
import type { Database, Transaction } from '../../db/client.js';
import { isUniqueViolation } from '../../db/errors.js';
import { businessDate } from '../../lib/dates.js';
import { errors } from '../../lib/errors.js';
import { dateToPeriod, periodOf, periodToDate } from '../../lib/periods.js';
import type { AuthenticatedAccount } from '../../plugins/auth.js';
import { assertInScope, blockScope } from '../../plugins/permissions.js';
import type { ApprovalHandler } from '../approvals/approval-registry.js';
import { loadDebts, NO_DEBT } from '../billing/account-statements.js';
import { registryErrors } from './registry.errors.js';
import * as repo from './registry.repository.js';

// Registry (CU-05 to CU-07, CU-10, CU-11; RF-PAD; D-06, D-10, D-11, D-18). Block leaders see
// and change data of their own block only (blockScope / assertInScope); of people outside it
// they get name, distinguishing note and folio (RF-PAD-04, HU-13).

export interface RegistryServiceDeps {
  db: Database;
  now: () => Date;
  timeZone: string;
}

type Executor = Database | Transaction;

export function personBasic(row: {
  id: number;
  folio: string;
  givenNames: string;
  paternalSurname: string;
  maternalSurname: string | null;
  distinguishingNote: string | null;
}): PersonBasic {
  return {
    id: row.id,
    folio: row.folio,
    fullName: [row.givenNames, row.paternalSurname, row.maternalSurname].filter(Boolean).join(' '),
    distinguishingNote: row.distinguishingNote,
  };
}

/** Left-joined person columns are all null when there is no person. */
function optionalPerson(
  row: {
    id: number | null;
    folio: string | null;
    givenNames: string | null;
    paternalSurname: string | null;
    maternalSurname: string | null;
    distinguishingNote: string | null;
  } | null,
): PersonBasic | null {
  if (!row || row.id === null || row.folio === null || row.givenNames === null) return null;
  return personBasic({
    id: row.id,
    folio: row.folio,
    givenNames: row.givenNames,
    paternalSurname: row.paternalSurname ?? '',
    maternalSurname: row.maternalSurname,
    distinguishingNote: row.distinguishingNote,
  });
}

export function createRegistryService(deps: RegistryServiceDeps) {
  const { db } = deps;
  const today = () => businessDate(deps.now(), deps.timeZone);

  async function personDetail(
    executor: Executor,
    viewer: AuthenticatedAccount,
    id: number,
  ): Promise<PersonDetail> {
    const row = await repo.findPerson(executor, id);
    if (!row) throw registryErrors.personNotFound();
    const basic = personBasic(row);
    const scope = blockScope(viewer);
    if (
      scope !== null &&
      !(await repo.leaderSeesPerson(executor, id, scope, viewer.userAccountId))
    ) {
      return { access: 'basic', ...basic };
    }
    const units = await repo.unitsHeldBy(executor, id);
    // Debt only of the units in scope: a leader never gets amounts of another block.
    const visibleUnits = units.filter((u) => scope === null || u.blockId === scope);
    const debts = await loadDebts(
      executor,
      visibleUnits.map((u) => u.id),
      deps.now(),
      deps.timeZone,
    );
    const requests = await repo.requestsOf(executor, id, scope);
    return {
      access: 'full',
      ...basic,
      givenNames: row.givenNames,
      paternalSurname: row.paternalSurname,
      maternalSurname: row.maternalSurname,
      phone: row.phone,
      registeredOn: row.registeredOn,
      // Units in other blocks show only that they exist (no folio, address or amounts).
      units: units.map((u) =>
        scope !== null && u.blockId !== scope
          ? { scope: 'other_block' as const }
          : {
              scope: 'own' as const,
              id: u.id,
              folio: u.folio,
              reference: u.reference,
              status: u.status,
              connectionId: u.connectionId,
              connectionFolio: u.connectionFolio,
              address: u.address,
              blockCode: u.blockCode,
              holderSince: u.holderSince,
              debt: debts.get(u.id) ?? NO_DEBT,
            },
      ),
      totalDue: visibleUnits.reduce((sum, u) => sum + (debts.get(u.id)?.totalDue ?? 0), 0),
      connectionRequests: requests.map((r) => ({
        id: r.id,
        folio: r.folio,
        status: r.status,
        address: r.address,
        blockCode: r.blockCode,
      })),
    };
  }

  async function unitDetail(executor: Executor, viewer: AuthenticatedAccount, id: number) {
    const row = await repo.findUnit(executor, id);
    if (!row) throw registryErrors.unitNotFound();
    assertInScope(viewer, row.blockId);
    const [holders, suspensions, payments, pending] = await Promise.all([
      repo.holdersOf(executor, id),
      repo.suspensionsOf(executor, id, row.connectionId),
      repo.paymentsOf(executor, id),
      repo.pendingChangeOf(executor, id),
    ]);
    const unit: UnitDetail = {
      id: row.id,
      folio: row.folio,
      reference: row.reference,
      status: row.status,
      registeredOn: row.registeredOn,
      activatedOn: row.activatedOn,
      billingStartPeriod: row.billingStartPeriod ? dateToPeriod(row.billingStartPeriod) : null,
      deactivatedOn: row.deactivatedOn,
      connection: {
        id: row.connectionId,
        folio: row.connectionFolio,
        address: row.address,
        blockId: row.blockId,
        blockCode: row.blockCode,
      },
      holder: optionalPerson(row.holder),
      holders: holders.map((h) => ({
        ...personBasic(h),
        validFrom: h.validFrom,
        validTo: h.validTo,
      })),
      suspensions: suspensions.map((s) => ({
        id: s.id,
        target: s.unitId !== null ? ('unit' as const) : ('connection' as const),
        periodFrom: dateToPeriod(s.periodFrom),
        periodTo: s.periodTo ? dateToPeriod(s.periodTo) : null,
        reason: s.reason,
      })),
      payments: payments.map((p) => ({
        id: p.id,
        folio: p.folio,
        occurredAt: p.occurredAt.toISOString(),
        total: p.total,
        cancelled: p.cancelled,
      })),
      pendingChange: pending,
    };
    return unit;
  }

  async function requestUnitChange(
    actor: Actor,
    viewer: AuthenticatedAccount,
    unitId: number,
    change: { type: 'deactivation' | 'holder_change'; newHolderId: number | null; reason: string },
  ) {
    const action =
      change.type === 'deactivation' ? 'request_deactivation' : 'request_holder_change';
    return db.transaction(async (tx) => {
      const current = await repo.lockUnit(tx, unitId);
      if (!current) throw registryErrors.unitNotFound();
      assertInScope(viewer, current.blockId);
      if (current.status === 'deactivated') {
        throw errors.invalidState('La unidad ya está dada de baja.', current.status, action);
      }
      if (await repo.pendingChangeOf(tx, unitId)) {
        throw errors.invalidState(
          'La unidad ya tiene una solicitud de baja o de cambio de titular pendiente.',
          'pending_change',
          action,
        );
      }
      let newHolder: PersonBasic | null = null;
      if (change.newHolderId !== null) {
        const target = await repo.findPerson(tx, change.newHolderId);
        if (!target) throw registryErrors.personNotFound();
        if (current.holderPersonId === change.newHolderId) {
          throw registryErrors.invalidField('body.newHolderId', 'Esa persona ya es la titular.');
        }
        newHolder = personBasic(target);
      }
      const created = await repo.insertUnitChangeRequest(tx, {
        unitId,
        type: change.type,
        newHolderId: change.newHolderId,
        reason: change.reason,
        requestedBy: actor.userAccountId,
        requestedAt: deps.now(),
      });
      await writeAudit(tx, actor, {
        action: 'create',
        table: 'unit_change_request',
        recordId: created.id,
        after: {
          unitId,
          type: change.type,
          newHolderId: change.newHolderId,
          approvalId: created.approvalId,
        },
        reason: change.reason,
      });
      return {
        request: {
          id: created.id,
          unitId,
          type: change.type,
          newHolder,
          approvalId: created.approvalId,
        },
      };
    });
  }

  return {
    async search(viewer: AuthenticatedAccount, q: string): Promise<SearchResponse> {
      const scope = blockScope(viewer);
      const [people, connections, units] = await Promise.all([
        repo.searchPeople(db, q),
        repo.searchConnections(db, q, scope),
        repo.searchUnits(db, q, scope),
      ]);
      const debts = await loadDebts(
        db,
        units.map((u) => u.id),
        deps.now(),
        deps.timeZone,
      );
      return {
        people: people.map(personBasic),
        connections: connections.map((c) => ({
          id: c.id,
          folio: c.folio,
          address: c.address,
          blockCode: c.blockCode,
          status: c.status,
          unitCount: c.unitCount,
        })),
        units: units.map((u) => ({
          id: u.id,
          folio: u.folio,
          reference: u.reference,
          status: u.status,
          connectionId: u.connectionId,
          connectionFolio: u.connectionFolio,
          address: u.address,
          blockCode: u.blockCode,
          holder: optionalPerson(u.holder),
          debt: debts.get(u.id) ?? NO_DEBT,
        })),
      };
    },

    async matches(query: PersonMatchesQuery) {
      const [exact, similar] = await Promise.all([
        repo.peopleWithName(db, query),
        repo.peopleWithSimilarName(db, query),
      ]);
      return { exact: exact.map(personBasic), similar: similar.map(personBasic) };
    },

    /** D-10: a homonym needs a distinguishing note; name + note is unique. */
    async createPerson(actor: Actor, viewer: AuthenticatedAccount, input: CreatePersonRequest) {
      try {
        return await db.transaction(async (tx) => {
          const homonyms = await repo.peopleWithName(tx, input);
          if (homonyms.length > 0) {
            if (input.distinguishingNote === null) {
              throw registryErrors.homonymWithoutNote(homonyms.map(personBasic));
            }
            const note = input.distinguishingNote.toLowerCase();
            if (homonyms.some((h) => h.distinguishingNote?.toLowerCase() === note)) {
              throw registryErrors.duplicateNote();
            }
          }
          const id = await repo.insertPerson(tx, {
            givenNames: input.givenNames,
            paternalSurname: input.paternalSurname,
            maternalSurname: input.maternalSurname,
            distinguishingNote: input.distinguishingNote,
            phone: input.phone,
            registeredOn: input.registeredOn ?? today(),
            createdBy: actor.userAccountId,
          });
          await writeAudit(tx, actor, {
            action: 'create',
            table: 'person',
            recordId: id,
            after: { ...input },
          });
          return { person: await personDetail(tx, viewer, id) };
        });
      } catch (error) {
        if (isUniqueViolation(error, 'person_name_note_uq')) {
          throw input.distinguishingNote === null
            ? registryErrors.homonymWithoutNote([])
            : registryErrors.duplicateNote();
        }
        throw error;
      }
    },

    async getPerson(viewer: AuthenticatedAccount, id: number) {
      return { person: await personDetail(db, viewer, id) };
    },

    /** A new family in an active connection, without opening fee (RF-PAD-09). */
    async createUnit(actor: Actor, viewer: AuthenticatedAccount, input: CreateUnitRequest) {
      return db.transaction(async (tx) => {
        const target = await repo.lockConnection(tx, input.connectionId);
        if (!target) throw registryErrors.connectionNotFound();
        assertInScope(viewer, target.blockId);
        if (target.status !== 'active') throw registryErrors.connectionNotActive(target.status);
        if (!(await repo.findPerson(tx, input.holderPersonId)))
          throw registryErrors.personNotFound();

        const registeredOn = input.registeredOn ?? today();
        const id = await repo.insertUnitWithHolder(tx, {
          connectionId: input.connectionId,
          reference: input.reference,
          registeredOn,
          activatedOn: registeredOn,
          billingStartPeriod: periodToDate(input.billingStartPeriod ?? periodOf(registeredOn)),
          holderPersonId: input.holderPersonId,
          createdBy: actor.userAccountId,
        });
        await writeAudit(tx, actor, {
          action: 'create',
          table: 'unit',
          recordId: id,
          after: { ...input, registeredOn },
        });
        return { unit: await unitDetail(tx, viewer, id) };
      });
    },

    async getUnit(viewer: AuthenticatedAccount, id: number) {
      return { unit: await unitDetail(db, viewer, id) };
    },

    requestDeactivation(
      actor: Actor,
      viewer: AuthenticatedAccount,
      unitId: number,
      reason: string,
    ) {
      return requestUnitChange(actor, viewer, unitId, {
        type: 'deactivation',
        newHolderId: null,
        reason,
      });
    },

    requestHolderChange(
      actor: Actor,
      viewer: AuthenticatedAccount,
      unitId: number,
      input: UnitHolderChangeRequest,
    ) {
      return requestUnitChange(actor, viewer, unitId, {
        type: 'holder_change',
        newHolderId: input.newHolderId,
        reason: input.reason,
      });
    },

    /** S-08: the suspensions with their target, newest first (committee). */
    async listSuspensions(query: SuspensionListQuery) {
      const rows = await repo.listSuspensions(db, {
        status: query.status,
        currentMonth: periodToDate(periodOf(today())),
        connectionId: query.connectionId,
        unitId: query.unitId,
        limit: query.limit,
        cursor: query.cursor,
      });
      const hasMore = rows.length > query.limit;
      const data = hasMore ? rows.slice(0, query.limit) : rows;
      return {
        data: data.map(toSuspensionListItem),
        next: hasMore ? String(data.at(-1)?.id) : null,
      };
    },

    /** D-06: a suspended connection or unit generates no monthly fees. */
    async createSuspension(
      actor: Actor,
      input: CreateSuspensionRequest,
    ): Promise<{ suspension: Suspension }> {
      return db.transaction(async (tx) => {
        const agreementRow = await repo.findAgreement(tx, input.agreementId);
        if (!agreementRow) throw registryErrors.agreementNotFound();
        if (agreementRow.result !== 'approved_by_majority') {
          throw registryErrors.invalidField(
            'body.agreementId',
            'El acuerdo debe estar aprobado por mayoría.',
          );
        }
        const connectionId = input.connectionId ?? null;
        const unitId = input.unitId ?? null;
        if (connectionId !== null) {
          const target = await repo.lockConnection(tx, connectionId);
          if (!target) throw registryErrors.connectionNotFound();
          if (target.status === 'deactivated') {
            throw errors.invalidState('La toma está dada de baja.', target.status, 'suspend');
          }
        } else {
          const target = await repo.lockUnit(tx, unitId ?? 0);
          if (!target) throw registryErrors.unitNotFound();
          if (target.status === 'deactivated') {
            throw errors.invalidState('La unidad está dada de baja.', target.status, 'suspend');
          }
        }
        const periodFrom = periodToDate(input.periodFrom);
        if (await repo.overlappingSuspension(tx, { connectionId, unitId }, periodFrom)) {
          throw errors.invalidState(
            'Ya hay una suspensión vigente en ese periodo.',
            'suspended',
            'suspend',
          );
        }
        const row = await repo.insertSuspension(tx, {
          connectionId,
          unitId,
          periodFrom,
          reason: input.reason,
          agreementId: input.agreementId,
          createdBy: actor.userAccountId,
        });
        await writeAudit(tx, actor, {
          action: 'create',
          table: 'suspension',
          recordId: row.id,
          after: {
            connectionId,
            unitId,
            periodFrom: input.periodFrom,
            agreementId: input.agreementId,
          },
          reason: input.reason,
        });
        return { suspension: toSuspension(row) };
      });
    },

    async endSuspension(actor: Actor, id: number, periodTo: string) {
      return db.transaction(async (tx) => {
        const current = await repo.lockSuspension(tx, id);
        if (!current) throw registryErrors.suspensionNotFound();
        if (current.periodTo !== null) {
          throw errors.invalidState('La suspensión ya terminó.', 'ended', 'end');
        }
        const to = periodToDate(periodTo);
        if (to < current.periodFrom) {
          throw registryErrors.invalidField(
            'body.periodTo',
            'El periodo final no puede ser anterior al inicial.',
          );
        }
        const row = await repo.endSuspension(tx, id, to);
        await writeAudit(tx, actor, {
          action: 'end',
          table: 'suspension',
          recordId: id,
          before: { periodTo: null },
          after: { periodTo },
        });
        return { suspension: toSuspension(row) };
      });
    },
  };
}

function toSuspensionListItem(row: repo.SuspensionListRow): SuspensionListItem {
  const holder = [row.holder?.givenNames, row.holder?.paternalSurname, row.holder?.maternalSurname]
    .filter(Boolean)
    .join(' ');
  return {
    ...toSuspension(row),
    target: row.unitId === null ? 'connection' : 'unit',
    agreement: { id: row.agreementId, folio: row.agreementFolio },
    connection: { ...row.connection, blockCode: row.blockCode },
    unit:
      row.unitId === null || row.unitFolio === null
        ? null
        : {
            id: row.unitId,
            folio: row.unitFolio,
            reference: row.unitReference,
            holderName: holder === '' ? null : holder,
          },
    createdAt: row.createdAt.toISOString(),
  };
}

function toSuspension(row: {
  id: number;
  connectionId: number | null;
  unitId: number | null;
  periodFrom: string;
  periodTo: string | null;
  reason: string;
  agreementId: number;
}): Suspension {
  return {
    id: row.id,
    connectionId: row.connectionId,
    unitId: row.unitId,
    periodFrom: dateToPeriod(row.periodFrom),
    periodTo: row.periodTo ? dateToPeriod(row.periodTo) : null,
    reason: row.reason,
    agreementId: row.agreementId,
  };
}

export type RegistryService = ReturnType<typeof createRegistryService>;

// --- Approval handlers ----------------------------------------------------------------------

async function describeChanges(executor: Executor, ids: number[]) {
  const rows = await repo.changeRequestsByApproval(executor, ids);
  const texts = new Map<number, string>();
  for (const row of rows) {
    const holder = await repo.currentHolderOf(executor, row.unitId);
    const current = holder ? personBasic(holder).fullName : 'sin titular';
    const next = optionalPerson(row.newHolder);
    texts.set(
      row.approvalId,
      row.type === 'deactivation'
        ? `Baja de la unidad ${row.unitFolio} (titular: ${current})`
        : `Cambio de titular de la unidad ${row.unitFolio}: ${current} → ${next?.fullName ?? '?'}`,
    );
  }
  return texts;
}

/** unit_deactivation: approving deactivates the unit today; its debt stays (D-11). */
export const unitDeactivationHandler: ApprovalHandler = {
  async onApproved({ tx, approvalId, actor, today }) {
    const [request] = await repo.changeRequestsByApproval(tx, [approvalId]);
    if (!request) return;
    const current = await repo.lockUnit(tx, request.unitId);
    if (!current || current.status === 'deactivated') return;
    await repo.deactivateUnit(tx, request.unitId, today);
    await writeAudit(tx, actor, {
      action: 'deactivate',
      table: 'unit',
      recordId: request.unitId,
      before: { deactivatedOn: null },
      after: { deactivatedOn: today },
    });
  },
  async onRejected() {},
  describe: describeChanges,
};

/**
 * holder_change: approving closes the current holder today and opens the new one from today.
 * The debt stays with the unit (D-11) and the history shows who held it in each period.
 */
export const holderChangeHandler: ApprovalHandler = {
  async onApproved({ tx, approvalId, actor, today }) {
    const [request] = await repo.changeRequestsByApproval(tx, [approvalId]);
    if (!request || request.newHolder?.id == null) return;
    await repo.lockUnit(tx, request.unitId);
    const current = await repo.currentHolderOf(tx, request.unitId);
    if (current?.id === request.newHolder.id) return;
    if (current) {
      if (current.validFrom >= today) {
        throw errors.invalidState(
          'El titular actual se registró hoy; el cambio puede autorizarse a partir de mañana.',
          'holder_since_today',
          'change_holder',
        );
      }
      await repo.closeHolder(tx, request.unitId, current.validFrom, today);
    }
    await repo.openHolder(tx, {
      unitId: request.unitId,
      personId: request.newHolder.id,
      validFrom: today,
      createdBy: actor.userAccountId,
    });
    await writeAudit(tx, actor, {
      action: 'change_holder',
      table: 'unit',
      recordId: request.unitId,
      before: { holderPersonId: current?.id ?? null },
      after: { holderPersonId: request.newHolder.id, validFrom: today },
    });
  },
  async onRejected() {},
  describe: describeChanges,
};
