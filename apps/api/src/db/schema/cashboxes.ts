import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  check,
  date,
  index,
  pgSequence,
  pgTable,
  text,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { userAccount } from './access.js';
import { approval } from './approval.js';
import { createdAt, createdBy, fk, folioDefault, id, money, timestamptz } from './columns.js';
import { cashboxType } from './enums.js';
import { block, person } from './organization.js';

const userAccountId = (): AnyPgColumn => userAccount.id;

// Cash under custody. Its balance is always computed (v_cashbox_balance), never stored.
// The custodian of a block cashbox is the current block leader and the custodian of the
// committee cashbox is the current treasurer (both from role_assignment); only support
// cashboxes store their custodian (D-07).
export const cashbox = pgTable(
  'cashbox',
  {
    id: id(),
    type: cashboxType().notNull(),
    blockId: fk()
      .unique('cashbox_block_id_unique')
      .references((): AnyPgColumn => block.id),
    custodianPersonId: fk()
      .unique('cashbox_custodian_person_id_unique')
      .references((): AnyPgColumn => person.id),
    createdBy: createdBy(userAccountId),
    createdAt: createdAt(),
  },
  (t) => [
    // A single committee cashbox.
    uniqueIndex('cashbox_committee_uq').on(t.type).where(sql`${t.type} = 'committee'`),
    // block: only block_id; support: only custodian_person_id; committee: neither.
    check(
      'cashbox_type_target',
      sql`(${t.type} = 'block') = (${t.blockId} IS NOT NULL) AND (${t.type} = 'support') = (${t.custodianPersonId} IS NOT NULL)`,
    ),
  ],
);

// Cash a box already held when the system started (D-18), requested by the treasurer and
// approved by the president. A rejected request frees the box for a new one: a trigger allows
// a single pending or approved opening balance per cashbox (migration 0017).
export const openingBalance = pgTable(
  'opening_balance',
  {
    id: id(),
    cashboxId: fk()
      .notNull()
      .references((): AnyPgColumn => cashbox.id),
    amount: money().notNull(),
    date: date({ mode: 'string' }).notNull(),
    approvalId: fk()
      .notNull()
      .unique('opening_balance_approval_id_unique')
      .references((): AnyPgColumn => approval.id),
    createdBy: createdBy(userAccountId),
    createdAt: createdAt(),
  },
  (t) => [
    index('opening_balance_cashbox_id_idx').on(t.cashboxId),
    check('opening_balance_amount_positive', sql`${t.amount} > 0`),
  ],
);

export const handoverFolioSeq = pgSequence('handover_folio_seq');

// Cash a block or support cashbox hands over to the committee cashbox (the destination is
// always the committee box). Its status and difference are derived in v_handover. The source
// cashbox only goes down by received_amount; a shortfall stays in it until an approved
// adjustment (D-16). A trigger requires the source cashbox to be of type block or support
// (migration 0014).
export const handover = pgTable(
  'handover',
  {
    id: id(),
    folio: text()
      .notNull()
      .unique('handover_folio_unique')
      .default(folioDefault('EN', 'handover_folio_seq')),
    sourceCashboxId: fk()
      .notNull()
      .references((): AnyPgColumn => cashbox.id),
    declaredAmount: money().notNull(),
    date: date({ mode: 'string' }).notNull(),
    notes: text(),
    withdrawnAt: timestamptz(),
    receivedAmount: money(),
    confirmedAt: timestamptz(),
    confirmedBy: fk().references(userAccountId),
    createdBy: createdBy(userAccountId),
    createdAt: createdAt(),
  },
  (t) => [
    // Target of the composite FK from adjustment.
    unique('handover_id_source_cashbox_id_unique').on(t.id, t.sourceCashboxId),
    index('handover_source_cashbox_id_idx').on(t.sourceCashboxId),
    check('handover_declared_amount_positive', sql`${t.declaredAmount} > 0`),
    // Zero is allowed: the treasurer may receive none of the declared cash (D-16).
    check('handover_received_amount_not_negative', sql`${t.receivedAmount} >= 0`),
    // A withdrawn handover cannot be confirmed, and a confirmed one cannot be withdrawn.
    check(
      'handover_not_withdrawn_and_confirmed',
      sql`${t.withdrawnAt} IS NULL OR ${t.confirmedAt} IS NULL`,
    ),
    // Confirmation data (amount received, when and by whom) is recorded all at once.
    check(
      'handover_confirmation_complete',
      sql`num_nonnulls(${t.receivedAmount}, ${t.confirmedAt}, ${t.confirmedBy}) IN (0, 3)`,
    ),
  ],
);
