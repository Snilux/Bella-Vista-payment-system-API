import { z } from 'zod';
import { ROLES } from '../domain/role-assignment.js';

// Approvals inbox (/v1/approvals; transversal): the president resolves every request; each
// requester follows their own. Values translated per docs/glosario.md.

export const APPROVAL_TYPES = [
  'role_assignment',
  'rate',
  'plumber_salary',
  'opening_balance',
  'unit_deactivation',
  'holder_change',
  'payment_cancellation',
  'adjustment',
  'expense_refund',
] as const;

export type ApprovalType = (typeof APPROVAL_TYPES)[number];

export const APPROVAL_STATUSES = ['pending', 'approved', 'rejected'] as const;

const accountRefSchema = z.object({
  userAccountId: z.int(),
  username: z.string(),
  role: z.enum(ROLES),
  fullName: z.string(),
});

export const approvalSchema = z.object({
  id: z.int(),
  type: z.enum(APPROVAL_TYPES),
  status: z.enum(APPROVAL_STATUSES),
  /** Why it was requested. */
  reason: z.string(),
  /** What is being approved, written by the module that owns the type. */
  description: z.string().nullable(),
  requestedBy: accountRefSchema,
  requestedAt: z.iso.datetime(),
  resolvedBy: accountRefSchema.nullable(),
  resolvedAt: z.iso.datetime().nullable(),
  resolutionReason: z.string().nullable(),
});

export const approvalListQuerySchema = z.object({
  status: z.enum(['pending', 'resolved', 'all']).default('pending'),
});

export const approvalListResponseSchema = z.object({ approvals: z.array(approvalSchema) });
export const approvalResponseSchema = z.object({ approval: approvalSchema });

export const resolveApprovalRequestSchema = z
  .object({
    result: z.enum(['approved', 'rejected'], { error: 'Indique si se autoriza o se rechaza.' }),
    reason: z
      .string()
      .trim()
      .max(500, { error: 'El motivo no puede tener más de 500 caracteres.' })
      .optional()
      .transform((value) => (value ? value : undefined)),
  })
  .refine((body) => body.result === 'approved' || body.reason !== undefined, {
    path: ['reason'],
    error: 'Escriba el motivo del rechazo.',
  });

export type Approval = z.infer<typeof approvalSchema>;
export type ApprovalListQuery = z.infer<typeof approvalListQuerySchema>;
export type ResolveApprovalRequest = z.infer<typeof resolveApprovalRequestSchema>;
