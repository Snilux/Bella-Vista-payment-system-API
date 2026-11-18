import {
  type Adjustment,
  type CashboxMovementQuery,
  type CashboxRef,
  type CreateAdjustmentRequest,
  formatMoney,
  type Handover,
  type HandoverListQuery,
  type MyCashbox,
  type OpeningBalance,
  type OpeningBalanceRequest,
  type PrepareHandoverRequest,
} from '@bella-vista/shared';
import { type Actor, writeAudit } from '../../db/audit.js';
import type { Database, Transaction } from '../../db/client.js';
import {
  type IdempotencyContext,
  type IdempotentResult,
  idempotentTransaction,
} from '../../db/idempotency.js';
import { lockRecord } from '../../db/locks.js';
import { businessDate } from '../../lib/dates.js';
import { AppError, errors } from '../../lib/errors.js';
import type { AuthenticatedAccount } from '../../plugins/auth.js';
import { blockScope } from '../../plugins/permissions.js';
import type { ApprovalHandler } from '../approvals/approval-registry.js';
import { assertDateOpen } from '../closings/period-lock.js';
import * as repo from './cashboxes.repository.js';

// Cashboxes (CU-17, CU-18; RF-CAJ; D-07, D-16, D-18): the custodian's cashbox and its
// movements, opening balances approved by the president, handovers from block and support
// boxes to the committee box, and adjustments of handover differences. Balances are always
// computed from the movements (v_cashbox_movement); money records are never edited.

export interface CashboxesServiceDeps {
  db: Database;
  now: () => Date;
  timeZone: string;
}

type Executor = Database | Transaction;

const auditActor = (account: AuthenticatedAccount): Actor => ({
  userAccountId: account.userAccountId,
  role: account.role,
});

export const cashboxErrors = {
  notFound: () => new AppError('NOT_FOUND', 404, 'No existe esa caja.'),
  handoverNotFound: () => new AppError('NOT_FOUND', 404, 'No existe esa entrega.'),
  insufficientBalance: (amount: number, available: number, details: Record<string, unknown>) =>
    new AppError(
      'INSUFFICIENT_BALANCE',
      422,
      `El importe (${formatMoney(amount)}) es mayor que lo disponible en la caja (${formatMoney(available)}).`,
      { amount, available, ...details },
    ),
};

const HANDOVER_LABELS: Record<string, string> = {
  pending: 'pendiente',
  withdrawn: 'retirada',
  confirmed: 'confirmada',
  with_difference: 'confirmada con diferencia',
  adjusted: 'aclarada',
};

/** Creates the cashbox of a block (with the block, or for blocks created before step 7). */
export async function ensureBlockCashbox(
  tx: Transaction,
  blockId: number,
  actor: Actor,
): Promise<number> {
  await lockRecord(tx, 'cashbox_block', blockId);
  const existing = await repo.blockCashbox(tx, blockId);
  if (existing !== null) return existing;
  const row = await repo.insertCashbox(tx, {
    type: 'block',
    blockId,
    createdBy: actor.userAccountId,
  });
  await writeAudit(tx, actor, {
    action: 'create',
    table: 'cashbox',
    recordId: row.id,
    after: { type: 'block', blockId },
  });
  return row.id;
}

/**
 * The cashbox in the account's custody (D-07): block leader → block box, treasurer → committee
 * box, president → support box. With `create` (a transaction) a missing block or support box
 * is created; without it, `id` is null when it does not exist yet.
 */
export async function custodianCashbox(
  exec: Executor,
  account: AuthenticatedAccount,
  create: Transaction | null,
): Promise<CashboxRef> {
  if (account.role === 'block_leader') {
    const block = blockScope(account);
    if (block === null) throw errors.roleNotActive();
    const id = create
      ? await ensureBlockCashbox(create, block, auditActor(account))
      : await repo.blockCashbox(exec, block);
    return { id, type: 'block', label: (await repo.blockCode(exec, block)) ?? '' };
  }
  if (account.role === 'treasurer') {
    const id = await repo.committeeCashbox(exec);
    if (id === null) throw errors.internal(); // created by the bootstrap (D-27)
    return { id, type: 'committee', label: 'Comité' };
  }
  if (account.role === 'president') {
    if (create) await lockRecord(create, 'cashbox_support', account.personId);
    let id = await repo.supportCashbox(exec, account.personId);
    if (id === null && create) {
      const row = await repo.insertCashbox(create, {
        type: 'support',
        custodianPersonId: account.personId,
        createdBy: account.userAccountId,
      });
      await writeAudit(create, auditActor(account), {
        action: 'create',
        table: 'cashbox',
        recordId: row.id,
        after: { type: 'support', custodianPersonId: account.personId },
      });
      id = row.id;
    }
    const name = await repo.personFullName(exec, account.personId);
    return { id, type: 'support', label: `Apoyo · ${name ?? ''}` };
  }
  // Secretary and members hold no cash.
  throw errors.forbidden();
}

const toOpeningBalance = (
  row: NonNullable<Awaited<ReturnType<typeof repo.findOpeningBalance>>>,
): OpeningBalance => ({
  id: row.id,
  cashboxId: row.cashboxId,
  amount: row.amount,
  date: row.date,
  status: row.result ?? 'pending',
  approvalId: row.approvalId,
});

const toAdjustment = (
  row: NonNullable<Awaited<ReturnType<typeof repo.findAdjustment>>>,
): Adjustment => ({
  id: row.id,
  cashboxId: row.cashboxId,
  handoverId: row.handoverId,
  closingId: row.closingId,
  amount: row.amount,
  date: row.date,
  status: row.result ?? 'pending',
  approvalId: row.approvalId,
});

export function createCashboxesService(deps: CashboxesServiceDeps) {
  const { db } = deps;
  const today = () => businessDate(deps.now(), deps.timeZone);

  async function toHandovers(exec: Executor, rows: repo.HandoverRow[]): Promise<Handover[]> {
    const labels = await repo.cashboxLabels(exec, [...new Set(rows.map((r) => r.cashboxId))]);
    return rows.map((row) => {
      const box = labels.find((l) => l.id === row.cashboxId);
      return {
        id: row.id,
        folio: row.folio,
        cashbox: { id: row.cashboxId, type: box?.type ?? 'block', label: box?.label ?? '' },
        date: row.date,
        declaredAmount: row.declaredAmount,
        receivedAmount: row.receivedAmount,
        difference: row.difference,
        adjustedAmount: row.adjustedAmount,
        notes: row.notes,
        status: row.status,
        preparedBy: { userAccountId: row.preparedById, username: row.preparedByUsername },
        withdrawnAt: row.withdrawnAt?.toISOString() ?? null,
        confirmedAt: row.confirmedAt?.toISOString() ?? null,
        confirmedBy:
          row.confirmedById !== null && row.confirmedByUsername !== null
            ? { userAccountId: row.confirmedById, username: row.confirmedByUsername }
            : null,
      };
    });
  }

  async function handoverOrThrow(exec: Executor, id: number): Promise<Handover> {
    const row = await repo.findHandover(exec, id);
    if (!row) throw cashboxErrors.handoverNotFound();
    const [item] = await toHandovers(exec, [row]);
    if (!item) throw errors.internal();
    return item;
  }

  /**
   * A handover the viewer may see: block leaders and the president (support) only the ones of
   * their own cashbox; the treasurer and members all of them.
   */
  async function visibleHandover(exec: Executor, viewer: AuthenticatedAccount, id: number) {
    const row = await repo.findHandover(exec, id);
    if (!row) throw cashboxErrors.handoverNotFound();
    if (viewer.role === 'block_leader' || viewer.role === 'president') {
      const own = await custodianCashbox(exec, viewer, null);
      if (own.id !== row.cashboxId) {
        throw viewer.role === 'block_leader'
          ? errors.outOfScope()
          : cashboxErrors.handoverNotFound();
      }
    }
    return row;
  }

  /** The cashbox of `id` if the viewer may see it: the committee all, a block leader theirs. */
  async function visibleCashbox(exec: Executor, viewer: AuthenticatedAccount, id: number) {
    const box = await repo.findCashbox(exec, id);
    if (!box) throw cashboxErrors.notFound();
    const scope = blockScope(viewer);
    if (scope !== null && box.blockId !== scope) throw errors.outOfScope();
    return box;
  }

  /** A handover with a difference and no pending adjustment (RF-CAJ-06). */
  async function handoverOrigin(tx: Transaction, handoverId: number) {
    if (!(await repo.lockHandover(tx, handoverId))) throw cashboxErrors.handoverNotFound();
    const row = await repo.findHandover(tx, handoverId);
    if (!row) throw cashboxErrors.handoverNotFound();
    if (row.status !== 'with_difference') {
      throw errors.invalidState(
        row.status === 'confirmed'
          ? 'La entrega se confirmó sin diferencia; no hay nada que aclarar.'
          : `La entrega está ${HANDOVER_LABELS[row.status] ?? row.status}.`,
        row.status,
        'propose_adjustment',
      );
    }
    if (await repo.hasPendingAdjustment(tx, { handoverId })) {
      throw errors.invalidState(
        'La entrega ya tiene una aclaración pendiente de autorizar.',
        'adjustment_pending',
        'propose_adjustment',
      );
    }
    return { cashboxId: row.cashboxId };
  }

  /**
   * A reviewed or closed closing with a difference and no pending adjustment. The adjustment
   * goes to the open period with a reference to the closing (D-14).
   */
  async function closingOrigin(tx: Transaction, closingId: number) {
    const row = await repo.lockClosingForAdjustment(tx, closingId);
    if (!row) throw new AppError('NOT_FOUND', 404, 'No existe ese corte.');
    if (row.status !== 'reviewed' && row.status !== 'closed') {
      throw errors.invalidState(
        'Solo se aclara la diferencia de un corte revisado o cerrado.',
        row.status,
        'propose_adjustment',
      );
    }
    if (!row.difference) {
      throw errors.invalidState(
        'El corte no tiene diferencia; no hay nada que aclarar.',
        row.status,
        'propose_adjustment',
      );
    }
    if (await repo.hasPendingAdjustment(tx, { closingId })) {
      throw errors.invalidState(
        'El corte ya tiene una aclaración pendiente de autorizar.',
        'adjustment_pending',
        'propose_adjustment',
      );
    }
    return { cashboxId: row.cashboxId };
  }

  return {
    /** The custodian's cashbox with its summary (RF-CAJ-07). */
    async mine(viewer: AuthenticatedAccount): Promise<{ cashbox: MyCashbox }> {
      const ref = await custodianCashbox(db, viewer, null);
      if (ref.id === null) {
        return {
          cashbox: {
            cashbox: ref,
            balance: 0,
            collected: 0,
            handedOver: 0,
            pendingHandover: 0,
            available: 0,
            openingBalance: null,
          },
        };
      }
      const [balance, totals, pending, opening] = await Promise.all([
        repo.balanceOf(db, ref.id),
        repo.totalsByKind(db, ref.id),
        repo.pendingHandoverTotal(db, ref.id),
        repo.openingBalanceOf(db, ref.id),
      ]);
      const total = (kind: string) => totals.find((t) => t.kind === kind)?.amount ?? 0;
      return {
        cashbox: {
          cashbox: ref,
          balance,
          collected: total('payment') + total('payment_cancellation'),
          handedOver: -total('handover_out'),
          pendingHandover: pending,
          available: balance - pending,
          openingBalance: opening ? toOpeningBalance(opening) : null,
        },
      };
    },

    async list() {
      return { cashboxes: await repo.listCashboxes(db) };
    },

    async movements(viewer: AuthenticatedAccount, id: number, query: CashboxMovementQuery) {
      await visibleCashbox(db, viewer, id);
      const offset = query.cursor ?? 0;
      const rows = await repo.movementsOf(db, id, {
        from: query.from,
        to: query.to,
        offset,
        limit: query.limit,
      });
      const data = rows.slice(0, query.limit);
      return {
        data,
        next: rows.length > query.limit ? String(offset + query.limit) : null,
      };
    },

    /**
     * Opening balance of a cashbox (D-18, RF-CAJ-03): the treasurer captures it and the
     * president approves it. One pending or approved per cashbox; a rejected one frees it.
     */
    async requestOpeningBalance(
      actor: Actor,
      idempotency: IdempotencyContext,
      cashboxId: number,
      input: OpeningBalanceRequest,
    ): Promise<IdempotentResult> {
      if (input.date > today()) {
        throw errors.validation({
          issues: [{ path: 'body.date', message: 'La fecha no puede ser posterior a hoy.' }],
        });
      }
      const now = deps.now();
      return idempotentTransaction(db, idempotency, async (tx) => {
        const box = await repo.findCashbox(tx, cashboxId);
        if (!box) throw cashboxErrors.notFound();
        await assertDateOpen(tx, cashboxId, input.date);
        await lockRecord(tx, 'opening_balance', cashboxId);
        if (await repo.hasOpenOpeningBalance(tx, cashboxId)) {
          throw errors.invalidState(
            'La caja ya tiene un saldo inicial autorizado o pendiente de autorizar.',
            'opening_balance_exists',
            'request_opening_balance',
          );
        }
        const approvalId = await repo.insertApproval(tx, {
          type: 'opening_balance',
          reason: input.reason,
          requestedBy: actor.userAccountId,
          requestedAt: now,
        });
        const id = await repo.insertOpeningBalance(tx, {
          cashboxId,
          amount: input.amount,
          date: input.date,
          approvalId,
          createdBy: actor.userAccountId,
        });
        await writeAudit(tx, actor, {
          action: 'request_opening_balance',
          table: 'opening_balance',
          recordId: id,
          after: { cashboxId, amount: input.amount, date: input.date, approvalId },
          reason: input.reason,
        });
        const row = await repo.findOpeningBalance(tx, id);
        if (!row) throw errors.internal();
        return { status: 201, body: { openingBalance: toOpeningBalance(row) } };
      });
    },

    // --- Handovers ----------------------------------------------------------------------------

    async listHandovers(viewer: AuthenticatedAccount, query: HandoverListQuery) {
      let cashboxId: number | null = null;
      if (viewer.role === 'block_leader' || viewer.role === 'president') {
        const own = await custodianCashbox(db, viewer, null);
        if (own.id === null) return { data: [], next: null };
        cashboxId = own.id;
      }
      const rows = await repo.listHandovers(db, {
        cashboxId,
        status: query.status,
        cursor: query.cursor,
        limit: query.limit,
      });
      const data = rows.slice(0, query.limit);
      return {
        data: await toHandovers(db, data),
        next: rows.length > query.limit ? String(data.at(-1)?.id) : null,
      };
    },

    async getHandover(viewer: AuthenticatedAccount, id: number) {
      await visibleHandover(db, viewer, id);
      return { handover: await handoverOrThrow(db, id) };
    },

    /**
     * Prepares a handover from the custodian's cashbox (RF-CAJ-04): pending until the
     * treasurer confirms it, and never more than what is still available in the cashbox.
     */
    async prepareHandover(
      actor: Actor,
      viewer: AuthenticatedAccount,
      idempotency: IdempotencyContext,
      input: PrepareHandoverRequest,
    ): Promise<IdempotentResult> {
      const on = today();
      return idempotentTransaction(db, idempotency, async (tx) => {
        const box = await custodianCashbox(tx, viewer, null);
        if (box.id === null) throw cashboxErrors.insufficientBalance(input.declaredAmount, 0, {});
        await lockRecord(tx, 'cashbox', box.id);
        const [balance, pending] = await Promise.all([
          repo.balanceOf(tx, box.id),
          repo.pendingHandoverTotal(tx, box.id),
        ]);
        const available = balance - pending;
        if (input.declaredAmount > available) {
          throw cashboxErrors.insufficientBalance(input.declaredAmount, available, {
            balance,
            pendingHandover: pending,
          });
        }
        const id = await repo.insertHandover(tx, {
          sourceCashboxId: box.id,
          declaredAmount: input.declaredAmount,
          date: on,
          notes: input.notes,
          createdBy: actor.userAccountId,
        });
        await writeAudit(tx, actor, {
          action: 'prepare',
          table: 'handover',
          recordId: id,
          after: { sourceCashboxId: box.id, declaredAmount: input.declaredAmount, date: on },
        });
        return { status: 201, body: { handover: await handoverOrThrow(tx, id) } };
      });
    },

    /** Withdraws a pending handover; only who prepared it. */
    async withdrawHandover(actor: Actor, viewer: AuthenticatedAccount, id: number) {
      const now = deps.now();
      return db.transaction(async (tx) => {
        if (!(await repo.lockHandover(tx, id))) throw cashboxErrors.handoverNotFound();
        const row = await visibleHandover(tx, viewer, id);
        if (row.preparedById !== actor.userAccountId) throw errors.forbidden();
        if (row.status !== 'pending') {
          throw errors.invalidState(
            `La entrega está ${HANDOVER_LABELS[row.status] ?? row.status}.`,
            row.status,
            'withdraw',
          );
        }
        await repo.withdrawHandover(tx, id, now);
        await writeAudit(tx, actor, {
          action: 'withdraw',
          table: 'handover',
          recordId: id,
          before: { withdrawnAt: null },
          after: { withdrawnAt: now.toISOString() },
        });
        return { handover: await handoverOrThrow(tx, id) };
      });
    },

    /**
     * Confirms a handover with the amount received (RF-CAJ-05). The source cashbox only goes
     * down by that amount; a shortfall stays in it until an approved adjustment (D-16).
     */
    async confirmHandover(
      actor: Actor,
      idempotency: IdempotencyContext,
      id: number,
      receivedAmount: number,
    ): Promise<IdempotentResult> {
      const now = deps.now();
      return idempotentTransaction(db, idempotency, async (tx) => {
        if (!(await repo.lockHandover(tx, id))) throw cashboxErrors.handoverNotFound();
        const row = await repo.findHandover(tx, id);
        if (!row) throw cashboxErrors.handoverNotFound();
        if (row.status !== 'pending') {
          throw errors.invalidState(
            `La entrega está ${HANDOVER_LABELS[row.status] ?? row.status}.`,
            row.status,
            'confirm',
          );
        }
        if (receivedAmount > row.declaredAmount) {
          throw errors.validation({
            issues: [
              {
                path: 'body.receivedAmount',
                message: `No puede ser mayor que lo declarado (${formatMoney(row.declaredAmount)}).`,
              },
            ],
          });
        }
        const committee = await repo.committeeCashbox(tx);
        for (const box of [row.cashboxId, committee].sort()) {
          if (box !== null) await lockRecord(tx, 'cashbox', box);
        }
        await repo.confirmHandover(tx, id, {
          receivedAmount,
          confirmedAt: now,
          confirmedBy: actor.userAccountId,
        });
        await writeAudit(tx, actor, {
          action: 'confirm',
          table: 'handover',
          recordId: id,
          before: { receivedAmount: null },
          after: { receivedAmount, difference: row.declaredAmount - receivedAmount },
        });
        return { status: 200, body: { handover: await handoverOrThrow(tx, id) } };
      });
    },

    /**
     * Proposes an adjustment of a handover difference (RF-CAJ-06): a signed movement of the
     * source cashbox, applied once the president approves it.
     */
    async proposeAdjustment(
      actor: Actor,
      idempotency: IdempotencyContext,
      input: CreateAdjustmentRequest,
    ): Promise<IdempotentResult> {
      const now = deps.now();
      const on = today();
      return idempotentTransaction(db, idempotency, async (tx) => {
        const origin =
          input.handoverId !== undefined
            ? await handoverOrigin(tx, input.handoverId)
            : await closingOrigin(tx, input.closingId ?? 0);
        const approvalId = await repo.insertApproval(tx, {
          type: 'adjustment',
          reason: input.reason,
          requestedBy: actor.userAccountId,
          requestedAt: now,
        });
        const id = await repo.insertAdjustment(tx, {
          cashboxId: origin.cashboxId,
          handoverId: input.handoverId ?? null,
          closingId: input.closingId ?? null,
          amount: input.amount,
          date: on,
          approvalId,
          createdBy: actor.userAccountId,
        });
        await writeAudit(tx, actor, {
          action: 'propose',
          table: 'adjustment',
          recordId: id,
          after: {
            handoverId: input.handoverId ?? null,
            closingId: input.closingId ?? null,
            amount: input.amount,
            date: on,
            approvalId,
          },
          reason: input.reason,
        });
        const created = await repo.findAdjustment(tx, id);
        if (!created) throw errors.internal();
        return { status: 201, body: { adjustment: toAdjustment(created) } };
      });
    },
  };
}

export type CashboxesService = ReturnType<typeof createCashboxesService>;

/**
 * opening_balance: once approved it counts in the cashbox (v_cashbox_movement). The database
 * refuses the approval in a month with a closed closing (D-14).
 */
export const openingBalanceHandler: ApprovalHandler = {
  async onApproved() {},
  async onRejected() {},
  async describe(db, approvalIds) {
    const rows = await repo.openingBalancesByApproval(db, approvalIds);
    const labels = await repo.cashboxLabels(db, [...new Set(rows.map((r) => r.cashboxId))]);
    return new Map(
      rows.map((r) => [
        r.approvalId,
        {
          description: `Saldo inicial de ${formatMoney(r.amount)} en ${labels.find((l) => l.id === r.cashboxId)?.label ?? 'la caja'}`,
          subject: { type: 'cashbox', id: r.cashboxId },
        },
      ]),
    );
  },
};

/** adjustment: once approved it moves the source cashbox (v_cashbox_movement, D-16). */
export const adjustmentHandler: ApprovalHandler = {
  async onApproved() {},
  async onRejected() {},
  async describe(db, approvalIds) {
    const rows = await repo.adjustmentsByApproval(db, approvalIds);
    return new Map(
      rows.flatMap((r) => {
        const subject =
          r.closingId !== null
            ? ({ type: 'closing', id: r.closingId } as const)
            : r.handoverId !== null
              ? ({ type: 'handover', id: r.handoverId } as const)
              : null;
        if (!subject) return [];
        const description = r.closingFolio
          ? `Aclaración de ${formatMoney(r.amount)} en el corte ${r.closingFolio}`
          : `Aclaración de ${formatMoney(r.amount)} en la entrega ${r.handoverFolio ?? ''}`.trim();
        return [[r.approvalId, { description, subject }] as const];
      }),
    );
  },
};
