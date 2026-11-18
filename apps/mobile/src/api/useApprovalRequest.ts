import {
  expenseResponseSchema,
  paymentResponseSchema,
  unitChangeRequestResponseSchema,
} from '@bella-vista/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { REQUEST_CONFIGS, type RequestType } from '../features/approvals/approval-types.js';
import { requireApiClient } from './api.js';
import { queryKeys } from './keys.js';
import { useMoneyOperation } from './useMoneyOperation.js';

// G-11 · Solicitud con motivo: one hook for every request that goes to the president. The ones
// that move money (cancellation, refund) carry an Idempotency-Key; all of them go through
// useMoneyOperation, so a double tap sends once and a request without answer is retried as is.

const RESPONSE_SCHEMAS = {
  unit_deactivation: unitChangeRequestResponseSchema,
  holder_change: unitChangeRequestResponseSchema,
  payment_cancellation: paymentResponseSchema,
  expense_refund: expenseResponseSchema,
} as const;

export type ApprovalRequestVars = { reason: string; newHolderId?: number };

export function useApprovalRequest(type: RequestType, recordId: number) {
  const queryClient = useQueryClient();
  const config = REQUEST_CONFIGS[type];

  const send = useCallback(
    (vars: ApprovalRequestVars, idempotencyKey: string | undefined) =>
      requireApiClient().request({
        method: 'POST',
        path: config.path(recordId),
        body: config.needsNewHolder
          ? { newHolderId: vars.newHolderId, reason: vars.reason }
          : { reason: vars.reason },
        schema: RESPONSE_SCHEMAS[type],
        ...(idempotencyKey ? { idempotencyKey } : {}),
      }),
    [config, recordId, type],
  );

  const onSuccess = useCallback(() => {
    // The requester follows it in their own approvals list.
    void queryClient.invalidateQueries({ queryKey: queryKeys.approvals });
  }, [queryClient]);

  return useMoneyOperation(send, { idempotent: config.idempotent, onSuccess });
}
