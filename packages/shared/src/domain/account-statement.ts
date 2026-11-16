import {
  BUSINESS_TIME_ZONE,
  comparePeriods,
  currentPeriod,
  minPeriod,
  type Period,
  periodOf,
  periodRange,
} from './periods.js';
import { type RateInput, rateForPeriod } from './rates.js';

// Account statement of a unit (2.1 §5.2; docs/decisiones.md "Cálculo del estado de cuenta";
// D-01, D-02, D-05, D-06, D-25). Nothing is stored: it is computed when queried from the
// billing start, suspensions, approved rates and covered months. Amounts are integer cents.
//
// Debt cycle (D-02, RF-MEN-05/06): it opens when the unit has 4 overdue months and closes only
// when it has none. Whether it is open now depends on history (paying 2 of 4 overdue months
// leaves the other 2 with surcharge), so it is rebuilt from the dates of the payments that
// cover each month. Cancelled payments do not exist here: their covered months are deleted.

export const DEBT_CYCLE_THRESHOLD = 4;

export interface SuspensionInput {
  /** First suspended month (AAAA-MM). */
  from: Period;
  /** Last suspended month, inclusive; null while it lasts. */
  to: Period | null;
}

/** A month covered by a payment, with the rate and surcharge frozen in it (D-25). */
export interface CoveredMonthInput {
  period: Period;
  paymentId: number;
  /** When the payment was made. */
  paidAt: Date;
  rateId: number;
  /** Base amount of the frozen rate, in cents. */
  baseAmount: number;
  withSurcharge: boolean;
}

export interface AccountStatementInput {
  now: Date;
  timeZone?: string;
  /** First billed month; null for a unit pending activation (no months at all). */
  billingStartPeriod: Period | null;
  /** Last billed month, inclusive: the month of the deactivation, billed in full. */
  lastBillablePeriod: Period | null;
  /** Approved rates. */
  rates: readonly RateInput[];
  /** Suspensions of the unit and of its connection (D-06). */
  suspensions: readonly SuspensionInput[];
  coveredMonths: readonly CoveredMonthInput[];
}

/**
 * pending: the month in course (D-01); overdue: an ended month not paid; paid: a covered month
 * up to the current one; advance: a covered month after the current one.
 */
export type StatementMonthStatus = 'pending' | 'overdue' | 'paid' | 'advance';

export interface StatementMonth {
  period: Period;
  status: StatementMonthStatus;
  /** Rate applied: frozen for covered months, in force for unpaid ones; null if none. */
  rateId: number | null;
  baseAmount: number | null;
  surcharge: number | null;
  total: number | null;
  /** Payment that covers the month (paid and advance only). */
  paymentId: number | null;
}

export interface StatementSummary {
  overdueCount: number;
  /** 1 when the month in course is billable and unpaid. */
  pendingCount: number;
  inDebtCycle: boolean;
  overdueTotal: number;
  pendingTotal: number;
  surchargeTotal: number;
  /** Everything owed today: overdue (with surcharge) plus the pending month. */
  totalDue: number;
  advanceCount: number;
}

export interface AccountStatement {
  currentPeriod: Period;
  months: StatementMonth[];
  summary: StatementSummary;
  /** Billable unpaid months without an approved rate: shown, not priced, not payable. */
  missingRatePeriods: Period[];
}

export function isSuspended(suspensions: readonly SuspensionInput[], period: Period): boolean {
  return suspensions.some(
    (s) =>
      comparePeriods(s.from, period) <= 0 && (s.to === null || comparePeriods(period, s.to) <= 0),
  );
}

/**
 * Billable months up to `until`: from the billing start to the last billable month, without
 * suspended months.
 */
export function billablePeriods(input: AccountStatementInput, until: Period): Period[] {
  if (input.billingStartPeriod === null) return [];
  const end = input.lastBillablePeriod ? minPeriod(until, input.lastBillablePeriod) : until;
  return periodRange(input.billingStartPeriod, end).filter(
    (period) => !isSuspended(input.suspensions, period),
  );
}

/**
 * Whether the debt cycle is open at `now`, replaying the history: at the start of each month
 * and after each payment, count the billable months that had ended and were not yet paid. The
 * cycle opens at 4 and closes only at 0.
 */
export function isDebtCycleOpen(input: AccountStatementInput): boolean {
  if (input.billingStartPeriod === null) return false;
  const timeZone = input.timeZone ?? BUSINESS_TIME_ZONE;
  const current = currentPeriod(input.now, timeZone);
  const billable = billablePeriods(input, current);
  const paidAt = new Map(input.coveredMonths.map((m) => [m.period, m.paidAt.getTime()]));
  const paymentTimes = [...new Set(input.coveredMonths.map((m) => m.paidAt.getTime()))]
    .filter((time) => time <= input.now.getTime())
    .sort((a, b) => a - b);

  /** Overdue count when the month in course is `month` and payments up to `time` exist. */
  const overdueAt = (month: Period, time: number) =>
    billable.filter((period) => {
      if (comparePeriods(period, month) >= 0) return false;
      const paid = paidAt.get(period);
      return paid === undefined || paid > time;
    }).length;

  let open = false;
  const update = (count: number) => {
    if (count === 0) open = false;
    else if (count >= DEBT_CYCLE_THRESHOLD) open = true;
  };
  for (const month of periodRange(input.billingStartPeriod, current)) {
    // Start of the month: payments made in earlier months count.
    const before = paymentTimes.filter(
      (t) => comparePeriods(periodOf(new Date(t), timeZone), month) < 0,
    );
    update(
      overdueAt(month, before.length > 0 ? (before.at(-1) as number) : Number.NEGATIVE_INFINITY),
    );
    // Each payment made during the month, in order.
    for (const time of paymentTimes) {
      if (periodOf(new Date(time), timeZone) === month) update(overdueAt(month, time));
    }
  }
  return open;
}

export function computeAccountStatement(input: AccountStatementInput): AccountStatement {
  const timeZone = input.timeZone ?? BUSINESS_TIME_ZONE;
  const current = currentPeriod(input.now, timeZone);
  const covered = new Map(input.coveredMonths.map((m) => [m.period, m]));
  const inDebtCycle = isDebtCycleOpen(input);

  const months: StatementMonth[] = [];
  const missingRatePeriods: Period[] = [];
  const periods = new Set([...billablePeriods(input, current), ...covered.keys()]);

  for (const period of [...periods].sort(comparePeriods)) {
    const paid = covered.get(period);
    if (paid) {
      const surcharge = paid.withSurcharge ? paid.baseAmount : 0;
      months.push({
        period,
        status: comparePeriods(period, current) > 0 ? 'advance' : 'paid',
        rateId: paid.rateId,
        baseAmount: paid.baseAmount,
        surcharge,
        total: paid.baseAmount + surcharge,
        paymentId: paid.paymentId,
      });
      continue;
    }
    const status: StatementMonthStatus = period === current ? 'pending' : 'overdue';
    const rate = rateForPeriod(input.rates, period);
    if (!rate) {
      missingRatePeriods.push(period);
      months.push({
        period,
        status,
        rateId: null,
        baseAmount: null,
        surcharge: null,
        total: null,
        paymentId: null,
      });
      continue;
    }
    // D-02 / RF-MEN-05: with the cycle open every overdue month carries a surcharge equal to
    // its base; the month in course never does.
    const surcharge = status === 'overdue' && inDebtCycle ? rate.amount : 0;
    months.push({
      period,
      status,
      rateId: rate.id,
      baseAmount: rate.amount,
      surcharge,
      total: rate.amount + surcharge,
      paymentId: null,
    });
  }

  const sum = (list: StatementMonth[], pick: (m: StatementMonth) => number | null) =>
    list.reduce((total, m) => total + (pick(m) ?? 0), 0);
  const overdue = months.filter((m) => m.status === 'overdue');
  const pending = months.filter((m) => m.status === 'pending');
  const overdueTotal = sum(overdue, (m) => m.total);
  const pendingTotal = sum(pending, (m) => m.total);
  return {
    currentPeriod: current,
    months,
    summary: {
      overdueCount: overdue.length,
      pendingCount: pending.length,
      inDebtCycle,
      overdueTotal,
      pendingTotal,
      surchargeTotal: sum(overdue, (m) => m.surcharge),
      totalDue: overdueTotal + pendingTotal,
      advanceCount: months.filter((m) => m.status === 'advance').length,
    },
    missingRatePeriods,
  };
}
