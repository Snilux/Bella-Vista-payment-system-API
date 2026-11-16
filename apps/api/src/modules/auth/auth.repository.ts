import { eq } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import { approval, roleAssignment, userAccount } from '../../db/schema/index.js';

/** Account with its role assignment: what each authenticated request is checked against. */
export async function findAccountAccess(db: Database, userAccountId: number) {
  const [row] = await db
    .select({
      userAccountId: userAccount.id,
      username: userAccount.username,
      mustChangePassword: userAccount.mustChangePassword,
      deactivatedAt: userAccount.deactivatedAt,
      lockedUntil: userAccount.lockedUntil,
      roleAssignmentId: roleAssignment.id,
      role: roleAssignment.role,
      personId: roleAssignment.personId,
      blockId: roleAssignment.blockId,
      startDate: roleAssignment.startDate,
      endDate: roleAssignment.endDate,
      approvalResult: approval.result,
    })
    .from(userAccount)
    .innerJoin(roleAssignment, eq(roleAssignment.id, userAccount.roleAssignmentId))
    .leftJoin(approval, eq(approval.id, roleAssignment.approvalId))
    .where(eq(userAccount.id, userAccountId))
    .limit(1);
  return row ?? null;
}

export type AccountAccess = NonNullable<Awaited<ReturnType<typeof findAccountAccess>>>;
