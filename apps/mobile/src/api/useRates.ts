import {
  type CreateFeeAmountRequest,
  type CreateFeeRequest,
  type CreateRateRequest,
  feeListResponseSchema,
  feeResponseSchema,
  rateListResponseSchema,
  rateResponseSchema,
} from '@bella-vista/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { requireApiClient } from './api.js';
import { queryKeys } from './keys.js';

// Tarifas y conceptos (docs/api.md "Tarifas y conceptos"; T-10, T-11; D-05, D-13, D-20). A new
// rate waits for the president (a rate approval); a new amount of a fee is a new record from a
// date, never an edit of the previous one.

export function useRates() {
  return useQuery({
    queryKey: queryKeys.rates,
    queryFn: ({ signal }) =>
      requireApiClient().request({
        method: 'GET',
        path: '/rates',
        schema: rateListResponseSchema,
        signal,
      }),
    select: (data) => data.rates,
  });
}

export function useCreateRate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateRateRequest) =>
      requireApiClient().request({
        method: 'POST',
        path: '/rates',
        body,
        schema: rateResponseSchema,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.rates });
      void queryClient.invalidateQueries({ queryKey: queryKeys.approvals });
    },
  });
}

export function useFees() {
  return useQuery({
    queryKey: queryKeys.fees,
    queryFn: ({ signal }) =>
      requireApiClient().request({
        method: 'GET',
        path: '/fees',
        schema: feeListResponseSchema,
        signal,
      }),
    select: (data) => data.fees,
  });
}

export function useCreateFee() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateFeeRequest) =>
      requireApiClient().request({
        method: 'POST',
        path: '/fees',
        body,
        schema: feeResponseSchema,
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.fees }),
  });
}

/** T-11: a new amount from a date (today or later); the previous one stays in the history. */
export function useAddFeeAmount(feeId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateFeeAmountRequest) =>
      requireApiClient().request({
        method: 'POST',
        path: `/fees/${feeId}/amounts`,
        body,
        schema: feeResponseSchema,
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.fees }),
  });
}
