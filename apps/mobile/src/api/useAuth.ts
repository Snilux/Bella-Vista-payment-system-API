import {
  type ChangePasswordRequest,
  type LoginRequest,
  type SessionAccount,
  sessionResponseSchema,
} from '@bella-vista/shared';
import { useMutation } from '@tanstack/react-query';
import { sessionStore } from '../session/session-store.js';
import { secureTokenStore } from '../session/tokens.js';
import { getApiClient } from './api.js';
import type { ApiClient, TokenStore } from './client.js';
import { ApiError } from './errors.js';

// Session endpoints (docs/api.md "Detalle: sesión y cuentas"; 3.2 §3.2). Each successful answer
// is saved by the token store, which also publishes the account to the session state, so the
// layouts move the person to C-02 or to the home of their role by themselves.

export function createSessionActions(client: ApiClient, tokens: TokenStore) {
  return {
    /** C-01. Login errors (wrong password, locked…) never end a session: there is none yet. */
    async login(input: LoginRequest): Promise<SessionAccount> {
      const session = await client.request({
        method: 'POST',
        path: '/auth/login',
        body: input,
        schema: sessionResponseSchema,
        auth: false,
      });
      await tokens.save(session);
      return session.account;
    },

    /** C-02. The API closes the other sessions and returns a new pair of tokens. */
    async changePassword(input: ChangePasswordRequest): Promise<SessionAccount> {
      const session = await client.request({
        method: 'POST',
        path: '/auth/change-password',
        body: input,
        schema: sessionResponseSchema,
      });
      await tokens.save(session);
      return session.account;
    },

    /**
     * C-05 "Cerrar sesión": revokes the refresh token on the API and always forgets the session
     * on the phone, even without connection (the token then simply expires on the API).
     */
    async logout(): Promise<void> {
      const refreshToken = await tokens.getRefreshToken();
      try {
        if (refreshToken) {
          await client
            .request({ method: 'POST', path: '/auth/logout', body: { refreshToken }, schema: null })
            .catch(() => undefined);
        }
      } finally {
        await tokens.clear();
        sessionStore.signedOut(null);
      }
    },

    /**
     * Opening the app: with a stored refresh token, refresh and go straight in. If the API says
     * the token is no longer valid, the client ends the session ("Su sesión terminó…"); if it
     * cannot be reached, the session stays and the app offers to retry.
     */
    async restore(): Promise<void> {
      sessionStore.restoring();
      if (!(await tokens.getRefreshToken())) {
        sessionStore.signedOut(null);
        return;
      }
      try {
        await client.refreshSession();
      } catch (error) {
        if (sessionStore.get().status !== 'signed-out') sessionStore.unreachable(error);
      }
    },
  };
}

function sessionActions() {
  const client = getApiClient();
  if (!client) throw new ApiError('INVALID_REQUEST', 0, 'Falta EXPO_PUBLIC_API_URL.');
  return createSessionActions(client, secureTokenStore);
}

/** Restores the stored session when the app opens (without API URL: straight to C-01). */
export function restoreSession(): Promise<void> {
  if (!getApiClient()) {
    sessionStore.signedOut(null);
    return Promise.resolve();
  }
  return sessionActions().restore();
}

// The password travels in the mutation's variables: gcTime 0 drops them from TanStack's cache as
// soon as the screen that sent them closes (they never outlive C-01 or C-02, M9).
export function useLogin() {
  return useMutation({
    mutationFn: (input: LoginRequest) => sessionActions().login(input),
    gcTime: 0,
  });
}

export function useChangePassword() {
  return useMutation({
    mutationFn: (input: ChangePasswordRequest) => sessionActions().changePassword(input),
    gcTime: 0,
  });
}

export function useLogout() {
  return useMutation({ mutationFn: () => sessionActions().logout() });
}
