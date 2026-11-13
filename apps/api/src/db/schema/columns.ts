import { sql } from 'drizzle-orm';
import { type AnyPgColumn, bigint, timestamp } from 'drizzle-orm/pg-core';

// Shared column builders. Column names come from the object key via `casing: 'snake_case'`.
// This file must not import table modules: table files call these builders at load time,
// so an import cycle through here would hit uninitialized bindings.

/** `id bigint generated always as identity`. */
export const id = () => bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity();

/** Foreign key column holding a `bigint` id. */
export const fk = () => bigint({ mode: 'number' });

export const timestamptz = () => timestamp({ withTimezone: true, mode: 'date' });

export const createdAt = () => timestamptz().notNull().defaultNow();

/** Author of the row (FK to `user_account.id`). Required everywhere except bootstrap tables. */
export const createdBy = (userAccountId: () => AnyPgColumn) =>
  fk().notNull().references(userAccountId);

/**
 * Nullable author, only for `person`, `role_assignment` and `user_account`: the first
 * superadmin's rows are created before any account exists (null = bootstrap).
 */
export const createdByBootstrap = (userAccountId: () => AnyPgColumn) =>
  fk().references(userAccountId);

/**
 * Visible folio `<PREFIX>-AAAAMM-NNNNNN`: year and month of creation in the business time
 * zone (America/Mexico_City) plus a global counter from `sequence` that does not reset monthly.
 */
export const folioDefault = (prefix: string, sequence: string) =>
  sql.raw(
    `'${prefix}-' || to_char(now() AT TIME ZONE 'America/Mexico_City', 'YYYYMM') || '-' || lpad(nextval('${sequence}')::text, 6, '0')`,
  );
