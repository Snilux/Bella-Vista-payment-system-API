import {
  type CreateExtraChargeRequest,
  extraChargeListResponseSchema,
  extraChargeResponseSchema,
} from '@bella-vista/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { requireApiClient } from './api.js';
import { queryKeys } from './keys.js';

// Cargos extraordinarios (docs/api.md "Cobranza"; D-13, D-28). Only the treasurer creates and
// cancels them; whoever collects sees the pending ones in F-02 and charges them together with
// the months (extraChargeIds of the payment). Creating or cancelling one moves no cash, so they
// are plain mutations (no Idempotency-Key); the buttons still block a second tap.

/** F-02 and G-04: the charges the family can pay (its own and its connection's). */
export function useUnitCharges(unitId: number | null, status: 'pending' | 'all' = 'pending') {
  return useQuery({
    queryKey: queryKeys.unitCharges(unitId ?? 0, status),
    queryFn: ({ signal }) =>
      requireApiClient().request({
        method: 'GET',
        path: `/units/${unitId}/extra-charges`,
        query: { status },
        schema: extraChargeListResponseSchema,
        signal,
      }),
    select: (data) => data.charges,
    enabled: unitId !== null && unitId > 0,
  });
}

export function useCreateCharge() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateExtraChargeRequest) =>
      requireApiClient().request({
        method: 'POST',
        path: '/extra-charges',
        body,
        schema: extraChargeResponseSchema,
      }),
    // The family (its charges and statement) and the search, which shows the debt.
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.units });
      void queryClient.invalidateQueries({ queryKey: queryKeys.searchAll });
    },
  });
}

export function useCancelCharge() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) =>
      requireApiClient().request({
        method: 'POST',
        path: `/extra-charges/${id}/cancel`,
        body: { reason },
        schema: extraChargeResponseSchema,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.units });
      void queryClient.invalidateQueries({ queryKey: queryKeys.searchAll });
    },
  });
}
