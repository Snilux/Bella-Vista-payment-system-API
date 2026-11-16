import { z } from 'zod';

// Error response of the API (docs/api.md, "Errores"; codes translated per docs/glosario.md).
// `code` is stable and in English for the app to react to; `message` is Spanish, ready to show.

export const ERROR_CODES = [
  // Business codes (2.3 §5)
  'INVALID_CREDENTIALS',
  'ACCOUNT_LOCKED',
  'ROLE_NOT_ACTIVE',
  'OUT_OF_SCOPE',
  'ASSIGNMENT_HAS_ACCOUNT',
  'ASSIGNMENT_NOT_ACTIVE',
  'USERNAME_TAKEN',
  'HOMONYM_WITHOUT_NOTE',
  'DUPLICATE_DISTINGUISHING_NOTE',
  'MONTH_ORDER',
  'PERIOD_ALREADY_PAID',
  'TOTAL_CHANGED',
  'DUPLICATE_PAPER_FOLIO',
  'PERIOD_CLOSED',
  'INSUFFICIENT_BALANCE',
  'CONNECTION_NOT_ACTIVE',
  'LEADER_ALREADY_ASSIGNED',
  'ROLE_ALREADY_ASSIGNED',
  'DUPLICATE_CODE',
  'INVALID_RATE_EFFECTIVE_PERIOD',
  'APPROVAL_ALREADY_RESOLVED',
  'FEE_WITHOUT_AMOUNT',
  'OPENING_NOT_PAID',
  'INVALID_STATE',
  // General codes (2.3 §5.1)
  'VALIDATION_ERROR',
  'INVALID_REQUEST',
  'IDEMPOTENCY_KEY_REQUIRED',
  'UNAUTHENTICATED',
  'TOKEN_EXPIRED',
  'ACCOUNT_DISABLED',
  'PASSWORD_CHANGE_REQUIRED',
  'FORBIDDEN',
  'NOT_FOUND',
  'IDEMPOTENCY_KEY_REUSED',
  'TOO_MANY_REQUESTS',
  'INTERNAL_ERROR',
  'DATABASE_UNAVAILABLE',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/** One field that failed validation (`details.issues` of VALIDATION_ERROR). */
export const validationIssueSchema = z.object({
  path: z.string(),
  message: z.string(),
});

export type ValidationIssue = z.infer<typeof validationIssueSchema>;

export const errorResponseSchema = z.object({
  error: z.object({
    code: z.enum(ERROR_CODES),
    message: z.string(),
    details: z.record(z.string(), z.unknown()),
  }),
});

export type ErrorResponse = z.infer<typeof errorResponseSchema>;
