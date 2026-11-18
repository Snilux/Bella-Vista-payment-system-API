import {
  accountStatementResponseSchema,
  type CreatePaymentRequest,
  handoverPageSchema,
  myCashboxResponseSchema,
  type PaymentPreviewRequest,
  paymentPreviewResponseSchema,
  paymentResponseSchema,
  unitResponseSchema,
} from '@bella-vista/shared';
import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { requireApiClient } from './api.js';
import { queryKeys } from './keys.js';
import { COUNT_LIMIT } from './useOrganization.js';

// Cobranza (docs/api.md "Cobranza" and "Estado de cuenta"; 3.2 §10.2, §10.3, §10.5). The API
// decides which month is overdue and how much surcharge it carries (account statement) and
// recalculates every payment (preview and registration). Registering a payment moves money: it
// goes through useMoneyOperation in F-03 with its Idempotency-Key (registerPayment below).

export function useUnit(id: number) {
  return useQuery({
    queryKey: queryKeys.unit(id),
    queryFn: ({ signal }) =>
      requireApiClient().request({
        method: 'GET',
        path: `/units/${id}`,
        schema: unitResponseSchema,
        signal,
      }),
    select: (data) => data.unit,
    enabled: Number.isInteger(id) && id > 0,
  });
}

export function useAccountStatement(unitId: number | null) {
  return useQuery({
    queryKey: queryKeys.statement(unitId ?? 0),
    queryFn: ({ signal }) =>
      requireApiClient().request({
        method: 'GET',
        path: `/units/${unitId}/account-statement`,
        schema: accountStatementResponseSchema,
        signal,
      }),
    select: (data) => data.statement,
    enabled: unitId !== null && unitId > 0,
  });
}

export function usePayment(id: number) {
  return useQuery({
    queryKey: queryKeys.payment(id),
    queryFn: ({ signal }) =>
      requireApiClient().request({
        method: 'GET',
        path: `/payments/${id}`,
        schema: paymentResponseSchema,
        signal,
      }),
    select: (data) => data.payment,
    enabled: Number.isInteger(id) && id > 0,
  });
}

/** F-03: what the API would charge for this selection (its total becomes expectedTotal). */
export function usePaymentPreview(body: PaymentPreviewRequest | null) {
  return useQuery({
    queryKey: [...queryKeys.payments, 'preview', body],
    queryFn: ({ signal }) =>
      requireApiClient().request({
        method: 'POST',
        path: '/payments/preview',
        body,
        schema: paymentPreviewResponseSchema,
        signal,
      }),
    select: (data) => data.preview,
    enabled: body !== null,
    // The preview is a calculation, never cached between visits: the total must be today's.
    gcTime: 0,
    staleTime: 0,
  });
}

/** The POST of F-03, for useMoneyOperation (it adds the Idempotency-Key). */
export const registerPayment = (body: CreatePaymentRequest, idempotencyKey: string | undefined) =>
  requireApiClient().request({
    method: 'POST',
    path: '/payments',
    body,
    schema: paymentResponseSchema,
    ...(idempotencyKey ? { idempotencyKey } : {}),
  });

/**
 * What a registered payment changes (3.2 §3.3): the statement and the family, the person's file
 * and the search, the rosters, "Mi caja", the payments and, for an opening, the request.
 */
export function afterPayment(queryClient: QueryClient) {
  for (const queryKey of [
    queryKeys.units,
    queryKeys.payments,
    queryKeys.people,
    queryKeys.connections,
    queryKeys.searchAll,
    queryKeys.blockRosters,
    queryKeys.myCashbox,
    queryKeys.communityReport,
    queryKeys.connectionRequests,
  ]) {
    void queryClient.invalidateQueries({ queryKey });
  }
}

/** G-10: a new paper receipt for a lost one; no cost and no cash movement (D-23). */
export function useReplaceReceipt(paymentId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (paperFolio: string) =>
      requireApiClient().request({
        method: 'POST',
        path: `/payments/${paymentId}/replacements`,
        body: { paperFolio },
        schema: paymentResponseSchema,
      }),
    onSuccess: ({ payment }) => {
      queryClient.setQueryData(queryKeys.payment(paymentId), { payment });
      void queryClient.invalidateQueries({ queryKey: queryKeys.payments });
    },
  });
}

/** J-01: the leader's cashbox ("Debo tener"). */
export function useMyCashbox() {
  return useQuery({
    queryKey: queryKeys.myCashbox,
    queryFn: ({ signal }) =>
      requireApiClient().request({
        method: 'GET',
        path: '/cashboxes/mine',
        schema: myCashboxResponseSchema,
        signal,
      }),
    select: (data) => data.cashbox,
  });
}

/** J-01 "Entregas por confirmar": the leader's pending handovers (count of the first 100). */
export function usePendingHandoverCount() {
  return useQuery({
    queryKey: [...queryKeys.handovers, { status: 'pending' }],
    queryFn: ({ signal }) =>
      requireApiClient().request({
        method: 'GET',
        path: '/handovers',
        query: { status: 'pending', limit: COUNT_LIMIT },
        schema: handoverPageSchema,
        signal,
      }),
    select: (page) => ({ count: page.data.length, more: page.next !== null }),
  });
}
