import { describe, expect, it } from 'vitest';
import { createRoleAssignmentSchema } from '../../src/schemas/role-assignment.js';

const base = { personId: 7, startDate: '2026-11-01' };

function issues(input: unknown) {
  const result = createRoleAssignmentSchema.safeParse(input);
  return result.success
    ? []
    : result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }));
}

describe('createRoleAssignmentSchema', () => {
  it('accepts a block leader with block and trimmed phone', () => {
    const parsed = createRoleAssignmentSchema.parse({
      ...base,
      role: 'block_leader',
      blockId: 3,
      contactPhone: ' 5512345678 ',
    });
    expect(parsed.contactPhone).toBe('5512345678');
  });

  it('accepts other roles with or without phone and without block', () => {
    expect(issues({ ...base, role: 'treasurer' })).toEqual([]);
    expect(issues({ ...base, role: 'member', contactPhone: '5512345678' })).toEqual([]);
  });

  it('requires block and phone for a block leader, with Spanish messages', () => {
    expect(issues({ ...base, role: 'block_leader' })).toEqual([
      { path: 'blockId', message: 'El jefe de manzana debe tener una manzana.' },
      { path: 'contactPhone', message: 'El jefe de manzana debe tener un teléfono de contacto.' },
    ]);
  });

  it('forbids a block for other roles', () => {
    expect(issues({ ...base, role: 'secretary', blockId: 3 })).toEqual([
      { path: 'blockId', message: 'Solo el jefe de manzana puede tener una manzana asignada.' },
    ]);
  });

  it('rejects a blank phone', () => {
    expect(issues({ ...base, role: 'member', contactPhone: '  ' })).toEqual([
      { path: 'contactPhone', message: 'El teléfono no puede estar vacío.' },
    ]);
  });

  it('does not let the secretary register a superadmin (D-19)', () => {
    expect(issues({ ...base, role: 'superadmin' }).map((issue) => issue.path)).toEqual(['role']);
  });

  it('carries the rule code in the issue params', () => {
    const result = createRoleAssignmentSchema.safeParse({ ...base, role: 'president', blockId: 1 });
    expect(result.success).toBe(false);
    const issue = result.error?.issues[0];
    expect(issue?.code === 'custom' && issue.params).toEqual({
      rule: 'BLOCK_ONLY_FOR_BLOCK_LEADER',
    });
  });
});
