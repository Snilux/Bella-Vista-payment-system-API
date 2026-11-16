import { describe, expect, it } from 'vitest';
import { ACTIONS, type Action, can, isBlockScoped } from '../../src/domain/permissions.js';
import { ROLES, type Role } from '../../src/domain/role-assignment.js';

// Expected matrix written from docs/api.md ("Permisos (resumen)") with its abbreviations,
// independently of the implementation: SA, PRE, TES, SEC, VOC (member), JM (block leader).
const abbreviation: Record<string, Role> = {
  SA: 'superadmin',
  PRE: 'president',
  TES: 'treasurer',
  SEC: 'secretary',
  VOC: 'member',
  JM: 'block_leader',
};

const expected: Record<Action, string> = {
  'accounts.manage': 'SA',
  'organization.view': 'PRE TES SEC VOC JM',
  'organization.manage': 'SEC',
  'assignments.view': 'PRE TES SEC VOC',
  'assignments.register': 'SEC',
  'assignments.close': 'SEC',
  'registry.view': 'PRE TES SEC VOC JM',
  'registry.manage': 'PRE SEC JM',
  'connectionRequests.view': 'PRE TES SEC VOC JM',
  'connectionRequests.manage': 'SEC JM',
  'connectionRequests.resolve': 'SEC',
  'agreements.view': 'PRE TES SEC VOC',
  'agreements.manage': 'SEC',
  'unitChanges.request': 'SEC JM',
  'suspensions.manage': 'PRE SEC',
  'rates.view': 'PRE TES SEC VOC JM',
  'rates.register': 'TES',
  'payments.view': 'PRE TES SEC VOC JM',
  'billing.collect': 'PRE TES JM',
  'receipts.replace': 'TES JM',
  'payments.requestCancellation': 'TES JM',
  'handovers.view': 'PRE TES VOC JM',
  'handovers.prepare': 'PRE JM',
  'handovers.confirm': 'TES',
  'adjustments.propose': 'TES',
  'committee.view': 'PRE TES SEC VOC',
  'committee.manage': 'TES',
  'closings.view': 'PRE TES SEC VOC JM',
  'closings.prepare': 'TES JM',
  'closings.review': 'PRE VOC',
  'approvals.view': 'PRE TES SEC VOC JM',
  'approvals.resolve': 'PRE',
  'reports.block': 'PRE TES SEC VOC JM',
  'reports.community': 'PRE TES SEC VOC',
  'auditLog.view': 'PRE SA',
};

const cases = ACTIONS.flatMap((action) => {
  const allowed = new Set(expected[action].split(' ').map((a) => abbreviation[a]));
  return ROLES.map((role) => [action, role, allowed.has(role)] as const);
});

describe('can', () => {
  it('covers every action of the matrix', () => {
    expect([...ACTIONS].sort()).toEqual(Object.keys(expected).sort());
  });

  it.each(cases)('%s by %s → %s', (action, role, allowed) => {
    expect(can(role, action)).toBe(allowed);
  });

  it('gives the superadmin nothing but accounts and the audit log (D-19)', () => {
    expect(ACTIONS.filter((action) => can('superadmin', action))).toEqual([
      'accounts.manage',
      'auditLog.view',
    ]);
  });
});

describe('isBlockScoped', () => {
  it.each(ROLES.map((role) => [role, role === 'block_leader'] as const))(
    '%s → %s',
    (role, scoped) => {
      expect(isBlockScoped(role)).toBe(scoped);
    },
  );
});
