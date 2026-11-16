import {
  type AccountStatementResponse,
  type CashboxRef,
  type CreatePaymentRequest,
  formatMoney,
  type PaidCharge,
  type Payment,
  type PaymentListQuery,
  type PaymentPreview,
  type PaymentPreviewRequest,
  type PaymentSummary,
  type PricedMonth,
  priceSelection,
  rateForPeriod,
  validatePaymentSelection,
} from '@bella-vista/shared';
import { type Actor, writeAudit } from '../../db/audit.js';
import type { Database, Transaction } from '../../db/client.js';
import { isUniqueViolation } from '../../db/errors.js';
import {
  type IdempotencyContext,
  type IdempotentResult,
  idempotentTransaction,
} from '../../db/idempotency.js';
import { lockRecord } from '../../db/locks.js';
import { AppError, errors } from '../../lib/errors.js';
import { dateToPeriod, periodToDate } from '../../lib/periods.js';
import type { AuthenticatedAccount } from '../../plugins/auth.js';
import { assertInScope, blockScope } from '../../plugins/permissions.js';
import type { ApprovalHandler } from '../approvals/approval-registry.js';
import { loadAccountStatements } from './account-statements.js';
import { billingErrors } from './billing.errors.js';
import * as repo from './billing.repository.js';

// Billing (CU-13 to CU-16; RF-MEN-07, RF-PAG; D-03, D-05, D-07, D-15, D-23, D-25). The
// account statement (API step 5), and payments: preview, registration, paper receipt
// replacements and cancellation requests resolved by the president.
//
// A payment is priced on the server with the same pure functions as the account statement
// (packages/shared), and registered in one transaction with its Idempotency-Key, the unit
// locked (FOR UPDATE), the cashbox locked, and its audit entry.

export interface BillingServiceDeps {
  db: Database;
  now: () => Date;
  timeZone: string;
}

type Executor = Database | Transaction;

interface PricedSelection {
  unit: { id: number; folio: string; holder: string | null; connectionId: number } | null;
  blockId: number | null;
  months: PricedMonth[];
  charges: (repo.ChargeRow & { amount: number })[];
  total: number;
}

const toPublicCharge = (c: {
  id: number;
  feeName: string;
  feeType: PaidCharge['feeType'];
  amount: number;
  connectionRequestId: number | null;
}): PaidCharge => ({
  id: c.id,
  feeName: c.feeName,
  feeType: c.feeType,
  amount: c.amount,
  connectionRequestId: c.connectionRequestId,
});

const toNextPage = <T extends { id: number }>(rows: T[], limit: number) => {
  const data = rows.slice(0, limit);
  return { data, next: rows.length > limit ? String(data.at(-1)?.id) : null };
};

export function createBillingService(deps: BillingServiceDeps) {
  const { db } = deps;

  /**
   * Validates and prices a selection of months and extra charges (preview and registration).
   * With `tx` the unit and the connection requests are locked first.
   */
  async function priceRequest(
    exec: Executor,
    viewer: AuthenticatedAccount,
    input: PaymentPreviewRequest,
    now: Date,
    lock: Transaction | null,
  ): Promise<PricedSelection> {
    let unit: PricedSelection['unit'] = null;
    let blockId: number | null = null;
    let months: PricedMonth[] = [];

    if (input.unitId !== undefined) {
      if (lock && !(await repo.lockUnitRow(lock, input.unitId))) throw billingErrors.unitNotFound();
      const found = await repo.findPaymentUnit(exec, input.unitId);
      if (!found) throw billingErrors.unitNotFound();
      // A block leader collects only in their block (RF-PAD-04).
      assertInScope(viewer, found.blockId);
      unit = {
        id: found.id,
        folio: found.folio,
        holder: found.holder,
        connectionId: found.connectionId,
      };
      blockId = found.blockId;

      if (input.periods.length > 0) {
        const loaded = (await loadAccountStatements(exec, [found.id], now, deps.timeZone)).get(
          found.id,
        );
        if (!loaded) throw billingErrors.unitNotFound();
        const issues = validatePaymentSelection(loaded.input, loaded.statement, input.periods);
        if (issues.length > 0) {
          const paid = issues.filter((i) => i.code === 'PERIOD_ALREADY_PAID');
          if (paid.length > 0) {
            throw billingErrors.periodAlreadyPaid(paid.map((i) => i.period ?? ''));
          }
          if (issues.some((i) => i.code === 'MONTH_ORDER')) throw billingErrors.monthOrder(issues);
          throw billingErrors.invalidSelection(issues);
        }
        months = priceSelection(loaded.input, loaded.statement, input.periods).months;
        // Same rule as the trigger of migration 0008: each month uses a rate that already
        // started (defense in depth; the domain only picks such rates).
        for (const month of months) {
          const rate = loaded.input.rates.find((r) => r.id === month.rateId);
          if (!rate || rate !== rateForPeriod(loaded.input.rates, month.period)) {
            throw billingErrors.invalidSelection([{ code: 'RATE_MISSING', period: month.period }]);
          }
        }
      }
    } else if (input.periods.length > 0) {
      // Also enforced by the request schema and the trigger of migration 0008.
      throw billingErrors.chargeTarget('Los meses se cobran a una unidad.');
    }

    const ids = input.extraChargeIds;
    if (new Set(ids).size !== ids.length) {
      throw billingErrors.chargeTarget('Hay cargos repetidos.');
    }
    const requestIds = new Set<number>();
    const rows = await repo.chargesByIds(exec, ids);
    for (const row of rows) if (row.connectionRequestId) requestIds.add(row.connectionRequestId);
    if (lock && requestIds.size > 0) {
      await repo.lockConnectionRequests(lock, [...requestIds]);
    }
    const charges = lock && requestIds.size > 0 ? await repo.chargesByIds(exec, ids) : rows;

    for (const id of ids) {
      const charge = charges.find((c) => c.id === id);
      if (!charge) throw billingErrors.chargeNotFound(id);
      if (charge.cancelledOn !== null) {
        throw billingErrors.chargeNotPayable(
          `El cargo de ${charge.feeName} está cancelado.`,
          'cancelled',
        );
      }
      if (charge.paid) {
        throw billingErrors.chargeNotPayable(
          `El cargo de ${charge.feeName} ya está pagado.`,
          'paid',
        );
      }
      if (unit) {
        if (charge.unitId !== unit.id && charge.connectionId !== unit.connectionId) {
          throw billingErrors.chargeTarget(
            `El cargo de ${charge.feeName} no corresponde a esta unidad ni a su toma.`,
          );
        }
      } else {
        if (charge.connectionRequestId === null || requestIds.size !== 1) {
          throw billingErrors.chargeTarget(
            'Sin unidad solo se cobra la apertura de una solicitud de toma.',
          );
        }
        if (charge.requestStatus !== 'approved_pending_payment') {
          throw billingErrors.chargeNotPayable(
            'La solicitud de toma no está pendiente de pago.',
            charge.requestStatus ?? 'unknown',
          );
        }
        blockId = charge.requestBlockId;
        assertInScope(viewer, blockId);
      }
    }

    const priced = charges
      .filter((c) => ids.includes(c.id))
      .sort((a, b) => a.id - b.id)
      .map((c) => ({ ...c, amount: c.amount }));
    const total =
      months.reduce((sum, m) => sum + m.total, 0) + priced.reduce((sum, c) => sum + c.amount, 0);
    return { unit, blockId, months, charges: priced, total };
  }

  /** Where the cash goes (D-07): JM → block box, TES → committee box, PRE → support box. */
  async function receivingCashbox(
    exec: Executor,
    account: AuthenticatedAccount,
    create: Transaction | null,
  ): Promise<CashboxRef> {
    if (account.role === 'block_leader') {
      const block = blockScope(account);
      if (block === null) throw errors.roleNotActive();
      if (create) await lockRecord(create, 'cashbox_block', block);
      let id = await repo.blockCashbox(exec, block);
      if (id === null && create) {
        // Blocks created through the API get their cashbox with their first payment.
        const row = await repo.insertCashbox(create, {
          type: 'block',
          blockId: block,
          createdBy: account.userAccountId,
        });
        await writeAudit(create, auditActor(account), {
          action: 'create',
          table: 'cashbox',
          recordId: row.id,
          after: { type: 'block', blockId: block },
        });
        id = row.id;
      }
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
    throw errors.forbidden();
  }

  async function toSummaries(exec: Executor, rows: repo.PaymentRow[]): Promise<PaymentSummary[]> {
    const labels = await repo.cashboxLabels(exec, [...new Set(rows.map((r) => r.cashboxId))]);
    return rows.map((row) => {
      const box = labels.find((l) => l.id === row.cashboxId);
      return {
        id: row.id,
        folio: row.folio,
        unit:
          row.unitId !== null && row.unitFolio !== null
            ? { id: row.unitId, folio: row.unitFolio, holder: row.holder }
            : null,
        blockId: row.blockId,
        total: row.total,
        cashbox: { id: row.cashboxId, type: box?.type ?? 'block', label: box?.label ?? '' },
        paperFolio: row.paperFolio ?? '',
        occurredAt: row.occurredAt.toISOString(),
        cancelled: row.cancelled,
      };
    });
  }

  async function paymentDetail(exec: Executor, id: number): Promise<Payment> {
    const row = await repo.findPayment(exec, id);
    if (!row) throw billingErrors.paymentNotFound();
    const [summary] = await toSummaries(exec, [row]);
    if (!summary) throw errors.internal();
    const [months, charges, receipts, cancellations] = await Promise.all([
      repo.monthsOf(exec, id),
      repo.chargesOf(exec, id),
      repo.receiptsOf(exec, id),
      repo.cancellationsOf(exec, id),
    ]);
    return {
      ...summary,
      months: months.map((m) => ({
        period: dateToPeriod(m.period),
        baseAmount: m.baseAmount,
        surcharge: m.withSurcharge ? m.baseAmount : 0,
        total: m.withSurcharge ? m.baseAmount * 2 : m.baseAmount,
      })),
      charges: charges.map(toPublicCharge),
      receipts: receipts.map((r) => ({ ...r, issuedAt: r.issuedAt.toISOString() })),
      capturedBy: { userAccountId: row.capturedById, username: row.capturedByUsername },
      cancellations: cancellations.map((c) => ({
        status: c.result ?? 'pending',
        approvalId: c.approvalId,
        reason: c.reason,
        requestedAt: c.requestedAt.toISOString(),
        resolvedAt: c.resolvedAt?.toISOString() ?? null,
      })),
    };
  }

  /** A payment the viewer may see: block leaders only those of their block. */
  async function visiblePayment(exec: Executor, viewer: AuthenticatedAccount, id: number) {
    const row = await repo.findPayment(exec, id);
    if (!row) throw billingErrors.paymentNotFound();
    assertInScope(viewer, row.blockId);
    return row;
  }

  return {
    async getStatement(
      viewer: AuthenticatedAccount,
      unitId: number,
    ): Promise<AccountStatementResponse> {
      const loaded = (
        await loadAccountStatements(deps.db, [unitId], deps.now(), deps.timeZone)
      ).get(unitId);
      if (!loaded) throw new AppError('NOT_FOUND', 404, 'No existe esa unidad.');
      // A block leader only sees the debt of their own block (RF-PAD-04).
      assertInScope(viewer, loaded.blockId);
      return { statement: { unitId, ...loaded.statement } };
    },

    /** Prices a selection without saving anything (RF-PAG-03). */
    async preview(
      viewer: AuthenticatedAccount,
      input: PaymentPreviewRequest,
    ): Promise<{ preview: PaymentPreview }> {
      const priced = await priceRequest(db, viewer, input, deps.now(), null);
      return {
        preview: {
          unit: priced.unit && {
            id: priced.unit.id,
            folio: priced.unit.folio,
            holder: priced.unit.holder,
          },
          months: priced.months.map((m) => ({
            period: m.period,
            kind: m.kind,
            baseAmount: m.baseAmount,
            surcharge: m.surcharge,
            total: m.total,
          })),
          charges: priced.charges.map(toPublicCharge),
          total: priced.total,
          cashbox: await receivingCashbox(db, viewer, null),
        },
      };
    },

    /**
     * Registers a payment (RF-PAG-01 to 06, 2.3 §4): recomputes the total, refuses it when it
     * differs from what the operator saw (TOTAL_CHANGED), and stores the payment, its months
     * with the frozen rate and surcharge (D-25), the covered months, the charges and the
     * original paper receipt, all with the Idempotency-Key.
     */
    async register(
      actor: Actor,
      viewer: AuthenticatedAccount,
      idempotency: IdempotencyContext,
      input: CreatePaymentRequest,
    ): Promise<IdempotentResult> {
      const now = deps.now();
      try {
        return await idempotentTransaction(db, idempotency, async (tx) => {
          const priced = await priceRequest(tx, viewer, input, now, tx);
          if (priced.total !== input.expectedTotal) {
            throw billingErrors.totalChanged(input.expectedTotal, {
              total: priced.total,
              months: priced.months.map((m) => ({
                period: m.period,
                baseAmount: m.baseAmount,
                surcharge: m.surcharge,
                total: m.total,
              })),
              charges: priced.charges.map(toPublicCharge),
            });
          }
          const box = await receivingCashbox(tx, viewer, tx);
          if (box.id === null) throw errors.internal();
          await lockRecord(tx, 'cashbox', box.id);
          if (await repo.paperFolioTaken(tx, box.id, input.paperFolio)) {
            throw billingErrors.duplicatePaperFolio(input.paperFolio);
          }

          const paymentId = await repo.insertPayment(tx, {
            unitId: priced.unit?.id ?? null,
            cashboxId: box.id,
            occurredAt: now,
            idempotencyKey: idempotency.key,
            createdBy: actor.userAccountId,
          });
          await repo.insertPaymentMonths(
            tx,
            priced.months.map((m) => ({
              paymentId,
              period: periodToDate(m.period),
              rateId: m.rateId,
              withSurcharge: m.withSurcharge,
              createdBy: actor.userAccountId,
            })),
          );
          if (priced.unit) {
            const unitId = priced.unit.id;
            await repo.insertCoveredPeriods(
              tx,
              priced.months.map((m) => ({
                unitId,
                period: periodToDate(m.period),
                paymentId,
                createdBy: actor.userAccountId,
              })),
            );
          }
          await repo.insertPaymentCharges(
            tx,
            priced.charges.map((c) => ({
              paymentId,
              extraChargeId: c.id,
              createdBy: actor.userAccountId,
            })),
          );
          await repo.insertPaperReceipt(tx, {
            paymentId,
            cashboxId: box.id,
            paperFolio: input.paperFolio,
            type: 'original',
            issuedAt: now,
            createdBy: actor.userAccountId,
          });
          await writeAudit(tx, actor, {
            action: 'create',
            table: 'payment',
            recordId: paymentId,
            after: {
              unitId: priced.unit?.id ?? null,
              cashboxId: box.id,
              months: priced.months.map((m) => ({
                period: m.period,
                rateId: m.rateId,
                withSurcharge: m.withSurcharge,
              })),
              extraChargeIds: priced.charges.map((c) => c.id),
              total: priced.total,
              paperFolio: input.paperFolio,
            },
          });
          return { status: 201, body: { payment: await paymentDetail(tx, paymentId) } };
        });
      } catch (error) {
        if (isUniqueViolation(error, 'paper_receipt_cashbox_folio_unique')) {
          throw billingErrors.duplicatePaperFolio(input.paperFolio);
        }
        // Two payments of the same months at once: the second one hits the lock row.
        if (isUniqueViolation(error, 'covered_period_pk')) {
          throw billingErrors.periodAlreadyPaid(input.periods);
        }
        if (isUniqueViolation(error, 'payment_charge_extra_charge_id_unique')) {
          throw billingErrors.chargeNotPayable('El cargo ya está pagado.', 'paid');
        }
        throw error;
      }
    },

    async list(viewer: AuthenticatedAccount, query: PaymentListQuery) {
      const scope = blockScope(viewer);
      if (scope !== null && query.blockId !== undefined && query.blockId !== scope) {
        throw errors.outOfScope();
      }
      const rows = await repo.listPayments(db, {
        unitId: query.unitId,
        blockId: scope ?? query.blockId,
        from: query.from,
        to: query.to,
        cursor: query.cursor,
        limit: query.limit,
      });
      const page = toNextPage(rows, query.limit);
      return { data: await toSummaries(db, page.data), next: page.next };
    },

    async get(viewer: AuthenticatedAccount, id: number) {
      await visiblePayment(db, viewer, id);
      return { payment: await paymentDetail(db, id) };
    },

    /**
     * Replacement of a lost paper receipt (D-23, RF-PAG-08): free, without cash movement; the
     * new paper folio is tied to the original payment, in the receipt book of its cashbox.
     */
    async replaceReceipt(
      actor: Actor,
      viewer: AuthenticatedAccount,
      id: number,
      paperFolio: string,
    ) {
      const now = deps.now();
      try {
        return await db.transaction(async (tx) => {
          await lockRecord(tx, 'payment', id);
          const row = await visiblePayment(tx, viewer, id);
          if (row.cancelled) throw billingErrors.paymentCancelled('replace_receipt');
          await lockRecord(tx, 'cashbox', row.cashboxId);
          if (await repo.paperFolioTaken(tx, row.cashboxId, paperFolio)) {
            throw billingErrors.duplicatePaperFolio(paperFolio);
          }
          const receiptId = await repo.insertPaperReceipt(tx, {
            paymentId: id,
            cashboxId: row.cashboxId,
            paperFolio,
            type: 'replacement',
            issuedAt: now,
            createdBy: actor.userAccountId,
          });
          await writeAudit(tx, actor, {
            action: 'replace_receipt',
            table: 'paper_receipt',
            recordId: receiptId,
            after: { paymentId: id, paperFolio },
          });
          return { payment: await paymentDetail(tx, id) };
        });
      } catch (error) {
        if (isUniqueViolation(error, 'paper_receipt_cashbox_folio_unique')) {
          throw billingErrors.duplicatePaperFolio(paperFolio);
        }
        throw error;
      }
    },

    /**
     * Cancellation request (D-15, RF-PAG-09): the president approves it in the approvals
     * inbox; nothing changes until then.
     */
    async requestCancellation(
      actor: Actor,
      viewer: AuthenticatedAccount,
      idempotency: IdempotencyContext,
      id: number,
      reason: string,
    ): Promise<IdempotentResult> {
      const now = deps.now();
      return idempotentTransaction(db, idempotency, async (tx) => {
        await lockRecord(tx, 'payment', id);
        const row = await visiblePayment(tx, viewer, id);
        if (row.cancelled) throw billingErrors.paymentCancelled('request_cancellation');
        const previous = await repo.cancellationsOf(tx, id);
        if (previous.some((c) => c.result === null)) throw billingErrors.cancellationPending();
        const charges = await repo.chargesOf(tx, id);
        if (charges.some((c) => c.requestStatus === 'installed')) {
          throw billingErrors.openingInstalled('request_cancellation');
        }
        const request = await repo.insertCancellationRequest(tx, {
          paymentId: id,
          reason,
          requestedBy: actor.userAccountId,
          requestedAt: now,
        });
        await writeAudit(tx, actor, {
          action: 'request_cancellation',
          table: 'payment_cancellation',
          recordId: request.id,
          after: { paymentId: id, approvalId: request.approvalId },
          reason,
        });
        return { status: 201, body: { payment: await paymentDetail(tx, id) } };
      });
    },
  };
}

export type BillingService = ReturnType<typeof createBillingService>;

const auditActor = (account: AuthenticatedAccount): Actor => ({
  userAccountId: account.userAccountId,
  role: account.role,
});

/**
 * payment_cancellation (D-15): approving it frees the payment's months (deletes its
 * covered_period rows, so they are pending or overdue again) and re-issues its extra charges
 * so they can be paid again (a charge is paid once: payment_charge.extra_charge_id is unique;
 * the new charge keeps the charge date and so its frozen amount, D-13). The cashbox
 * counter-movement is derived in v_cashbox_movement; the database refuses it in a closed
 * month (D-14) and allows one approved cancellation per payment.
 */
export const paymentCancellationHandler: ApprovalHandler = {
  async onApproved({ tx, approvalId, actor, today }) {
    const [request] = await repo.cancellationsByApproval(tx, [approvalId]);
    if (!request) return;
    await lockRecord(tx, 'payment', request.paymentId);
    if (request.unitId !== null) await repo.lockUnitRow(tx, request.unitId);
    const charges = await repo.chargesOf(tx, request.paymentId);
    if (charges.some((c) => c.requestStatus === 'installed')) {
      throw billingErrors.openingInstalled('cancel_payment');
    }
    const freed = await repo.deleteCoveredPeriods(tx, request.paymentId);
    const reissued: { from: number; to: number }[] = [];
    for (const charge of charges) {
      if (charge.cancelledOn !== null) continue;
      await repo.cancelCharge(tx, charge.id, today);
      const id = await repo.insertCharge(tx, {
        feeId: charge.feeId,
        connectionRequestId: charge.connectionRequestId,
        connectionId: charge.connectionId,
        unitId: charge.unitId,
        chargedOn: charge.chargedOn,
        createdBy: actor.userAccountId,
      });
      reissued.push({ from: charge.id, to: id });
    }
    await writeAudit(tx, actor, {
      action: 'cancel',
      table: 'payment',
      recordId: request.paymentId,
      before: { coveredPeriods: freed.map((f) => dateToPeriod(f.period)) },
      after: { coveredPeriods: [], reissuedCharges: reissued },
    });
  },
  async onRejected() {},
  async describe(db, approvalIds) {
    const rows = await repo.cancellationsByApproval(db, approvalIds);
    return new Map(
      rows.map((r) => [r.approvalId, `Cancelar el pago ${r.folio} (${formatMoney(r.total)})`]),
    );
  },
};
