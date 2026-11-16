import type { Role } from './role-assignment.js';

// Permission matrix of docs/api.md ("Permisos (resumen)"): which roles may perform each
// action. It answers "can this role do it at all"; the block scope of a block leader (D-09)
// and the validity of the assignment are checked by the API on top of it. The superadmin
// only manages accounts and reads the technical audit log (D-19).

const COMMITTEE = ['president', 'treasurer', 'secretary', 'member'] as const;
const COMMITTEE_AND_LEADERS = [...COMMITTEE, 'block_leader'] as const;

export const PERMISSIONS = {
  // Accounts (CU-02)
  'accounts.manage': ['superadmin'],
  // Organization (CU-03, CU-04)
  'organization.view': COMMITTEE_AND_LEADERS,
  'organization.manage': ['secretary'],
  'assignments.view': COMMITTEE,
  'assignments.register': ['secretary'],
  // Registry and connections (CU-05 to CU-11)
  'registry.view': COMMITTEE_AND_LEADERS,
  'registry.manage': ['secretary', 'block_leader', 'president'],
  'connectionRequests.view': COMMITTEE_AND_LEADERS,
  'connectionRequests.manage': ['secretary', 'block_leader'],
  'agreements.view': COMMITTEE,
  'agreements.manage': ['secretary'],
  'unitChanges.request': ['secretary', 'block_leader'],
  'suspensions.manage': ['president', 'secretary'],
  // Rates, fees and opening balances (CU-12, D-20)
  'rates.view': COMMITTEE_AND_LEADERS,
  'rates.register': ['treasurer'],
  // Billing (CU-13 to CU-16); the president collects only as support (D-07)
  'billing.collect': ['treasurer', 'block_leader', 'president'],
  'receipts.replace': ['treasurer', 'block_leader'],
  'payments.requestCancellation': ['treasurer', 'block_leader'],
  // Cashboxes and handovers (CU-17, CU-18)
  'handovers.view': ['president', 'treasurer', 'member', 'block_leader'],
  'handovers.prepare': ['block_leader', 'president'],
  'handovers.confirm': ['treasurer'],
  'adjustments.propose': ['treasurer'],
  // Committee: incomes, expenses and plumber (CU-19 to CU-21)
  'committee.view': COMMITTEE,
  'committee.manage': ['treasurer'],
  // Closings (CU-22)
  'closings.view': COMMITTEE_AND_LEADERS,
  'closings.prepare': ['treasurer', 'block_leader'],
  'closings.review': ['president', 'member'],
  // Approvals inbox (transversal)
  'approvals.resolve': ['president'],
  // Reports (CU-23, CU-24)
  'reports.block': COMMITTEE_AND_LEADERS,
  'reports.community': COMMITTEE,
  // Audit log (CU-25): full for the president, technical entries only for the superadmin
  'auditLog.view': ['president', 'superadmin'],
} as const satisfies Record<string, readonly Role[]>;

export type Action = keyof typeof PERMISSIONS;

export const ACTIONS = Object.keys(PERMISSIONS) as Action[];

/** Whether `role` may perform `action` (before block scope and assignment validity). */
export function can(role: Role, action: Action): boolean {
  return (PERMISSIONS[action] as readonly Role[]).includes(role);
}

/** Roles whose data access is limited to their own block. */
export function isBlockScoped(role: Role): boolean {
  return role === 'block_leader';
}
