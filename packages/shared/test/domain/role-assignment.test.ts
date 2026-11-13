import { describe, expect, it } from 'vitest';
import {
  ROLES,
  type RoleAssignmentFields,
  type RoleAssignmentRule,
  requiresApproval,
  roleAssignmentViolations,
} from '../../src/domain/role-assignment.js';

describe('roleAssignmentViolations', () => {
  const cases: [string, RoleAssignmentFields, RoleAssignmentRule[]][] = [
    [
      'leader with block and phone',
      { role: 'block_leader', blockId: 1, contactPhone: '5512345678' },
      [],
    ],
    [
      'leader without block',
      { role: 'block_leader', contactPhone: '5512345678' },
      ['BLOCK_LEADER_REQUIRES_BLOCK'],
    ],
    [
      'leader without phone',
      { role: 'block_leader', blockId: 1 },
      ['BLOCK_LEADER_REQUIRES_CONTACT_PHONE'],
    ],
    [
      'leader with blank phone',
      { role: 'block_leader', blockId: 1, contactPhone: '   ' },
      ['BLOCK_LEADER_REQUIRES_CONTACT_PHONE'],
    ],
    [
      'leader with nothing',
      { role: 'block_leader', blockId: null, contactPhone: null },
      ['BLOCK_LEADER_REQUIRES_BLOCK', 'BLOCK_LEADER_REQUIRES_CONTACT_PHONE'],
    ],
    ['treasurer without block or phone', { role: 'treasurer' }, []],
    ['treasurer with phone', { role: 'treasurer', contactPhone: '5512345678' }, []],
    ['treasurer with block', { role: 'treasurer', blockId: 1 }, ['BLOCK_ONLY_FOR_BLOCK_LEADER']],
    ['member with block', { role: 'member', blockId: 2 }, ['BLOCK_ONLY_FOR_BLOCK_LEADER']],
    ['superadmin with block', { role: 'superadmin', blockId: 2 }, ['BLOCK_ONLY_FOR_BLOCK_LEADER']],
    ['superadmin alone', { role: 'superadmin' }, []],
  ];

  it.each(cases)('%s', (_label, fields, expected) => {
    expect(roleAssignmentViolations(fields)).toEqual(expected);
  });
});

describe('requiresApproval', () => {
  it.each(ROLES.map((role) => [role, role !== 'superadmin'] as const))(
    '%s → %s',
    (role, expected) => {
      expect(requiresApproval(role)).toBe(expected);
    },
  );
});
