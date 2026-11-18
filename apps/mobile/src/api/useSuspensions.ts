import {
  type CreateSuspensionRequest,
  type SuspensionListItem,
  suspensionPageSchema,
  suspensionResponseSchema,
} from '@bella-vista/shared';
import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { FetchPage } from '../ui/PaginatedList.js';
import { requireApiClient } from './api.js';
import { queryKeys } from './keys.js';
import { COUNT_LIMIT } from './useOrganization.js';
import { afterRegistryChange } from './useRegistry.js';

// Suspensiones (D-06; S-08 and S-01): a suspended connection or family generates no monthly fees
// while it lasts; earlier debts stay. GET /v1/suspensions is for the committee only.

/** S-08: the active ones (or the ended ones), newest first. */
export function suspensionPages(status: 'active' | 'ended') {
  const fetchPage: FetchPage<SuspensionListItem> = ({ limit, cursor, signal }) =>
    requireApiClient().request({
      method: 'GET',
      path: '/suspensions',
      query: { status, limit, cursor },
      schema: suspensionPageSchema,
      signal,
    });
  return { queryKey: [...queryKeys.suspensions, 'list', status], fetchPage };
}

/** S-01 "Suspensiones vigentes" (count of the first 100). */
export function useActiveSuspensionCount(enabled = true) {
  return useQuery({
    queryKey: [...queryKeys.suspensions, 'count'],
    queryFn: ({ signal }) =>
      requireApiClient().request({
        method: 'GET',
        path: '/suspensions',
        query: { status: 'active', limit: COUNT_LIMIT },
        schema: suspensionPageSchema,
        signal,
      }),
    select: (page) => ({ count: page.data.length, more: page.next !== null }),
    enabled,
  });
}

function afterSuspensionChange(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: queryKeys.suspensions });
  afterRegistryChange(queryClient);
}

export function useSuspend() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateSuspensionRequest) =>
      requireApiClient().request({
        method: 'POST',
        path: '/suspensions',
        body,
        schema: suspensionResponseSchema,
      }),
    onSuccess: () => afterSuspensionChange(queryClient),
  });
}

/** Reactivate: `periodTo` is the last month without billing. */
export function useEndSuspension() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, periodTo }: { id: number; periodTo: string }) =>
      requireApiClient().request({
        method: 'POST',
        path: `/suspensions/${id}/end`,
        body: { periodTo },
        schema: suspensionResponseSchema,
      }),
    onSuccess: () => afterSuspensionChange(queryClient),
  });
}
