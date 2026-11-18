import { and, desc, eq, gte, isNotNull, lt, lte, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Database, Transaction } from '../../db/client.js';
import { closing, userAccount, vCashboxMovement, vClosing } from '../../db/schema/index.js';

// Queries of closings (CU-22). The figures come from v_closing; closing has UPDATE grants on
// its count, review and close columns, so it is locked FOR UPDATE.

type Executor = Database | Transaction;

const preparer = alias(userAccount, 'preparer');
const reviewer = alias(userAccount, 'reviewer');
const closer = alias(userAccount, 'closer');

function closingQuery(db: Executor) {
  return db
    .select({
      id: vClosing.id,
      folio: vClosing.folio,
      cashboxId: vClosing.cashboxId,
      type: vClosing.type,
      dateFrom: vClosing.dateFrom,
      dateTo: vClosing.dateTo,
      status: vClosing.status,
      startingBalance: vClosing.startingBalance,
      openingBalances: vClosing.totalOpeningBalances,
      payments: vClosing.totalPayments,
      cancellations: vClosing.totalCancellations,
      handoversOut: vClosing.totalHandoversOut,
      handoversIn: vClosing.totalHandoversIn,
      incomes: vClosing.totalIncomes,
      expenses: vClosing.totalExpenses,
      refunds: vClosing.totalRefunds,
      adjustments: vClosing.totalAdjustments,
      expectedBalance: vClosing.expectedBalance,
      countedCash: vClosing.countedCash,
      difference: vClosing.difference,
      notes: closing.notes,
      preparedById: preparer.id,
      preparedByUsername: preparer.username,
      preparedByName: sql<string>`(SELECT concat_ws(' ', p.given_names, p.paternal_surname, p.maternal_surname)
        FROM role_assignment ra JOIN person p ON p.id = ra.person_id
        WHERE ra.id = ${preparer.roleAssignmentId})`,
      reviewedById: reviewer.id,
      reviewedByUsername: reviewer.username,
      reviewedByName: sql<string>`(SELECT concat_ws(' ', p.given_names, p.paternal_surname, p.maternal_surname)
        FROM role_assignment ra JOIN person p ON p.id = ra.person_id
        WHERE ra.id = ${reviewer.roleAssignmentId})`,
      reviewedAt: closing.reviewedAt,
      closedById: closer.id,
      closedByUsername: closer.username,
      closedByName: sql<string>`(SELECT concat_ws(' ', p.given_names, p.paternal_surname, p.maternal_surname)
        FROM role_assignment ra JOIN person p ON p.id = ra.person_id
        WHERE ra.id = ${closer.roleAssignmentId})`,
      closedAt: closing.closedAt,
    })
    .from(vClosing)
    .innerJoin(closing, eq(closing.id, vClosing.id))
    .innerJoin(preparer, eq(preparer.id, closing.createdBy))
    .leftJoin(reviewer, eq(reviewer.id, closing.reviewedBy))
    .leftJoin(closer, eq(closer.id, closing.closedBy));
}

export type ClosingRow = Awaited<ReturnType<typeof listClosings>>[number];

export function listClosings(
  db: Executor,
  filter: {
    cashboxId?: number | null | undefined;
    from?: string | undefined;
    to?: string | undefined;
    status?: (typeof vClosing.status)['_']['data'] | undefined;
    cursor?: number | undefined;
    limit: number;
  },
) {
  return closingQuery(db)
    .where(
      and(
        filter.cashboxId != null ? eq(vClosing.cashboxId, filter.cashboxId) : undefined,
        // Closings that overlap [from, to].
        filter.to !== undefined ? lte(vClosing.dateFrom, filter.to) : undefined,
        filter.from !== undefined ? gte(vClosing.dateTo, filter.from) : undefined,
        filter.status !== undefined ? eq(vClosing.status, filter.status) : undefined,
        filter.cursor !== undefined ? lt(vClosing.id, filter.cursor) : undefined,
      ),
    )
    .orderBy(desc(vClosing.id))
    .limit(filter.limit + 1);
}

export async function findClosing(db: Executor, id: number): Promise<ClosingRow | null> {
  const [row] = await closingQuery(db).where(eq(vClosing.id, id)).limit(1);
  return row ?? null;
}

export async function lockClosing(tx: Transaction, id: number): Promise<boolean> {
  const [row] = await tx
    .select({ id: closing.id })
    .from(closing)
    .where(eq(closing.id, id))
    .for('update');
  return row !== undefined;
}

export async function monthlyClosingOf(db: Executor, cashboxId: number, dateFrom: string) {
  const [row] = await db
    .select({ id: closing.id, closedAt: closing.closedAt })
    .from(closing)
    .where(
      and(
        eq(closing.cashboxId, cashboxId),
        eq(closing.type, 'monthly'),
        eq(closing.dateFrom, dateFrom),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Whether the cashbox has movements dated before `date`. */
export async function hasMovementsBefore(db: Executor, cashboxId: number, date: string) {
  const [row] = await db
    .select({ cashboxId: vCashboxMovement.cashboxId })
    .from(vCashboxMovement)
    .where(and(eq(vCashboxMovement.cashboxId, cashboxId), lt(vCashboxMovement.occurredOn, date)))
    .limit(1);
  return row !== undefined;
}

/** Whether the cashbox has movements dated after `date`. */
export async function hasMovementsAfter(db: Executor, cashboxId: number, date: string) {
  const [row] = await db
    .select({ cashboxId: vCashboxMovement.cashboxId })
    .from(vCashboxMovement)
    .where(and(eq(vCashboxMovement.cashboxId, cashboxId), gte(vCashboxMovement.occurredOn, date)))
    .limit(1);
  return row !== undefined;
}

/** First day after the latest closed monthly closing of the cashbox, or null. */
export async function openFrom(db: Executor, cashboxId: number): Promise<string | null> {
  const [row] = await db
    .select({ dateTo: closing.dateTo })
    .from(closing)
    .where(
      and(
        eq(closing.cashboxId, cashboxId),
        eq(closing.type, 'monthly'),
        isNotNull(closing.closedAt),
      ),
    )
    .orderBy(desc(closing.dateTo))
    .limit(1);
  if (!row) return null;
  const next = new Date(`${row.dateTo}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

export async function insertClosing(tx: Transaction, values: typeof closing.$inferInsert) {
  const [row] = await tx.insert(closing).values(values).returning({ id: closing.id });
  if (!row) throw new Error('closing not inserted');
  return row.id;
}

export async function updateClosing(
  tx: Transaction,
  id: number,
  values: Partial<
    Pick<
      typeof closing.$inferInsert,
      'countedCash' | 'notes' | 'reviewedBy' | 'reviewedAt' | 'closedBy' | 'closedAt'
    >
  >,
) {
  await tx.update(closing).set(values).where(eq(closing.id, id));
}
