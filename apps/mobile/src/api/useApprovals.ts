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
// every request; any other role, the ones it sent. R-03 reads one with GET /approvals/{id}, whose
// subject points to the record (the payment, the rate, the family…). Resolving takes it out of the pending list at once (the inbox and
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
 * R-03: one request with its subject (GET /v1/approvals/{id}). While it loads, the item of the
 * pending inbox already cached (where the person came from) shows at once.
 */
export function useApproval(id: number) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: queryKeys.approval(id),
    queryFn: ({ signal }) =>
      requireApiClient().request({
        method: 'GET',
        path: `/approvals/${id}`,
        schema: approvalResponseSchema,
        signal,
      }),
    select: (data) => data.approval,
    placeholderData: () => {
      const inbox = queryClient.getQueryData<{ approvals: Approval[] }>(
        queryKeys.approvalList('pending'),
      );
      const item = inbox?.approvals.find((approval) => approval.id === id);
      return item ? { approval: item } : undefined;
    },
  });
}

/** What a resolution may change: the inbox and the records the approval type touches. */
function afterResolution(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: queryKeys.approvals });
  void queryClient.invalidateQueries({ queryKey: queryKeys.roleAssignments });
  void queryClient.invalidateQueries({ queryKey: queryKeys.blocks });
  void queryClient.invalidateQueries({ queryKey: queryKeys.communityReport });
  // An approved cancellation frees months and moves the cashbox; a rate changes prices.
  void queryClient.invalidateQueries({ queryKey: queryKeys.payments });
  void queryClient.invalidateQueries({ queryKey: queryKeys.units });
  void queryClient.invalidateQueries({ queryKey: queryKeys.rates });
  void queryClient.invalidateQueries({ queryKey: queryKeys.myCashbox });
  void queryClient.invalidateQueries({ queryKey: queryKeys.people });
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
      queryClient.setQueryData(queryKeys.approval(id), { approval });
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
