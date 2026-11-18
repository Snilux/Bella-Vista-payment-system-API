import {
  type Block,
  type Closing,
  type ClosingListQuery,
  type CountClosingRequest,
  closingPageSchema,
  closingResponseSchema,
  type OpenClosingRequest,
  periodOf,
} from '@bella-vista/shared';
import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { requireApiClient } from './api.js';
import { queryKeys } from './keys.js';
import { COUNT_LIMIT } from './useOrganization.js';

// Closings (docs/api.md "Cortes"; D-08, D-14): how many wait for review (R-01, V-01), the
// handover record of a leader substitution (S-07) and, since M8, the closing screens. Opening,
// counting, reviewing and closing move no cash: plain mutations (the buttons block a second tap).

/** R-01 "Cortes por revisar": counted closings (count of the first 100). */
export function useCountedClosingCount(enabled = true) {
  return useQuery({
    queryKey: [...queryKeys.closings, { status: 'counted' }],
    queryFn: ({ signal }) =>
      requireApiClient().request({
        method: 'GET',
        path: '/closings',
        query: { status: 'counted', limit: COUNT_LIMIT },
        schema: closingPageSchema,
        signal,
      }),
    select: (page) => ({ count: page.data.length, more: page.next !== null }),
    enabled,
  });
}

/**
 * S-07 "Sustituir jefe": the extraordinary closings of the block's cashbox this month (an
 * extraordinary closing covers from day 1 of the current month to its date), newest first.
 * Drafts come too, so the screen can say the cash still has to be counted.
 */
export function useBlockExtraordinaryClosings(block: Pick<Block, 'fullCode'> | null) {
  const period = periodOf(new Date());
  return useQuery({
    queryKey: [...queryKeys.closings, { period, type: 'extraordinary' }],
    queryFn: ({ signal }) =>
      requireApiClient().request({
        method: 'GET',
        path: '/closings',
        query: { period, limit: COUNT_LIMIT },
        schema: closingPageSchema,
        signal,
      }),
    select: (page) =>
      page.data
        .filter(
          (closing) =>
            closing.type === 'extraordinary' &&
            closing.cashbox.type === 'block' &&
            closing.cashbox.label === block?.fullCode,
        )
        .sort((a, b) => b.dateTo.localeCompare(a.dateTo) || b.id - a.id),
    enabled: block !== null,
  });
}

// --- M8: the closing screens (J-05, T-13, R-04, G-08) ---------------------------------------

/** R-04, T-13 and J-05: the closings of a filter (the first 100; a month has few). */
export function useClosings(filter: Omit<ClosingListQuery, 'limit' | 'cursor'>, enabled = true) {
  return useQuery({
    queryKey: [...queryKeys.closings, 'list', filter],
    queryFn: ({ signal }) =>
      requireApiClient().request({
        method: 'GET',
        path: '/closings',
        query: { ...filter, limit: COUNT_LIMIT },
        schema: closingPageSchema,
        signal,
      }),
    select: (page) => page.data,
    enabled,
  });
}

export function useClosing(id: number | null) {
  return useQuery({
    queryKey: queryKeys.closing(id ?? 0),
    queryFn: ({ signal }) =>
      requireApiClient().request({
        method: 'GET',
        path: `/closings/${id}`,
        schema: closingResponseSchema,
        signal,
      }),
    select: (data) => data.closing,
    enabled: id !== null && Number.isInteger(id) && id > 0,
  });
}

/**
 * What a closing changes: the closings, the cashboxes (nextClosingPeriod), the reports (last
 * closing and differences) and the audit log.
 */
function afterClosing(queryClient: QueryClient, closing?: Closing) {
  if (closing) queryClient.setQueryData(queryKeys.closing(closing.id), { closing });
  for (const queryKey of [
    queryKeys.closings,
    queryKeys.cashboxes,
    queryKeys.reports,
    queryKeys.auditLog,
  ]) {
    void queryClient.invalidateQueries({ queryKey });
  }
}

/** J-05 "Preparar corte", T-13 committee and extraordinary closings: the API computes figures. */
export function useOpenClosing() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: OpenClosingRequest) =>
      requireApiClient().request({
        method: 'POST',
        path: '/closings',
        body,
        schema: closingResponseSchema,
      }),
    onSuccess: ({ closing }) => afterClosing(queryClient, closing),
  });
}

/** G-08 / J-05: the cash counted and the notes (required with a difference). */
export function useCountClosing(id: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CountClosingRequest) =>
      requireApiClient().request({
        method: 'POST',
        path: `/closings/${id}/count`,
        body,
        schema: closingResponseSchema,
      }),
    onSuccess: ({ closing }) => afterClosing(queryClient, closing),
  });
}

/** G-08: "Marcar como revisado" (president or member) and "Cerrar corte" (president). */
export function useClosingStep(id: number, step: 'review' | 'close') {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      requireApiClient().request({
        method: 'POST',
        path: `/closings/${id}/${step}`,
        schema: closingResponseSchema,
      }),
    onSuccess: ({ closing }) => afterClosing(queryClient, closing),
  });
}
