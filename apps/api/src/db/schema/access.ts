import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  check,
  index,
  pgTable,
  smallint,
  text,
} from 'drizzle-orm/pg-core';
import { createdAt, createdBy, createdByBootstrap, fk, id, timestamptz } from './columns.js';
import { roleAssignment } from './organization.js';

// One account per role assignment (D-22): person and role come from the assignment.
export const userAccount = pgTable(
  'user_account',
  {
    id: id(),
    roleAssignmentId: fk()
      .notNull()
      .unique('user_account_role_assignment_id_unique')
      .references((): AnyPgColumn => roleAssignment.id),
    username: text().notNull().unique('user_account_username_unique'),
    passwordHash: text().notNull(),
    mustChangePassword: boolean().notNull().default(true),
    deactivatedAt: timestamptz(),
    lockedUntil: timestamptz(),
    failedAttempts: smallint().notNull().default(0),
    createdBy: createdByBootstrap((): AnyPgColumn => userAccount.id),
    createdAt: createdAt(),
  },
  (t) => [
    check(
      'user_account_username_format',
      sql`${t.username} = lower(btrim(${t.username})) AND ${t.username} <> ''`,
    ),
    check('user_account_failed_attempts', sql`${t.failedAttempts} >= 0`),
  ],
);

export const refreshToken = pgTable(
  'refresh_token',
  {
    id: id(),
    userAccountId: fk()
      .notNull()
      .references((): AnyPgColumn => userAccount.id),
    tokenHash: text().notNull().unique('refresh_token_token_hash_unique'),
    expiresAt: timestamptz().notNull(),
    revokedAt: timestamptz(),
    replacedById: fk().references((): AnyPgColumn => refreshToken.id),
    createdBy: createdBy((): AnyPgColumn => userAccount.id),
    createdAt: createdAt(),
  },
  (t) => [
    index('refresh_token_user_account_id_idx').on(t.userAccountId),
    check('refresh_token_not_self_replaced', sql`${t.replacedById} <> ${t.id}`),
  ],
);
