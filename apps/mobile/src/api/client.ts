import {
  errorResponseSchema,
  type SessionAccount,
  type SessionResponse,
  sessionResponseSchema,
} from '@bella-vista/shared';
import type { z } from 'zod';
import { ApiError, type ApiErrorCode } from './errors.js';

// HTTP client (3.2 §3.1 and §3.2): one fetch-based client for the whole app.
// - Base URL without /v1 (EXPO_PUBLIC_API_URL); /v1 is added here and /health lives outside it.
// - Bearer access token kept in memory; on TOKEN_EXPIRED it refreshes once (concurrent
//   requests share the same refresh) and repeats the request.
// - 15 s limit per request; no answer → NETWORK_ERROR.
// - Every answer is validated with the shared Zod schemas (INVALID_RESPONSE if it does not match).
// - It never repeats a request by itself except after refreshing the token, which is safe for
//   money operations: the API rejected the first one before doing anything and the repeat
//   carries the same Idempotency-Key.

export const REQUEST_TIMEOUT_MS = 15_000;

/** Where the session tokens live: access token in memory, refresh token in SecureStore. */
export type TokenStore = {
  getAccessToken(): string | null;
  getRefreshToken(): Promise<string | null>;
  save(session: SessionResponse): Promise<void>;
  clear(): Promise<void>;
};

/** Why the client ended the session (the app goes back to C-01 with the matching message). */
export type SessionEndReason =
  | 'expired'
  | 'role-not-active'
  | 'account-disabled'
  | 'account-locked';

/** Codes that end the session when an authenticated request (or the refresh) gets them. */
const SESSION_ENDING: Partial<Record<ApiErrorCode, SessionEndReason>> = {
  UNAUTHENTICATED: 'expired',
  TOKEN_EXPIRED: 'expired',
  ROLE_NOT_ACTIVE: 'role-not-active',
  ACCOUNT_DISABLED: 'account-disabled',
  ACCOUNT_LOCKED: 'account-locked',
};

export type QueryValue = string | number | boolean | null | undefined;

export type RequestOptions<S extends z.ZodType | null> = {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  /** Path under /v1, e.g. "/units/45/account-statement". */
  path: string;
  /** Schema of a successful answer; null for 204 or answers the caller ignores. */
  schema: S;
  query?: Record<string, QueryValue>;
  body?: unknown;
  /** Money operations: generated when the person taps Confirm and kept for the retry. */
  idempotencyKey?: string;
  /** False only for login and refresh. */
  auth?: boolean;
  /** Cancels the request (TanStack Query, a newer search). */
  signal?: AbortSignal;
};

type Result<S extends z.ZodType | null> = S extends z.ZodType ? z.output<S> : undefined;

export type ApiClientOptions = {
  /** e.g. http://192.168.1.20:3000 (no /v1). */
  baseUrl: string;
  tokens: TokenStore;
  onSessionEnded: (reason: SessionEndReason) => void;
  /**
   * 403 PASSWORD_CHANGE_REQUIRED: the session stays, but the app only allows C-02 until the
   * password changes (the account is marked as mustChangePassword).
   */
  onPasswordChangeRequired?: () => void;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
};

export type ApiClient = ReturnType<typeof createApiClient>;

export function createApiClient({
  baseUrl,
  tokens,
  onSessionEnded,
  onPasswordChangeRequired,
  fetchFn = (input, init) => fetch(input, init),
  timeoutMs = REQUEST_TIMEOUT_MS,
}: ApiClientOptions) {
  const root = baseUrl.replace(/\/+$/, '');
  let refreshing: Promise<SessionAccount> | null = null;

  async function endSession(reason: SessionEndReason) {
    await tokens.clear();
    onSessionEnded(reason);
  }

  /** One fetch with the time limit; every failure becomes an ApiError (or the caller's abort). */
  async function send(url: string, init: RequestInit, signal?: AbortSignal): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const forwardAbort = () => controller.abort();
    signal?.addEventListener('abort', forwardAbort);
    try {
      if (signal?.aborted) throw signal.reason ?? new Error('Aborted');
      return await fetchFn(url, { ...init, signal: controller.signal });
    } catch (error) {
      // The caller cancelled: not a network failure, let it propagate as an abort.
      if (signal?.aborted) throw error;
      throw new ApiError('NETWORK_ERROR', 0, 'No hay conexión.');
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', forwardAbort);
    }
  }

  async function readJson(response: Response): Promise<unknown> {
    let text: string;
    try {
      text = await response.text();
    } catch {
      throw new ApiError('NETWORK_ERROR', 0, 'No hay conexión.');
    }
    if (text === '') return undefined;
    try {
      return JSON.parse(text);
    } catch {
      return Symbol.for('invalid-json');
    }
  }

  async function toApiError(response: Response): Promise<ApiError> {
    const parsed = errorResponseSchema.safeParse(await readJson(response));
    if (!parsed.success) {
      return new ApiError(
        'INVALID_RESPONSE',
        response.status,
        'La respuesta del servidor no es la esperada.',
      );
    }
    const { code, message, details } = parsed.data.error;
    return new ApiError(code, response.status, message, details);
  }

  async function execute<S extends z.ZodType | null>(
    options: RequestOptions<S>,
    accessToken: string | null,
  ): Promise<Result<S>> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;

    const response = await send(
      buildUrl(`${root}/v1${options.path}`, options.query),
      {
        method: options.method,
        headers,
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      },
      options.signal,
    );
    if (!response.ok) throw await toApiError(response);
    return parseBody(response, options.schema);
  }

  async function parseBody<S extends z.ZodType | null>(
    response: Response,
    schema: S,
  ): Promise<Result<S>> {
    const body = await readJson(response);
    if (schema === null) return undefined as Result<S>;
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError(
        'INVALID_RESPONSE',
        response.status,
        'La respuesta del servidor no es la esperada.',
      );
    }
    return parsed.data as Result<S>;
  }

  /**
   * Rotates the refresh token and returns the account as the API sees it now. Concurrent
   * callers share the same refresh.
   */
  function refreshSession(): Promise<SessionAccount> {
    refreshing ??= (async () => {
      const refreshToken = await tokens.getRefreshToken();
      if (!refreshToken) {
        await endSession('expired');
        throw new ApiError('UNAUTHENTICATED', 401, 'No hay sesión.');
      }
      try {
        const session = await execute(
          {
            method: 'POST',
            path: '/auth/refresh',
            body: { refreshToken },
            schema: sessionResponseSchema,
          },
          null,
        );
        await tokens.save(session);
        return session.account;
      } catch (error) {
        // Without connection the session stays: the person can retry when the signal returns.
        const reason = error instanceof ApiError ? refreshFailureReason(error) : null;
        if (reason) await endSession(reason);
        throw error;
      }
    })().finally(() => {
      refreshing = null;
    });
    return refreshing;
  }

  async function request<S extends z.ZodType | null>(
    options: RequestOptions<S>,
  ): Promise<Result<S>> {
    if (options.auth === false) return execute(options, null);

    if (!tokens.getAccessToken()) await refreshSession();
    let usedToken = tokens.getAccessToken();
    try {
      return await execute(options, usedToken);
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      if (error.code !== 'TOKEN_EXPIRED') return endIfNeeded(error);
      // Another request may have refreshed already while this one was on the way.
      if (tokens.getAccessToken() === usedToken) await refreshSession();
      usedToken = tokens.getAccessToken();
      try {
        return await execute(options, usedToken);
      } catch (retryError) {
        if (retryError instanceof ApiError) return endIfNeeded(retryError);
        throw retryError;
      }
    }
  }

  async function endIfNeeded(error: ApiError): Promise<never> {
    const reason = SESSION_ENDING[error.code];
    if (reason) await endSession(reason);
    else if (error.code === 'PASSWORD_CHANGE_REQUIRED') onPasswordChangeRequired?.();
    throw error;
  }

  /** GET /health (outside /v1): 200 when the API and its database answer. */
  async function health(signal?: AbortSignal): Promise<boolean> {
    const response = await send(`${root}/health`, { method: 'GET' }, signal);
    return response.ok;
  }

  return { request, refreshSession, health };
}

/**
 * Refresh failures that end the session. A network failure, a server error or the rate limit
 * keep it (the refresh token may still be good).
 */
function refreshFailureReason(error: ApiError): SessionEndReason | null {
  const reason = SESSION_ENDING[error.code];
  if (reason) return reason;
  return error.status >= 400 && error.status < 500 && error.code !== 'TOO_MANY_REQUESTS'
    ? 'expired'
    : null;
}

function buildUrl(url: string, query: Record<string, QueryValue> | undefined): string {
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null) params.append(key, String(value));
  }
  const text = params.toString();
  return text ? `${url}?${text}` : url;
}
