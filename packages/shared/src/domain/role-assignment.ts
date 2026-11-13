// Role assignment rules (docs/modelo-datos.md, asignacion_cargo; D-09, D-19, D-22).
// PostgreSQL enforces the same rules with CHECK constraints on role_assignment; keep both
// in sync.

export const ROLES = [
  'superadmin',
  'president',
  'treasurer',
  'secretary',
  'member',
  'block_leader',
] as const;

export type Role = (typeof ROLES)[number];

/** Roles the secretary can register. The superadmin is created only at bootstrap (D-19). */
export const ASSIGNABLE_ROLES = [
  'president',
  'treasurer',
  'secretary',
  'member',
  'block_leader',
] as const satisfies readonly Role[];

export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

export type RoleAssignmentRule =
  | 'BLOCK_LEADER_REQUIRES_BLOCK'
  | 'BLOCK_LEADER_REQUIRES_CONTACT_PHONE'
  | 'BLOCK_ONLY_FOR_BLOCK_LEADER';

export interface RoleAssignmentFields {
  role: Role;
  blockId?: number | null | undefined;
  contactPhone?: string | null | undefined;
}

/**
 * Returns the rules the assignment breaks (empty when valid):
 * - a block leader needs a block and a contact phone;
 * - any other role must not have a block (the contact phone is optional for them).
 */
export function roleAssignmentViolations(fields: RoleAssignmentFields): RoleAssignmentRule[] {
  const hasBlock = fields.blockId != null;
  const hasPhone = fields.contactPhone != null && fields.contactPhone.trim() !== '';
  const violations: RoleAssignmentRule[] = [];
  if (fields.role === 'block_leader') {
    if (!hasBlock) violations.push('BLOCK_LEADER_REQUIRES_BLOCK');
    if (!hasPhone) violations.push('BLOCK_LEADER_REQUIRES_CONTACT_PHONE');
  } else if (hasBlock) {
    violations.push('BLOCK_ONLY_FOR_BLOCK_LEADER');
  }
  return violations;
}

/** Every assignment goes through a president approval except the superadmin's. */
export function requiresApproval(role: Role): boolean {
  return role !== 'superadmin';
}
