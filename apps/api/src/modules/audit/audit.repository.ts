import { and, desc, eq, lt, sql } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import { auditLog, userAccount } from '../../db/schema/index.js';

// Audit log query (CU-25). Dates are filtered by business date (America/Mexico_City), the same
// zone as folios and periods.

export function listAuditLog(
  db: Database,
  filter: {
    technicalOnly: boolean;
    userAccountId?: number | undefined;
    tableName?: string | undefined;
    recordId?: number | undefined;
    action?: string | undefined;
    from?: string | undefined;
    to?: string | undefined;
    cursor?: number | undefined;
    limit: number;
  },
) {
  const businessDate = sql`f_business_date(${auditLog.createdAt})`;
  return db
    .select({
      id: auditLog.id,
      userAccountId: auditLog.userAccountId,
      username: userAccount.username,
      role: auditLog.role,
      action: auditLog.action,
      tableName: auditLog.tableName,
      recordId: auditLog.recordId,
      before: auditLog.before,
      after: auditLog.after,
      reason: auditLog.reason,
      isTechnical: auditLog.isTechnical,
      createdAt: auditLog.createdAt,
    })
    .from(auditLog)
    .innerJoin(userAccount, eq(userAccount.id, auditLog.userAccountId))
    .where(
      and(
        filter.technicalOnly ? eq(auditLog.isTechnical, true) : undefined,
        filter.userAccountId !== undefined
          ? eq(auditLog.userAccountId, filter.userAccountId)
          : undefined,
        filter.tableName !== undefined ? eq(auditLog.tableName, filter.tableName) : undefined,
        filter.recordId !== undefined ? eq(auditLog.recordId, filter.recordId) : undefined,
        filter.action !== undefined ? eq(auditLog.action, filter.action) : undefined,
        filter.from !== undefined ? sql`${businessDate} >= ${filter.from}` : undefined,
        filter.to !== undefined ? sql`${businessDate} <= ${filter.to}` : undefined,
        filter.cursor !== undefined ? lt(auditLog.id, filter.cursor) : undefined,
      ),
    )
    .orderBy(desc(auditLog.id))
    .limit(filter.limit + 1);
}
