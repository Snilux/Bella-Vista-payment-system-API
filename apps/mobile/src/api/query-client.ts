import { QueryClient } from '@tanstack/react-query';
import { isApiError } from './errors.js';

// TanStack Query defaults (3.2 §3.3):
// - queries retry twice, but only when it can help (no connection, server error, timeout);
//   a 4xx answer is final;
// - an answer is fresh for 30 s: switching tabs or coming back to the app reloads only what is
//   older (other accounts' changes show up without reloading everything at every tap, M9);
// - operations (mutations) never retry by themselves: money operations retry only when the
//   person taps "Reintentar", with the same Idempotency-Key (M6, useMoneyOperation);
// - operations are always sent (networkMode "always"): without signal they fail at once with
//   NETWORK_ERROR and the screen says so, instead of waiting paused with the button on
//   "Guardando..." and going out later on their own when the signal returns (M9).

export const MAX_QUERY_RETRIES = 2;
export const FRESH_FOR_MS = 30_000;

export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (failureCount >= MAX_QUERY_RETRIES) return false;
  if (!isApiError(error)) return false;
  return error.code === 'NETWORK_ERROR' || error.status >= 500;
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: shouldRetryQuery, refetchOnReconnect: true, staleTime: FRESH_FOR_MS },
      mutations: { retry: false, networkMode: 'always' },
    },
  });
}

/**
 * Reloads what the mounted screens show. `staleOnly` (a tab gains focus) skips answers younger
 * than FRESH_FOR_MS; a fetch already on its way is never cancelled and started again.
 */
export function refreshShownQueries(
  queryClient: QueryClient,
  { staleOnly }: { staleOnly: boolean },
): Promise<void> {
  return queryClient.refetchQueries(
    { type: 'active', ...(staleOnly ? { stale: true } : {}) },
    { cancelRefetch: false },
  );
}
