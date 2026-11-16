import { QueryClient } from '@tanstack/react-query';
import { isApiError } from './errors.js';

// TanStack Query defaults (3.2 §3.3):
// - queries retry twice, but only when it can help (no connection, server error, timeout);
//   a 4xx answer is final;
// - operations (mutations) never retry by themselves: money operations retry only when the
//   person taps "Reintentar", with the same Idempotency-Key (M6, useMoneyOperation).

export const MAX_QUERY_RETRIES = 2;

export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (failureCount >= MAX_QUERY_RETRIES) return false;
  if (!isApiError(error)) return false;
  return error.code === 'NETWORK_ERROR' || error.status >= 500;
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: shouldRetryQuery, refetchOnReconnect: true },
      mutations: { retry: false },
    },
  });
}
