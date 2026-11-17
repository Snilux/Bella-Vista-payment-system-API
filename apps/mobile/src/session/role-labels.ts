import type { Role, SessionAccount } from '@bella-vista/shared';

// Role names as the person reads them (2.5 §1). The app does not know the person's gender, so
// it uses the names of the documents ("Jefe de manzana"), never a guessed form.

export const ROLE_LABELS: Record<Role, string> = {
  superadmin: 'Superadministrador',
  president: 'Presidente',
  treasurer: 'Tesorero',
  secretary: 'Secretario',
  member: 'Vocal',
  block_leader: 'Jefe de manzana',
};

/** "Jefe de manzana · S1-M03" for a block leader, the role name for the others. */
export function roleDescription(account: Pick<SessionAccount, 'role' | 'blockCode'>): string {
  const label = ROLE_LABELS[account.role];
  return account.blockCode ? `${label} · ${account.blockCode}` : label;
}
