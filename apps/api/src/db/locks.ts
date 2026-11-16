import { sql } from 'drizzle-orm';
import type { Transaction } from './client.js';

// Row locks for tables the API user cannot update. PostgreSQL requires UPDATE privilege for
// SELECT ... FOR UPDATE (and every other row lock), and agua_api has none on money records
// (payment, rate, fee, cashbox; RNF-SEG-08). For those, a transaction-scoped advisory lock on
// "<table>:<id>" serializes the operations that touch the same record; it is released on
// commit or rollback. Tables with UPDATE grants (unit, connection_request...) keep FOR UPDATE.

export async function lockRecord(tx: Transaction, table: string, id: number | string) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`${table}:${id}`}))`);
}
