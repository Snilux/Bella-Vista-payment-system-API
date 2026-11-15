import { sql } from 'drizzle-orm';
import { type AnyPgColumn, check, date, pgTable, uniqueIndex } from 'drizzle-orm/pg-core';
import { userAccount } from './access.js';
import { approval } from './approval.js';
import { createdAt, createdBy, fk, id, money } from './columns.js';
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

// Cash a box already held when the system started (D-18). A box without one has no row.
export const openingBalance = pgTable(
  'opening_balance',
  {
    cashboxId: fk()
      .primaryKey()
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
  (t) => [check('opening_balance_amount_positive', sql`${t.amount} > 0`)],
);
