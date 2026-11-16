import { and, between, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import {
  approval,
  cashbox,
  expenseCategory,
  handover,
  openingBalance,
  paperReceipt,
  paymentCancellation,
  person,
  section,
  vBlock,
  vCashboxBalance,
  vCashboxMovement,
  vClosing,
  vConnection,
  vExpense,
  vPaymentAmount,
  vUnit,
} from '../../db/schema/index.js';

// Report queries (CU-23, CU-24): a fixed number of grouped queries per report, whatever the
// number of blocks, connections or units (no N+1). Money figures come from the same views as
// the closings (v_cashbox_movement, v_payment_amount), so the totals agree with them.

type Range = { dateFrom: string; dateTo: string };

const personName = sql<string>`concat_ws(' ', ${person.givenNames}, ${person.paternalSurname}, ${person.maternalSurname})`;

export async function findBlock(db: Database, id: number) {
  const [row] = await db
    .select({
      id: vBlock.id,
      code: vBlock.code,
      name: vBlock.name,
      sectionId: section.id,
      sectionCode: section.code,
      sectionName: section.name,
      leaderName: vBlock.leaderName,
      leaderPhone: vBlock.leaderContactPhone,
    })
    .from(vBlock)
    .innerJoin(section, eq(section.id, vBlock.sectionId))
    .where(eq(vBlock.id, id))
    .limit(1);
  return row ?? null;
}

export function listBlocks(db: Database) {
  return db
    .select({
      id: vBlock.id,
      code: vBlock.code,
      leaderName: vBlock.leaderName,
      sectionId: section.id,
      sectionCode: section.code,
      sectionName: section.name,
    })
    .from(vBlock)
    .innerJoin(section, eq(section.id, vBlock.sectionId))
    .orderBy(section.code, vBlock.code);
}

/** Connections currently in the block. */
export function connectionsOfBlock(db: Database, blockId: number) {
  return db
    .select({
      id: vConnection.id,
      folio: vConnection.folio,
      address: vConnection.address,
      status: vConnection.status,
    })
    .from(vConnection)
    .where(eq(vConnection.blockId, blockId))
    .orderBy(vConnection.folio);
}

/** Units with their connection's current block, status and current holder. */
export function units(db: Database, blockId?: number) {
  return db
    .select({
      id: vUnit.id,
      folio: vUnit.folio,
      connectionId: vUnit.connectionId,
      blockId: vConnection.blockId,
      reference: vUnit.reference,
      registeredOn: vUnit.registeredOn,
      activatedOn: vUnit.activatedOn,
      status: vUnit.status,
      holderName: sql<
        string | null
      >`CASE WHEN ${person.id} IS NULL THEN NULL ELSE ${personName} END`,
      holderNote: person.distinguishingNote,
    })
    .from(vUnit)
    .innerJoin(vConnection, eq(vConnection.id, vUnit.connectionId))
    .leftJoin(person, eq(person.id, vUnit.holderPersonId))
    .where(blockId !== undefined ? eq(vConnection.blockId, blockId) : undefined)
    .orderBy(vUnit.folio);
}

/** Payments of the units in the range, with the original paper folio. */
export function paymentsOfUnits(db: Database, unitIds: number[], range: Range) {
  if (unitIds.length === 0) return Promise.resolve([]);
  return db
    .select({
      id: vPaymentAmount.id,
      folio: vPaymentAmount.folio,
      unitId: vPaymentAmount.unitId,
      occurredAt: vPaymentAmount.occurredAt,
      total: vPaymentAmount.total,
      cancelled: vPaymentAmount.cancelled,
      paperFolio: paperReceipt.paperFolio,
    })
    .from(vPaymentAmount)
    .leftJoin(
      paperReceipt,
      and(eq(paperReceipt.paymentId, vPaymentAmount.id), eq(paperReceipt.type, 'original')),
    )
    .where(
      and(
        inArray(vPaymentAmount.unitId, unitIds),
        between(vPaymentAmount.occurredOn, range.dateFrom, range.dateTo),
      ),
    )
    .orderBy(vPaymentAmount.occurredAt);
}

export function cashboxes(db: Database) {
  return db
    .select({
      id: cashbox.id,
      type: cashbox.type,
      blockId: cashbox.blockId,
      balance: vCashboxBalance.balance,
    })
    .from(cashbox)
    .innerJoin(vCashboxBalance, eq(vCashboxBalance.cashboxId, cashbox.id))
    .orderBy(cashbox.id);
}

/** Movements of the range by cashbox and kind (the figures of v_closing). */
export function movementsByKind(db: Database, range: Range, cashboxId?: number) {
  return db
    .select({
      cashboxId: vCashboxMovement.cashboxId,
      kind: vCashboxMovement.kind,
      amount: sql<number>`coalesce(sum(${vCashboxMovement.amount}), 0)`.mapWith(Number),
    })
    .from(vCashboxMovement)
    .where(
      and(
        between(vCashboxMovement.occurredOn, range.dateFrom, range.dateTo),
        cashboxId !== undefined ? eq(vCashboxMovement.cashboxId, cashboxId) : undefined,
      ),
    )
    .groupBy(vCashboxMovement.cashboxId, vCashboxMovement.kind);
}

/** Monthly fees and extra charges received by a cashbox in the range. */
export async function paymentSplit(db: Database, cashboxId: number, range: Range) {
  const [row] = await db
    .select({
      fees: sql<number>`coalesce(sum(${vPaymentAmount.monthsAmount}), 0)`.mapWith(Number),
      charges: sql<number>`coalesce(sum(${vPaymentAmount.chargesAmount}), 0)`.mapWith(Number),
    })
    .from(vPaymentAmount)
    .where(
      and(
        eq(vPaymentAmount.cashboxId, cashboxId),
        between(vPaymentAmount.occurredOn, range.dateFrom, range.dateTo),
      ),
    );
  return row ?? { fees: 0, charges: 0 };
}

/** Payments of the range by the block they served (any cashbox). */
export function paymentsByBlock(db: Database, range: Range) {
  return db
    .select({
      blockId: vPaymentAmount.blockId,
      amount: sql<number>`coalesce(sum(${vPaymentAmount.total}), 0)`.mapWith(Number),
    })
    .from(vPaymentAmount)
    .where(between(vPaymentAmount.occurredOn, range.dateFrom, range.dateTo))
    .groupBy(vPaymentAmount.blockId);
}

/**
 * Cancellations approved in the range by the block of their payment, as v_cashbox_movement
 * dates them (on the resolution date, D-14).
 */
export function cancellationsByBlock(db: Database, range: Range) {
  const resolvedOn = sql`f_business_date(${approval.resolvedAt})`;
  return db
    .select({
      blockId: vPaymentAmount.blockId,
      amount: sql<number>`coalesce(sum(${vPaymentAmount.total}), 0)`.mapWith(Number),
    })
    .from(paymentCancellation)
    .innerJoin(approval, eq(approval.id, paymentCancellation.approvalId))
    .innerJoin(vPaymentAmount, eq(vPaymentAmount.id, paymentCancellation.paymentId))
    .where(
      and(
        eq(approval.result, 'approved'),
        sql`${resolvedOn} BETWEEN ${range.dateFrom} AND ${range.dateTo}`,
      ),
    )
    .groupBy(vPaymentAmount.blockId);
}

export async function pendingHandovers(db: Database, cashboxId: number) {
  const [row] = await db
    .select({
      total: sql<number>`coalesce(sum(${handover.declaredAmount}), 0)`.mapWith(Number),
    })
    .from(handover)
    .where(
      and(
        eq(handover.sourceCashboxId, cashboxId),
        sql`${handover.withdrawnAt} IS NULL AND ${handover.confirmedAt} IS NULL`,
      ),
    );
  return row?.total ?? 0;
}

export async function approvedOpeningBalance(db: Database, cashboxId: number) {
  const [row] = await db
    .select({ amount: openingBalance.amount })
    .from(openingBalance)
    .innerJoin(approval, eq(approval.id, openingBalance.approvalId))
    .where(and(eq(openingBalance.cashboxId, cashboxId), eq(approval.result, 'approved')))
    .limit(1);
  return row?.amount ?? null;
}

export async function lastClosing(db: Database, cashboxId: number) {
  const [row] = await db
    .select({
      id: vClosing.id,
      folio: vClosing.folio,
      type: vClosing.type,
      dateFrom: vClosing.dateFrom,
      dateTo: vClosing.dateTo,
      status: vClosing.status,
      difference: vClosing.difference,
    })
    .from(vClosing)
    .where(eq(vClosing.cashboxId, cashboxId))
    .orderBy(desc(vClosing.dateTo), desc(vClosing.id))
    .limit(1);
  return row ?? null;
}

/** Paid expenses of the range by category (positive amounts). */
export function expensesByCategory(db: Database, range: Range) {
  return db
    .select({
      categoryId: expenseCategory.id,
      name: expenseCategory.name,
      amount: sql<number>`coalesce(sum(${vExpense.effectiveAmount}), 0)`.mapWith(Number),
    })
    .from(vExpense)
    .innerJoin(expenseCategory, eq(expenseCategory.id, vExpense.categoryId))
    .where(and(isNotNull(vExpense.paidOn), between(vExpense.paidOn, range.dateFrom, range.dateTo)))
    .groupBy(expenseCategory.id, expenseCategory.name)
    .orderBy(expenseCategory.id);
}

/** Sum of the differences of the closings counted whose range starts in the report range. */
export async function closingDifferences(db: Database, range: Range) {
  const [row] = await db
    .select({
      total: sql<number>`coalesce(sum(${vClosing.difference}), 0)`.mapWith(Number),
    })
    .from(vClosing)
    .where(
      and(isNotNull(vClosing.difference), between(vClosing.dateFrom, range.dateFrom, range.dateTo)),
    );
  return row?.total ?? 0;
}
