import { z } from 'zod';
import { periodSchema } from './common.js';

// Report data (/v1/reports; CU-23, CU-24, RF-REP). JSON only: the app builds the HTML and the
// PDF on the phone. Amounts in integer cents. Money figures are filtered by the month range;
// debts are computed at the moment of the query (D-25).

export const reportQuerySchema = z
  .object({
    /** First month (AAAA-MM); the current month when omitted. */
    from: periodSchema.optional(),
    /** Last month (AAAA-MM); `from` (or the current month) when omitted. */
    to: periodSchema.optional(),
  })
  .refine((q) => q.from === undefined || q.to === undefined || q.from <= q.to, {
    path: ['to'],
    error: 'El mes final no puede ser anterior al inicial.',
  });

export const blockReportQuerySchema = reportQuerySchema.and(
  z.object({ blockId: z.coerce.number().int().positive() }),
);

const rangeSchema = z.object({
  from: periodSchema,
  to: periodSchema,
  /** Calendar dates of the range. */
  dateFrom: z.iso.date(),
  dateTo: z.iso.date(),
  /** When the debts were computed. */
  debtAsOf: z.iso.datetime(),
});

const debtSchema = z.object({
  totalDue: z.int(),
  overdueCount: z.int(),
  inDebtCycle: z.boolean(),
});

// --- Block registry report (RF-REP-01) ------------------------------------------------------

export const blockReportUnitSchema = z.object({
  id: z.int(),
  folio: z.string(),
  reference: z.string().nullable(),
  holder: z.object({ fullName: z.string(), distinguishingNote: z.string().nullable() }).nullable(),
  registeredOn: z.iso.date(),
  activatedOn: z.iso.date().nullable(),
  status: z.enum(['pending_activation', 'active', 'suspended', 'deactivated']),
  /** Payments of the unit in the range (any cashbox). */
  payments: z.array(
    z.object({
      id: z.int(),
      folio: z.string(),
      occurredAt: z.iso.datetime(),
      total: z.int(),
      paperFolio: z.string().nullable(),
      cancelled: z.boolean(),
    }),
  ),
  /** Months owed today: pending and overdue, with base, surcharge and total. */
  debtMonths: z.array(
    z.object({
      period: periodSchema,
      status: z.enum(['pending', 'overdue']),
      baseAmount: z.int().nullable(),
      surcharge: z.int().nullable(),
      total: z.int().nullable(),
    }),
  ),
  debt: debtSchema,
  /** Months paid in advance. */
  advances: z.array(periodSchema),
});

export const blockReportSchema = z.object({
  range: rangeSchema,
  block: z.object({
    id: z.int(),
    code: z.string(),
    name: z.string().nullable(),
    section: z.object({ id: z.int(), code: z.string(), name: z.string() }),
    leader: z.object({ fullName: z.string(), phone: z.string().nullable() }).nullable(),
  }),
  connections: z.array(
    z.object({
      id: z.int(),
      folio: z.string(),
      address: z.string(),
      status: z.enum(['active', 'suspended', 'deactivated']),
      units: z.array(blockReportUnitSchema),
    }),
  ),
  cashbox: z.object({
    id: z.int().nullable(),
    label: z.string(),
    /** Approved opening balance (D-18). */
    openingBalance: z.int().nullable(),
    /** Payments received in the range: monthly fees and extra charges. */
    collectedFees: z.int(),
    collectedCharges: z.int(),
    /** Cancellations approved in the range (negative). */
    cancellations: z.int(),
    /** collectedFees + collectedCharges + cancellations: same figure as the closings. */
    collected: z.int(),
    /** Confirmed handovers in the range: the amount received by the treasurer. */
    handedOver: z.int(),
    /** Declared in handovers pending confirmation (now). */
    pendingHandover: z.int(),
    /** Expected balance now. */
    expectedBalance: z.int(),
    lastClosing: z
      .object({
        id: z.int(),
        folio: z.string(),
        type: z.enum(['monthly', 'extraordinary']),
        dateFrom: z.iso.date(),
        dateTo: z.iso.date(),
        status: z.enum(['draft', 'counted', 'reviewed', 'closed']),
        difference: z.int().nullable(),
      })
      .nullable(),
  }),
  totals: z.object({
    activeUnits: z.int(),
    collected: z.int(),
    totalDue: z.int(),
    advances: z.int(),
  }),
});

export const blockReportResponseSchema = z.object({ report: blockReportSchema });

// --- Community report (RF-REP-02) -----------------------------------------------------------

const blockFiguresSchema = z.object({
  activeUnits: z.int(),
  /** Payments of the block's units (any cashbox) minus their cancellations, in the range. */
  collected: z.int(),
  totalDue: z.int(),
  advances: z.int(),
  /** Received by the treasurer from the block cashbox in the range. */
  handedOver: z.int(),
  /** Balance of the block cashbox now: cash with the leader. */
  cashWithLeader: z.int(),
});

export const communityReportSchema = z.object({
  range: rangeSchema,
  sections: z.array(
    z.object({
      id: z.int(),
      code: z.string(),
      name: z.string(),
      blocks: z.array(
        blockFiguresSchema.extend({
          id: z.int(),
          code: z.string(),
          leaderName: z.string().nullable(),
        }),
      ),
      totals: blockFiguresSchema,
    }),
  ),
  supportCashboxes: z.array(
    z.object({
      id: z.int(),
      label: z.string(),
      collected: z.int(),
      handedOver: z.int(),
      balance: z.int(),
    }),
  ),
  committee: z.object({
    cashboxId: z.int(),
    openingBalance: z.int(),
    /** Payments received directly by the treasurer, net of cancellations. */
    collected: z.int(),
    handoversReceived: z.int(),
    incomes: z.int(),
    /** Paid expenses by category (the plumber included), positive amounts. */
    expensesByCategory: z.array(
      z.object({ categoryId: z.int(), name: z.string(), amount: z.int() }),
    ),
    expenses: z.int(),
    refunds: z.int(),
    adjustments: z.int(),
    balance: z.int(),
  }),
  totals: z.object({
    collected: z.int(),
    cashWithLeaders: z.int(),
    cashInSupport: z.int(),
    committeeBalance: z.int(),
    /** Sum of the balances of every cashbox. */
    expectedCommunityFunds: z.int(),
    totalDue: z.int(),
    advances: z.int(),
    /** Sum of the differences of the closings counted in the range. */
    closingDifferences: z.int(),
  }),
});

export const communityReportResponseSchema = z.object({ report: communityReportSchema });

export type ReportQuery = z.infer<typeof reportQuerySchema>;
export type BlockReportQuery = z.infer<typeof blockReportQuerySchema>;
export type BlockReport = z.infer<typeof blockReportSchema>;
export type CommunityReport = z.infer<typeof communityReportSchema>;
