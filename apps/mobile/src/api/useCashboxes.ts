import {
  type CashboxMovement,
  cashboxListResponseSchema,
  cashboxMovementPageSchema,
  type Handover,
  type HandoverListQuery,
  handoverPageSchema,
  handoverResponseSchema,
  openingBalanceResponseSchema,
} from '@bella-vista/shared';
import { type QueryClient, useQuery } from '@tanstack/react-query';
import type { FetchPage } from '../ui/PaginatedList.js';
import { requireApiClient } from './api.js';
import { queryKeys } from './keys.js';

// Cajas y entregas (docs/api.md "Cajas"; J-02 to J-04, T-02, T-03, T-12, G-09, R-06; D-16, D-18).
// The balance is always the API's (computed from the movements). Every POST that moves money
// goes through useMoneyOperation in its screen: the functions below take the Idempotency-Key
// that the hook creates (withdraw has none: the API does not key it).

/** T-12: every cashbox with its balance and its current opening balance (committee). */
export function useCashboxes(enabled = true) {
  return useQuery({
    enabled,
    queryKey: queryKeys.cashboxList,
    queryFn: ({ signal }) =>
      requireApiClient().request({
        method: 'GET',
        path: '/cashboxes',
        schema: cashboxListResponseSchema,
        signal,
      }),
    select: (data) => data.cashboxes,
  });
}

/** G-09: the movements of a cashbox in one month (AAAA-MM), newest first, paginated. */
export function movementPages(
  cashboxId: number,
  month: { from: string; to: string; key: string },
): { queryKey: readonly unknown[]; fetchPage: FetchPage<CashboxMovement> } {
  return {
    queryKey: queryKeys.movements(cashboxId, month.key),
    fetchPage: ({ limit, cursor, signal }) =>
      requireApiClient().request({
        method: 'GET',
        path: `/cashboxes/${cashboxId}/movements`,
        query: { from: month.from, to: month.to, limit, cursor },
        schema: cashboxMovementPageSchema,
        signal,
      }),
  };
}

/** J-04 and T-02: handovers by status (the API scopes them: a leader only sees theirs). */
export function handoverPages(status?: HandoverListQuery['status']): {
  queryKey: readonly unknown[];
  fetchPage: FetchPage<Handover>;
} {
  return {
    queryKey: [...queryKeys.handovers, 'list', status ?? 'all'],
    fetchPage: ({ limit, cursor, signal }) =>
      requireApiClient().request({
        method: 'GET',
        path: '/handovers',
        query: { status, limit, cursor },
        schema: handoverPageSchema,
        signal,
      }),
  };
}

/** T-03 and R-03. */
export function useHandover(id: number) {
  return useQuery({
    queryKey: queryKeys.handover(id),
    queryFn: ({ signal }) =>
      requireApiClient().request({
        method: 'GET',
        path: `/handovers/${id}`,
        schema: handoverResponseSchema,
        signal,
      }),
    select: (data) => data.handover,
    enabled: Number.isInteger(id) && id > 0,
  });
}

const withKey = (idempotencyKey: string | undefined) => (idempotencyKey ? { idempotencyKey } : {});

/** J-03 and R-06: prepare a handover from the custodian's cashbox. */
export const prepareHandover = (
  body: { declaredAmount: number; notes?: string },
  idempotencyKey: string | undefined,
) =>
  requireApiClient().request({
    method: 'POST',
    path: '/handovers',
    body,
    schema: handoverResponseSchema,
    ...withKey(idempotencyKey),
  });

/** J-04: withdraw a pending handover (not keyed by the API). */
export const withdrawHandover = (id: number) =>
  requireApiClient().request({
    method: 'POST',
    path: `/handovers/${id}/withdraw`,
    schema: handoverResponseSchema,
  });

/** T-03: the amount the treasurer counted. */
export const confirmHandover = (
  vars: { id: number; receivedAmount: number },
  idempotencyKey: string | undefined,
) =>
  requireApiClient().request({
    method: 'POST',
    path: `/handovers/${vars.id}/confirm`,
    body: { receivedAmount: vars.receivedAmount },
    schema: handoverResponseSchema,
    ...withKey(idempotencyKey),
  });

/** T-12: an opening balance waits for the president (D-18). */
export const requestOpeningBalance = (
  vars: { cashboxId: number; amount: number; date: string; reason: string },
  idempotencyKey: string | undefined,
) =>
  requireApiClient().request({
    method: 'POST',
    path: `/cashboxes/${vars.cashboxId}/opening-balance`,
    body: { amount: vars.amount, date: vars.date, reason: vars.reason },
    schema: openingBalanceResponseSchema,
    ...withKey(idempotencyKey),
  });

/**
 * What a cash movement changes (3.2 §3.3): every cashbox (balances, movements, T-12), the
 * handovers, the expenses, the plumber's payments, the approvals it may have created and the
 * community report.
 */
export function afterCashMovement(queryClient: QueryClient) {
  for (const queryKey of [
    queryKeys.cashboxes,
    queryKeys.handovers,
    queryKeys.expenses,
    queryKeys.incomes,
    queryKeys.plumbers,
    queryKeys.approvals,
    queryKeys.communityReport,
  ]) {
    void queryClient.invalidateQueries({ queryKey });
  }
}
