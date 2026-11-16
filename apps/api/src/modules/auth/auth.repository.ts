import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Database, Transaction } from '../../db/client.js';
import { approval, refreshToken, roleAssignment, userAccount } from '../../db/schema/index.js';

// Queries of the auth module. They receive the executor (pool or transaction); the service
// decides the transaction and the locks.

type Executor = Database | Transaction;

const accountAccessColumns = {
  userAccountId: userAccount.id,
  username: userAccount.username,
  mustChangePassword: userAccount.mustChangePassword,
  deactivatedAt: userAccount.deactivatedAt,
  lockedUntil: userAccount.lockedUntil,
  failedAttempts: userAccount.failedAttempts,
  roleAssignmentId: roleAssignment.id,
  role: roleAssignment.role,
  personId: roleAssignment.personId,
  blockId: roleAssignment.blockId,
  startDate: roleAssignment.startDate,
  endDate: roleAssignment.endDate,
  approvalResult: approval.result,
};

const accountAccessQuery = (db: Executor) =>
  db
    .select(accountAccessColumns)
    .from(userAccount)
    .innerJoin(roleAssignment, eq(roleAssignment.id, userAccount.roleAssignmentId))
    .leftJoin(approval, eq(approval.id, roleAssignment.approvalId));

/** Account with its role assignment: what each authenticated request is checked against. */
export async function findAccountAccess(db: Executor, userAccountId: number) {
  const [row] = await accountAccessQuery(db).where(eq(userAccount.id, userAccountId)).limit(1);
  return row ?? null;
}

export type AccountAccess = NonNullable<Awaited<ReturnType<typeof findAccountAccess>>>;

/**
 * Account for a login or password change, with its hash, locking the user_account row so
 * concurrent attempts count failures correctly.
 */
export async function lockAccountForCredentials(
  tx: Transaction,
  where: { username: string } | { userAccountId: number },
) {
  const [row] = await accountAccessQuery(tx)
    .where(
      'username' in where
        ? eq(userAccount.username, where.username)
        : eq(userAccount.id, where.userAccountId),
    )
    .limit(1)
    .for('update', { of: userAccount });
  if (!row) return null;
  const [secret] = await tx
    .select({ passwordHash: userAccount.passwordHash })
    .from(userAccount)
    .where(eq(userAccount.id, row.userAccountId));
  return { ...row, passwordHash: secret?.passwordHash ?? '' };
}

export async function updateAccountCredentials(
  tx: Transaction,
  userAccountId: number,
  values: Partial<
    Pick<
      typeof userAccount.$inferInsert,
      'passwordHash' | 'mustChangePassword' | 'failedAttempts' | 'lockedUntil' | 'deactivatedAt'
    >
  >,
): Promise<void> {
  await tx.update(userAccount).set(values).where(eq(userAccount.id, userAccountId));
}

// --- Refresh tokens -------------------------------------------------------------------------

export async function insertRefreshToken(
  tx: Transaction,
  values: { userAccountId: number; tokenHash: string; expiresAt: Date },
) {
  const [row] = await tx
    .insert(refreshToken)
    .values({ ...values, createdBy: values.userAccountId })
    .returning({ id: refreshToken.id });
  if (!row) throw new Error('refresh token not inserted');
  return row.id;
}

/** Refresh token by hash, locked for the rotation. */
export async function lockRefreshToken(tx: Transaction, tokenHash: string) {
  const [row] = await tx
    .select()
    .from(refreshToken)
    .where(eq(refreshToken.tokenHash, tokenHash))
    .limit(1)
    .for('update');
  return row ?? null;
}

/** Marks a token as rotated into `replacedById`. */
export async function markRotated(
  tx: Transaction,
  id: number,
  replacedById: number,
  now: Date,
): Promise<void> {
  await tx
    .update(refreshToken)
    .set({ revokedAt: now, replacedById })
    .where(eq(refreshToken.id, id));
}

/**
 * Revokes every token of the rotation chain that contains `id` (its ancestors and
 * descendants through replaced_by_id): a reused token means the chain was stolen.
 */
export async function revokeChain(tx: Transaction, id: number, now: Date): Promise<number> {
  const rows = await tx.execute<{ id: number }>(sql`
    WITH RECURSIVE ancestors AS (
      SELECT id FROM refresh_token WHERE id = ${id}
      UNION
      SELECT r.id FROM refresh_token r JOIN ancestors a ON r.replaced_by_id = a.id
    ), descendants AS (
      SELECT id, replaced_by_id FROM refresh_token WHERE id = ${id}
      UNION
      SELECT r.id, r.replaced_by_id FROM refresh_token r JOIN descendants d ON r.id = d.replaced_by_id
    )
    UPDATE refresh_token SET revoked_at = ${now.toISOString()}::timestamptz
    WHERE revoked_at IS NULL
      AND (id IN (SELECT id FROM ancestors) OR id IN (SELECT id FROM descendants))
    RETURNING id`);
  return rows.length;
}

/** Revokes every open session of an account (password change, reset, lock, deactivation). */
export async function revokeAllRefreshTokens(
  tx: Transaction,
  userAccountId: number,
  now: Date,
): Promise<void> {
  await tx
    .update(refreshToken)
    .set({ revokedAt: now })
    .where(and(eq(refreshToken.userAccountId, userAccountId), isNull(refreshToken.revokedAt)));
}

/** Revokes one token if it belongs to the account (logout). */
export async function revokeRefreshToken(
  tx: Transaction,
  userAccountId: number,
  tokenHash: string,
  now: Date,
): Promise<void> {
  await tx
    .update(refreshToken)
    .set({ revokedAt: now })
    .where(
      and(
        eq(refreshToken.tokenHash, tokenHash),
        eq(refreshToken.userAccountId, userAccountId),
        isNull(refreshToken.revokedAt),
      ),
    );
}
