import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  check,
  date,
  foreignKey,
  index,
  pgSequence,
  pgTable,
  text,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { userAccount } from './access.js';
import { agreement } from './agreement.js';
import { approval } from './approval.js';
import { createdAt, createdBy, fk, folioDefault, id, money } from './columns.js';
import { salaryFrequency } from './enums.js';

const userAccountId = (): AnyPgColumn => userAccount.id;

export const incomeFolioSeq = pgSequence('income_folio_seq');
export const expenseFolioSeq = pgSequence('expense_folio_seq');

// Money the committee cashbox receives outside monthly fees (donations, sales, etc.).
export const income = pgTable(
  'income',
  {
    id: id(),
    folio: text()
      .notNull()
      .unique('income_folio_unique')
      .default(folioDefault('IN', 'income_folio_seq')),
    concept: text().notNull(),
    amount: money().notNull(),
    date: date({ mode: 'string' }).notNull(),
    voucherReference: text(),
    createdBy: createdBy(userAccountId),
    createdAt: createdAt(),
  },
  (t) => [
    check('income_amount_positive', sql`${t.amount} > 0`),
    check('income_concept_not_blank', sql`btrim(${t.concept}) <> ''`),
  ],
);

// Expense category. Exactly one category (at most one row) marks the plumber's salary.
export const expenseCategory = pgTable(
  'expense_category',
  {
    id: id(),
    name: text().notNull().unique('expense_category_name_unique'),
    isPlumberSalary: boolean().notNull().default(false),
    createdBy: createdBy(userAccountId),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('expense_category_plumber_salary_uq')
      .on(t.isPlumberSalary)
      .where(sql`${t.isPlumberSalary}`),
    check('expense_category_name_not_blank', sql`btrim(${t.name}) <> ''`),
  ],
);

// Committee expense (D-17). Its status and effective amount are derived in v_expense. A
// plumber payment has no amount or agreement of its own: both come from plumber_salary.
// TODO(block 7): a deferred trigger must require amount and agreement_id unless the expense
// has a plumber_payment (inserted after the expense); see COMMENT ON TABLE expense in
// migration 0010.
export const expense = pgTable(
  'expense',
  {
    id: id(),
    folio: text()
      .notNull()
      .unique('expense_folio_unique')
      .default(folioDefault('GA', 'expense_folio_seq')),
    categoryId: fk()
      .notNull()
      .references((): AnyPgColumn => expenseCategory.id),
    description: text().notNull(),
    amount: money(),
    agreementId: fk().references((): AnyPgColumn => agreement.id),
    paidOn: date({ mode: 'string' }),
    rejectedOn: date({ mode: 'string' }),
    rejectionReason: text(),
    voucherReference: text(),
    createdBy: createdBy(userAccountId),
    createdAt: createdAt(),
  },
  (t) => [
    index('expense_category_id_idx').on(t.categoryId),
    index('expense_agreement_id_idx').on(t.agreementId),
    check('expense_amount_positive', sql`${t.amount} > 0`),
    check('expense_description_not_blank', sql`btrim(${t.description}) <> ''`),
    // A paid expense cannot be rejected, and a rejected one cannot be paid.
    check('expense_not_paid_and_rejected', sql`${t.paidOn} IS NULL OR ${t.rejectedOn} IS NULL`),
    // The rejection reason exists exactly when the expense is rejected.
    check(
      'expense_rejection_reason',
      sql`(${t.rejectedOn} IS NULL) = (${t.rejectionReason} IS NULL)`,
    ),
    check('expense_rejection_reason_not_blank', sql`btrim(${t.rejectionReason}) <> ''`),
  ],
);

// Refund of a paid expense, resolved through its approval. An expense is refunded once.
export const expenseRefund = pgTable('expense_refund', {
  id: id(),
  expenseId: fk()
    .notNull()
    .unique('expense_refund_expense_id_unique')
    .references((): AnyPgColumn => expense.id),
  date: date({ mode: 'string' }).notNull(),
  approvalId: fk()
    .notNull()
    .unique('expense_refund_approval_id_unique')
    .references((): AnyPgColumn => approval.id),
  createdBy: createdBy(userAccountId),
  createdAt: createdAt(),
});

// The plumber does not use the app (D-24).
export const plumber = pgTable(
  'plumber',
  {
    id: id(),
    name: text().notNull(),
    phone: text(),
    active: boolean().notNull().default(true),
    createdBy: createdBy(userAccountId),
    createdAt: createdAt(),
  },
  (t) => [check('plumber_name_not_blank', sql`btrim(${t.name}) <> ''`)],
);

// Salary history of a plumber, set by an agreement and confirmed through its approval (D-24).
export const plumberSalary = pgTable(
  'plumber_salary',
  {
    id: id(),
    plumberId: fk()
      .notNull()
      .references((): AnyPgColumn => plumber.id),
    amount: money().notNull(),
    frequency: salaryFrequency().notNull(),
    effectiveFrom: date({ mode: 'string' }).notNull(),
    agreementId: fk()
      .notNull()
      .references((): AnyPgColumn => agreement.id),
    approvalId: fk()
      .notNull()
      .unique('plumber_salary_approval_id_unique')
      .references((): AnyPgColumn => approval.id),
    createdBy: createdBy(userAccountId),
    createdAt: createdAt(),
  },
  (t) => [
    // Target of the composite FK from plumber_payment.
    unique('plumber_salary_id_plumber_id_unique').on(t.id, t.plumberId),
    index('plumber_salary_plumber_id_idx').on(t.plumberId),
    index('plumber_salary_agreement_id_idx').on(t.agreementId),
    check('plumber_salary_amount_positive', sql`${t.amount} > 0`),
  ],
);

// An expense that pays one plumber period; the period end follows from the salary's
// frequency. plumber_id repeats plumber_salary.plumber_id on purpose (2.2 §2.3) so a period
// is paid once per plumber; the composite FK keeps it consistent.
export const plumberPayment = pgTable(
  'plumber_payment',
  {
    expenseId: fk()
      .primaryKey()
      .references((): AnyPgColumn => expense.id),
    plumberSalaryId: fk().notNull(),
    plumberId: fk().notNull(),
    periodStart: date({ mode: 'string' }).notNull(),
    createdBy: createdBy(userAccountId),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: 'plumber_payment_salary_plumber_fk',
      columns: [t.plumberSalaryId, t.plumberId],
      foreignColumns: [plumberSalary.id, plumberSalary.plumberId],
    }),
    unique('plumber_payment_plumber_period_unique').on(t.plumberId, t.periodStart),
    index('plumber_payment_plumber_salary_id_idx').on(t.plumberSalaryId),
  ],
);
