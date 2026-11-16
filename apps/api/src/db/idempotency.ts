import { eq, lt, sql } from 'drizzle-orm';
import { errors } from '../lib/errors.js';
import type { Database, Transaction } from './client.js';
import { idempotencyKey } from './schema/index.js';

// Idempotency-Key of the POSTs that move money (2.1 §6, docs/api.md). The response of the
// operation is stored in the same transaction that performs it, so a retry can never repeat
// the operation: either the transaction committed with its stored response, or neither exists.
// Keys live 24 h and are purged when queried (no scheduled jobs, D-25).

export const IDEMPOTENCY_TTL_HOURS = 24;

/** Who used the key and on which route (method and path). */
export interface IdempotencyContext {
  key: string;
  userAccountId: number;
  route: string;
}

export interface StoredResponse {
  status: number;
  body: unknown;
}

type Executor = Database | Transaction;

const freshOnly = sql`${idempotencyKey.createdAt} >= now() - make_interval(hours => ${IDEMPOTENCY_TTL_HOURS})`;

/** Deletes the keys older than 24 h. */
export async function purgeExpiredIdempotencyKeys(db: Executor): Promise<void> {
  await db
    .delete(idempotencyKey)
    .where(
      lt(idempotencyKey.createdAt, sql`now() - make_interval(hours => ${IDEMPOTENCY_TTL_HOURS})`),
    );
}

/**
 * Stored response for `ctx.key`, or null when the key is new. Throws IDEMPOTENCY_KEY_REUSED
 * when another account or another route used the key.
 */
export async function findStoredResponse(
  db: Executor,
  ctx: IdempotencyContext,
): Promise<StoredResponse | null> {
  const [row] = await db
    .select()
    .from(idempotencyKey)
    .where(sql`${eq(idempotencyKey.key, ctx.key)} AND ${freshOnly}`)
    .limit(1);
  if (!row) return null;
  if (row.userAccountId !== ctx.userAccountId || row.route !== ctx.route) {
    throw errors.idempotencyKeyReused();
  }
  return row.response as StoredResponse;
}

export type IdempotentResult = StoredResponse & { replayed: boolean };

/**
 * Runs `operation` in a transaction at most once per key. A transaction-scoped advisory lock
 * on the key serializes concurrent requests with the same key: the second one waits, then
 * finds the stored response and returns it instead of running the operation again.
 */
export function idempotentTransaction(
  db: Database,
  ctx: IdempotencyContext,
  operation: (tx: Transaction) => Promise<StoredResponse>,
): Promise<IdempotentResult> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`idempotency:${ctx.key}`}))`);
    const stored = await findStoredResponse(tx, ctx);
    if (stored) return { ...stored, replayed: true };

    const response = await operation(tx);
    // An expired row with the same key may still exist: purge it before inserting.
    await purgeExpiredIdempotencyKeys(tx);
    await tx.insert(idempotencyKey).values({
      key: ctx.key,
      userAccountId: ctx.userAccountId,
      route: ctx.route,
      response,
    });
    return { ...response, replayed: false };
  });
}
