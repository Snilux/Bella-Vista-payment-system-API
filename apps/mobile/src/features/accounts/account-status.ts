import { type AccountSummary, formatDateTime } from '@bella-vista/shared';
import type { StatusTone } from '../../ui/index.js';

// How A-01 and A-03 show an account and which actions A-03 offers (3.2 §10.8). The API does not
// refuse an action that makes no sense (unlocking an account that is not locked, resetting a
// disabled one), so this table is what keeps them off the screen.

export type AccountCommand = 'reset' | 'lock' | 'unlock' | 'deactivate';

export type AccountView = {
  /** One line with the status in words ("Activa", "Bloqueada por el administrador"). */
  summary: string;
  /** Status tag of the card; none for an active account (as in the A-01 capture). */
  tag: { tone: StatusTone; label: string } | null;
  /** What A-03 offers, the main action first. */
  commands: AccountCommand[];
  /** Why A-03 offers nothing (or little). */
  notice: string | null;
};

/** A lock by the superadmin has no end: the API stores 9999-12-31. */
export function isManualLock(account: Pick<AccountSummary, 'lockedUntil'>): boolean {
  return account.lockedUntil?.startsWith('9999') ?? false;
}

/** `self`: the account is the signed-in superadmin's own. */
export function accountView(account: AccountSummary, self = false): AccountView {
  const view = statusView(account);
  if (!self) return view;
  return {
    ...view,
    commands: [],
    notice: 'Es su propia cuenta. Para cambiar su contraseña use Más → Perfil.',
  };
}

function statusView(account: AccountSummary): AccountView {
  switch (account.status) {
    case 'active':
      return {
        summary: 'Activa',
        tag: null,
        commands: ['reset', 'lock', 'deactivate'],
        notice: null,
      };
    case 'must_change_password':
      return {
        summary: 'Debe cambiar la contraseña temporal al entrar',
        tag: { tone: 'pending', label: 'Contraseña temporal' },
        commands: ['reset', 'lock', 'deactivate'],
        notice: null,
      };
    case 'locked':
      if (isManualLock(account) || !account.lockedUntil) {
        return {
          summary: 'Bloqueada por el administrador',
          tag: { tone: 'overdue', label: 'Bloqueada' },
          commands: ['unlock', 'deactivate'],
          notice: null,
        };
      }
      return {
        summary: `Bloqueada por intentos fallidos hasta ${formatDateTime(account.lockedUntil)}`,
        tag: { tone: 'overdue', label: 'Bloqueada' },
        commands: ['unlock', 'reset', 'lock', 'deactivate'],
        notice: null,
      };
    case 'role_not_active':
      return {
        summary: 'Su cargo no está vigente',
        tag: { tone: 'cancelled', label: 'Cargo no vigente' },
        commands: ['deactivate'],
        notice: 'El cargo de esta cuenta no está vigente, así que no puede entrar.',
      };
    case 'disabled':
      return {
        summary: account.deactivatedAt
          ? `Desactivada el ${formatDateTime(account.deactivatedAt)}`
          : 'Desactivada',
        tag: { tone: 'cancelled', label: 'Desactivada' },
        commands: [],
        notice:
          'Una cuenta desactivada no se puede reactivar. Si la persona recibe otro cargo, se le crea otra cuenta.',
      };
  }
}

type CommandText = {
  /** Button on A-03. */
  button: string;
  /** Title of the confirmation sheet. */
  title: string;
  /** What happens, in the sheet. */
  effect: string;
  confirm: string;
  danger: boolean;
};

export const COMMAND_TEXTS: Record<AccountCommand, CommandText> = {
  reset: {
    button: 'Restablecer contraseña',
    title: '¿Restablecer la contraseña?',
    effect:
      'Se genera una contraseña temporal nueva y se cierran sus sesiones abiertas. La persona deberá cambiarla al entrar.',
    confirm: 'Sí, restablecer',
    danger: false,
  },
  lock: {
    button: 'Bloquear cuenta',
    title: '¿Bloquear la cuenta?',
    effect: 'No podrá entrar hasta que usted la desbloquee, y sus sesiones abiertas se cierran.',
    confirm: 'Sí, bloquear',
    danger: false,
  },
  unlock: {
    button: 'Desbloquear cuenta',
    title: '¿Desbloquear la cuenta?',
    effect: 'Podrá volver a entrar con su contraseña. Los intentos fallidos vuelven a cero.',
    confirm: 'Sí, desbloquear',
    danger: false,
  },
  deactivate: {
    button: 'Desactivar cuenta',
    title: '¿Desactivar la cuenta?',
    effect:
      'No se puede deshacer: la cuenta no podrá volver a entrar y sus sesiones abiertas se cierran.',
    confirm: 'Sí, desactivar',
    danger: true,
  },
};
