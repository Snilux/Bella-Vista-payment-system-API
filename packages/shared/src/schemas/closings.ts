import { z } from 'zod';
import { cashboxRefSchema } from './billing.js';
import { optionalText, page, paginationQuerySchema, periodSchema } from './common.js';

// Cashbox closings (/v1/closings; CU-22, RF-COR; D-08, D-14). The figures are computed by
// v_closing from the movements; a closed monthly closing locks its month.

export const CLOSING_TYPES = ['monthly', 'extraordinary'] as const;
export const CLOSING_STATUSES = ['draft', 'counted', 'reviewed', 'closed'] as const;

const accountRef = z.object({ userAccountId: z.int(), username: z.string() });

export const closingFiguresSchema = z.object({
  /** Balance before date_from. */
  startingBalance: z.int(),
  openingBalances: z.int(),
  payments: z.int(),
  /** Negative. */
  cancellations: z.int(),
  /** Negative: cash handed over to the committee cashbox. */
  handoversOut: z.int(),
  handoversIn: z.int(),
  incomes: z.int(),
  /** Negative. */
  expenses: z.int(),
  refunds: z.int(),
  adjustments: z.int(),
  expectedBalance: z.int(),
});

export const closingSchema = z.object({
  id: z.int(),
  folio: z.string(),
  cashbox: cashboxRefSchema.extend({ id: z.int() }),
  type: z.enum(CLOSING_TYPES),
  dateFrom: z.iso.date(),
  dateTo: z.iso.date(),
  status: z.enum(CLOSING_STATUSES),
  figures: closingFiguresSchema,
  countedCash: z.int().nullable(),
  /** counted - expected (negative = shortfall); null until counted. */
  difference: z.int().nullable(),
  notes: z.string().nullable(),
  /** fullName: the person of the account (R-04 "Preparó María López"). */
  preparedBy: accountRef.extend({ fullName: z.string() }),
  reviewedBy: accountRef.extend({ fullName: z.string() }).nullable(),
  reviewedAt: z.iso.datetime().nullable(),
  closedBy: accountRef.extend({ fullName: z.string() }).nullable(),
  closedAt: z.iso.datetime().nullable(),
});

export const closingListQuerySchema = paginationQuerySchema.extend({
  cashboxId: z.coerce.number().int().positive().optional(),
  /** Closings that cover any day of this month. */
  period: periodSchema.optional(),
  status: z.enum(CLOSING_STATUSES).optional(),
});

export const closingPageSchema = page(closingSchema);
export const closingResponseSchema = z.object({ closing: closingSchema });

export const openClosingRequestSchema = z
  .object({
    type: z.enum(CLOSING_TYPES, { error: 'Indique si el corte es mensual o extraordinario.' }),
    /** The custodian's cashbox when omitted (the committee one for the treasurer). */
    cashboxId: z.int().positive().optional(),
    /** Month of a monthly closing (already finished). */
    period: periodSchema.optional(),
  })
  .refine((body) => body.type !== 'monthly' || body.period !== undefined, {
    path: ['period'],
    error: 'Indique el mes del corte.',
  });

export const countClosingRequestSchema = z.object({
  countedCash: z
    .int({ error: 'El efectivo contado debe ser un número entero de centavos.' })
    .min(0, { error: 'El efectivo contado no puede ser negativo.' }),
  /** Required when the counted cash differs from the expected balance. */
  notes: optionalText(1000),
});

export type ClosingFigures = z.infer<typeof closingFiguresSchema>;
export type Closing = z.infer<typeof closingSchema>;
export type ClosingListQuery = z.infer<typeof closingListQuerySchema>;
export type OpenClosingRequest = z.infer<typeof openClosingRequestSchema>;
export type CountClosingRequest = z.infer<typeof countClosingRequestSchema>;
