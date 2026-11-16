import {
  type AccountStatement,
  type AccountStatementInput,
  isSuspended,
} from './account-statement.js';
import { addMonths, comparePeriods, isPeriod, type Period } from './periods.js';
import { rateForPeriod } from './rates.js';

// Payment order (D-03, D-05, RF-PAG-02): whole months only, in chronological order from the
// oldest unpaid one, without gaps. Future months (advances) only when nothing is left unpaid
// or in the same operation that settles it, priced with the rate approved for their own month
// and without surcharge. Used by the payment preview and registration (API step 6).

/** Upper bound of advance months a single payment may cover. */
export const MAX_ADVANCE_MONTHS = 24;

export type PaymentSelectionIssueCode =
  | 'EMPTY_SELECTION'
  | 'INVALID_PERIOD'
  | 'DUPLICATE_PERIOD'
  | 'PERIOD_ALREADY_PAID'
  | 'PERIOD_NOT_BILLABLE'
  | 'MONTH_ORDER'
  | 'RATE_MISSING';

export interface PaymentSelectionIssue {
  code: PaymentSelectionIssueCode;
  period: Period | null;
}

export interface PricedMonth {
  period: Period;
  kind: 'overdue' | 'pending' | 'advance';
  rateId: number;
  baseAmount: number;
  surcharge: number;
  withSurcharge: boolean;
  total: number;
}

/**
 * Problems of a selection of months to pay, in the order a person would fix them (empty when
 * valid). `statement` must be computed from the same `input`.
 */
export function validatePaymentSelection(
  input: AccountStatementInput,
  statement: AccountStatement,
  selected: readonly Period[],
): PaymentSelectionIssue[] {
  if (selected.length === 0) return [{ code: 'EMPTY_SELECTION', period: null }];
  const invalid = selected.filter((p) => !isPeriod(p));
  if (invalid.length > 0) return invalid.map((period) => ({ code: 'INVALID_PERIOD', period }));
  if (new Set(selected).size !== selected.length) {
    const seen = new Set<Period>();
    const duplicated: Period[] = [];
    for (const period of selected) {
      if (seen.has(period)) duplicated.push(period);
      seen.add(period);
    }
    return duplicated.map((period) => ({ code: 'DUPLICATE_PERIOD', period }));
  }

  const issues: PaymentSelectionIssue[] = [];
  const sorted = [...selected].sort(comparePeriods);
  const paid = new Set(
    statement.months
      .filter((m) => m.status === 'paid' || m.status === 'advance')
      .map((m) => m.period),
  );
  for (const period of sorted) {
    if (paid.has(period)) issues.push({ code: 'PERIOD_ALREADY_PAID', period });
  }
  if (issues.length > 0) return issues;

  const current = statement.currentPeriod;
  const unpaid = statement.months
    .filter((m) => m.status === 'overdue' || m.status === 'pending')
    .map((m) => m.period);
  const dueSelected = sorted.filter((p) => comparePeriods(p, current) <= 0);
  const advances = sorted.filter((p) => comparePeriods(p, current) > 0);

  // Months up to the current one must be billable and a prefix of the unpaid ones.
  for (const period of dueSelected) {
    if (!unpaid.includes(period)) issues.push({ code: 'PERIOD_NOT_BILLABLE', period });
  }
  if (issues.length > 0) return issues;
  dueSelected.forEach((period, index) => {
    if (unpaid[index] !== period) issues.push({ code: 'MONTH_ORDER', period });
  });
  if (issues.length > 0) return issues;

  // Advances: only once everything unpaid is selected, consecutive billable months after the
  // current one (suspended months are skipped), and within the billing range.
  if (advances.length > 0) {
    if (dueSelected.length !== unpaid.length) {
      return advances.map((period) => ({ code: 'MONTH_ORDER', period }));
    }
    const expected = nextAdvancePeriods(input, current, paid, advances.length);
    advances.forEach((period, index) => {
      const wanted = expected[index];
      if (wanted === undefined) issues.push({ code: 'PERIOD_NOT_BILLABLE', period });
      else if (wanted !== period) {
        issues.push({
          code: isBillableFuture(input, period) ? 'MONTH_ORDER' : 'PERIOD_NOT_BILLABLE',
          period,
        });
      }
    });
    if (issues.length > 0) return issues;
  }

  for (const period of sorted) {
    const month = statement.months.find((m) => m.period === period);
    const hasRate = month ? month.rateId !== null : rateForPeriod(input.rates, period) !== null;
    if (!hasRate) issues.push({ code: 'RATE_MISSING', period });
  }
  return issues;
}

function isBillableFuture(input: AccountStatementInput, period: Period): boolean {
  if (input.billingStartPeriod === null) return false;
  if (comparePeriods(period, input.billingStartPeriod) < 0) return false;
  if (input.lastBillablePeriod && comparePeriods(period, input.lastBillablePeriod) > 0)
    return false;
  return !isSuspended(input.suspensions, period);
}

/** The next `count` billable, unpaid months after the current one (suspended months skipped). */
function nextAdvancePeriods(
  input: AccountStatementInput,
  current: Period,
  paid: Set<Period>,
  count: number,
): Period[] {
  const result: Period[] = [];
  let period = current;
  for (let step = 0; step < MAX_ADVANCE_MONTHS && result.length < count; step++) {
    period = addMonths(period, 1);
    if (input.lastBillablePeriod && comparePeriods(period, input.lastBillablePeriod) > 0) break;
    if (paid.has(period)) continue;
    // A suspended month generates nothing (D-06): advances skip it.
    if (!isBillableFuture(input, period)) continue;
    result.push(period);
  }
  return result;
}

/**
 * Prices a valid selection: overdue months carry the surcharge when the debt cycle is open
 * (D-02); the pending month and advances never do; advances use the rate of their own month
 * (D-05). Call validatePaymentSelection first.
 */
export function priceSelection(
  input: AccountStatementInput,
  statement: AccountStatement,
  selected: readonly Period[],
): { months: PricedMonth[]; total: number } {
  const months = [...selected].sort(comparePeriods).map((period): PricedMonth => {
    const month = statement.months.find((m) => m.period === period);
    if (month && month.status !== 'paid' && month.status !== 'advance') {
      if (month.rateId === null || month.baseAmount === null || month.surcharge === null) {
        throw new RangeError(`period ${period} has no rate`);
      }
      return {
        period,
        kind: month.status,
        rateId: month.rateId,
        baseAmount: month.baseAmount,
        surcharge: month.surcharge,
        withSurcharge: month.surcharge > 0,
        total: month.baseAmount + month.surcharge,
      };
    }
    const rate = rateForPeriod(input.rates, period);
    if (!rate) throw new RangeError(`period ${period} has no rate`);
    return {
      period,
      kind: 'advance',
      rateId: rate.id,
      baseAmount: rate.amount,
      surcharge: 0,
      withSurcharge: false,
      total: rate.amount,
    };
  });
  return { months, total: months.reduce((sum, m) => sum + m.total, 0) };
}
