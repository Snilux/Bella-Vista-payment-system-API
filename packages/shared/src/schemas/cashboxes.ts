import { z } from 'zod';
import { cashboxRefSchema } from './billing.js';
import { optionalText, page, paginationQuerySchema, requiredText } from './common.js';

// Cashboxes, opening balances, handovers and adjustments (/v1/cashboxes, /v1/handovers,
// /v1/adjustments; CU-17, CU-18, RF-CAJ; D-07, D-16, D-18). Amounts in integer cents; the
// balance of a cashbox is always computed from its movements, never stored.

const amountSchema = z
  .int({ error: 'El importe debe ser un número entero de centavos.' })
  .positive({ error: 'El importe debe ser mayor que cero.' })
  .max(100_000_000, { error: 'El importe es demasiado grande.' });

const APPROVAL_STATUS = z.enum(['pending', 'approved', 'rejected']);

export const openingBalanceSchema = z.object({
  id: z.int(),
  cashboxId: z.int(),
  amount: z.int(),
  date: z.iso.date(),
  status: APPROVAL_STATUS,
  approvalId: z.int(),
});

/** What the custodian sees of their cashbox (RF-CAJ-07). */
export const myCashboxSchema = z.object({
  /** id is null when the support cashbox does not exist yet (it is created when collecting). */
  cashbox: cashboxRefSchema,
  /** Expected balance (v_cashbox_balance). */
  balance: z.int(),
  /** Payments minus cancellations. */
  collected: z.int(),
  /** Confirmed handovers: the amount received by the treasurer. */
  handedOver: z.int(),
  /** Declared in handovers still pending confirmation. */
  pendingHandover: z.int(),
  /** What can still be handed over: balance - pendingHandover. */
  available: z.int(),
  openingBalance: openingBalanceSchema.nullable(),
  /** The month (AAAA-MM) whose monthly closing comes next; null if none has ended yet. */
  nextClosingPeriod: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .nullable(),
});

export const myCashboxResponseSchema = z.object({ cashbox: myCashboxSchema });

export const cashboxListResponseSchema = z.object({
  cashboxes: z.array(
    cashboxRefSchema.extend({
      id: z.int(),
      balance: z.int(),
      /** Its opening balance (T-12): approved, else pending, else the latest rejected; null if never captured. */
      openingBalance: openingBalanceSchema.nullable(),
      /** The month (AAAA-MM) whose monthly closing comes next; null if none has ended yet. */
      nextClosingPeriod: z
        .string()
        .regex(/^\d{4}-\d{2}$/)
        .nullable(),
    }),
  ),
});

export const CASHBOX_MOVEMENT_KINDS = [
  'opening_balance',
  'payment',
  'payment_cancellation',
  'handover_out',
  'handover_in',
  'income',
  'expense',
  'expense_refund',
  'adjustment',
] as const;

export const cashboxMovementSchema = z.object({
  occurredOn: z.iso.date(),
  kind: z.enum(CASHBOX_MOVEMENT_KINDS),
  /** Signed: positive in, negative out. */
  amount: z.int(),
  /** Table and id of the record behind the movement. */
  tableName: z.string(),
  recordId: z.int(),
  /** Folio of that record (PG, EN, IN, GA; for an adjustment, its handover or closing). */
  folio: z.string().nullable(),
  /**
   * Short description: the family of a payment or cancellation, the source cashbox of a
   * handover, the concept of an income, the description of an expense or refund.
   */
  detail: z.string().nullable(),
});

export const cashboxMovementQuerySchema = paginationQuerySchema.extend({
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
});

export const cashboxMovementPageSchema = page(cashboxMovementSchema);

export const openingBalanceRequestSchema = z.object({
  amount: amountSchema,
  /** Date the cash was counted when the system started (D-18); today or earlier. */
  date: z.iso.date({ error: 'La fecha debe tener el formato AAAA-MM-DD.' }),
  reason: requiredText(500, 'Escriba el motivo o la referencia del conteo.'),
});

export const openingBalanceResponseSchema = z.object({ openingBalance: openingBalanceSchema });

// --- Handovers ------------------------------------------------------------------------------

export const HANDOVER_STATUSES = [
  'pending',
  'withdrawn',
  'confirmed',
  'with_difference',
  'adjusted',
] as const;

const accountRef = z.object({ userAccountId: z.int(), username: z.string() });

export const handoverSchema = z.object({
  id: z.int(),
  /** Also the folio of the receipt constancy (RF-CAJ-05). */
  folio: z.string(),
  cashbox: cashboxRefSchema.extend({ id: z.int() }),
  date: z.iso.date(),
  declaredAmount: z.int(),
  receivedAmount: z.int().nullable(),
  /** declared - received; positive = shortfall that stays in the source cashbox (D-16). */
  difference: z.int().nullable(),
  /** Sum of the approved adjustments. */
  adjustedAmount: z.int().nullable(),
  notes: z.string().nullable(),
  status: z.enum(HANDOVER_STATUSES),
  /** fullName: the person of the account (T-02 "S1-M03 · María López"). */
  preparedBy: accountRef.extend({ fullName: z.string() }),
  withdrawnAt: z.iso.datetime().nullable(),
  confirmedAt: z.iso.datetime().nullable(),
  confirmedBy: accountRef.nullable(),
});

export const handoverListQuerySchema = paginationQuerySchema.extend({
  status: z.enum(HANDOVER_STATUSES).optional(),
});

export const handoverPageSchema = page(handoverSchema);
export const handoverResponseSchema = z.object({ handover: handoverSchema });

export const prepareHandoverRequestSchema = z.object({
  declaredAmount: amountSchema,
  notes: optionalText(500),
});

export const confirmHandoverRequestSchema = z.object({
  receivedAmount: z
    .int({ error: 'El importe recibido debe ser un número entero de centavos.' })
    .min(0, { error: 'El importe recibido no puede ser negativo.' }),
});

// --- Adjustments ----------------------------------------------------------------------------

export const adjustmentSchema = z.object({
  id: z.int(),
  cashboxId: z.int(),
  handoverId: z.int().nullable(),
  closingId: z.int().nullable(),
  /** Signed movement of the cashbox: negative takes cash out (e.g. a shortfall written off). */
  amount: z.int(),
  date: z.iso.date(),
  status: APPROVAL_STATUS,
  approvalId: z.int(),
});

/** An adjustment of a handover difference or of a closing difference (exactly one). */
export const createAdjustmentRequestSchema = z
  .object({
    handoverId: z.int().positive().optional(),
    closingId: z.int().positive().optional(),
    amount: z
      .int({ error: 'El importe debe ser un número entero de centavos.' })
      .refine((value) => value !== 0, { error: 'El importe no puede ser cero.' }),
    reason: requiredText(500, 'Escriba el motivo de la aclaración.'),
  })
  .refine((body) => (body.handoverId === undefined) !== (body.closingId === undefined), {
    path: ['handoverId'],
    error: 'Elija la entrega o el corte que se aclara (solo uno).',
  });

export const adjustmentResponseSchema = z.object({ adjustment: adjustmentSchema });

export type MyCashbox = z.infer<typeof myCashboxSchema>;
export type OpeningBalance = z.infer<typeof openingBalanceSchema>;
export type OpeningBalanceRequest = z.infer<typeof openingBalanceRequestSchema>;
export type CashboxMovement = z.infer<typeof cashboxMovementSchema>;
export type CashboxMovementQuery = z.infer<typeof cashboxMovementQuerySchema>;
export type CashboxListItem = z.infer<typeof cashboxListResponseSchema>['cashboxes'][number];
export type Handover = z.infer<typeof handoverSchema>;
export type HandoverListQuery = z.infer<typeof handoverListQuerySchema>;
export type PrepareHandoverRequest = z.infer<typeof prepareHandoverRequestSchema>;
export type Adjustment = z.infer<typeof adjustmentSchema>;
export type CreateAdjustmentRequest = z.infer<typeof createAdjustmentRequestSchema>;
