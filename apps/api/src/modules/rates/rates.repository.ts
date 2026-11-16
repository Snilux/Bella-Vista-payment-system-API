import { and, asc, desc, eq, gte, inArray, isNull, lte, or } from 'drizzle-orm';
import type { Database, Transaction } from '../../db/client.js';
import { lockRecord } from '../../db/locks.js';
import { agreement, approval, extraCharge, fee, feeAmount, rate } from '../../db/schema/index.js';

// Queries of rates and fees (CU-12). The services decide and open the transactions.

type Executor = Database | Transaction;

// --- Rates ----------------------------------------------------------------------------------

function rateQuery(db: Executor) {
  return db
    .select({
      id: rate.id,
      effectivePeriod: rate.effectivePeriod,
      amount: rate.amount,
      approvedOn: rate.approvedOn,
      agreementId: agreement.id,
      agreementFolio: agreement.folio,
      approvalId: rate.approvalId,
      result: approval.result,
      createdAt: rate.createdAt,
    })
    .from(rate)
    .innerJoin(agreement, eq(agreement.id, rate.agreementId))
    .innerJoin(approval, eq(approval.id, rate.approvalId));
}

export type RateRow = Awaited<ReturnType<typeof listRates>>[number];

/** Full history, newest effective period first. */
export function listRates(db: Executor) {
  return rateQuery(db).orderBy(desc(rate.effectivePeriod), desc(rate.id));
}

export async function findRate(db: Executor, id: number): Promise<RateRow | null> {
  const [row] = await rateQuery(db).where(eq(rate.id, id)).limit(1);
  return row ?? null;
}

export function ratesByApproval(db: Executor, approvalIds: number[]) {
  if (approvalIds.length === 0) return Promise.resolve([]);
  return rateQuery(db).where(inArray(rate.approvalId, approvalIds));
}

/** The rate of an approval, with its period locked (approval handler). */
export async function lockRateByApproval(tx: Transaction, approvalId: number) {
  const [row] = await tx
    .select({ id: rate.id, effectivePeriod: rate.effectivePeriod })
    .from(rate)
    .where(eq(rate.approvalId, approvalId));
  if (!row) return null;
  await lockRateRegistration(tx);
  return row;
}

/** Rates of `effectivePeriod` that are pending or approved (an open slot), except `exceptId`. */
export async function openRatesFor(db: Executor, effectivePeriod: string, exceptId?: number) {
  const rows = await db
    .select({ id: rate.id, result: approval.result })
    .from(rate)
    .innerJoin(approval, eq(approval.id, rate.approvalId))
    .where(
      and(
        eq(rate.effectivePeriod, effectivePeriod),
        or(isNull(approval.result), eq(approval.result, 'approved')),
      ),
    );
  return rows.filter((r) => r.id !== exceptId);
}

/** Effective period of the earliest approved rate, or null when none is approved. */
export async function earliestApprovedPeriod(db: Executor): Promise<string | null> {
  const [row] = await db
    .select({ effectivePeriod: rate.effectivePeriod })
    .from(rate)
    .innerJoin(approval, eq(approval.id, rate.approvalId))
    .where(eq(approval.result, 'approved'))
    .orderBy(asc(rate.effectivePeriod))
    .limit(1);
  return row?.effectivePeriod ?? null;
}

/**
 * Serializes rate registrations: two treasurers' requests for the same period cannot both
 * pass the "open slot" check.
 */
export async function lockRateRegistration(tx: Transaction): Promise<void> {
  await lockRecord(tx, 'rate', 'registration');
}

export async function insertRateWithApproval(
  tx: Transaction,
  values: {
    effectivePeriod: string;
    amount: number;
    approvedOn: string;
    agreementId: number;
    reason: string;
    requestedBy: number;
    requestedAt: Date;
  },
): Promise<{ id: number; approvalId: number }> {
  const [request] = await tx
    .insert(approval)
    .values({
      type: 'rate',
      reason: values.reason,
      requestedBy: values.requestedBy,
      requestedAt: values.requestedAt,
      createdBy: values.requestedBy,
    })
    .returning({ id: approval.id });
  if (!request) throw new Error('approval not inserted');
  const [row] = await tx
    .insert(rate)
    .values({
      effectivePeriod: values.effectivePeriod,
      amount: values.amount,
      approvedOn: values.approvedOn,
      agreementId: values.agreementId,
      approvalId: request.id,
      createdBy: values.requestedBy,
    })
    .returning({ id: rate.id });
  if (!row) throw new Error('rate not inserted');
  return { id: row.id, approvalId: request.id };
}

export async function findAgreement(db: Executor, id: number) {
  const [row] = await db
    .select({ id: agreement.id, folio: agreement.folio, result: agreement.result })
    .from(agreement)
    .where(eq(agreement.id, id))
    .limit(1);
  return row ?? null;
}

// --- Fees -----------------------------------------------------------------------------------

export function listFees(db: Executor) {
  return db.select({ id: fee.id, type: fee.type, name: fee.name }).from(fee).orderBy(fee.id);
}

export async function findFee(db: Executor, id: number) {
  const [row] = await db
    .select({ id: fee.id, type: fee.type, name: fee.name })
    .from(fee)
    .where(eq(fee.id, id))
    .limit(1);
  return row ?? null;
}

/** The fee, locked for its amount history (advisory lock: no UPDATE grant on fee). */
export async function lockFee(tx: Transaction, id: number) {
  await lockRecord(tx, 'fee', id);
  return findFee(tx, id);
}

/** Amount history of the fees, newest first. */
export function amountsOf(db: Executor, feeIds: number[]) {
  if (feeIds.length === 0) return Promise.resolve([]);
  return db
    .select({
      feeId: feeAmount.feeId,
      effectiveFrom: feeAmount.effectiveFrom,
      amount: feeAmount.amount,
    })
    .from(feeAmount)
    .where(inArray(feeAmount.feeId, feeIds))
    .orderBy(desc(feeAmount.effectiveFrom));
}

export async function insertFee(tx: Transaction, values: typeof fee.$inferInsert) {
  const [row] = await tx.insert(fee).values(values).returning({ id: fee.id });
  if (!row) throw new Error('fee not inserted');
  return row.id;
}

export async function insertFeeAmount(tx: Transaction, values: typeof feeAmount.$inferInsert) {
  await tx.insert(feeAmount).values(values);
}

export async function amountOn(db: Executor, feeId: number, on: string) {
  const [row] = await db
    .select({ amount: feeAmount.amount })
    .from(feeAmount)
    .where(and(eq(feeAmount.feeId, feeId), lte(feeAmount.effectiveFrom, on)))
    .orderBy(desc(feeAmount.effectiveFrom))
    .limit(1);
  return row?.amount ?? null;
}

/** Whether the fee has charges dated on or after `on` (a new amount would change them). */
export async function hasChargesSince(db: Executor, feeId: number, on: string) {
  const [row] = await db
    .select({ id: extraCharge.id })
    .from(extraCharge)
    .where(and(eq(extraCharge.feeId, feeId), gte(extraCharge.chargedOn, on)))
    .limit(1);
  return row !== undefined;
}
