import { z } from 'zod';
import { periodSchema } from './common.js';

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
