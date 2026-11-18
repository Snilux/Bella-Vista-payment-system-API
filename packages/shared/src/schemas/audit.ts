import { z } from 'zod';
import { ROLES } from '../domain/role-assignment.js';
import { page, paginationQuerySchema } from './common.js';

// Audit log query (/v1/audit-log; CU-25, RF-AUD-02): the president sees every entry, the
// superadmin only the technical ones.

export const auditEntrySchema = z.object({
  id: z.int(),
  userAccountId: z.int(),
  username: z.string(),
  /** The person of the account (R-05). */
  fullName: z.string(),
  role: z.string(),
  action: z.string(),
  tableName: z.string(),
  recordId: z.int(),
  before: z.unknown().nullable(),
  after: z.unknown().nullable(),
  reason: z.string().nullable(),
  isTechnical: z.boolean(),
  createdAt: z.iso.datetime(),
});

export const auditLogQuerySchema = paginationQuerySchema.extend({
  userAccountId: z.coerce.number().int().positive().optional(),
  /** The role of the account when it acted (R-05 "Cargo"). */
  role: z.enum(ROLES).optional(),
  tableName: z.string().trim().min(1).max(64).optional(),
  recordId: z.coerce.number().int().positive().optional(),
  action: z.string().trim().min(1).max(64).optional(),
  /** Business dates (inclusive). */
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
});

export const auditLogPageSchema = page(auditEntrySchema);

export type AuditEntry = z.infer<typeof auditEntrySchema>;
export type AuditLogQuery = z.infer<typeof auditLogQuerySchema>;
