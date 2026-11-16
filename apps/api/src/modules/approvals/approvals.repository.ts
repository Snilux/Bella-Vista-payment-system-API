import { and, desc, eq, isNotNull, isNull, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Database, Transaction } from '../../db/client.js';
import { approval, person, roleAssignment, userAccount } from '../../db/schema/index.js';

type Executor = Database | Transaction;

const requesterAccount = alias(userAccount, 'requester_account');
const requesterAssignment = alias(roleAssignment, 'requester_assignment');
const requesterPerson = alias(person, 'requester_person');
const resolverAccount = alias(userAccount, 'resolver_account');
const resolverAssignment = alias(roleAssignment, 'resolver_assignment');
const resolverPerson = alias(person, 'resolver_person');

const approvalQuery = (db: Executor) =>
  db
    .select({
      id: approval.id,
      type: approval.type,
      reason: approval.reason,
      result: approval.result,
      requestedAt: approval.requestedAt,
      resolvedAt: approval.resolvedAt,
      resolutionReason: approval.resolutionReason,
      requester: {
        userAccountId: requesterAccount.id,
        username: requesterAccount.username,
        role: requesterAssignment.role,
        givenNames: requesterPerson.givenNames,
        paternalSurname: requesterPerson.paternalSurname,
        maternalSurname: requesterPerson.maternalSurname,
      },
      resolver: {
        userAccountId: resolverAccount.id,
        username: resolverAccount.username,
        role: resolverAssignment.role,
        givenNames: resolverPerson.givenNames,
        paternalSurname: resolverPerson.paternalSurname,
        maternalSurname: resolverPerson.maternalSurname,
      },
    })
    .from(approval)
    .innerJoin(requesterAccount, eq(requesterAccount.id, approval.requestedBy))
    .innerJoin(requesterAssignment, eq(requesterAssignment.id, requesterAccount.roleAssignmentId))
    .innerJoin(requesterPerson, eq(requesterPerson.id, requesterAssignment.personId))
    .leftJoin(resolverAccount, eq(resolverAccount.id, approval.resolvedBy))
    .leftJoin(resolverAssignment, eq(resolverAssignment.id, resolverAccount.roleAssignmentId))
    .leftJoin(resolverPerson, eq(resolverPerson.id, resolverAssignment.personId));

export function listApprovals(
  db: Executor,
  filter: { status: 'pending' | 'resolved' | 'all'; requestedBy: number | null },
) {
  const conditions: SQL[] = [];
  if (filter.status === 'pending') conditions.push(isNull(approval.result));
  if (filter.status === 'resolved') conditions.push(isNotNull(approval.result));
  if (filter.requestedBy !== null) conditions.push(eq(approval.requestedBy, filter.requestedBy));
  return approvalQuery(db)
    .where(and(...conditions))
    .orderBy(desc(approval.requestedAt), desc(approval.id));
}

export type ApprovalRow = Awaited<ReturnType<typeof listApprovals>>[number];

export async function findApproval(db: Executor, id: number): Promise<ApprovalRow | null> {
  const [row] = await approvalQuery(db).where(eq(approval.id, id)).limit(1);
  return row ?? null;
}

/** Approval locked for its resolution. */
export async function lockApproval(tx: Transaction, id: number) {
  const [row] = await tx
    .select({ id: approval.id, type: approval.type, result: approval.result })
    .from(approval)
    .where(eq(approval.id, id))
    .limit(1)
    .for('update');
  return row ?? null;
}

export async function recordResolution(
  tx: Transaction,
  id: number,
  values: {
    result: 'approved' | 'rejected';
    resolvedBy: number;
    resolvedAt: Date;
    resolutionReason: string | null;
  },
): Promise<void> {
  await tx.update(approval).set(values).where(eq(approval.id, id));
}
