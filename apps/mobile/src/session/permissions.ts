import { type Action, can } from '@bella-vista/shared';
import { useAccount } from './session-store.js';

// Permisos de la interfaz (3.2 §3.3, §11.1): the screens hide what the role of the account
// cannot do, with the same matrix the API uses (can() of @bella-vista/shared). The API still
// decides: a 403 FORBIDDEN is shown as "No tiene permiso para esta acción".

/** Whether the signed-in account may do `action` (false without a session). */
export function useCan(action: Action): boolean {
  const account = useAccount();
  return account !== null && can(account.role, action);
}

/** Keeps the items whose action (if any) the role may perform. */
export function allowedFor<T extends { action?: Action }>(
  role: Parameters<typeof can>[0],
  items: readonly T[],
): T[] {
  return items.filter((item) => item.action === undefined || can(role, item.action));
}
