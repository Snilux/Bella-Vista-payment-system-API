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

/**
 * The record an approval is about, so a screen can open it (R-03 → G-05, T-10, G-04…):
 * role_assignment → its assignment; rate → the rate; plumber_salary → the plumber;
 * opening_balance → the cashbox; unit_deactivation and holder_change → the unit;
 * payment_cancellation → the payment; adjustment → its handover or closing;
 * expense_refund → the expense.
 */
export const APPROVAL_SUBJECT_TYPES = [
  'role_assignment',
  'rate',
  'plumber',
  'cashbox',
  'unit',
  'payment',
  'handover',
  'closing',
  'expense',
] as const;

export type ApprovalSubjectType = (typeof APPROVAL_SUBJECT_TYPES)[number];

export const approvalSubjectSchema = z.object({
  type: z.enum(APPROVAL_SUBJECT_TYPES),
  id: z.int(),
});

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
  /** The record it is about; null only if its module wrote none. */
  subject: approvalSubjectSchema.nullable(),
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
export type ApprovalSubject = z.infer<typeof approvalSubjectSchema>;
export type ApprovalListQuery = z.infer<typeof approvalListQuerySchema>;
export type ResolveApprovalRequest = z.infer<typeof resolveApprovalRequestSchema>;
