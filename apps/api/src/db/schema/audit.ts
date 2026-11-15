import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  index,
  jsonb,
  pgTable,
  text,
  uuid,
} from 'drizzle-orm/pg-core';
import { userAccount } from './access.js';
import { createdAt, fk, id } from './columns.js';
import { role } from './enums.js';

// Audit log (CU-25): who did what on which row, with the row before and after. The author is
// user_account_id and role is the account's role at that moment (it never changes, D-22, but
// is kept so the log reads on its own). is_technical marks superadmin and bootstrap entries.
// Insert-only: the API database user has no UPDATE or DELETE on it (migration 0015).
export const auditLog = pgTable(
  'audit_log',
  {
    id: id(),
    userAccountId: fk()
      .notNull()
      .references((): AnyPgColumn => userAccount.id),
    role: role().notNull(),
    action: text().notNull(),
    tableName: text().notNull(),
    recordId: bigint({ mode: 'number' }).notNull(),
    before: jsonb(),
    after: jsonb(),
    reason: text(),
    isTechnical: boolean().notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    index('audit_log_table_record_idx').on(t.tableName, t.recordId),
    index('audit_log_user_account_id_idx').on(t.userAccountId),
    index('audit_log_created_at_idx').on(t.createdAt),
    check('audit_log_action_not_blank', sql`btrim(${t.action}) <> ''`),
    check('audit_log_table_name_not_blank', sql`btrim(${t.tableName}) <> ''`),
  ],
);

// Stored response of a money-moving POST, keyed by its Idempotency-Key header: a retry with
// the same key gets the same response instead of a second operation. Rows older than 24 h
// are purged when queried (no scheduled jobs, D-25).
export const idempotencyKey = pgTable(
  'idempotency_key',
  {
    key: uuid().primaryKey(),
    userAccountId: fk()
      .notNull()
      .references((): AnyPgColumn => userAccount.id),
    route: text().notNull(),
    response: jsonb().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('idempotency_key_created_at_idx').on(t.createdAt)],
);
