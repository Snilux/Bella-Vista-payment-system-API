import {
  addMonths,
  type Closing,
  type ClosingListQuery,
  type CountClosingRequest,
  currentPeriod,
  formatMoney,
  formatPeriod,
  type OpenClosingRequest,
} from '@bella-vista/shared';
import { type Actor, writeAudit } from '../../db/audit.js';
import type { Database, Transaction } from '../../db/client.js';
import { isUniqueViolation } from '../../db/errors.js';
import { businessDate } from '../../lib/dates.js';
import { AppError, errors } from '../../lib/errors.js';
import { dateToPeriod, periodToDate } from '../../lib/periods.js';
import type { AuthenticatedAccount } from '../../plugins/auth.js';
import { blockScope } from '../../plugins/permissions.js';
import { cashboxLabels, findCashbox } from '../cashboxes/cashboxes.repository.js';
import { custodianCashbox } from '../cashboxes/cashboxes.service.js';
import * as repo from './closings.repository.js';

// Cashbox closings (CU-22; RF-COR; D-08, D-14). The custodian (block leader, or the treasurer
// for the committee and support cashboxes) opens and counts; the president or a member
// reviews and closes. A closed monthly closing locks its month (trigger of migration 0014),
// and monthly closings are closed in order so the figures of a closed one never change.

export interface ClosingsServiceDeps {
  db: Database;
  now: () => Date;
  timeZone: string;
}

type Executor = Database | Transaction;

const STATUS_LABELS: Record<string, string> = {
  draft: 'en borrador',
  counted: 'contado',
  reviewed: 'revisado',
  closed: 'cerrado',
};

export const closingErrors = {
  notFound: () => new AppError('NOT_FOUND', 404, 'No existe ese corte.'),
  state: (status: string, action: string) =>
    errors.invalidState(`El corte está ${STATUS_LABELS[status] ?? status}.`, status, action),
  notesRequired: (difference: number) =>
    errors.validation({
      issues: [
        {
          path: 'body.notes',
          message: `Hay una diferencia de ${formatMoney(difference)}; escriba las observaciones.`,
        },
      ],
      difference,
    }),
};

const lastDay = (period: string) => {
  const [year, month] = period.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
};

export function createClosingsService(deps: ClosingsServiceDeps) {
  const { db } = deps;
  const today = () => businessDate(deps.now(), deps.timeZone);

  async function toClosings(exec: Executor, rows: repo.ClosingRow[]): Promise<Closing[]> {
    const labels = await cashboxLabels(exec, [...new Set(rows.map((r) => r.cashboxId))]);
    return rows.map((row) => {
      const box = labels.find((l) => l.id === row.cashboxId);
      return {
        id: row.id,
        folio: row.folio,
        cashbox: { id: row.cashboxId, type: box?.type ?? 'block', label: box?.label ?? '' },
        type: row.type,
        dateFrom: row.dateFrom,
        dateTo: row.dateTo,
        status: row.status,
        figures: {
          startingBalance: row.startingBalance,
          openingBalances: row.openingBalances,
          payments: row.payments,
          cancellations: row.cancellations,
          handoversOut: row.handoversOut,
          handoversIn: row.handoversIn,
          incomes: row.incomes,
          expenses: row.expenses,
          refunds: row.refunds,
          adjustments: row.adjustments,
          expectedBalance: row.expectedBalance,
        },
        countedCash: row.countedCash,
        difference: row.difference,
        notes: row.notes,
        preparedBy: { userAccountId: row.preparedById, username: row.preparedByUsername },
        reviewedBy:
          row.reviewedById !== null && row.reviewedByUsername !== null
            ? { userAccountId: row.reviewedById, username: row.reviewedByUsername }
            : null,
        reviewedAt: row.reviewedAt?.toISOString() ?? null,
        closedBy:
          row.closedById !== null && row.closedByUsername !== null
            ? { userAccountId: row.closedById, username: row.closedByUsername }
            : null,
        closedAt: row.closedAt?.toISOString() ?? null,
      };
    });
  }

  async function closingOrThrow(exec: Executor, id: number): Promise<Closing> {
    const row = await repo.findClosing(exec, id);
    if (!row) throw closingErrors.notFound();
    const [item] = await toClosings(exec, [row]);
    if (!item) throw errors.internal();
    return item;
  }

  /** The block leader only sees the closings of their block cashbox. */
  async function leaderCashbox(exec: Executor, viewer: AuthenticatedAccount) {
    if (blockScope(viewer) === null) return null;
    const own = await custodianCashbox(exec, viewer, null);
    return own.id ?? -1;
  }

  async function visibleClosing(exec: Executor, viewer: AuthenticatedAccount, id: number) {
    const row = await repo.findClosing(exec, id);
    if (!row) throw closingErrors.notFound();
    const own = await leaderCashbox(exec, viewer);
    if (own !== null && own !== row.cashboxId) throw errors.outOfScope();
    return row;
  }

  /** A difference needs notes (RF-COR-02); checked again with the figures of now. */
  function assertNotes(row: { difference: number | null; notes: string | null }) {
    if (row.difference !== null && row.difference !== 0 && !row.notes) {
      throw closingErrors.notesRequired(row.difference);
    }
  }

  async function lockForAction(tx: Transaction, id: number) {
    if (!(await repo.lockClosing(tx, id))) throw closingErrors.notFound();
    const row = await repo.findClosing(tx, id);
    if (!row) throw closingErrors.notFound();
    return row;
  }

  return {
    async list(viewer: AuthenticatedAccount, query: ClosingListQuery) {
      const own = await leaderCashbox(db, viewer);
      if (own !== null && query.cashboxId !== undefined && query.cashboxId !== own) {
        throw errors.outOfScope();
      }
      const rows = await repo.listClosings(db, {
        cashboxId: own ?? query.cashboxId,
        from: query.period ? periodToDate(query.period) : undefined,
        to: query.period ? lastDay(query.period) : undefined,
        status: query.status,
        cursor: query.cursor,
        limit: query.limit,
      });
      const data = rows.slice(0, query.limit);
      return {
        data: await toClosings(db, data),
        next: rows.length > query.limit ? String(data.at(-1)?.id) : null,
      };
    },

    async get(viewer: AuthenticatedAccount, id: number) {
      await visibleClosing(db, viewer, id);
      return { closing: await closingOrThrow(db, id) };
    },

    /**
     * Opens a closing (RF-COR-01): monthly for a finished month, or extraordinary from the
     * first day of the current month to today (the handover record of D-08).
     */
    async open(actor: Actor, viewer: AuthenticatedAccount, input: OpenClosingRequest) {
      const on = today();
      let cashboxId: number;
      if (viewer.role === 'block_leader') {
        const own = await custodianCashbox(db, viewer, null);
        if (own.id === null) throw closingErrors.notFound();
        if (input.cashboxId !== undefined && input.cashboxId !== own.id) {
          throw errors.outOfScope();
        }
        cashboxId = own.id;
      } else {
        cashboxId = input.cashboxId ?? (await custodianCashbox(db, viewer, null)).id ?? 0;
        if (!(await findCashbox(db, cashboxId))) {
          throw new AppError('NOT_FOUND', 404, 'No existe esa caja.');
        }
      }

      let dateFrom: string;
      let dateTo: string;
      if (input.type === 'monthly') {
        const period = input.period ?? '';
        if (period >= currentPeriod(deps.now(), deps.timeZone)) {
          throw errors.validation({
            issues: [
              {
                path: 'body.period',
                message: 'Solo se hace el corte mensual de un mes que ya terminó.',
              },
            ],
          });
        }
        dateFrom = periodToDate(period);
        dateTo = lastDay(period);
      } else {
        dateFrom = `${on.slice(0, 7)}-01`;
        dateTo = on;
      }

      try {
        return await db.transaction(async (tx) => {
          if (input.type === 'monthly' && (await repo.monthlyClosingOf(tx, cashboxId, dateFrom))) {
            throw errors.invalidState(
              `Ya existe el corte de ${formatPeriod(dateToPeriod(dateFrom))} de esa caja.`,
              'closing_exists',
              'open',
            );
          }
          const id = await repo.insertClosing(tx, {
            cashboxId,
            type: input.type,
            dateFrom,
            dateTo,
            createdBy: actor.userAccountId,
          });
          await writeAudit(tx, actor, {
            action: 'open',
            table: 'closing',
            recordId: id,
            after: { cashboxId, type: input.type, dateFrom, dateTo },
          });
          return { closing: await closingOrThrow(tx, id) };
        });
      } catch (error) {
        if (isUniqueViolation(error, 'closing_monthly_uq')) {
          throw errors.invalidState(
            'Ya existe el corte de ese mes de esa caja.',
            'closing_exists',
            'open',
          );
        }
        throw error;
      }
    },

    /** Counted cash and notes (RF-COR-02); only who prepared it, until it is reviewed. */
    async count(
      actor: Actor,
      viewer: AuthenticatedAccount,
      id: number,
      input: CountClosingRequest,
    ) {
      return db.transaction(async (tx) => {
        const row = await lockForAction(tx, id);
        const own = await leaderCashbox(tx, viewer);
        if (own !== null && own !== row.cashboxId) throw errors.outOfScope();
        if (row.preparedById !== actor.userAccountId) throw errors.forbidden();
        if (row.status !== 'draft' && row.status !== 'counted') {
          throw closingErrors.state(row.status, 'count');
        }
        assertNotes({ difference: input.countedCash - row.expectedBalance, notes: input.notes });
        await repo.updateClosing(tx, id, { countedCash: input.countedCash, notes: input.notes });
        await writeAudit(tx, actor, {
          action: 'count',
          table: 'closing',
          recordId: id,
          before: { countedCash: row.countedCash, notes: row.notes },
          after: {
            countedCash: input.countedCash,
            expectedBalance: row.expectedBalance,
            difference: input.countedCash - row.expectedBalance,
            notes: input.notes,
          },
        });
        return { closing: await closingOrThrow(tx, id) };
      });
    },

    /** Review by the president or a member (RF-COR-03). */
    async review(actor: Actor, id: number) {
      const now = deps.now();
      return db.transaction(async (tx) => {
        const row = await lockForAction(tx, id);
        if (row.status !== 'counted') throw closingErrors.state(row.status, 'review');
        assertNotes(row);
        await repo.updateClosing(tx, id, { reviewedBy: actor.userAccountId, reviewedAt: now });
        await writeAudit(tx, actor, {
          action: 'review',
          table: 'closing',
          recordId: id,
          after: { expectedBalance: row.expectedBalance, difference: row.difference },
        });
        return { closing: await closingOrThrow(tx, id) };
      });
    },

    /**
     * Closes it (RF-COR-03, RF-COR-04). A monthly closing needs the previous month of the
     * cashbox closed (or no movements before it); once closed its month is locked (D-14).
     */
    async close(actor: Actor, id: number) {
      const now = deps.now();
      return db.transaction(async (tx) => {
        const row = await lockForAction(tx, id);
        if (row.status !== 'reviewed') throw closingErrors.state(row.status, 'close');
        assertNotes(row);
        if (row.type === 'monthly') {
          const previous = addMonths(dateToPeriod(row.dateFrom), -1);
          const prior = await repo.monthlyClosingOf(tx, row.cashboxId, periodToDate(previous));
          if (
            prior?.closedAt == null &&
            (await repo.hasMovementsBefore(tx, row.cashboxId, row.dateFrom))
          ) {
            throw errors.invalidState(
              `Primero hay que cerrar el corte de ${formatPeriod(previous)} de esta caja.`,
              'previous_open',
              'close',
            );
          }
        }
        await repo.updateClosing(tx, id, { closedBy: actor.userAccountId, closedAt: now });
        await writeAudit(tx, actor, {
          action: 'close',
          table: 'closing',
          recordId: id,
          after: {
            type: row.type,
            dateFrom: row.dateFrom,
            dateTo: row.dateTo,
            expectedBalance: row.expectedBalance,
            countedCash: row.countedCash,
            difference: row.difference,
          },
        });
        return { closing: await closingOrThrow(tx, id) };
      });
    },
  };
}

export type ClosingsService = ReturnType<typeof createClosingsService>;
