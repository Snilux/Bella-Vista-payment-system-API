import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index.js';

export interface CreateDbOptions {
  /** Maximum pool size. */
  max?: number;
}

/**
 * Opens a postgres.js pool and wraps it with Drizzle. The caller owns the pool and must
 * call `sql.end()` on shutdown. Sessions run in UTC; business periods are computed in
 * `BUSINESS_TIMEZONE` by the domain code, never by the database session.
 */
export function createDb(url: string, options: CreateDbOptions = {}) {
  const sql = postgres(url, {
    max: options.max ?? 10,
    connection: { TimeZone: 'UTC' },
    onnotice: () => {},
  });
  const db = drizzle({ client: sql, schema, casing: 'snake_case' });
  return { db, sql };
}

export type Database = ReturnType<typeof createDb>['db'];
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
