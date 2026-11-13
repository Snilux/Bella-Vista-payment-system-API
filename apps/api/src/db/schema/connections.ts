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
import { createdAt, createdBy, fk, folioDefault, id } from './columns.js';
import { block, person } from './organization.js';

const userAccountId = (): AnyPgColumn => userAccount.id;

export const connectionRequestFolioSeq = pgSequence('connection_request_folio_seq');
export const connectionFolioSeq = pgSequence('connection_folio_seq');

// Application for a new water connection. Its status (requested, approved pending payment,
// pending installation, rejected, cancelled, installed) is derived in v_connection_request.
// A rejected agreement requires resolution_reason: enforced by a trigger (hand-written
// migration 0004) because it depends on agreement.result.
export const connectionRequest = pgTable(
  'connection_request',
  {
    id: id(),
    folio: text()
      .notNull()
      .unique('connection_request_folio_unique')
      .default(folioDefault('ST', 'connection_request_folio_seq')),
    applicantId: fk()
      .notNull()
      .references((): AnyPgColumn => person.id),
    address: text().notNull(),
    blockId: fk()
      .notNull()
      .references((): AnyPgColumn => block.id),
    requestedOn: date({ mode: 'string' }).notNull(),
    agreementId: fk().references((): AnyPgColumn => agreement.id),
    resolutionReason: text(),
    // Withdrawn by the applicant or opening fee not paid in time (D-12).
    cancelledOn: date({ mode: 'string' }),
    cancellationReason: text(),
    createdBy: createdBy(userAccountId),
    createdAt: createdAt(),
  },
  (t) => [
    index('connection_request_block_id_idx').on(t.blockId),
    index('connection_request_applicant_id_idx').on(t.applicantId),
    check('connection_request_address_not_blank', sql`btrim(${t.address}) <> ''`),
    check(
      'connection_request_resolution_needs_agreement',
      sql`${t.resolutionReason} IS NULL OR (${t.agreementId} IS NOT NULL AND btrim(${t.resolutionReason}) <> '')`,
    ),
    check(
      'connection_request_cancellation_reason',
      sql`(${t.cancelledOn} IS NULL) = (${t.cancellationReason} IS NULL) AND (${t.cancellationReason} IS NULL OR btrim(${t.cancellationReason}) <> '')`,
    ),
    check(
      'connection_request_cancelled_after_request',
      sql`${t.cancelledOn} IS NULL OR ${t.cancelledOn} >= ${t.requestedOn}`,
    ),
  ],
);

// Physical connection; exists from its activation. connection_request_id is null for the
// connections that already existed when the system started (D-18).
export const connection = pgTable(
  'connection',
  {
    id: id(),
    folio: text()
      .notNull()
      .unique('connection_folio_unique')
      .default(folioDefault('T', 'connection_folio_seq')),
    connectionRequestId: fk()
      .unique('connection_connection_request_id_unique')
      .references((): AnyPgColumn => connectionRequest.id),
    address: text().notNull(),
    activatedOn: date({ mode: 'string' }).notNull(),
    deactivatedOn: date({ mode: 'string' }),
    deactivationReason: text(),
    createdBy: createdBy(userAccountId),
    createdAt: createdAt(),
  },
  (t) => [
    check('connection_address_not_blank', sql`btrim(${t.address}) <> ''`),
    check(
      'connection_deactivation_reason',
      sql`(${t.deactivatedOn} IS NULL) = (${t.deactivationReason} IS NULL) AND (${t.deactivationReason} IS NULL OR btrim(${t.deactivationReason}) <> '')`,
    ),
    check(
      'connection_deactivated_after_activation',
      sql`${t.deactivatedOn} IS NULL OR ${t.deactivatedOn} >= ${t.activatedOn}`,
    ),
  ],
);

// Block history of a connection. valid_to is exclusive (the next row starts that day) and
// null for the current block. Overlapping ranges are rejected by an EXCLUDE constraint in
// the hand-written migration 0004.
export const connectionBlock = pgTable(
  'connection_block',
  {
    connectionId: fk()
      .notNull()
      .references((): AnyPgColumn => connection.id),
    blockId: fk()
      .notNull()
      .references((): AnyPgColumn => block.id),
    validFrom: date({ mode: 'string' }).notNull(),
    validTo: date({ mode: 'string' }),
    createdBy: createdBy(userAccountId),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ name: 'connection_block_pk', columns: [t.connectionId, t.validFrom] }),
    // One current block per connection.
    uniqueIndex('connection_block_current_uq').on(t.connectionId).where(sql`${t.validTo} IS NULL`),
    index('connection_block_block_id_idx').on(t.blockId),
    check(
      'connection_block_valid_range',
      sql`${t.validTo} IS NULL OR ${t.validTo} > ${t.validFrom}`,
    ),
  ],
);
