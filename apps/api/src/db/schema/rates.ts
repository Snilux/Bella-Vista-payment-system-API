import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  check,
  date,
  index,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { userAccount } from './access.js';
import { agreement } from './agreement.js';
import { approval } from './approval.js';
import { createdAt, createdBy, firstOfMonth, fk, id, money } from './columns.js';
import { connection, connectionRequest } from './connections.js';
import { feeType } from './enums.js';
import { unit } from './registry.js';

const userAccountId = (): AnyPgColumn => userAccount.id;

// Monthly fee in force from effective_period (always day 1). Its status is derived from the
// approval. A trigger allows a single approved rate per effective_period (migration 0014).
export const rate = pgTable(
  'rate',
  {
    id: id(),
    effectivePeriod: date({ mode: 'string' }).notNull(),
    amount: money().notNull(),
    approvedOn: date({ mode: 'string' }).notNull(),
    agreementId: fk()
      .notNull()
      .references((): AnyPgColumn => agreement.id),
    approvalId: fk()
      .notNull()
      .unique('rate_approval_id_unique')
      .references((): AnyPgColumn => approval.id),
    createdBy: createdBy(userAccountId),
    createdAt: createdAt(),
  },
  (t) => [
    index('rate_effective_period_idx').on(t.effectivePeriod),
    index('rate_agreement_id_idx').on(t.agreementId),
    check('rate_effective_period_first_of_month', firstOfMonth(t.effectivePeriod)),
    check('rate_amount_positive', sql`${t.amount} > 0`),
  ],
);

// Extraordinary fee (opening, reconnection, repair, other). Its amount lives in fee_amount.
export const fee = pgTable(
  'fee',
  {
    id: id(),
    type: feeType().notNull(),
    name: text().notNull().unique('fee_name_unique'),
    createdBy: createdBy(userAccountId),
    createdAt: createdAt(),
  },
  (t) => [check('fee_name_not_blank', sql`btrim(${t.name}) <> ''`)],
);

// Amount history of a fee: the row with the latest effective_from on or before a date is
// the amount in force on that date (D-13).
export const feeAmount = pgTable(
  'fee_amount',
  {
    feeId: fk()
      .notNull()
      .references((): AnyPgColumn => fee.id),
    effectiveFrom: date({ mode: 'string' }).notNull(),
    amount: money().notNull(),
    createdBy: createdBy(userAccountId),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ name: 'fee_amount_pk', columns: [t.feeId, t.effectiveFrom] }),
    check('fee_amount_amount_positive', sql`${t.amount} > 0`),
  ],
);

// A fee charged to exactly one target: a connection request (the opening fee), a connection
// or a unit. The amount is not stored: it is the fee_amount in force on charged_on. The
// hand-written migration 0006 adds triggers that require that amount to exist and tie the
// opening fee to connection requests (both ways).
export const extraCharge = pgTable(
  'extra_charge',
  {
    id: id(),
    feeId: fk()
      .notNull()
      .references((): AnyPgColumn => fee.id),
    connectionRequestId: fk().references((): AnyPgColumn => connectionRequest.id),
    connectionId: fk().references((): AnyPgColumn => connection.id),
    unitId: fk().references((): AnyPgColumn => unit.id),
    chargedOn: date({ mode: 'string' }).notNull(),
    cancelledOn: date({ mode: 'string' }),
    createdBy: createdBy(userAccountId),
    createdAt: createdAt(),
  },
  (t) => [
    // One current (not cancelled) opening charge per connection request.
    uniqueIndex('extra_charge_request_current_uq')
      .on(t.connectionRequestId)
      .where(sql`${t.cancelledOn} IS NULL`),
    index('extra_charge_fee_id_idx').on(t.feeId),
    index('extra_charge_connection_id_idx').on(t.connectionId),
    index('extra_charge_unit_id_idx').on(t.unitId),
    check(
      'extra_charge_single_target',
      sql`num_nonnulls(${t.connectionRequestId}, ${t.connectionId}, ${t.unitId}) = 1`,
    ),
    check(
      'extra_charge_cancelled_after_charge',
      sql`${t.cancelledOn} IS NULL OR ${t.cancelledOn} >= ${t.chargedOn}`,
    ),
  ],
);
