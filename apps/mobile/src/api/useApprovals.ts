import {
  type Approval,
  approvalListResponseSchema,
  approvalResponseSchema,
  type ResolveApprovalRequest,
} from '@bella-vista/shared';
import {
  type QueryClient,
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { requireApiClient } from './api.js';
import { isApiError } from './errors.js';
import { queryKeys } from './keys.js';

// Approvals inbox (docs/api.md "Autorizaciones"; 3.2 §10.8, R-01 to R-03). The president sees
// every request; any other role, the ones it sent. There is no GET /approvals/{id}: R-03 reads
// the item from the lists. Resolving takes it out of the pending list at once (the inbox and
// the counter of the tab update without waiting) and then reloads everything it may change.

type ListStatus = 'pending' | 'resolved' | 'all';

export const approvalList = (status: ListStatus) =>
  queryOptions({
    queryKey: queryKeys.approvalList(status),
    queryFn: ({ signal }) =>
      requireApiClient().request({
        method: 'GET',
        path: '/approvals',
        query: { status },
        schema: approvalListResponseSchema,
        signal,
      }),
    select: (data) => data.approvals,
  });

export function useApprovals(status: ListStatus, enabled = true) {
  return useQuery({ ...approvalList(status), enabled });
}

/** The badge of the president's "Autorizaciones" tab. */
export function usePendingApprovalCount(enabled: boolean): number {
  const query = useQuery({
    ...approvalList('pending'),
    select: (data) => data.approvals.length,
    enabled,
  });
  return query.data ?? 0;
}

/**
 * R-03: one request, from the list of every status. While it loads, the pending list already
 * cached (the inbox the person came from) shows it at once.
 */
export function useApproval(id: number) {
  const queryClient = useQueryClient();
  return useQuery({
    ...approvalList('all'),
    select: (data) => data.approvals.find((item) => item.id === id) ?? null,
    placeholderData: () =>
      queryClient.getQueryData(queryKeys.approvalList('pending')) as
        | { approvals: Approval[] }
        | undefined,
  });
}

/** What a resolution may change: the inbox and the records the approval type touches. */
function afterResolution(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: queryKeys.approvals });
  void queryClient.invalidateQueries({ queryKey: queryKeys.roleAssignments });
  void queryClient.invalidateQueries({ queryKey: queryKeys.blocks });
  void queryClient.invalidateQueries({ queryKey: queryKeys.communityReport });
}

function withoutPending(queryClient: QueryClient, id: number) {
  queryClient.setQueryData<{ approvals: Approval[] }>(queryKeys.approvalList('pending'), (list) =>
    list ? { approvals: list.approvals.filter((item) => item.id !== id) } : list,
  );
}

export function useResolveApproval(id: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: ResolveApprovalRequest) =>
      requireApiClient().request({
        method: 'POST',
        path: `/approvals/${id}/resolve`,
        body,
        schema: approvalResponseSchema,
      }),
    onSuccess: ({ approval }) => {
      withoutPending(queryClient, id);
      queryClient.setQueryData<{ approvals: Approval[] }>(queryKeys.approvalList('all'), (list) =>
        list
          ? { approvals: list.approvals.map((item) => (item.id === id ? approval : item)) }
          : list,
      );
      afterResolution(queryClient);
    },
    onError: (error) => {
      // Someone else resolved it (or it no longer exists): show the inbox as it is now.
      if (isApiError(error) && ['APPROVAL_ALREADY_RESOLVED', 'NOT_FOUND'].includes(error.code)) {
        afterResolution(queryClient);
      }
    },
  });
}
