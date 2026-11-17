import { renderHook } from '@testing-library/react-native';
import { createApiClient, type TokenStore } from '../../src/api/client.js';
import { sessionEndMessage } from '../../src/api/error-messages.js';
import { createSessionActions } from '../../src/api/useAuth.js';
import { useCan } from '../../src/session/permissions.js';
import { sessionStore } from '../../src/session/session-store.js';
import {
  apiError,
  type Call,
  json,
  memoryTokens,
  type Reply,
  scriptedFetch,
  session,
} from '../api/fake-api.js';

// Session (3.2 §3.2): opening the app with a stored refresh token goes straight in; an invalid
// one goes back to C-01 with "Su sesión terminó…"; without connection the session stays; the
// temporary password forces C-02; leaving revokes the token and forgets it on the phone.

function setup(
  route: (call: Call) => Reply,
  tokens: { access: string | null; refresh: string | null } = {
    access: null,
    refresh: 'refresh-0',
  },
) {
  const { fetchFn, calls } = scriptedFetch(route);
  const memory = memoryTokens(tokens);
  // Like the app's SecureStore store: saving a session publishes its account.
  const store: TokenStore = {
    ...memory.store,
    async save(value) {
      await memory.store.save(value);
      sessionStore.signedIn(value.account);
    },
  };
  const client = createApiClient({
    baseUrl: 'http://api.test:3000',
    tokens: store,
    onSessionEnded: (reason) => sessionStore.signedOut(reason),
    onPasswordChangeRequired: () => sessionStore.passwordChangeRequired(),
    fetchFn,
  });
  return { actions: createSessionActions(client, store), client, calls, state: memory.state };
}

const temporary = () => {
  const value = session(1);
  return { ...value, account: { ...value.account, mustChangePassword: true } };
};

beforeEach(() => sessionStore.restoring());

describe('opening the app', () => {
  it('with a valid refresh token refreshes and enters with the account', async () => {
    const { actions, calls } = setup(() => json(200, session(1)));
    await actions.restore();
    expect(calls.map((c) => c.url)).toEqual(['http://api.test:3000/v1/auth/refresh']);
    expect(sessionStore.get()).toEqual({ status: 'signed-in', account: session(1).account });
  });

  it('with an invalid refresh token goes back to C-01 saying the session ended', async () => {
    const { actions, state } = setup(() => apiError(401, 'UNAUTHENTICATED'));
    await actions.restore();
    expect(sessionStore.get()).toEqual({ status: 'signed-out', ended: 'expired' });
    expect(state.refresh).toBeNull();
    expect(sessionEndMessage('expired')).toBe('Su sesión terminó, inicie sesión de nuevo.');
  });

  it('without connection keeps the stored session and offers to retry', async () => {
    const { actions, state } = setup(() => ({ networkError: true }));
    await actions.restore();
    expect(sessionStore.get().status).toBe('unreachable');
    expect(state.refresh).toBe('refresh-0');
  });

  it('without a stored token goes to C-01 without a message and without calling the API', async () => {
    const { actions, calls } = setup(() => json(200, session(1)), { access: null, refresh: null });
    await actions.restore();
    expect(sessionStore.get()).toEqual({ status: 'signed-out', ended: null });
    expect(calls).toEqual([]);
  });

  it('with a temporary password enters only to C-02 (mustChangePassword)', async () => {
    const { actions } = setup(() => json(200, temporary()));
    await actions.restore();
    expect(sessionStore.get()).toMatchObject({
      status: 'signed-in',
      account: { mustChangePassword: true },
    });
  });
});

describe('login, password change and logout', () => {
  it('login stores the tokens and publishes the account', async () => {
    const { actions, calls, state } = setup(() => json(200, session(1)), {
      access: null,
      refresh: null,
    });
    await actions.login({ username: 'jefe1', password: 'secreta-123' });
    expect(calls[0]).toMatchObject({
      url: 'http://api.test:3000/v1/auth/login',
      body: { username: 'jefe1', password: 'secreta-123' },
    });
    expect(calls[0]?.headers.Authorization).toBeUndefined();
    expect(state).toMatchObject({ access: 'access-1', refresh: 'refresh-1' });
    expect(sessionStore.get()).toMatchObject({ status: 'signed-in' });
  });

  it('a wrong password does not end any session nor reveal more than the message', async () => {
    const { actions } = setup(() => apiError(401, 'INVALID_CREDENTIALS'), {
      access: null,
      refresh: null,
    });
    sessionStore.signedOut(null);
    await expect(actions.login({ username: 'x', password: 'y' })).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    });
    expect(sessionStore.get()).toEqual({ status: 'signed-out', ended: null });
  });

  it('PASSWORD_CHANGE_REQUIRED on any request sends the account to C-02', async () => {
    const { actions, client } = setup((call) =>
      call.url.endsWith('/auth/refresh')
        ? json(200, session(1))
        : apiError(403, 'PASSWORD_CHANGE_REQUIRED'),
    );
    await actions.restore();
    await expect(
      client.request({ method: 'GET', path: '/cashboxes/mine', schema: null }),
    ).rejects.toMatchObject({ code: 'PASSWORD_CHANGE_REQUIRED' });
    expect(sessionStore.get()).toMatchObject({
      status: 'signed-in',
      account: { mustChangePassword: true },
    });
  });

  it('changing the password saves the new tokens and lets the account in', async () => {
    const { actions, calls, state } = setup((call) =>
      call.url.endsWith('/auth/change-password') ? json(200, session(2)) : json(200, temporary()),
    );
    await actions.restore();
    await actions.changePassword({ currentPassword: 'Temporal-1', newPassword: 'NuevaClave-1' });
    expect(calls.at(-1)).toMatchObject({
      url: 'http://api.test:3000/v1/auth/change-password',
      headers: { Authorization: 'Bearer access-1' },
    });
    expect(state.refresh).toBe('refresh-2');
    expect(sessionStore.get()).toMatchObject({ account: { mustChangePassword: false } });
  });

  it('logout revokes the refresh token and deletes it from the phone', async () => {
    const { actions, calls, state } = setup((call) =>
      call.url.endsWith('/auth/logout') ? { status: 204 } : json(200, session(1)),
    );
    await actions.restore();
    await actions.logout();
    expect(calls.at(-1)).toMatchObject({
      url: 'http://api.test:3000/v1/auth/logout',
      body: { refreshToken: 'refresh-1' },
    });
    expect(state).toMatchObject({ access: null, refresh: null });
    expect(sessionStore.get()).toEqual({ status: 'signed-out', ended: null });
  });

  it('logout without connection still forgets the session on the phone', async () => {
    const { actions, state } = setup((call) =>
      call.url.endsWith('/auth/logout') ? { networkError: true } : json(200, session(1)),
    );
    await actions.restore();
    await actions.logout();
    expect(state.refresh).toBeNull();
    expect(sessionStore.get()).toEqual({ status: 'signed-out', ended: null });
  });

  it.each([
    ['ROLE_NOT_ACTIVE', 403, 'role-not-active', 'Su cargo ya no está vigente.'],
    [
      'ACCOUNT_DISABLED',
      401,
      'account-disabled',
      'Su cuenta está desactivada. Pida ayuda al administrador.',
    ],
  ] as const)('%s closes the session with a clear message', async (code, status, reason, text) => {
    const { actions, client } = setup((call) =>
      call.url.endsWith('/auth/refresh') ? json(200, session(1)) : apiError(status, code),
    );
    await actions.restore();
    await expect(
      client.request({ method: 'GET', path: '/cashboxes/mine', schema: null }),
    ).rejects.toMatchObject({ code });
    expect(sessionStore.get()).toEqual({ status: 'signed-out', ended: reason });
    expect(sessionEndMessage(reason)).toBe(text);
  });
});

describe('permissions of the interface', () => {
  it('hide what the role cannot do and everything without a session', async () => {
    const can = async (action: Parameters<typeof useCan>[0]) =>
      (await renderHook(() => useCan(action))).result.current;
    sessionStore.signedOut(null);
    expect(await can('billing.collect')).toBe(false);

    sessionStore.signedIn(session(1).account); // block leader
    expect(await can('billing.collect')).toBe(true);
    expect(await can('approvals.resolve')).toBe(false);

    sessionStore.signedIn({
      ...session(1).account,
      role: 'member',
      blockId: null,
      blockCode: null,
    });
    expect(await can('closings.review')).toBe(true);
    expect(await can('billing.collect')).toBe(false);
  });
});
