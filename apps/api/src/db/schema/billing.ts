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
  primaryKey,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { userAccount } from './access.js';
import { approval } from './approval.js';
import { cashbox } from './cashboxes.js';
import {
  createdAt,
  createdBy,
  firstOfMonth,
  fk,
  folioDefault,
  id,
  timestamptz,
} from './columns.js';
import { receiptType } from './enums.js';
import { extraCharge, rate } from './rates.js';
import { unit } from './registry.js';

const userAccountId = (): AnyPgColumn => userAccount.id;

export const paymentFolioSeq = pgSequence('payment_folio_seq');

// A payment received into a cashbox. No role or total columns: who captured it is
// created_by (role from that account, D-22) and the total is derived in v_payment_amount.
// unit_id is null only for a payment that covers an opening fee alone.
export const payment = pgTable(
  'payment',
  {
    id: id(),
    folio: text()
      .notNull()
      .unique('payment_folio_unique')
      .default(folioDefault('PG', 'payment_folio_seq')),
    unitId: fk().references((): AnyPgColumn => unit.id),
    cashboxId: fk()
      .notNull()
      .references((): AnyPgColumn => cashbox.id),
    occurredAt: timestamptz().notNull(),
    idempotencyKey: uuid().notNull().unique('payment_idempotency_key_unique'),
    createdBy: createdBy(userAccountId),
    createdAt: createdAt(),
  },
  (t) => [
    // Targets of the composite FKs from covered_period and paper_receipt.
    unique('payment_id_unit_id_unique').on(t.id, t.unitId),
    unique('payment_id_cashbox_id_unique').on(t.id, t.cashboxId),
    index('payment_unit_id_idx').on(t.unitId),
    index('payment_cashbox_id_idx').on(t.cashboxId),
  ],
);

// A month paid in a payment, priced with rate_id; with_surcharge doubles it (in debt cycle
// when paid, D-02). Triggers in migration 0008 require the payment to have a unit and the
// rate to start no later than the period.
export const paymentMonth = pgTable(
  'payment_month',
  {
    paymentId: fk()
      .notNull()
      .references((): AnyPgColumn => payment.id),
    period: date({ mode: 'string' }).notNull(),
    rateId: fk()
      .notNull()
      .references((): AnyPgColumn => rate.id),
    withSurcharge: boolean().notNull(),
    createdBy: createdBy(userAccountId),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ name: 'payment_month_pk', columns: [t.paymentId, t.period] }),
    index('payment_month_rate_id_idx').on(t.rateId),
    check('payment_month_period_first_of_month', firstOfMonth(t.period)),
  ],
);

// Lock row: a month is covered once per unit. unit_id repeats payment.unit_id on purpose
// (controlled redundancy, 2.2 §2.3) and both composite FKs keep it consistent. Cancelling
// a payment deletes its rows here, the only DELETE in billing.
export const coveredPeriod = pgTable(
  'covered_period',
  {
    unitId: fk().notNull(),
    period: date({ mode: 'string' }).notNull(),
    paymentId: fk().notNull(),
    createdBy: createdBy(userAccountId),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ name: 'covered_period_pk', columns: [t.unitId, t.period] }),
    index('covered_period_payment_id_idx').on(t.paymentId),
    foreignKey({
      name: 'covered_period_payment_unit_fk',
      columns: [t.paymentId, t.unitId],
      foreignColumns: [payment.id, payment.unitId],
    }),
    foreignKey({
      name: 'covered_period_payment_month_fk',
      columns: [t.paymentId, t.period],
      foreignColumns: [paymentMonth.paymentId, paymentMonth.period],
    }),
  ],
);

// Extra charge settled by a payment; a charge is paid at most once.
export const paymentCharge = pgTable(
  'payment_charge',
  {
    paymentId: fk()
      .notNull()
      .references((): AnyPgColumn => payment.id),
    extraChargeId: fk()
      .notNull()
      .unique('payment_charge_extra_charge_id_unique')
      .references((): AnyPgColumn => extraCharge.id),
    createdBy: createdBy(userAccountId),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ name: 'payment_charge_pk', columns: [t.paymentId, t.extraChargeId] })],
);

// Hand-written paper receipt (D-23): one original per payment plus replacements, each with
// a folio unique within the cashbox's receipt book. cashbox_id repeats payment.cashbox_id
// on purpose (2.2 §2.3), kept consistent by the composite FK.
export const paperReceipt = pgTable(
  'paper_receipt',
  {
    id: id(),
    paymentId: fk().notNull(),
    cashboxId: fk().notNull(),
    paperFolio: text().notNull(),
    type: receiptType().notNull(),
    issuedAt: timestamptz().notNull(),
    createdBy: createdBy(userAccountId),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: 'paper_receipt_payment_cashbox_fk',
      columns: [t.paymentId, t.cashboxId],
      foreignColumns: [payment.id, payment.cashboxId],
    }),
    unique('paper_receipt_cashbox_folio_unique').on(t.cashboxId, t.paperFolio),
    uniqueIndex('paper_receipt_original_uq').on(t.paymentId).where(sql`${t.type} = 'original'`),
    index('paper_receipt_payment_id_idx').on(t.paymentId),
    check('paper_receipt_folio_not_blank', sql`btrim(${t.paperFolio}) <> ''`),
  ],
);

// Request to cancel a payment, resolved through its approval (D-15). TODO(block 7): a
// trigger on approval resolution must allow a single approved cancellation per payment; it
// is not enforced yet (see COMMENT ON TABLE payment_cancellation in migration 0008).
export const paymentCancellation = pgTable(
  'payment_cancellation',
  {
    id: id(),
    paymentId: fk()
      .notNull()
      .references((): AnyPgColumn => payment.id),
    approvalId: fk()
      .notNull()
      .unique('payment_cancellation_approval_id_unique')
      .references((): AnyPgColumn => approval.id),
    createdBy: createdBy(userAccountId),
    createdAt: createdAt(),
  },
  (t) => [index('payment_cancellation_payment_id_idx').on(t.paymentId)],
);
