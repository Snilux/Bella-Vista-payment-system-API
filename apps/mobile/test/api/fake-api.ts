import type { SessionResponse } from '@bella-vista/shared';
import type { TokenStore } from '../../src/api/client.js';

// Test doubles for the HTTP client: a scripted fetch and an in-memory token store.

export type Reply =
  | { status: number; body?: unknown; rawBody?: string }
  | { networkError: true }
  /** Never answers until the request is aborted (timeout or caller). */
  | { hang: true };

export type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };

export function json(status: number, body?: unknown): Reply {
  return { status, body };
}

export function apiError(status: number, code: string, message = 'Mensaje', details = {}): Reply {
  return { status, body: { error: { code, message, details } } };
}

/** fetch that answers each request with the reply chosen by `route` and records the calls. */
export function scriptedFetch(route: (call: Call) => Reply) {
  const calls: Call[] = [];
  const fetchFn = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const call: Call = {
      url: String(input),
      method: init?.method ?? 'GET',
      headers: { ...(init?.headers as Record<string, string> | undefined) },
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    const reply = route(call);
    if ('networkError' in reply) return Promise.reject(new TypeError('Network request failed'));
    if ('hang' in reply) {
      return new Promise((_, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(Object.assign(new Error('Aborted'), { name: 'AbortError' })),
        );
      });
    }
    const text = reply.rawBody ?? (reply.body === undefined ? '' : JSON.stringify(reply.body));
    const response = {
      ok: reply.status >= 200 && reply.status < 300,
      status: reply.status,
      text: () => Promise.resolve(text),
    };
    return Promise.resolve(response as Response);
  };
  return { fetchFn, calls };
}

export function session(n: number): SessionResponse {
  return {
    accessToken: `access-${n}`,
    accessTokenExpiresIn: 900,
    refreshToken: `refresh-${n}`,
    account: {
      username: 'jefe1',
      role: 'block_leader',
      blockId: 3,
      blockCode: 'S1-M03',
      fullName: 'María López Hernández',
      mustChangePassword: false,
    },
  };
}

export function memoryTokens(initial: { access: string | null; refresh: string | null }) {
  const state = { ...initial, cleared: 0 };
  const store: TokenStore = {
    getAccessToken: () => state.access,
    getRefreshToken: () => Promise.resolve(state.refresh),
    save: (value) => {
      state.access = value.accessToken;
      state.refresh = value.refreshToken;
      return Promise.resolve();
    },
    clear: () => {
      state.access = null;
      state.refresh = null;
      state.cleared += 1;
      return Promise.resolve();
    },
  };
  return { store, state };
}
