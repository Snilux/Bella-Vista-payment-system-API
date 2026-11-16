import { getTableName, sql, type Table } from 'drizzle-orm';
import type { Transaction } from './client.js';
import { auditLog, type role } from './schema/index.js';

// Audit log (CU-25, 2.1 §6): every service that changes data writes here inside the same
// transaction. The actor comes from the authenticated account (request.actor) or, for the
// seed scripts, from the superadmin and the development accounts.

export type Role = (typeof role.enumValues)[number];

/** Account acting in a transaction: who appears in the audit log. */
export interface Actor {
  userAccountId: number;
  role: Role;
}

export interface AuditEntry {
  /** snake_case verb, e.g. `create`, `update_contact`, `approve`. */
  action: string;
  /** Drizzle table or its SQL name. */
  table: Table | string;
  recordId: number;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  reason?: string | null;
  /** Forces a technical entry; superadmin entries are always technical. */
  technical?: boolean;
}

/**
 * Writes one audit entry. Callers strip secrets (password and token hashes) from
 * before/after.
 */
export async function writeAudit(tx: Transaction, actor: Actor, entry: AuditEntry): Promise<void> {
  await tx.insert(auditLog).values({
    userAccountId: actor.userAccountId,
    role: actor.role,
    action: entry.action,
    tableName: typeof entry.table === 'string' ? entry.table : getTableName(entry.table),
    recordId: entry.recordId,
    before: entry.before ?? null,
    after: entry.after ?? null,
    reason: entry.reason ?? null,
    isTechnical: entry.technical === true || actor.role === 'superadmin',
  });
}

/**
 * Tells the database triggers who is acting in this transaction (SET LOCAL): the
 * contact-change trigger of migration 0015 rejects updates to person/plumber contact data
 * without it and writes its own audit entry with this account and reason.
 */
export async function applyAuditContext(
  tx: Transaction,
  actor: Actor,
  reason?: string,
): Promise<void> {
  await tx.execute(
    sql`SELECT set_config('app.user_account_id', ${String(actor.userAccountId)}, true),
               set_config('app.audit_reason', ${reason ?? ''}, true)`,
  );
}

/** Technical `create` entry for a row inserted by a seed script. */
export function auditCreate(
  tx: Transaction,
  actor: Actor,
  table: Table,
  recordId: number,
  after: Record<string, unknown>,
  reason: string,
): Promise<void> {
  return writeAudit(tx, actor, {
    action: 'create',
    table,
    recordId,
    after,
    reason,
    technical: true,
  });
}
