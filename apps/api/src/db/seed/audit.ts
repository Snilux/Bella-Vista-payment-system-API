import { getTableName, type Table } from 'drizzle-orm';
import type { Transaction } from '../client.js';
import { auditLog, type role } from '../schema/index.js';

export type Role = (typeof role.enumValues)[number];

/** Account the seed scripts act as in the audit log. */
export interface Actor {
  userAccountId: number;
  role: Role;
}

/**
 * Writes a technical `create` entry in the audit log for a row inserted by a seed script.
 * `after` must never carry secrets (password hashes are stripped by the caller).
 */
export async function auditCreate(
  tx: Transaction,
  actor: Actor,
  table: Table,
  recordId: number,
  after: Record<string, unknown>,
  reason: string,
): Promise<void> {
  await tx.insert(auditLog).values({
    userAccountId: actor.userAccountId,
    role: actor.role,
    action: 'create',
    tableName: getTableName(table),
    recordId,
    after,
    reason,
    isTechnical: true,
  });
}
