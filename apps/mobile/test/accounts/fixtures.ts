import type { AccountSummary, AssignmentWithoutAccount } from '@bella-vista/shared';

// Accounts as GET /v1/accounts returns them (packages/shared accountSummarySchema).

export function account(change: Partial<AccountSummary> = {}): AccountSummary {
  return {
    id: 5,
    username: 'tesorero',
    role: 'treasurer',
    status: 'active',
    mustChangePassword: false,
    failedAttempts: 0,
    lockedUntil: null,
    deactivatedAt: null,
    roleAssignmentId: 5,
    assignmentStartDate: '2026-01-01',
    assignmentEndDate: null,
    blockCode: null,
    person: {
      id: 5,
      folio: 'P-000005',
      fullName: 'Rosa María Salinas Vega',
      distinguishingNote: null,
    },
    ...change,
  };
}

export function assignment(
  change: Partial<AssignmentWithoutAccount> = {},
): AssignmentWithoutAccount {
  return {
    roleAssignmentId: 12,
    role: 'member',
    startDate: '2026-01-01',
    blockCode: null,
    person: {
      id: 12,
      folio: 'P-000012',
      fullName: 'Silvia Ramírez Cruz',
      distinguishingNote: null,
    },
    ...change,
  };
}
