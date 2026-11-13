import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  check,
  date,
  index,
  pgSequence,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { userAccount } from './access.js';
import { agreement } from './agreement.js';
import { approval } from './approval.js';
import { createdAt, createdBy, fk, folioDefault, id } from './columns.js';
import { connection } from './connections.js';
import { unitChangeType } from './enums.js';
import { person } from './organization.js';

const userAccountId = (): AnyPgColumn => userAccount.id;

/** CHECK expression: a period column holds the first day of a month. */
const firstOfMonth = (column: AnyPgColumn) => sql`extract(day from ${column}) = 1`;

export const unitFolioSeq = pgSequence('unit_folio_seq');

// A household that pays one full monthly fee ("familia" on screen), supplied by one
// connection. Status (pending activation, active, suspended, deactivated) is derived in
// v_unit. billing_start_period is the activation month or, for units that existed at
// startup, the first unpaid month in the paper ledger (D-18).
export const unit = pgTable(
  'unit',
  {
    id: id(),
    folio: text()
      .notNull()
      .unique('unit_folio_unique')
      .default(folioDefault('U', 'unit_folio_seq')),
    connectionId: fk()
      .notNull()
      .references((): AnyPgColumn => connection.id),
    reference: text(),
    registeredOn: date({ mode: 'string' }).notNull(),
    activatedOn: date({ mode: 'string' }),
    billingStartPeriod: date({ mode: 'string' }),
    deactivatedOn: date({ mode: 'string' }),
    createdBy: createdBy(userAccountId),
    createdAt: createdAt(),
  },
  (t) => [
    index('unit_connection_id_idx').on(t.connectionId),
    check(
      'unit_billing_start_when_active',
      sql`${t.activatedOn} IS NULL OR ${t.billingStartPeriod} IS NOT NULL`,
    ),
    check(
      'unit_billing_start_first_of_month',
      sql`${t.billingStartPeriod} IS NULL OR ${firstOfMonth(t.billingStartPeriod)}`,
    ),
    check(
      'unit_activated_after_registration',
      sql`${t.activatedOn} IS NULL OR ${t.activatedOn} >= ${t.registeredOn}`,
    ),
    check(
      'unit_deactivated_after_registration',
      sql`${t.deactivatedOn} IS NULL OR ${t.deactivatedOn} >= ${t.registeredOn}`,
    ),
    check('unit_reference_not_blank', sql`${t.reference} IS NULL OR btrim(${t.reference}) <> ''`),
  ],
);

// Holder history of a unit (D-11: debt stays with the unit). valid_to is exclusive and null
// for the current holder; overlapping ranges are rejected by an EXCLUDE constraint in the
// hand-written migration 0004.
export const unitHolder = pgTable(
  'unit_holder',
  {
    unitId: fk()
      .notNull()
      .references((): AnyPgColumn => unit.id),
    personId: fk()
      .notNull()
      .references((): AnyPgColumn => person.id),
    validFrom: date({ mode: 'string' }).notNull(),
    validTo: date({ mode: 'string' }),
    createdBy: createdBy(userAccountId),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ name: 'unit_holder_pk', columns: [t.unitId, t.validFrom] }),
    // One current holder per unit.
    uniqueIndex('unit_holder_current_uq').on(t.unitId).where(sql`${t.validTo} IS NULL`),
    index('unit_holder_person_id_idx').on(t.personId),
    check('unit_holder_valid_range', sql`${t.validTo} IS NULL OR ${t.validTo} > ${t.validFrom}`),
  ],
);

// Suspension of a whole connection or of a single unit (D-06). period_to is inclusive and
// null while the suspension lasts.
export const suspension = pgTable(
  'suspension',
  {
    id: id(),
    connectionId: fk().references((): AnyPgColumn => connection.id),
    unitId: fk().references((): AnyPgColumn => unit.id),
    periodFrom: date({ mode: 'string' }).notNull(),
    periodTo: date({ mode: 'string' }),
    reason: text().notNull(),
    agreementId: fk()
      .notNull()
      .references((): AnyPgColumn => agreement.id),
    createdBy: createdBy(userAccountId),
    createdAt: createdAt(),
  },
  (t) => [
    index('suspension_connection_id_idx').on(t.connectionId),
    index('suspension_unit_id_idx').on(t.unitId),
    check('suspension_single_target', sql`num_nonnulls(${t.connectionId}, ${t.unitId}) = 1`),
    check('suspension_period_from_first_of_month', firstOfMonth(t.periodFrom)),
    check(
      'suspension_period_to_first_of_month',
      sql`${t.periodTo} IS NULL OR ${firstOfMonth(t.periodTo)}`,
    ),
    check(
      'suspension_period_range',
      sql`${t.periodTo} IS NULL OR ${t.periodTo} >= ${t.periodFrom}`,
    ),
    check('suspension_reason_not_blank', sql`btrim(${t.reason}) <> ''`),
  ],
);

// Request to deactivate a unit or change its holder; the reason lives in the approval.
export const unitChangeRequest = pgTable(
  'unit_change_request',
  {
    id: id(),
    unitId: fk()
      .notNull()
      .references((): AnyPgColumn => unit.id),
    type: unitChangeType().notNull(),
    newHolderId: fk().references((): AnyPgColumn => person.id),
    approvalId: fk()
      .notNull()
      .unique('unit_change_request_approval_id_unique')
      .references((): AnyPgColumn => approval.id),
    createdBy: createdBy(userAccountId),
    createdAt: createdAt(),
  },
  (t) => [
    index('unit_change_request_unit_id_idx').on(t.unitId),
    check(
      'unit_change_request_new_holder',
      sql`(${t.type} = 'holder_change') = (${t.newHolderId} IS NOT NULL)`,
    ),
  ],
);
