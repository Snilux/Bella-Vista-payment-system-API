import { sql } from 'drizzle-orm';
import { type AnyPgColumn, check, index, pgTable, text } from 'drizzle-orm/pg-core';
import { userAccount } from './access.js';
import { createdAt, createdBy, fk, id, timestamptz } from './columns.js';
import { approvalResult, approvalType } from './enums.js';

// result null = pending. `type` tells which table points at the approval; the trigger that
// checks it belongs to the "views and triggers" block.
export const approval = pgTable(
  'approval',
  {
    id: id(),
    type: approvalType().notNull(),
    reason: text().notNull(),
    requestedBy: fk()
      .notNull()
      .references((): AnyPgColumn => userAccount.id),
    requestedAt: timestamptz().notNull().defaultNow(),
    result: approvalResult(),
    resolvedBy: fk().references((): AnyPgColumn => userAccount.id),
    resolvedAt: timestamptz(),
    resolutionReason: text(),
    createdBy: createdBy((): AnyPgColumn => userAccount.id),
    createdAt: createdAt(),
  },
  (t) => [
    check('approval_reason_not_blank', sql`btrim(${t.reason}) <> ''`),
    check(
      'approval_resolution_complete',
      sql`num_nulls(${t.result}, ${t.resolvedBy}, ${t.resolvedAt}) IN (0, 3)`,
    ),
    check(
      'approval_rejection_reason',
      sql`${t.result} IS DISTINCT FROM 'rejected' OR nullif(btrim(${t.resolutionReason}), '') IS NOT NULL`,
    ),
    index('approval_pending_idx').on(t.requestedAt).where(sql`${t.result} IS NULL`),
  ],
);
