import {
  type ActivateConnectionRequestRequest,
  activationResponseSchema,
  type ConnectionRequestStatus,
  type CreateConnectionRequestRequest,
  connectionRequestPageSchema,
  connectionRequestResponseSchema,
  feeListResponseSchema,
  type ResolveConnectionRequestRequest,
} from '@bella-vista/shared';
import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { FetchPage } from '../ui/PaginatedList.js';
import { requireApiClient } from './api.js';
import { queryKeys } from './keys.js';
import { afterRegistryChange } from './useRegistry.js';

// Solicitudes de toma (docs/api.md "Padrón y tomas"; D-12, D-13; S-02, S-03, J-06, P-05, P-06).
// The API filters by block: a block leader only receives the requests of their block.

type Request = ReturnType<typeof connectionRequestPageSchema.parse>['data'][number];

/** S-02 and J-06: one status at a time (a chip per status), paginated. */
export function connectionRequestPages(status: ConnectionRequestStatus | null) {
  const fetchPage: FetchPage<Request> = ({ limit, cursor, signal }) =>
    requireApiClient().request({
      method: 'GET',
      path: '/connection-requests',
      query: { limit, cursor, status: status ?? undefined },
      schema: connectionRequestPageSchema,
      signal,
    });
  return { queryKey: [...queryKeys.connectionRequests, 'list', status ?? 'all'], fetchPage };
}

export function useConnectionRequest(id: number) {
  return useQuery({
    queryKey: queryKeys.connectionRequest(id),
    queryFn: ({ signal }) =>
      requireApiClient().request({
        method: 'GET',
        path: `/connection-requests/${id}`,
        schema: connectionRequestResponseSchema,
        signal,
      }),
    select: (data) => data.request,
  });
}

/** P-05 and S-03: the opening fee with its amount in force today (null when it has none). */
export function useOpeningFee() {
  return useQuery({
    queryKey: queryKeys.fees,
    queryFn: ({ signal }) =>
      requireApiClient().request({
        method: 'GET',
        path: '/fees',
        schema: feeListResponseSchema,
        signal,
      }),
    select: (data) => data.fees.find((fee) => fee.type === 'opening') ?? null,
  });
}

function afterRequestChange(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: queryKeys.connectionRequests });
  afterRegistryChange(queryClient);
}

export function useCreateConnectionRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateConnectionRequestRequest) =>
      requireApiClient().request({
        method: 'POST',
        path: '/connection-requests',
        body,
        schema: connectionRequestResponseSchema,
      }),
    onSettled: () => afterRequestChange(queryClient),
  });
}

/** S-03: the agreement's result decides (approved → opening charge; rejected → reason). */
export function useResolveConnectionRequest(id: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: ResolveConnectionRequestRequest) =>
      requireApiClient().request({
        method: 'POST',
        path: `/connection-requests/${id}/resolve`,
        body,
        schema: connectionRequestResponseSchema,
      }),
    onSuccess: () => afterRequestChange(queryClient),
  });
}

/** P-06: creates the connection and its first family; needs the opening paid. */
export function useActivateConnectionRequest(id: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: ActivateConnectionRequestRequest) =>
      requireApiClient().request({
        method: 'POST',
        path: `/connection-requests/${id}/activate`,
        body,
        schema: activationResponseSchema,
      }),
    onSuccess: () => afterRequestChange(queryClient),
  });
}

/** J-06 (and S-02): cancels before the opening is paid (D-12). */
export function useCancelConnectionRequest(id: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (reason: string) =>
      requireApiClient().request({
        method: 'POST',
        path: `/connection-requests/${id}/cancel`,
        body: { reason },
        schema: connectionRequestResponseSchema,
      }),
    onSuccess: () => afterRequestChange(queryClient),
  });
}
