import { z } from 'zod';
import { createApiClient, type SessionEndReason } from '../../src/api/client.js';
import { ApiError } from '../../src/api/errors.js';
import {
  apiError,
  type Call,
  json,
  memoryTokens,
  type Reply,
  scriptedFetch,
  session,
} from './fake-api.js';

// HTTP client (3.2 §3.1, §3.2): 401 TOKEN_EXPIRED → refresh → retry, shared refresh, session
// end, network errors and timeouts, response validation.

const BASE = 'http://api.test:3000';
const itemSchema = z.object({ id: z.int(), name: z.string() });

function setup(
  route: (call: Call) => Reply,
  tokens: { access: string | null; refresh: string | null } = {
    access: 'access-0',
    refresh: 'refresh-0',
  },
) {
  const { fetchFn, calls } = scriptedFetch(route);
  const { store, state } = memoryTokens(tokens);
  const ended: SessionEndReason[] = [];
  const client = createApiClient({
    baseUrl: `${BASE}/`,
    tokens: store,
    onSessionEnded: (reason) => ended.push(reason),
    fetchFn,
    timeoutMs: 50,
  });
  return { client, calls, state, ended };
}

const get = { method: 'GET', path: '/items/1', schema: itemSchema } as const;

const rejection = async (promise: Promise<unknown>): Promise<ApiError> => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  throw new Error('expected the request to fail');
};

describe('requests', () => {
  it('adds /v1, the bearer token and the query, and validates the answer', async () => {
    const { client, calls } = setup(() => json(200, { id: 1, name: 'Uno' }));
    const result = await client.request({
      ...get,
      query: { limit: 20, cursor: undefined, q: 'pé rez' },
    });

    expect(result).toEqual({ id: 1, name: 'Uno' });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`${BASE}/v1/items/1?limit=20&q=p%C3%A9+rez`);
    expect(calls[0]?.headers.Authorization).toBe('Bearer access-0');
  });

  it('sends the body as JSON and the Idempotency-Key of money operations', async () => {
    const { client, calls } = setup(() => json(201, { id: 9, name: 'Pago' }));
    await client.request({
      method: 'POST',
      path: '/payments',
      body: { unitId: 45 },
      idempotencyKey: '3f1c2a7e-0000-4000-8000-000000000001',
      schema: itemSchema,
    });

    expect(calls[0]?.headers['Content-Type']).toBe('application/json');
    expect(calls[0]?.headers['Idempotency-Key']).toBe('3f1c2a7e-0000-4000-8000-000000000001');
    expect(calls[0]?.body).toEqual({ unitId: 45 });
  });

  it('accepts an empty answer (204) when no schema is given', async () => {
    const { client } = setup(() => json(204));
    await expect(
      client.request({ method: 'POST', path: '/auth/logout', schema: null, body: {} }),
    ).resolves.toBeUndefined();
  });

  it('login and refresh go without a token', async () => {
    const { client, calls } = setup(() => json(200, { id: 1, name: 'x' }));
    await client.request({ ...get, auth: false });
    expect(calls[0]?.headers.Authorization).toBeUndefined();
  });

  it('checks /health outside /v1', async () => {
    const { client, calls } = setup(() => json(200, { status: 'ok', database: 'ok' }));
    await expect(client.health()).resolves.toBe(true);
    expect(calls[0]?.url).toBe(`${BASE}/health`);
  });
});

describe('API errors', () => {
  it('turns the error shape into an ApiError with code, message and details', async () => {
    const { client } = setup(() =>
      apiError(409, 'TOTAL_CHANGED', 'El total cambió.', { total: 15_000, expectedTotal: 10_000 }),
    );
    const error = await rejection(client.request(get));

    expect(error.code).toBe('TOTAL_CHANGED');
    expect(error.status).toBe(409);
    expect(error.message).toBe('El total cambió.');
    expect(error.details).toEqual({ total: 15_000, expectedTotal: 10_000 });
  });

  it('an answer that does not match the schema is INVALID_RESPONSE', async () => {
    const { client } = setup(() => json(200, { id: 'uno' }));
    expect((await rejection(client.request(get))).code).toBe('INVALID_RESPONSE');
  });

  it('an error body that is not the API shape is INVALID_RESPONSE', async () => {
    const { client } = setup(() => ({ status: 502, rawBody: '<html>Bad gateway</html>' }));
    const error = await rejection(client.request(get));
    expect(error.code).toBe('INVALID_RESPONSE');
    expect(error.status).toBe(502);
  });

  it('a 403 FORBIDDEN keeps the session', async () => {
    const { client, ended, state } = setup(() => apiError(403, 'FORBIDDEN'));
    expect((await rejection(client.request(get))).code).toBe('FORBIDDEN');
    expect(ended).toEqual([]);
    expect(state.access).toBe('access-0');
  });

  it.each([
    ['ROLE_NOT_ACTIVE', 403, 'role-not-active'],
    ['ACCOUNT_DISABLED', 401, 'account-disabled'],
    ['ACCOUNT_LOCKED', 401, 'account-locked'],
    ['PASSWORD_CHANGE_REQUIRED', 403, 'password-change-required'],
    ['UNAUTHENTICATED', 401, 'expired'],
  ])('%s ends the session (%s)', async (code, status, reason) => {
    const { client, ended, state } = setup(() => apiError(status, code));
    expect((await rejection(client.request(get))).code).toBe(code);
    expect(ended).toEqual([reason]);
    expect(state.refresh).toBeNull();
  });

  it('login errors do not end a session (unauthenticated request)', async () => {
    const { client, ended } = setup(() => apiError(401, 'ACCOUNT_LOCKED'));
    await rejection(client.request({ ...get, auth: false }));
    expect(ended).toEqual([]);
  });
});

describe('token refresh', () => {
  /** API whose valid access token is `access-N` after N refreshes. */
  function rotatingApi(options: { refreshReply?: Reply } = {}) {
    let generation = 0;
    return (call: Call): Reply => {
      if (call.url.endsWith('/v1/auth/refresh')) {
        if (options.refreshReply) return options.refreshReply;
        const body = call.body as { refreshToken: string };
        if (body.refreshToken !== `refresh-${generation}`) return apiError(401, 'UNAUTHENTICATED');
        generation += 1;
        return json(200, session(generation));
      }
      if (call.headers.Authorization !== `Bearer access-${generation}`) {
        return apiError(401, 'TOKEN_EXPIRED');
      }
      return json(200, { id: 1, name: 'Uno' });
    };
  }

  it('401 TOKEN_EXPIRED → refresh → repeats the request with the new token', async () => {
    const api = rotatingApi();
    // The stored access token is stale: the API is already at generation 0 → make it expire.
    const { client, calls, state } = setup(api, { access: 'access-old', refresh: 'refresh-0' });
    const result = await client.request(get);

    expect(result).toEqual({ id: 1, name: 'Uno' });
    expect(calls.map((call) => call.url)).toEqual([
      `${BASE}/v1/items/1`,
      `${BASE}/v1/auth/refresh`,
      `${BASE}/v1/items/1`,
    ]);
    expect(calls[2]?.headers.Authorization).toBe('Bearer access-1');
    expect(state).toMatchObject({ access: 'access-1', refresh: 'refresh-1' });
  });

  it('repeats a money operation with the same Idempotency-Key', async () => {
    const { client, calls } = setup(rotatingApi(), { access: 'stale', refresh: 'refresh-0' });
    await client.request({ ...get, method: 'POST', body: {}, idempotencyKey: 'key-1' });
    const posts = calls.filter((call) => call.url.endsWith('/items/1'));
    expect(posts.map((call) => call.headers['Idempotency-Key'])).toEqual(['key-1', 'key-1']);
  });

  it('several requests that expire together share one refresh', async () => {
    const { client, calls } = setup(rotatingApi(), { access: 'stale', refresh: 'refresh-0' });
    const results = await Promise.all([
      client.request(get),
      client.request(get),
      client.request(get),
    ]);

    expect(results).toHaveLength(3);
    expect(calls.filter((call) => call.url.endsWith('/auth/refresh'))).toHaveLength(1);
  });

  it('opening the app with only a refresh token refreshes first', async () => {
    const { client, calls } = setup(rotatingApi(), { access: null, refresh: 'refresh-0' });
    await client.request(get);
    expect(calls.map((call) => call.url)).toEqual([
      `${BASE}/v1/auth/refresh`,
      `${BASE}/v1/items/1`,
    ]);
  });

  it('a rejected refresh ends the session and goes back to login', async () => {
    const { client, ended, state } = setup(
      rotatingApi({ refreshReply: apiError(401, 'UNAUTHENTICATED') }),
      { access: 'stale', refresh: 'refresh-0' },
    );
    expect((await rejection(client.request(get))).code).toBe('UNAUTHENTICATED');
    expect(ended).toEqual(['expired']);
    expect(state).toMatchObject({ access: null, refresh: null });
  });

  it('a refresh that ends with ROLE_NOT_ACTIVE says so', async () => {
    const { client, ended } = setup(
      rotatingApi({ refreshReply: apiError(403, 'ROLE_NOT_ACTIVE') }),
      { access: 'stale', refresh: 'refresh-0' },
    );
    await rejection(client.request(get));
    expect(ended).toEqual(['role-not-active']);
  });

  it('without connection during the refresh the session is kept', async () => {
    const { client, ended, state } = setup(rotatingApi({ refreshReply: { networkError: true } }), {
      access: 'stale',
      refresh: 'refresh-0',
    });
    expect((await rejection(client.request(get))).code).toBe('NETWORK_ERROR');
    expect(ended).toEqual([]);
    expect(state.refresh).toBe('refresh-0');
  });

  it('without a refresh token the session ends', async () => {
    const { client, ended } = setup(() => apiError(401, 'TOKEN_EXPIRED'), {
      access: 'stale',
      refresh: null,
    });
    expect((await rejection(client.request(get))).code).toBe('UNAUTHENTICATED');
    expect(ended).toEqual(['expired']);
  });

  it('refreshes only once per request: a second TOKEN_EXPIRED ends the session', async () => {
    const { client, calls, ended } = setup((call) =>
      call.url.endsWith('/auth/refresh') ? json(200, session(1)) : apiError(401, 'TOKEN_EXPIRED'),
    );
    expect((await rejection(client.request(get))).code).toBe('TOKEN_EXPIRED');
    expect(calls.filter((call) => call.url.endsWith('/auth/refresh'))).toHaveLength(1);
    expect(ended).toEqual(['expired']);
  });

  it('other 401 codes do not trigger a refresh', async () => {
    const { client, calls } = setup(() => apiError(401, 'INVALID_CREDENTIALS'));
    await rejection(client.request(get));
    expect(calls.filter((call) => call.url.endsWith('/auth/refresh'))).toHaveLength(0);
  });
});

describe('network', () => {
  it('a failed fetch is NETWORK_ERROR', async () => {
    const { client } = setup(() => ({ networkError: true }));
    const error = await rejection(client.request(get));
    expect(error.code).toBe('NETWORK_ERROR');
    expect(error.status).toBe(0);
  });

  it('no answer within the time limit is NETWORK_ERROR', async () => {
    const { client } = setup(() => ({ hang: true }));
    expect((await rejection(client.request(get))).code).toBe('NETWORK_ERROR');
  });

  it('a request the caller cancels is an abort, not a network error', async () => {
    const { client } = setup(() => ({ hang: true }));
    const controller = new AbortController();
    const pending = client.request({ ...get, signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});
