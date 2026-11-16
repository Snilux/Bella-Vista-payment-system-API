import { and, asc, desc, eq, gte, inArray, isNotNull, lt, lte, or, sql } from 'drizzle-orm';
import type { Database, Transaction } from '../../db/client.js';
import {
  approval,
  cashbox,
  connectionRequest,
  coveredPeriod,
  extraCharge,
  fee,
  paperReceipt,
  payment,
  paymentCancellation,
  paymentCharge,
  paymentMonth,
  person,
  rate,
  suspension,
  unit,
  userAccount,
  vBlock,
  vConnection,
  vConnectionRequest,
  vPaymentAmount,
  vUnit,
} from '../../db/schema/index.js';

// Data of the account statement, loaded in batch: four queries whatever the number of units
// (no N+1 in lists, details or search).

type Executor = Database | Transaction;

export function unitsForStatement(db: Executor, unitIds: number[]) {
  return db
    .select({
      id: unit.id,
      connectionId: unit.connectionId,
      billingStartPeriod: unit.billingStartPeriod,
      deactivatedOn: unit.deactivatedOn,
      blockId: vConnection.blockId,
    })
    .from(unit)
    .innerJoin(vConnection, eq(vConnection.id, unit.connectionId))
    .where(inArray(unit.id, unitIds));
}

/** Rates approved by the president (D-20); pending or rejected ones never apply. */
export function approvedRates(db: Executor) {
  return db
    .select({ id: rate.id, effectivePeriod: rate.effectivePeriod, amount: rate.amount })
    .from(rate)
    .innerJoin(approval, eq(approval.id, rate.approvalId))
    .where(eq(approval.result, 'approved'));
}

/** Suspensions of the units or of their connections (D-06). */
export function suspensionsFor(db: Executor, unitIds: number[], connectionIds: number[]) {
  return db
    .select({
      unitId: suspension.unitId,
      connectionId: suspension.connectionId,
      periodFrom: suspension.periodFrom,
      periodTo: suspension.periodTo,
    })
    .from(suspension)
    .where(
      or(
        and(isNotNull(suspension.unitId), inArray(suspension.unitId, unitIds)),
        connectionIds.length > 0 ? inArray(suspension.connectionId, connectionIds) : undefined,
      ),
    );
}

/**
 * Months covered today, with the frozen rate and surcharge and the date of their payment. A
 * cancelled payment has no covered rows left, so it never appears.
 */
export function coveredMonthsFor(db: Executor, unitIds: number[]) {
  return db
    .select({
      unitId: coveredPeriod.unitId,
      period: coveredPeriod.period,
      paymentId: coveredPeriod.paymentId,
      paidAt: payment.occurredAt,
      rateId: paymentMonth.rateId,
      baseAmount: rate.amount,
      withSurcharge: paymentMonth.withSurcharge,
    })
    .from(coveredPeriod)
    .innerJoin(payment, eq(payment.id, coveredPeriod.paymentId))
    .innerJoin(
      paymentMonth,
      and(
        eq(paymentMonth.paymentId, coveredPeriod.paymentId),
        eq(paymentMonth.period, coveredPeriod.period),
      ),
    )
    .innerJoin(rate, eq(rate.id, paymentMonth.rateId))
    .where(inArray(coveredPeriod.unitId, unitIds));
}

// --- Payments -------------------------------------------------------------------------------
// Row locks: unit and connection_request use SELECT ... FOR UPDATE; payment and cashbox have no
// UPDATE grant for the API user, so they use lockRecord (db/locks.ts).

const personName = (p: typeof person) =>
  sql<string>`concat_ws(' ', ${p.givenNames}, ${p.paternalSurname}, ${p.maternalSurname})`;

/** Locks a unit (FOR UPDATE): payments and cancellations of the same unit go one at a time. */
export async function lockUnitRow(tx: Transaction, id: number): Promise<boolean> {
  const [locked] = await tx.select({ id: unit.id }).from(unit).where(eq(unit.id, id)).for('update');
  return locked !== undefined;
}

/** The unit to collect from, with its folio, connection, current block and status. */
export async function findPaymentUnit(db: Executor, id: number) {
  const [row] = await db
    .select({
      id: vUnit.id,
      folio: vUnit.folio,
      connectionId: vUnit.connectionId,
      status: vUnit.status,
      blockId: vConnection.blockId,
      holder: personName(person),
    })
    .from(vUnit)
    .innerJoin(vConnection, eq(vConnection.id, vUnit.connectionId))
    .leftJoin(person, eq(person.id, vUnit.holderPersonId))
    .where(eq(vUnit.id, id))
    .limit(1);
  return row ?? null;
}

/** Locks connection requests (FOR UPDATE) so their opening is paid once. */
export async function lockConnectionRequests(tx: Transaction, ids: number[]) {
  if (ids.length === 0) return;
  await tx
    .select({ id: connectionRequest.id })
    .from(connectionRequest)
    .where(inArray(connectionRequest.id, ids))
    .orderBy(connectionRequest.id)
    .for('update');
}

const chargeAmount = sql<number>`(
  SELECT fa.amount FROM fee_amount fa
  WHERE fa.fee_id = ${extraCharge.feeId} AND fa.effective_from <= ${extraCharge.chargedOn}
  ORDER BY fa.effective_from DESC LIMIT 1)`.mapWith(Number);

/** Extra charges with their amount (D-13), target, and whether a valid payment settled them. */
export function chargesByIds(db: Executor, ids: number[]) {
  if (ids.length === 0) return Promise.resolve([]);
  return db
    .select({
      id: extraCharge.id,
      feeId: extraCharge.feeId,
      feeName: fee.name,
      feeType: fee.type,
      connectionRequestId: extraCharge.connectionRequestId,
      connectionId: extraCharge.connectionId,
      unitId: extraCharge.unitId,
      chargedOn: extraCharge.chargedOn,
      cancelledOn: extraCharge.cancelledOn,
      amount: chargeAmount,
      paid: sql<boolean>`EXISTS (
        SELECT 1 FROM payment_charge pc
        JOIN v_payment_amount pa ON pa.id = pc.payment_id
        WHERE pc.extra_charge_id = ${extraCharge.id} AND NOT pa.cancelled)`,
      requestBlockId: vConnectionRequest.blockId,
      requestStatus: vConnectionRequest.status,
    })
    .from(extraCharge)
    .innerJoin(fee, eq(fee.id, extraCharge.feeId))
    .leftJoin(vConnectionRequest, eq(vConnectionRequest.id, extraCharge.connectionRequestId))
    .where(inArray(extraCharge.id, ids));
}

export type ChargeRow = Awaited<ReturnType<typeof chargesByIds>>[number];

// --- Cashboxes ------------------------------------------------------------------------------

export async function blockCashbox(db: Executor, blockId: number) {
  const [row] = await db
    .select({ id: cashbox.id })
    .from(cashbox)
    .where(eq(cashbox.blockId, blockId))
    .limit(1);
  return row?.id ?? null;
}

export async function committeeCashbox(db: Executor) {
  const [row] = await db
    .select({ id: cashbox.id })
    .from(cashbox)
    .where(eq(cashbox.type, 'committee'))
    .limit(1);
  return row?.id ?? null;
}

export async function supportCashbox(db: Executor, personId: number) {
  const [row] = await db
    .select({ id: cashbox.id })
    .from(cashbox)
    .where(eq(cashbox.custodianPersonId, personId))
    .limit(1);
  return row?.id ?? null;
}

export async function insertCashbox(tx: Transaction, values: typeof cashbox.$inferInsert) {
  const [row] = await tx.insert(cashbox).values(values).returning();
  if (!row) throw new Error('cashbox not inserted');
  return row;
}

/** Labels of cashboxes: block code, "Comité" or "Apoyo · <custodian>". */
export function cashboxLabels(db: Executor, ids: number[]) {
  if (ids.length === 0) return Promise.resolve([]);
  return db
    .select({
      id: cashbox.id,
      type: cashbox.type,
      label: sql<string>`CASE ${cashbox.type}
        WHEN 'block' THEN ${vBlock.code}
        WHEN 'committee' THEN 'Comité'
        ELSE 'Apoyo · ' || ${personName(person)} END`,
    })
    .from(cashbox)
    .leftJoin(vBlock, eq(vBlock.id, cashbox.blockId))
    .leftJoin(person, eq(person.id, cashbox.custodianPersonId))
    .where(inArray(cashbox.id, ids));
}

export async function blockCode(db: Executor, blockId: number) {
  const [row] = await db.select({ code: vBlock.code }).from(vBlock).where(eq(vBlock.id, blockId));
  return row?.code ?? null;
}

export async function personFullName(db: Executor, personId: number) {
  const [row] = await db
    .select({ name: personName(person) })
    .from(person)
    .where(eq(person.id, personId));
  return row?.name ?? null;
}

// --- Writing a payment ----------------------------------------------------------------------

export async function paperFolioTaken(db: Executor, cashboxId: number, paperFolio: string) {
  const [row] = await db
    .select({ id: paperReceipt.id })
    .from(paperReceipt)
    .where(and(eq(paperReceipt.cashboxId, cashboxId), eq(paperReceipt.paperFolio, paperFolio)))
    .limit(1);
  return row !== undefined;
}

export async function insertPayment(tx: Transaction, values: typeof payment.$inferInsert) {
  const [row] = await tx.insert(payment).values(values).returning({ id: payment.id });
  if (!row) throw new Error('payment not inserted');
  return row.id;
}

export async function insertPaymentMonths(
  tx: Transaction,
  rows: (typeof paymentMonth.$inferInsert)[],
) {
  if (rows.length > 0) await tx.insert(paymentMonth).values(rows);
}

export async function insertCoveredPeriods(
  tx: Transaction,
  rows: (typeof coveredPeriod.$inferInsert)[],
) {
  if (rows.length > 0) await tx.insert(coveredPeriod).values(rows);
}

export async function insertPaymentCharges(
  tx: Transaction,
  rows: (typeof paymentCharge.$inferInsert)[],
) {
  if (rows.length > 0) await tx.insert(paymentCharge).values(rows);
}

export async function insertPaperReceipt(
  tx: Transaction,
  values: typeof paperReceipt.$inferInsert,
) {
  const [row] = await tx.insert(paperReceipt).values(values).returning({ id: paperReceipt.id });
  if (!row) throw new Error('paper receipt not inserted');
  return row.id;
}

// --- Reading payments -----------------------------------------------------------------------

function paymentQuery(db: Executor) {
  return db
    .select({
      id: vPaymentAmount.id,
      folio: vPaymentAmount.folio,
      unitId: vPaymentAmount.unitId,
      unitFolio: unit.folio,
      holder: personName(person),
      blockId: vPaymentAmount.blockId,
      cashboxId: vPaymentAmount.cashboxId,
      total: vPaymentAmount.total,
      occurredAt: vPaymentAmount.occurredAt,
      cancelled: vPaymentAmount.cancelled,
      capturedById: userAccount.id,
      capturedByUsername: userAccount.username,
      paperFolio: paperReceipt.paperFolio,
    })
    .from(vPaymentAmount)
    .innerJoin(payment, eq(payment.id, vPaymentAmount.id))
    .innerJoin(userAccount, eq(userAccount.id, payment.createdBy))
    .leftJoin(unit, eq(unit.id, vPaymentAmount.unitId))
    .leftJoin(person, eq(person.id, vPaymentAmount.holderPersonId))
    .leftJoin(
      paperReceipt,
      and(eq(paperReceipt.paymentId, vPaymentAmount.id), eq(paperReceipt.type, 'original')),
    );
}

export type PaymentRow = Awaited<ReturnType<typeof listPayments>>[number];

export async function findPayment(db: Executor, id: number): Promise<PaymentRow | null> {
  const [row] = await paymentQuery(db).where(eq(vPaymentAmount.id, id)).limit(1);
  return row ?? null;
}

export function listPayments(
  db: Executor,
  filter: {
    unitId?: number | undefined;
    blockId?: number | null | undefined;
    from?: string | undefined;
    to?: string | undefined;
    cursor?: number | undefined;
    limit: number;
  },
) {
  return paymentQuery(db)
    .where(
      and(
        filter.unitId !== undefined ? eq(vPaymentAmount.unitId, filter.unitId) : undefined,
        filter.blockId != null ? eq(vPaymentAmount.blockId, filter.blockId) : undefined,
        filter.from !== undefined ? gte(vPaymentAmount.occurredOn, filter.from) : undefined,
        filter.to !== undefined ? lte(vPaymentAmount.occurredOn, filter.to) : undefined,
        filter.cursor !== undefined ? lt(vPaymentAmount.id, filter.cursor) : undefined,
      ),
    )
    .orderBy(desc(vPaymentAmount.id))
    .limit(filter.limit + 1);
}

export function monthsOf(db: Executor, paymentId: number) {
  return db
    .select({
      period: paymentMonth.period,
      baseAmount: rate.amount,
      withSurcharge: paymentMonth.withSurcharge,
    })
    .from(paymentMonth)
    .innerJoin(rate, eq(rate.id, paymentMonth.rateId))
    .where(eq(paymentMonth.paymentId, paymentId))
    .orderBy(asc(paymentMonth.period));
}

export function chargesOf(db: Executor, paymentId: number) {
  return db
    .select({
      id: extraCharge.id,
      feeId: extraCharge.feeId,
      feeName: fee.name,
      feeType: fee.type,
      connectionRequestId: extraCharge.connectionRequestId,
      connectionId: extraCharge.connectionId,
      unitId: extraCharge.unitId,
      chargedOn: extraCharge.chargedOn,
      cancelledOn: extraCharge.cancelledOn,
      amount: chargeAmount,
      requestStatus: vConnectionRequest.status,
    })
    .from(paymentCharge)
    .innerJoin(extraCharge, eq(extraCharge.id, paymentCharge.extraChargeId))
    .innerJoin(fee, eq(fee.id, extraCharge.feeId))
    .leftJoin(vConnectionRequest, eq(vConnectionRequest.id, extraCharge.connectionRequestId))
    .where(eq(paymentCharge.paymentId, paymentId))
    .orderBy(asc(extraCharge.id));
}

export function receiptsOf(db: Executor, paymentId: number) {
  return db
    .select({
      id: paperReceipt.id,
      paperFolio: paperReceipt.paperFolio,
      type: paperReceipt.type,
      issuedAt: paperReceipt.issuedAt,
    })
    .from(paperReceipt)
    .where(eq(paperReceipt.paymentId, paymentId))
    .orderBy(asc(paperReceipt.id));
}

export function cancellationsOf(db: Executor, paymentId: number) {
  return db
    .select({
      approvalId: approval.id,
      result: approval.result,
      reason: approval.reason,
      requestedAt: approval.requestedAt,
      resolvedAt: approval.resolvedAt,
    })
    .from(paymentCancellation)
    .innerJoin(approval, eq(approval.id, paymentCancellation.approvalId))
    .where(eq(paymentCancellation.paymentId, paymentId))
    .orderBy(desc(approval.id));
}

// --- Cancellation (D-15) --------------------------------------------------------------------

export async function insertCancellationRequest(
  tx: Transaction,
  values: { paymentId: number; reason: string; requestedBy: number; requestedAt: Date },
) {
  const [request] = await tx
    .insert(approval)
    .values({
      type: 'payment_cancellation',
      reason: values.reason,
      requestedBy: values.requestedBy,
      requestedAt: values.requestedAt,
      createdBy: values.requestedBy,
    })
    .returning({ id: approval.id });
  if (!request) throw new Error('approval not inserted');
  const [row] = await tx
    .insert(paymentCancellation)
    .values({ paymentId: values.paymentId, approvalId: request.id, createdBy: values.requestedBy })
    .returning({ id: paymentCancellation.id });
  if (!row) throw new Error('payment cancellation not inserted');
  return { id: row.id, approvalId: request.id };
}

export function cancellationsByApproval(db: Executor, approvalIds: number[]) {
  if (approvalIds.length === 0) return Promise.resolve([]);
  return db
    .select({
      approvalId: paymentCancellation.approvalId,
      paymentId: paymentCancellation.paymentId,
      folio: vPaymentAmount.folio,
      total: vPaymentAmount.total,
      unitId: vPaymentAmount.unitId,
    })
    .from(paymentCancellation)
    .innerJoin(vPaymentAmount, eq(vPaymentAmount.id, paymentCancellation.paymentId))
    .where(inArray(paymentCancellation.approvalId, approvalIds));
}

/** Frees the months of a cancelled payment (the only DELETE in billing). */
export function deleteCoveredPeriods(tx: Transaction, paymentId: number) {
  return tx
    .delete(coveredPeriod)
    .where(eq(coveredPeriod.paymentId, paymentId))
    .returning({ unitId: coveredPeriod.unitId, period: coveredPeriod.period });
}

export async function cancelCharge(tx: Transaction, id: number, on: string) {
  await tx.update(extraCharge).set({ cancelledOn: on }).where(eq(extraCharge.id, id));
}

export async function insertCharge(tx: Transaction, values: typeof extraCharge.$inferInsert) {
  const [row] = await tx.insert(extraCharge).values(values).returning({ id: extraCharge.id });
  if (!row) throw new Error('extra charge not inserted');
  return row.id;
}
