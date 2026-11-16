import { z } from 'zod';
import { page, paginationQuerySchema, periodSchema, requiredText } from './common.js';

// Account statement (GET /v1/units/{id}/account-statement; RF-MEN-07) and the debt summary
// shown in person and connection details and in the search. Amounts in integer cents.

export const statementMonthSchema = z.object({
  period: periodSchema,
  status: z.enum(['pending', 'overdue', 'paid', 'advance']),
  rateId: z.int().nullable(),
  baseAmount: z.int().nullable(),
  surcharge: z.int().nullable(),
  total: z.int().nullable(),
  paymentId: z.int().nullable(),
});

export const statementSummarySchema = z.object({
  overdueCount: z.int(),
  pendingCount: z.int(),
  inDebtCycle: z.boolean(),
  overdueTotal: z.int(),
  pendingTotal: z.int(),
  surchargeTotal: z.int(),
  totalDue: z.int(),
  advanceCount: z.int(),
});

export const accountStatementSchema = z.object({
  unitId: z.int(),
  currentPeriod: periodSchema,
  months: z.array(statementMonthSchema),
  summary: statementSummarySchema,
  /** Billable months without an approved rate: not priced and not payable yet. */
  missingRatePeriods: z.array(periodSchema),
});

export const accountStatementResponseSchema = z.object({ statement: accountStatementSchema });

/** What a unit owes today, for lists and details. */
export const debtSummarySchema = z.object({
  totalDue: z.int(),
  overdueCount: z.int(),
  inDebtCycle: z.boolean(),
});

export type AccountStatementResponse = z.infer<typeof accountStatementResponseSchema>;
export type DebtSummary = z.infer<typeof debtSummarySchema>;

// --- Payments (/v1/payments; CU-13 to CU-16, 2.3 §4) ----------------------------------------

const paperFolioSchema = requiredText(30, 'Escriba el folio del recibo de papel.');

const selectionShape = {
  /** Required to pay months; omitted for an opening fee alone (it belongs to a request). */
  unitId: z.int().positive().optional(),
  periods: z
    .array(periodSchema)
    .max(60, { error: 'Demasiados meses en un solo pago.' })
    .default([]),
  extraChargeIds: z.array(z.int().positive()).max(20).default([]),
};

const selectionRules = <
  T extends { unitId?: number | undefined; periods: string[]; extraChargeIds: number[] },
>(
  body: T,
  ctx: z.RefinementCtx,
) => {
  if (body.periods.length === 0 && body.extraChargeIds.length === 0) {
    ctx.addIssue({
      code: 'custom',
      path: ['periods'],
      message: 'Elija al menos un mes o un cargo.',
    });
  }
  if (body.periods.length > 0 && body.unitId === undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['unitId'],
      message: 'Elija la unidad a la que corresponden los meses.',
    });
  }
};

export const paymentPreviewRequestSchema = z.object(selectionShape).superRefine(selectionRules);

export const createPaymentRequestSchema = z
  .object({
    ...selectionShape,
    paperFolio: paperFolioSchema,
    /** Total the operator saw in the preview (RF-PAG-03). */
    expectedTotal: z.int({ error: 'Indique el total que vio en el resumen.' }).min(0),
  })
  .superRefine(selectionRules);

export const CASHBOX_TYPES = ['block', 'committee', 'support'] as const;

export const cashboxRefSchema = z.object({
  /** Null in a preview when the cashbox does not exist yet (it is created with the payment). */
  id: z.int().nullable(),
  type: z.enum(CASHBOX_TYPES),
  /** S1-M03, "Comité" or "Apoyo · <custodian>". */
  label: z.string(),
});

export const paymentUnitSchema = z.object({
  id: z.int(),
  folio: z.string(),
  /** Holder on the payment date (D-11). */
  holder: z.string().nullable(),
});

export const pricedMonthSchema = z.object({
  period: periodSchema,
  baseAmount: z.int(),
  surcharge: z.int(),
  total: z.int(),
});

export const paidChargeSchema = z.object({
  id: z.int(),
  feeName: z.string(),
  feeType: z.enum(['opening', 'reconnection', 'repair', 'other']),
  amount: z.int(),
  connectionRequestId: z.int().nullable(),
});

export const paymentPreviewSchema = z.object({
  unit: paymentUnitSchema.nullable(),
  months: z.array(pricedMonthSchema.extend({ kind: z.enum(['overdue', 'pending', 'advance']) })),
  charges: z.array(paidChargeSchema),
  total: z.int(),
  cashbox: cashboxRefSchema,
});

export const paymentPreviewResponseSchema = z.object({ preview: paymentPreviewSchema });

export const paperReceiptSchema = z.object({
  id: z.int(),
  paperFolio: z.string(),
  type: z.enum(['original', 'replacement']),
  issuedAt: z.iso.datetime(),
});

export const paymentCancellationSchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected']),
  approvalId: z.int(),
  reason: z.string(),
  requestedAt: z.iso.datetime(),
  resolvedAt: z.iso.datetime().nullable(),
});

export const paymentSchema = z.object({
  id: z.int(),
  folio: z.string(),
  unit: paymentUnitSchema.nullable(),
  /** Block served: the unit's block on the payment date, or the request's for an opening. */
  blockId: z.int().nullable(),
  months: z.array(pricedMonthSchema),
  charges: z.array(paidChargeSchema),
  total: z.int(),
  cashbox: cashboxRefSchema,
  /** Folio of the original paper receipt. */
  paperFolio: z.string(),
  receipts: z.array(paperReceiptSchema),
  occurredAt: z.iso.datetime(),
  capturedBy: z.object({ userAccountId: z.int(), username: z.string() }),
  cancelled: z.boolean(),
  /** Cancellation requests, newest first (D-15). */
  cancellations: z.array(paymentCancellationSchema),
});

export const paymentResponseSchema = z.object({ payment: paymentSchema });

export const paymentSummarySchema = paymentSchema.pick({
  id: true,
  folio: true,
  unit: true,
  blockId: true,
  total: true,
  cashbox: true,
  paperFolio: true,
  occurredAt: true,
  cancelled: true,
});

export const paymentListQuerySchema = paginationQuerySchema.extend({
  unitId: z.coerce.number().int().positive().optional(),
  blockId: z.coerce.number().int().positive().optional(),
  /** Payment dates (business date), inclusive. */
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
});

export const paymentPageSchema = page(paymentSummarySchema);

export const paperReceiptReplacementRequestSchema = z.object({ paperFolio: paperFolioSchema });

export const paymentCancellationRequestSchema = z.object({
  reason: requiredText(500, 'Escriba el motivo de la cancelación.'),
});

export type PaymentPreviewRequest = z.infer<typeof paymentPreviewRequestSchema>;
export type CreatePaymentRequest = z.infer<typeof createPaymentRequestSchema>;
export type CashboxRef = z.infer<typeof cashboxRefSchema>;
export type PaymentPreview = z.infer<typeof paymentPreviewSchema>;
export type Payment = z.infer<typeof paymentSchema>;
export type PaymentSummary = z.infer<typeof paymentSummarySchema>;
export type PaymentListQuery = z.infer<typeof paymentListQuerySchema>;
export type PaidCharge = z.infer<typeof paidChargeSchema>;
