import type { AuditEntry, AuditLogQuery } from '@bella-vista/shared';
import type { Database } from '../../db/client.js';
import type { AuthenticatedAccount } from '../../plugins/auth.js';
import { listAuditLog } from './audit.repository.js';

// Audit log (CU-25, RF-AUD-02): the president sees the full log; the superadmin only the
// technical entries (accounts, bootstrap and their own actions).

export function createAuditService(deps: { db: Database }) {
  return {
    async list(viewer: AuthenticatedAccount, query: AuditLogQuery) {
      const rows = await listAuditLog(deps.db, {
        technicalOnly: viewer.role !== 'president',
        userAccountId: query.userAccountId,
        role: query.role,
        tableName: query.tableName,
        recordId: query.recordId,
        action: query.action,
        from: query.from,
        to: query.to,
        cursor: query.cursor,
        limit: query.limit,
      });
      const data = rows
        .slice(0, query.limit)
        .map((row): AuditEntry => ({ ...row, createdAt: row.createdAt.toISOString() }));
      return { data, next: rows.length > query.limit ? String(data.at(-1)?.id) : null };
    },
  };
}

export type AuditService = ReturnType<typeof createAuditService>;
