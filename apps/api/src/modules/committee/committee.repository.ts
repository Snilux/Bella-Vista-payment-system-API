import { and, desc, eq, inArray, isNull, lt, lte, or, sql } from 'drizzle-orm';
import type { Database, Transaction } from '../../db/client.js';
import {
  agreement,
  approval,
  expense,
  expenseCategory,
  expenseRefund,
  income,
  plumber,
  plumberPayment,
  plumberSalary,
  vExpense,
} from '../../db/schema/index.js';

// Queries of the committee cashbox: incomes, expenses, refunds and the plumber (CU-19 to
// CU-21). Expenses and the plumber have UPDATE grants and are locked FOR UPDATE; the committee
// cashbox is locked by the services with lockRecord.

type Executor = Database | Transaction;

// Never null: an expense has its own amount, or a plumber payment takes its salary's (the
// deferred trigger of migration 0014 enforces it).
const effectiveAmount = sql<number>`${vExpense.effectiveAmount}`.mapWith(Number);

export async function findAgreement(db: Executor, id: number) {
  const [row] = await db
    .select({ id: agreement.id, folio: agreement.folio, result: agreement.result })
    .from(agreement)
    .where(eq(agreement.id, id))
    .limit(1);
  return row ?? null;
}

export async function insertApproval(
  tx: Transaction,
  values: {
    type: 'expense_refund' | 'plumber_salary';
    reason: string;
    requestedBy: number;
    requestedAt: Date;
  },
) {
  const [row] = await tx
    .insert(approval)
    .values({ ...values, createdBy: values.requestedBy })
    .returning({ id: approval.id });
  if (!row) throw new Error('approval not inserted');
  return row.id;
}

// --- Incomes --------------------------------------------------------------------------------

export function listIncomes(db: Executor, page: { cursor?: number | undefined; limit: number }) {
  return db
    .select({
      id: income.id,
      folio: income.folio,
      concept: income.concept,
      amount: income.amount,
      date: income.date,
      voucherReference: income.voucherReference,
    })
    .from(income)
    .where(page.cursor !== undefined ? lt(income.id, page.cursor) : undefined)
    .orderBy(desc(income.id))
    .limit(page.limit + 1);
}

export async function insertIncome(tx: Transaction, values: typeof income.$inferInsert) {
  const [row] = await tx.insert(income).values(values).returning();
  if (!row) throw new Error('income not inserted');
  return row;
}

// --- Expenses -------------------------------------------------------------------------------

export function listCategories(db: Executor) {
  return db
    .select({
      id: expenseCategory.id,
      name: expenseCategory.name,
      isPlumberSalary: expenseCategory.isPlumberSalary,
    })
    .from(expenseCategory)
    .orderBy(expenseCategory.id);
}

export async function plumberSalaryCategory(db: Executor) {
  const [row] = await db
    .select({ id: expenseCategory.id })
    .from(expenseCategory)
    .where(eq(expenseCategory.isPlumberSalary, true))
    .limit(1);
  return row?.id ?? null;
}

function expenseQuery(db: Executor) {
  return db
    .select({
      id: vExpense.id,
      folio: vExpense.folio,
      categoryId: expenseCategory.id,
      categoryName: expenseCategory.name,
      isPlumberSalary: expenseCategory.isPlumberSalary,
      description: vExpense.description,
      amount: effectiveAmount,
      agreementId: agreement.id,
      agreementFolio: agreement.folio,
      status: vExpense.status,
      paidOn: vExpense.paidOn,
      rejectedOn: vExpense.rejectedOn,
      rejectionReason: expense.rejectionReason,
      voucherReference: expense.voucherReference,
      plumberId: plumberPayment.plumberId,
      periodStart: plumberPayment.periodStart,
      frequency: plumberSalary.frequency,
    })
    .from(vExpense)
    .innerJoin(expense, eq(expense.id, vExpense.id))
    .innerJoin(expenseCategory, eq(expenseCategory.id, vExpense.categoryId))
    .leftJoin(agreement, eq(agreement.id, vExpense.effectiveAgreementId))
    .leftJoin(plumberPayment, eq(plumberPayment.expenseId, vExpense.id))
    .leftJoin(plumberSalary, eq(plumberSalary.id, plumberPayment.plumberSalaryId));
}

export type ExpenseRow = Awaited<ReturnType<typeof listExpenses>>[number];

export function listExpenses(
  db: Executor,
  filter: {
    status?: (typeof vExpense.status)['_']['data'] | undefined;
    plumberId?: number | undefined;
    cursor?: number | undefined;
    limit: number;
  },
) {
  return expenseQuery(db)
    .where(
      and(
        filter.status !== undefined ? eq(vExpense.status, filter.status) : undefined,
        filter.plumberId !== undefined ? eq(plumberPayment.plumberId, filter.plumberId) : undefined,
        filter.cursor !== undefined ? lt(vExpense.id, filter.cursor) : undefined,
      ),
    )
    .orderBy(desc(vExpense.id))
    .limit(filter.limit + 1);
}

export async function findExpense(db: Executor, id: number): Promise<ExpenseRow | null> {
  const [row] = await expenseQuery(db).where(eq(vExpense.id, id)).limit(1);
  return row ?? null;
}

export async function lockExpense(tx: Transaction, id: number): Promise<boolean> {
  const [row] = await tx
    .select({ id: expense.id })
    .from(expense)
    .where(eq(expense.id, id))
    .for('update');
  return row !== undefined;
}

export async function insertExpense(tx: Transaction, values: typeof expense.$inferInsert) {
  const [row] = await tx.insert(expense).values(values).returning({ id: expense.id });
  if (!row) throw new Error('expense not inserted');
  return row.id;
}

export async function markExpensePaid(tx: Transaction, id: number, on: string) {
  await tx.update(expense).set({ paidOn: on }).where(eq(expense.id, id));
}

export async function markExpenseRejected(tx: Transaction, id: number, on: string, reason: string) {
  await tx
    .update(expense)
    .set({ rejectedOn: on, rejectionReason: reason })
    .where(eq(expense.id, id));
}

export function refundsOf(db: Executor, expenseIds: number[]) {
  if (expenseIds.length === 0) return Promise.resolve([]);
  return db
    .select({
      expenseId: expenseRefund.expenseId,
      approvalId: expenseRefund.approvalId,
      date: expenseRefund.date,
      result: approval.result,
    })
    .from(expenseRefund)
    .innerJoin(approval, eq(approval.id, expenseRefund.approvalId))
    .where(inArray(expenseRefund.expenseId, expenseIds))
    .orderBy(desc(expenseRefund.id));
}

export async function insertRefund(tx: Transaction, values: typeof expenseRefund.$inferInsert) {
  const [row] = await tx.insert(expenseRefund).values(values).returning({ id: expenseRefund.id });
  if (!row) throw new Error('expense refund not inserted');
  return row.id;
}

export function refundsByApproval(db: Executor, approvalIds: number[]) {
  if (approvalIds.length === 0) return Promise.resolve([]);
  return db
    .select({
      approvalId: expenseRefund.approvalId,
      expenseId: expenseRefund.expenseId,
      folio: vExpense.folio,
      amount: effectiveAmount,
    })
    .from(expenseRefund)
    .innerJoin(vExpense, eq(vExpense.id, expenseRefund.expenseId))
    .where(inArray(expenseRefund.approvalId, approvalIds));
}

// --- Plumber (D-24) -------------------------------------------------------------------------

export function listPlumbers(db: Executor) {
  return db
    .select({ id: plumber.id, name: plumber.name, phone: plumber.phone, active: plumber.active })
    .from(plumber)
    .orderBy(plumber.id);
}

export async function findPlumber(db: Executor, id: number) {
  const [row] = await db
    .select({ id: plumber.id, name: plumber.name, phone: plumber.phone, active: plumber.active })
    .from(plumber)
    .where(eq(plumber.id, id))
    .limit(1);
  return row ?? null;
}

/** Locks a plumber (FOR UPDATE: phone and active have UPDATE grants). */
export async function lockPlumber(tx: Transaction, id: number) {
  const [row] = await tx
    .select({ id: plumber.id })
    .from(plumber)
    .where(eq(plumber.id, id))
    .for('update');
  return row !== undefined ? findPlumber(tx, id) : null;
}

export async function insertPlumber(tx: Transaction, values: typeof plumber.$inferInsert) {
  const [row] = await tx.insert(plumber).values(values).returning({ id: plumber.id });
  if (!row) throw new Error('plumber not inserted');
  return row.id;
}

export async function updatePlumber(
  tx: Transaction,
  id: number,
  values: { phone?: string | null; active?: boolean },
) {
  await tx.update(plumber).set(values).where(eq(plumber.id, id));
}

const salaryColumns = {
  id: plumberSalary.id,
  plumberId: plumberSalary.plumberId,
  amount: plumberSalary.amount,
  frequency: plumberSalary.frequency,
  effectiveFrom: plumberSalary.effectiveFrom,
  agreementId: agreement.id,
  agreementFolio: agreement.folio,
  approvalId: plumberSalary.approvalId,
  result: approval.result,
};

export type SalaryRow = Awaited<ReturnType<typeof salariesOf>>[number];

/** Salaries of the plumbers, newest effective date first. */
export function salariesOf(db: Executor, plumberIds: number[]) {
  if (plumberIds.length === 0) return Promise.resolve([]);
  return db
    .select(salaryColumns)
    .from(plumberSalary)
    .innerJoin(agreement, eq(agreement.id, plumberSalary.agreementId))
    .innerJoin(approval, eq(approval.id, plumberSalary.approvalId))
    .where(inArray(plumberSalary.plumberId, plumberIds))
    .orderBy(desc(plumberSalary.effectiveFrom), desc(plumberSalary.id));
}

export async function findSalary(db: Executor, id: number): Promise<SalaryRow | null> {
  const [row] = await db
    .select(salaryColumns)
    .from(plumberSalary)
    .innerJoin(agreement, eq(agreement.id, plumberSalary.agreementId))
    .innerJoin(approval, eq(approval.id, plumberSalary.approvalId))
    .where(eq(plumberSalary.id, id));
  return row ?? null;
}

/** Approved salary in force on `on` (latest effective_from not after it). */
export async function salaryInForce(db: Executor, plumberId: number, on: string) {
  const [row] = await db
    .select(salaryColumns)
    .from(plumberSalary)
    .innerJoin(agreement, eq(agreement.id, plumberSalary.agreementId))
    .innerJoin(approval, eq(approval.id, plumberSalary.approvalId))
    .where(
      and(
        eq(plumberSalary.plumberId, plumberId),
        eq(approval.result, 'approved'),
        lte(plumberSalary.effectiveFrom, on),
      ),
    )
    .orderBy(desc(plumberSalary.effectiveFrom), desc(plumberSalary.id))
    .limit(1);
  return row ?? null;
}

/** Salaries of a plumber pending approval, or approved with the same effective date. */
export function openSalaries(db: Executor, plumberId: number) {
  return db
    .select({
      id: plumberSalary.id,
      effectiveFrom: plumberSalary.effectiveFrom,
      result: approval.result,
    })
    .from(plumberSalary)
    .innerJoin(approval, eq(approval.id, plumberSalary.approvalId))
    .where(
      and(
        eq(plumberSalary.plumberId, plumberId),
        or(isNull(approval.result), eq(approval.result, 'approved')),
      ),
    );
}

export async function insertSalary(tx: Transaction, values: typeof plumberSalary.$inferInsert) {
  const [row] = await tx.insert(plumberSalary).values(values).returning({ id: plumberSalary.id });
  if (!row) throw new Error('plumber salary not inserted');
  return row.id;
}

export function salariesByApproval(db: Executor, approvalIds: number[]) {
  if (approvalIds.length === 0) return Promise.resolve([]);
  return db
    .select({
      approvalId: plumberSalary.approvalId,
      plumberId: plumberSalary.plumberId,
      plumberName: plumber.name,
      id: plumberSalary.id,
      amount: plumberSalary.amount,
      frequency: plumberSalary.frequency,
      effectiveFrom: plumberSalary.effectiveFrom,
    })
    .from(plumberSalary)
    .innerJoin(plumber, eq(plumber.id, plumberSalary.plumberId))
    .where(inArray(plumberSalary.approvalId, approvalIds));
}

export async function periodPaid(db: Executor, plumberId: number, periodStart: string) {
  const [row] = await db
    .select({ expenseId: plumberPayment.expenseId })
    .from(plumberPayment)
    .where(
      and(eq(plumberPayment.plumberId, plumberId), eq(plumberPayment.periodStart, periodStart)),
    )
    .limit(1);
  return row !== undefined;
}

export async function insertPlumberPayment(
  tx: Transaction,
  values: typeof plumberPayment.$inferInsert,
) {
  await tx.insert(plumberPayment).values(values);
}
