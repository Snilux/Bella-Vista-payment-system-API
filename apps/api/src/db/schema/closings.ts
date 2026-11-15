import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
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
import { approval } from './approval.js';
import { cashbox, handover } from './cashboxes.js';
import { createdAt, createdBy, fk, folioDefault, id, money, timestamptz } from './columns.js';
import { closingType } from './enums.js';

const userAccountId = (): AnyPgColumn => userAccount.id;

export const closingFolioSeq = pgSequence('closing_folio_seq');

// Cash count of a cashbox over a date range (both ends inclusive). Expected balance,
// difference and status are derived in v_closing; counted_cash null = draft. A monthly
// closing covers a whole calendar month; an extraordinary one any range (e.g. the handover
// record when a block leader changes, D-08). Closing it locks the period (D-14).
// The closed-period trigger on money tables is in migration 0014.
export const closing = pgTable(
  'closing',
  {
    id: id(),
    folio: text()
      .notNull()
      .unique('closing_folio_unique')
      .default(folioDefault('CO', 'closing_folio_seq')),
    cashboxId: fk()
      .notNull()
      .references((): AnyPgColumn => cashbox.id),
    type: closingType().notNull(),
    dateFrom: date({ mode: 'string' }).notNull(),
    dateTo: date({ mode: 'string' }).notNull(),
    countedCash: money(),
    notes: text(),
    reviewedBy: fk().references(userAccountId),
    reviewedAt: timestamptz(),
    closedBy: fk().references(userAccountId),
    closedAt: timestamptz(),
    createdBy: createdBy(userAccountId),
    createdAt: createdAt(),
  },
  (t) => [
    // One monthly closing per cashbox and month.
    uniqueIndex('closing_monthly_uq').on(t.cashboxId, t.dateFrom).where(sql`${t.type} = 'monthly'`),
    // Target of the composite FK from adjustment.
    unique('closing_id_cashbox_id_unique').on(t.id, t.cashboxId),
    index('closing_cashbox_id_idx').on(t.cashboxId),
    check('closing_date_range', sql`${t.dateFrom} <= ${t.dateTo}`),
    // A monthly closing runs from the first to the last day of one month.
    check(
      'closing_monthly_whole_month',
      sql`${t.type} <> 'monthly' OR (extract(day from ${t.dateFrom}) = 1 AND ${t.dateTo} = (${t.dateFrom} + interval '1 month' - interval '1 day')::date)`,
    ),
    check('closing_counted_cash_not_negative', sql`${t.countedCash} >= 0`),
    check('closing_review_complete', sql`num_nonnulls(${t.reviewedBy}, ${t.reviewedAt}) IN (0, 2)`),
    check('closing_close_complete', sql`num_nonnulls(${t.closedBy}, ${t.closedAt}) IN (0, 2)`),
    // Only a counted closing can be reviewed, and only a reviewed one can be closed.
    check(
      'closing_reviewed_after_count',
      sql`${t.reviewedAt} IS NULL OR ${t.countedCash} IS NOT NULL`,
    ),
    check('closing_closed_after_review', sql`${t.closedAt} IS NULL OR ${t.reviewedAt} IS NOT NULL`),
  ],
);

// Signed correction of a cashbox balance, resolved through its approval: settles a handover
// shortfall (D-16) or a closing difference. cashbox_id must be the handover's source cashbox
// or the closing's cashbox; the composite FKs enforce it (MATCH SIMPLE: the FK whose target
// column is null is not checked).
export const adjustment = pgTable(
  'adjustment',
  {
    id: id(),
    cashboxId: fk()
      .notNull()
      .references((): AnyPgColumn => cashbox.id),
    handoverId: fk(),
    closingId: fk(),
    amount: money().notNull(),
    date: date({ mode: 'string' }).notNull(),
    approvalId: fk()
      .notNull()
      .unique('adjustment_approval_id_unique')
      .references((): AnyPgColumn => approval.id),
    createdBy: createdBy(userAccountId),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: 'adjustment_handover_cashbox_fk',
      columns: [t.handoverId, t.cashboxId],
      foreignColumns: [handover.id, handover.sourceCashboxId],
    }),
    foreignKey({
      name: 'adjustment_closing_cashbox_fk',
      columns: [t.closingId, t.cashboxId],
      foreignColumns: [closing.id, closing.cashboxId],
    }),
    index('adjustment_cashbox_id_idx').on(t.cashboxId),
    index('adjustment_handover_id_idx').on(t.handoverId),
    index('adjustment_closing_id_idx').on(t.closingId),
    // Exactly one origin: a handover or a closing.
    check('adjustment_single_origin', sql`num_nonnulls(${t.handoverId}, ${t.closingId}) = 1`),
    check('adjustment_amount_not_zero', sql`${t.amount} <> 0`),
  ],
);
