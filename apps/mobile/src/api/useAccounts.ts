import {
  type AccountListResponse,
  type AccountSummary,
  type AccountWithTemporaryPassword,
  accountListResponseSchema,
  accountResponseSchema,
  accountWithTemporaryPasswordSchema,
  type CreateAccountRequest,
} from '@bella-vista/shared';
import {
  type QueryClient,
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { getApiClient } from './api.js';
import type { ApiClient } from './client.js';
import { ApiError } from './errors.js';
import { queryKeys } from './keys.js';

// Accounts of the superadmin (docs/api.md "Cuentas (solo SA)"; 3.2 §10.8, A-01 to A-03).
//
// Temporary passwords (create and reset) are shown once and kept nowhere else:
// - the query cache only ever receives the `account` of an answer, never the password;
// - the two operations use gcTime 0, and the screen calls `reset()` as soon as it has copied the
//   password to its own state, so the mutation cache drops it at once;
// - the client logs nothing and the password never goes into a route parameter.

function apiClient(): ApiClient {
  const client = getApiClient();
  if (!client) throw new ApiError('INVALID_REQUEST', 0, 'Falta EXPO_PUBLIC_API_URL.');
  return client;
}

const accountList = queryOptions({
  queryKey: queryKeys.accounts,
  queryFn: ({ signal }) =>
    apiClient().request({
      method: 'GET',
      path: '/accounts',
      schema: accountListResponseSchema,
      signal,
    }),
});

/** A-01: accounts and the current assignments that still have no account. */
export function useAccountList() {
  return useQuery(accountList);
}

/**
 * A-03: one account, read from the same list (the API has no GET /accounts/{id}). The data is
 * null when the list has no account with that id.
 */
export function useManagedAccount(id: number) {
  return useQuery({
    ...accountList,
    select: (list: AccountListResponse) =>
      list.accounts.find((account) => account.id === id) ?? null,
  });
}

/** Puts the account an operation returned into the cached list, then reloads list and log. */
function afterChange(queryClient: QueryClient, account: AccountSummary) {
  queryClient.setQueryData<AccountListResponse>(queryKeys.accounts, (list) => {
    if (!list) return list;
    const exists = list.accounts.some((item) => item.id === account.id);
    return {
      accounts: exists
        ? list.accounts.map((item) => (item.id === account.id ? account : item))
        : [...list.accounts, account],
      assignmentsWithoutAccount: list.assignmentsWithoutAccount.filter(
        (assignment) => assignment.roleAssignmentId !== account.roleAssignmentId,
      ),
    };
  });
  void queryClient.invalidateQueries({ queryKey: queryKeys.accounts });
  void queryClient.invalidateQueries({ queryKey: queryKeys.auditLog });
}

/** A-02: creates the account of an assignment; the answer carries the temporary password. */
export function useCreateAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    gcTime: 0,
    mutationFn: (input: CreateAccountRequest): Promise<AccountWithTemporaryPassword> =>
      apiClient().request({
        method: 'POST',
        path: '/accounts',
        body: input,
        schema: accountWithTemporaryPasswordSchema,
      }),
    onSuccess: ({ account }) => afterChange(queryClient, account),
  });
}

/** A-03 "Restablecer contraseña": a new temporary password and every session closed. */
export function useResetPassword(id: number) {
  const queryClient = useQueryClient();
  return useMutation({
    gcTime: 0,
    mutationFn: (input: { reason: string }): Promise<AccountWithTemporaryPassword> =>
      apiClient().request({
        method: 'POST',
        path: `/accounts/${id}/reset-password`,
        body: input,
        schema: accountWithTemporaryPasswordSchema,
      }),
    onSuccess: ({ account }) => afterChange(queryClient, account),
  });
}

export type AccountAction = 'lock' | 'unlock' | 'deactivate';

/** A-03 "Bloquear", "Desbloquear" and "Desactivar", each with its reason. */
export function useAccountAction(id: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { action: AccountAction; reason: string }) => {
      const { account } = await apiClient().request({
        method: 'POST',
        path: `/accounts/${id}/${input.action}`,
        body: { reason: input.reason },
        schema: accountResponseSchema,
      });
      return account;
    },
    onSuccess: (account) => afterChange(queryClient, account),
  });
}
