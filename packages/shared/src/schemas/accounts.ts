import { z } from 'zod';
import { ROLES } from '../domain/role-assignment.js';

// Account management by the superadmin (/v1/accounts; CU-02, RF-AUT-03 to 05, D-19, D-22).

/** Same rule as the bootstrap superadmin and the user_account CHECK (lowercase, trimmed). */
export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9._-]{3,32}$/, {
    error:
      'El usuario debe tener de 3 a 32 caracteres: letras, números, punto, guion o guion bajo.',
  });

export const ACCOUNT_STATUSES = [
  'active',
  'locked',
  'disabled',
  'must_change_password',
  'role_not_active',
] as const;

export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

const personSummarySchema = z.object({
  id: z.int(),
  folio: z.string(),
  fullName: z.string(),
  distinguishingNote: z.string().nullable(),
});

export const accountSummarySchema = z.object({
  id: z.int(),
  username: z.string(),
  role: z.enum(ROLES),
  status: z.enum(ACCOUNT_STATUSES),
  mustChangePassword: z.boolean(),
  failedAttempts: z.int(),
  /** ISO timestamp; a manual lock by the superadmin has no end (9999-12-31). */
  lockedUntil: z.iso.datetime().nullable(),
  deactivatedAt: z.iso.datetime().nullable(),
  roleAssignmentId: z.int(),
  assignmentStartDate: z.iso.date(),
  assignmentEndDate: z.iso.date().nullable(),
  /** Visible block code (S1-M03) of a block leader. */
  blockCode: z.string().nullable(),
  person: personSummarySchema,
});

export const assignmentWithoutAccountSchema = z.object({
  roleAssignmentId: z.int(),
  role: z.enum(ROLES),
  startDate: z.iso.date(),
  blockCode: z.string().nullable(),
  person: personSummarySchema,
});

export const accountListResponseSchema = z.object({
  accounts: z.array(accountSummarySchema),
  /** Current, approved assignments that still have no account (the superadmin's inbox). */
  assignmentsWithoutAccount: z.array(assignmentWithoutAccountSchema),
});

export const accountIdParamsSchema = z.object({ id: z.coerce.number().int().positive() });

export const createAccountRequestSchema = z.object({
  roleAssignmentId: z.int({ error: 'Elija la asignación de cargo.' }).positive(),
  username: usernameSchema,
});

/** Response of create and reset: the temporary password is shown only here, once. */
export const accountWithTemporaryPasswordSchema = z.object({
  account: accountSummarySchema,
  temporaryPassword: z.string(),
});

const reasonSchema = z
  .string({ error: 'Escriba el motivo.' })
  .trim()
  .min(1, { error: 'Escriba el motivo.' })
  .max(500, { error: 'El motivo no puede tener más de 500 caracteres.' });

/** Lock, unlock and deactivate: the reason is required. */
export const accountReasonRequestSchema = z.object({ reason: reasonSchema });

/**
 * Reset password: the reason is optional (A-03 asks for it; older clients send no body). It
 * goes to the technical audit log, never the password.
 */
export const resetPasswordRequestSchema = z.object({ reason: reasonSchema.optional() }).nullish();

export const accountResponseSchema = z.object({ account: accountSummarySchema });

export type AccountSummary = z.infer<typeof accountSummarySchema>;
export type AssignmentWithoutAccount = z.infer<typeof assignmentWithoutAccountSchema>;
export type AccountListResponse = z.infer<typeof accountListResponseSchema>;
export type CreateAccountRequest = z.infer<typeof createAccountRequestSchema>;
export type AccountWithTemporaryPassword = z.infer<typeof accountWithTemporaryPasswordSchema>;
export type AccountReasonRequest = z.infer<typeof accountReasonRequestSchema>;
export type ResetPasswordRequest = z.infer<typeof resetPasswordRequestSchema>;
