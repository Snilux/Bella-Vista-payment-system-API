import { describe, expect, it } from 'vitest';
import {
  type AccountStatement,
  type AccountStatementInput,
  type CoveredMonthInput,
  computeAccountStatement,
} from '../../src/domain/account-statement.js';
import { periodRange } from '../../src/domain/periods.js';

// Table tests of the account statement (2.1 §5.2; D-01, D-02, D-05, D-06, D-25; RF-MEN).
// "Now" is noon in Mexico City; amounts in cents. Rates: $40.00 from 2025-01, $50.00 from
// 2026-01 (ids 1 and 2).

const RATES = [
  { id: 1, effectivePeriod: '2025-01', amount: 4_000 },
  { id: 2, effectivePeriod: '2026-01', amount: 5_000 },
];

const at = (day: string) => new Date(`${day}T18:00:00Z`);

/** Months covered by one payment made on `day`, at `base` with or without surcharge. */
const paid = (
  periods: string[],
  day: string,
  options: { base?: number; rateId?: number; withSurcharge?: boolean; paymentId?: number } = {},
): CoveredMonthInput[] =>
  periods.map((period) => ({
    period,
    paymentId: options.paymentId ?? 1,
    paidAt: at(day),
    rateId: options.rateId ?? 2,
    baseAmount: options.base ?? 5_000,
    withSurcharge: options.withSurcharge ?? false,
  }));

const input = (values: Partial<AccountStatementInput> & { now: Date }): AccountStatementInput => ({
  billingStartPeriod: '2026-01',
  lastBillablePeriod: null,
  rates: RATES,
  suspensions: [],
  coveredMonths: [],
  ...values,
});

/** One line per month: "period status base+surcharge". */
const lines = (statement: AccountStatement) =>
  statement.months.map((m) => `${m.period} ${m.status} ${m.baseAmount}+${m.surcharge}`);

interface Case {
  name: string;
  input: AccountStatementInput;
  lines: string[];
  summary?: Partial<AccountStatement['summary']>;
  missingRatePeriods?: string[];
}

const cases: Case[] = [
  // --- D-01: pending vs overdue ----------------------------------------------------------------
  {
    name: 'the month in course is pending',
    input: input({ now: at('2026-06-15'), billingStartPeriod: '2026-06' }),
    lines: ['2026-06 pending 5000+0'],
    summary: { overdueCount: 0, pendingCount: 1, totalDue: 5_000, inDebtCycle: false },
  },
  {
    name: 'ended months are overdue',
    input: input({ now: at('2026-06-15'), billingStartPeriod: '2026-05' }),
    lines: ['2026-05 overdue 5000+0', '2026-06 pending 5000+0'],
    summary: { overdueCount: 1, pendingTotal: 5_000, overdueTotal: 5_000, totalDue: 10_000 },
  },
  {
    name: 'at 23:59 of the last day the month is still pending (Mexico City time)',
    input: input({ now: new Date('2026-07-01T05:59:00Z'), billingStartPeriod: '2026-06' }),
    lines: ['2026-06 pending 5000+0'],
  },
  {
    name: 'at 00:00 of the next month it becomes overdue',
    input: input({ now: new Date('2026-07-01T06:00:00Z'), billingStartPeriod: '2026-06' }),
    lines: ['2026-06 overdue 5000+0', '2026-07 pending 5000+0'],
  },

  // --- Surcharge (RF-MEN-05) --------------------------------------------------------------------
  {
    name: 'three overdue months carry no surcharge',
    input: input({ now: at('2026-06-15'), billingStartPeriod: '2026-03' }),
    lines: [
      '2026-03 overdue 5000+0',
      '2026-04 overdue 5000+0',
      '2026-05 overdue 5000+0',
      '2026-06 pending 5000+0',
    ],
    summary: { overdueCount: 3, inDebtCycle: false, surchargeTotal: 0, totalDue: 20_000 },
  },
  {
    name: 'from the fourth overdue month every overdue month carries the surcharge, not the pending one',
    input: input({ now: at('2026-06-15'), billingStartPeriod: '2026-02' }),
    lines: [
      '2026-02 overdue 5000+5000',
      '2026-03 overdue 5000+5000',
      '2026-04 overdue 5000+5000',
      '2026-05 overdue 5000+5000',
      '2026-06 pending 5000+0',
    ],
    summary: {
      overdueCount: 4,
      inDebtCycle: true,
      surchargeTotal: 20_000,
      overdueTotal: 40_000,
      totalDue: 45_000,
    },
  },

  // --- D-02: partial payment and end of the cycle ------------------------------------------------
  {
    name: 'D-02: paying the oldest months keeps the surcharge on the remaining ones',
    input: input({
      now: at('2026-06-15'),
      billingStartPeriod: '2026-01',
      coveredMonths: paid(['2026-01', '2026-02'], '2026-06-10', { withSurcharge: true }),
    }),
    lines: [
      '2026-01 paid 5000+5000',
      '2026-02 paid 5000+5000',
      '2026-03 overdue 5000+5000',
      '2026-04 overdue 5000+5000',
      '2026-05 overdue 5000+5000',
      '2026-06 pending 5000+0',
    ],
    summary: { overdueCount: 3, inDebtCycle: true, totalDue: 35_000 },
  },
  {
    name: 'D-02: the cycle survives while one overdue month is left, even if it drops to one',
    input: input({
      now: at('2026-06-15'),
      billingStartPeriod: '2026-01',
      // On 2026-05-20 there were 4 overdue (01-04); paying 01-03 left 04 overdue.
      coveredMonths: paid(['2026-01', '2026-02', '2026-03'], '2026-05-20', { withSurcharge: true }),
    }),
    lines: [
      '2026-01 paid 5000+5000',
      '2026-02 paid 5000+5000',
      '2026-03 paid 5000+5000',
      '2026-04 overdue 5000+5000',
      '2026-05 overdue 5000+5000',
      '2026-06 pending 5000+0',
    ],
    summary: { overdueCount: 2, inDebtCycle: true, surchargeTotal: 10_000 },
  },
  {
    name: 'the cycle ends when no overdue month is left',
    input: input({
      now: at('2026-06-15'),
      billingStartPeriod: '2026-01',
      coveredMonths: paid(['2026-01', '2026-02', '2026-03', '2026-04', '2026-05'], '2026-06-10', {
        withSurcharge: true,
      }),
    }),
    lines: [
      '2026-01 paid 5000+5000',
      '2026-02 paid 5000+5000',
      '2026-03 paid 5000+5000',
      '2026-04 paid 5000+5000',
      '2026-05 paid 5000+5000',
      '2026-06 pending 5000+0',
    ],
    summary: { overdueCount: 0, inDebtCycle: false, totalDue: 5_000 },
  },
  {
    name: 'after a cycle ends, three new overdue months carry no surcharge',
    input: input({
      now: at('2026-09-15'),
      billingStartPeriod: '2026-01',
      coveredMonths: paid(['2026-01', '2026-02', '2026-03', '2026-04', '2026-05'], '2026-06-10', {
        withSurcharge: true,
      }),
    }),
    lines: [
      ...['01', '02', '03', '04', '05'].map((m) => `2026-${m} paid 5000+5000`),
      '2026-06 overdue 5000+0',
      '2026-07 overdue 5000+0',
      '2026-08 overdue 5000+0',
      '2026-09 pending 5000+0',
    ],
    summary: { overdueCount: 3, inDebtCycle: false },
  },
  {
    name: 'a new cycle needs four overdue months again',
    input: input({
      now: at('2026-10-15'),
      billingStartPeriod: '2026-01',
      coveredMonths: paid(['2026-01', '2026-02', '2026-03', '2026-04', '2026-05'], '2026-06-10', {
        withSurcharge: true,
      }),
    }),
    lines: [
      ...['01', '02', '03', '04', '05'].map((m) => `2026-${m} paid 5000+5000`),
      ...['06', '07', '08', '09'].map((m) => `2026-${m} overdue 5000+5000`),
      '2026-10 pending 5000+0',
    ],
    summary: { overdueCount: 4, inDebtCycle: true },
  },
  {
    name: 'a payment made before the fourth month ended prevents the cycle',
    input: input({
      now: at('2026-06-15'),
      billingStartPeriod: '2026-01',
      // Paid 01-03 on 2026-04-20, when only 3 were overdue; 04 and 05 are overdue now.
      coveredMonths: paid(['2026-01', '2026-02', '2026-03'], '2026-04-20'),
    }),
    lines: [
      '2026-01 paid 5000+0',
      '2026-02 paid 5000+0',
      '2026-03 paid 5000+0',
      '2026-04 overdue 5000+0',
      '2026-05 overdue 5000+0',
      '2026-06 pending 5000+0',
    ],
    summary: { inDebtCycle: false },
  },
  {
    name: 'a cancelled payment leaves no trace: its months are unpaid and the cycle stays open',
    // The payment of 01-05 on 2026-06-10 was cancelled: its covered months were deleted.
    input: input({ now: at('2026-06-15'), billingStartPeriod: '2026-01' }),
    lines: [
      ...['01', '02', '03', '04', '05'].map((m) => `2026-${m} overdue 5000+5000`),
      '2026-06 pending 5000+0',
    ],
    summary: { overdueCount: 5, inDebtCycle: true },
  },

  // --- Rate changes (D-05, RF-MEN-03) ------------------------------------------------------------
  {
    name: 'each overdue month uses the rate in force in its own month, across a rate change',
    input: input({ now: at('2026-02-15'), billingStartPeriod: '2025-10' }),
    lines: [
      '2025-10 overdue 4000+4000',
      '2025-11 overdue 4000+4000',
      '2025-12 overdue 4000+4000',
      '2026-01 overdue 5000+5000',
      '2026-02 pending 5000+0',
    ],
    summary: { overdueTotal: 34_000, totalDue: 39_000 },
  },
  {
    name: 'paid months keep their frozen rate and surcharge (D-25)',
    input: input({
      now: at('2026-03-15'),
      billingStartPeriod: '2026-01',
      coveredMonths: paid(['2026-01'], '2026-01-10', {
        base: 4_500,
        rateId: 9,
        withSurcharge: true,
      }),
    }),
    lines: ['2026-01 paid 4500+4500', '2026-02 overdue 5000+0', '2026-03 pending 5000+0'],
  },

  // --- Suspensions (D-06) ------------------------------------------------------------------------
  {
    name: 'months suspended for the connection or the unit generate nothing',
    input: input({
      now: at('2026-06-15'),
      billingStartPeriod: '2026-01',
      suspensions: [
        { from: '2026-02', to: '2026-03' }, // connection
        { from: '2026-05', to: null }, // unit, still suspended
      ],
    }),
    lines: ['2026-01 overdue 5000+0', '2026-04 overdue 5000+0'],
    summary: { overdueCount: 2, pendingCount: 0, totalDue: 10_000 },
  },
  {
    name: 'suspended months do not count towards the debt cycle',
    input: input({
      now: at('2026-06-15'),
      billingStartPeriod: '2026-01',
      suspensions: [{ from: '2026-02', to: '2026-03' }],
    }),
    lines: [
      '2026-01 overdue 5000+0',
      '2026-04 overdue 5000+0',
      '2026-05 overdue 5000+0',
      '2026-06 pending 5000+0',
    ],
    summary: { overdueCount: 3, inDebtCycle: false },
  },

  // --- Advances (D-05) ---------------------------------------------------------------------------
  {
    name: 'advances show with the rate of their own month',
    input: input({
      now: at('2026-06-15'),
      billingStartPeriod: '2026-05',
      rates: [...RATES, { id: 3, effectivePeriod: '2026-08', amount: 6_000 }],
      coveredMonths: [
        ...paid(['2026-05', '2026-06', '2026-07'], '2026-05-10'),
        ...paid(['2026-08'], '2026-05-10', { base: 6_000, rateId: 3 }),
      ],
    }),
    lines: [
      '2026-05 paid 5000+0',
      '2026-06 paid 5000+0',
      '2026-07 advance 5000+0',
      '2026-08 advance 6000+0',
    ],
    summary: { advanceCount: 2, totalDue: 0, pendingCount: 0 },
  },

  // --- Start, end and missing data ---------------------------------------------------------------
  {
    name: 'a unit activated in the middle of the month pays that month in full (RF-MEN-02)',
    input: input({ now: at('2026-06-25'), billingStartPeriod: '2026-06' }),
    lines: ['2026-06 pending 5000+0'],
    summary: { totalDue: 5_000 },
  },
  {
    name: 'a deactivated unit is billed up to its deactivation month, inclusive',
    input: input({
      now: at('2026-06-15'),
      billingStartPeriod: '2026-01',
      lastBillablePeriod: '2026-03',
    }),
    lines: ['2026-01 overdue 5000+0', '2026-02 overdue 5000+0', '2026-03 overdue 5000+0'],
    summary: { overdueCount: 3, pendingCount: 0 },
  },
  {
    name: 'a unit deactivated in the month in course still has that month pending',
    input: input({
      now: at('2026-06-15'),
      billingStartPeriod: '2026-06',
      lastBillablePeriod: '2026-06',
    }),
    lines: ['2026-06 pending 5000+0'],
  },
  {
    name: 'a unit pending activation has no months',
    input: input({ now: at('2026-06-15'), billingStartPeriod: null }),
    lines: [],
    summary: { totalDue: 0, overdueCount: 0, pendingCount: 0, inDebtCycle: false },
  },
  {
    name: 'months without an approved rate are listed, counted as overdue and not priced',
    input: input({
      now: at('2026-06-15'),
      billingStartPeriod: '2026-01',
      rates: [{ id: 5, effectivePeriod: '2026-03', amount: 5_000 }],
    }),
    lines: [
      '2026-01 overdue null+null',
      '2026-02 overdue null+null',
      '2026-03 overdue 5000+5000',
      '2026-04 overdue 5000+5000',
      '2026-05 overdue 5000+5000',
      '2026-06 pending 5000+0',
    ],
    summary: { overdueCount: 5, inDebtCycle: true, overdueTotal: 30_000, totalDue: 35_000 },
    missingRatePeriods: ['2026-01', '2026-02'],
  },
];

describe('computeAccountStatement', () => {
  it.each(cases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    const statement = computeAccountStatement(c.input);
    expect(lines(statement)).toEqual(c.lines);
    if (c.summary) expect(statement.summary).toMatchObject(c.summary);
    expect(statement.missingRatePeriods).toEqual(c.missingRatePeriods ?? []);
  });

  it('reports the current period and every total in integer cents', () => {
    const statement = computeAccountStatement(
      input({ now: at('2026-06-15'), billingStartPeriod: '2025-01' }),
    );
    expect(statement.currentPeriod).toBe('2026-06');
    expect(statement.months.map((m) => m.period)).toEqual(periodRange('2025-01', '2026-06'));
    for (const value of Object.values(statement.summary)) {
      if (typeof value === 'number') expect(Number.isInteger(value)).toBe(true);
    }
    // 12 months of 2025 at $80.00 + 5 of 2026 at $100.00 + June pending at $50.00.
    expect(statement.summary.totalDue).toBe(12 * 8_000 + 5 * 10_000 + 5_000);
  });

  it('ignores the order of its inputs', () => {
    const covered = paid(['2026-01', '2026-02'], '2026-06-10', { withSurcharge: true });
    const a = computeAccountStatement(input({ now: at('2026-06-15'), coveredMonths: covered }));
    const b = computeAccountStatement(
      input({
        now: at('2026-06-15'),
        coveredMonths: [...covered].reverse(),
        rates: [...RATES].reverse(),
      }),
    );
    expect(b).toEqual(a);
  });
});
