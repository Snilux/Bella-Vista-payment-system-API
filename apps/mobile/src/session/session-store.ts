import type { SessionAccount } from '@bella-vista/shared';
import { useSyncExternalStore } from 'react';
import type { SessionEndReason } from '../api/client.js';

// Session state of the app (3.2 §3.2), in memory. The token store writes the account each time
// a session starts or rotates (login, refresh, password change), so the account here is always
// the one the API returned last. Screens read it with useSession(); the guards of the layouts
// decide from it where the person may be.

export type SessionState =
  /** Opening the app: refreshing with the stored token. */
  | { status: 'restoring' }
  /** The stored session could not be checked (no connection, server down): retry, keep it. */
  | { status: 'unreachable'; error: unknown }
  /** C-01; `ended` says why the app closed the session by itself (null after "Salir"). */
  | { status: 'signed-out'; ended: SessionEndReason | null }
  | { status: 'signed-in'; account: SessionAccount };

type Listener = () => void;

let state: SessionState = { status: 'restoring' };
const listeners = new Set<Listener>();

function set(next: SessionState) {
  state = next;
  for (const listener of listeners) listener();
}

export const sessionStore = {
  get: (): SessionState => state,
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  restoring: () => set({ status: 'restoring' }),
  unreachable: (error: unknown) => set({ status: 'unreachable', error }),
  signedIn: (account: SessionAccount) => set({ status: 'signed-in', account }),
  signedOut: (ended: SessionEndReason | null) => set({ status: 'signed-out', ended }),
  /** A 403 PASSWORD_CHANGE_REQUIRED: only C-02 until the password changes. */
  passwordChangeRequired() {
    if (state.status === 'signed-in' && !state.account.mustChangePassword) {
      set({ status: 'signed-in', account: { ...state.account, mustChangePassword: true } });
    }
  },
};

export function useSession(): SessionState {
  return useSyncExternalStore(sessionStore.subscribe, sessionStore.get, sessionStore.get);
}

/** The signed-in account, or null (screens inside (app)/ always have one: the guard says so). */
export function useAccount(): SessionAccount | null {
  const session = useSession();
  return session.status === 'signed-in' ? session.account : null;
}
