import { z } from 'zod';
import { optionalText, periodSchema, requiredText } from './common.js';

// Rates and fees (/v1/rates, /v1/fees; CU-12, RF-TAR, D-05, D-13, D-20). Amounts in integer
// cents.

const amountSchema = z
  .int({ error: 'El importe debe ser un número entero de centavos.' })
  .positive({ error: 'El importe debe ser mayor que cero.' })
  .max(100_000_000, { error: 'El importe es demasiado grande.' });

// --- Rates ----------------------------------------------------------------------------------

export const RATE_STATUSES = ['pending', 'approved', 'rejected'] as const;

export const rateSchema = z.object({
  id: z.int(),
  effectivePeriod: periodSchema,
  amount: z.int(),
  approvedOn: z.iso.date(),
  agreement: z.object({ id: z.int(), folio: z.string() }),
  /** From its approval: only approved rates price months (D-20). */
  status: z.enum(RATE_STATUSES),
  approvalId: z.int(),
  createdAt: z.iso.datetime(),
});

export const rateListResponseSchema = z.object({ rates: z.array(rateSchema) });
export const rateResponseSchema = z.object({ rate: rateSchema });

export const createRateRequestSchema = z.object({
  effectivePeriod: periodSchema,
  amount: amountSchema,
  /** Date of the meeting agreement that approved it. */
  approvedOn: z.iso.date({ error: 'La fecha de aprobación debe tener el formato AAAA-MM-DD.' }),
  agreementId: z.int({ error: 'Indique el acuerdo de junta.' }).positive(),
  /** Shown to the president in the approvals inbox. */
  reason: optionalText(500),
});

// --- Fees -----------------------------------------------------------------------------------

export const FEE_TYPES = ['opening', 'reconnection', 'repair', 'other'] as const;

export const feeAmountSchema = z.object({
  effectiveFrom: z.iso.date(),
  amount: z.int(),
});

export const feeSchema = z.object({
  id: z.int(),
  type: z.enum(FEE_TYPES),
  name: z.string(),
  /** Amount in force today, or null when it has none yet. */
  currentAmount: feeAmountSchema.nullable(),
  /** Every amount, newest first (D-13). */
  amounts: z.array(feeAmountSchema),
});

export const feeListResponseSchema = z.object({ fees: z.array(feeSchema) });
export const feeResponseSchema = z.object({ fee: feeSchema });

export const createFeeRequestSchema = z.object({
  type: z.enum(FEE_TYPES, { error: 'Indique el tipo de concepto.' }),
  name: requiredText(100, 'Escriba el nombre del concepto.'),
});

export const createFeeAmountRequestSchema = z.object({
  effectiveFrom: z.iso.date({ error: 'La fecha debe tener el formato AAAA-MM-DD.' }),
  amount: amountSchema,
});

export type Rate = z.infer<typeof rateSchema>;
export type CreateRateRequest = z.infer<typeof createRateRequestSchema>;
export type Fee = z.infer<typeof feeSchema>;
export type CreateFeeRequest = z.infer<typeof createFeeRequestSchema>;
export type CreateFeeAmountRequest = z.infer<typeof createFeeAmountRequestSchema>;
