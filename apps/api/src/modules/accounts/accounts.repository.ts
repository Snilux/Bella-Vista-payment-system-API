import { and, asc, eq, gte, isNull, lte, ne, or } from 'drizzle-orm';
import type { Database, Transaction } from '../../db/client.js';
import { approval, person, roleAssignment, userAccount, vBlock } from '../../db/schema/index.js';

// Queries of the accounts module (superadmin only). Password hashes never leave this file
// except as the value to store.

type Executor = Database | Transaction;

const personColumns = {
  personId: person.id,
  personFolio: person.folio,
  givenNames: person.givenNames,
  paternalSurname: person.paternalSurname,
  maternalSurname: person.maternalSurname,
  distinguishingNote: person.distinguishingNote,
};

const accountColumns = {
  id: userAccount.id,
  username: userAccount.username,
  mustChangePassword: userAccount.mustChangePassword,
  failedAttempts: userAccount.failedAttempts,
  lockedUntil: userAccount.lockedUntil,
  deactivatedAt: userAccount.deactivatedAt,
  roleAssignmentId: roleAssignment.id,
  role: roleAssignment.role,
  assignmentStartDate: roleAssignment.startDate,
  assignmentEndDate: roleAssignment.endDate,
  approvalResult: approval.result,
  blockCode: vBlock.code,
  ...personColumns,
};

const accountQuery = (db: Executor) =>
  db
    .select(accountColumns)
    .from(userAccount)
    .innerJoin(roleAssignment, eq(roleAssignment.id, userAccount.roleAssignmentId))
    .innerJoin(person, eq(person.id, roleAssignment.personId))
    .leftJoin(approval, eq(approval.id, roleAssignment.approvalId))
    .leftJoin(vBlock, eq(vBlock.id, roleAssignment.blockId));

export function listAccounts(db: Executor) {
  return accountQuery(db).orderBy(asc(userAccount.username));
}

export type AccountRow = Awaited<ReturnType<typeof listAccounts>>[number];

export async function findAccount(db: Executor, id: number): Promise<AccountRow | null> {
  const [row] = await accountQuery(db).where(eq(userAccount.id, id)).limit(1);
  return row ?? null;
}

/**
 * Approved assignments current on `today` that have no account (D-19: the superadmin creates
 * accounts only for them). The superadmin's own assignment is created with its account.
 */
export function listAssignmentsWithoutAccount(db: Executor, today: string) {
  return db
    .select({
      roleAssignmentId: roleAssignment.id,
      role: roleAssignment.role,
      startDate: roleAssignment.startDate,
      blockCode: vBlock.code,
      ...personColumns,
    })
    .from(roleAssignment)
    .innerJoin(approval, eq(approval.id, roleAssignment.approvalId))
    .innerJoin(person, eq(person.id, roleAssignment.personId))
    .leftJoin(userAccount, eq(userAccount.roleAssignmentId, roleAssignment.id))
    .leftJoin(vBlock, eq(vBlock.id, roleAssignment.blockId))
    .where(
      and(
        isNull(userAccount.id),
        ne(roleAssignment.role, 'superadmin'),
        eq(approval.result, 'approved'),
        lte(roleAssignment.startDate, today),
        or(isNull(roleAssignment.endDate), gte(roleAssignment.endDate, today)),
      ),
    )
    .orderBy(asc(roleAssignment.startDate), asc(roleAssignment.id));
}

/** Role assignment locked for account creation, with its approval and existing account. */
export async function lockAssignment(tx: Transaction, id: number) {
  const [row] = await tx
    .select({
      id: roleAssignment.id,
      role: roleAssignment.role,
      startDate: roleAssignment.startDate,
      endDate: roleAssignment.endDate,
      approvalResult: approval.result,
    })
    .from(roleAssignment)
    .leftJoin(approval, eq(approval.id, roleAssignment.approvalId))
    .where(eq(roleAssignment.id, id))
    .limit(1)
    .for('update', { of: roleAssignment });
  if (!row) return null;
  const [account] = await tx
    .select({ id: userAccount.id })
    .from(userAccount)
    .where(eq(userAccount.roleAssignmentId, id))
    .limit(1);
  return { ...row, accountId: account?.id ?? null };
}

export async function usernameExists(tx: Transaction, username: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: userAccount.id })
    .from(userAccount)
    .where(eq(userAccount.username, username))
    .limit(1);
  return row !== undefined;
}

export async function insertAccount(
  tx: Transaction,
  values: { roleAssignmentId: number; username: string; passwordHash: string; createdBy: number },
): Promise<number> {
  const [row] = await tx
    .insert(userAccount)
    .values({ ...values, mustChangePassword: true })
    .returning({ id: userAccount.id });
  if (!row) throw new Error('account not inserted');
  return row.id;
}

/** Account row locked for a state change (reset, lock, unlock, deactivate). */
export async function lockAccount(tx: Transaction, id: number) {
  const [row] = await tx
    .select({
      id: userAccount.id,
      username: userAccount.username,
      mustChangePassword: userAccount.mustChangePassword,
      failedAttempts: userAccount.failedAttempts,
      lockedUntil: userAccount.lockedUntil,
      deactivatedAt: userAccount.deactivatedAt,
    })
    .from(userAccount)
    .where(eq(userAccount.id, id))
    .limit(1)
    .for('update');
  return row ?? null;
}

export type LockedAccount = NonNullable<Awaited<ReturnType<typeof lockAccount>>>;

export async function updateAccount(
  tx: Transaction,
  id: number,
  values: Partial<
    Pick<
      typeof userAccount.$inferInsert,
      'passwordHash' | 'mustChangePassword' | 'failedAttempts' | 'lockedUntil' | 'deactivatedAt'
    >
  >,
): Promise<void> {
  await tx.update(userAccount).set(values).where(eq(userAccount.id, id));
}
