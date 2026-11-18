import { isSuspended, type SuspensionInput } from './account-statement.js';
import { addMonths, comparePeriods, type Period } from './periods.js';
import { type RateInput, rateForPeriod } from './rates.js';

// Selección cronológica de meses (F-02; D-03, D-05; 3.2 §11.2 "Lista de meses"). The screen
// only paints what these functions say:
// - the selection is always a chronological prefix: marking a month marks the earlier ones and
//   unmarking one removes the later ones (no gaps, from the oldest unpaid month);
// - the advance months ("Adelantar meses") can be marked only once every overdue and pending
//   month is marked;
// - which month is overdue and how much surcharge it carries comes from the statement (the API,
//   or computeAccountStatement); advances are priced with the rate approved for their own month
//   and never carry surcharge (D-05).

export type SelectableKind = 'overdue' | 'pending' | 'advance';

export interface SelectableMonth {
  period: Period;
  kind: SelectableKind;
  baseAmount: number;
  surcharge: number;
  total: number;
}

/** The part of an account statement this needs (the API's or computeAccountStatement's). */
export interface StatementForSelection {
  currentPeriod: Period;
  months: readonly {
    period: Period;
    status: 'pending' | 'overdue' | 'paid' | 'advance';
    baseAmount: number | null;
    surcharge: number | null;
    total: number | null;
  }[];
}

export interface SelectableMonths {
  /** Overdue and pending months that can be paid, oldest first, then the advance months. */
  months: SelectableMonth[];
  /**
   * Unpaid months without an approved rate: they cannot be priced, so neither they nor any
   * later month can be paid until the rate exists (D-03, no gaps).
   */
  blockedFrom: Period | null;
}

/**
 * What F-02 offers: the unpaid months of the statement up to the first one without a price,
 * then up to `advanceCount` future months after the last covered one, priced with `rates`.
 * Advances are offered only when no unpaid month is blocked, and never for a suspended month
 * (D-06: it generates no fee, so it cannot be paid).
 */
export function selectableMonths(
  statement: StatementForSelection,
  options: {
    rates: readonly RateInput[];
    advanceCount: number;
    /** Suspensions of the unit and of its connection. */
    suspensions?: readonly SuspensionInput[];
  },
): SelectableMonths {
  const { rates, advanceCount, suspensions = [] } = options;
  const unpaid = statement.months
    .filter((month) => month.status === 'overdue' || month.status === 'pending')
    .sort((a, b) => comparePeriods(a.period, b.period));
  const months: SelectableMonth[] = [];
  for (const month of unpaid) {
    if (month.total === null || month.baseAmount === null) {
      return { months, blockedFrom: month.period };
    }
    months.push({
      period: month.period,
      kind: month.status === 'overdue' ? 'overdue' : 'pending',
      baseAmount: month.baseAmount,
      surcharge: month.surcharge ?? 0,
      total: month.total,
    });
  }

  // Advances start after the current month and after the last month already covered.
  const covered = statement.months
    .filter((month) => month.status === 'paid' || month.status === 'advance')
    .map((month) => month.period)
    .sort(comparePeriods);
  const last = covered.at(-1);
  let period = addMonths(
    last && comparePeriods(last, statement.currentPeriod) > 0 ? last : statement.currentPeriod,
    1,
  );
  // Bounded: a long suspension ahead cannot make this loop forever.
  for (let added = 0, tries = 0; added < advanceCount && tries < 120; tries += 1) {
    const current = period;
    period = addMonths(period, 1);
    if (isSuspended(suspensions, current)) continue;
    const rate = rateForPeriod(rates, current);
    if (!rate) break;
    added += 1;
    months.push({
      period: current,
      kind: 'advance',
      baseAmount: rate.amount,
      surcharge: 0,
      total: rate.amount,
    });
  }
  return { months, blockedFrom: null };
}

const isSelected = (selected: readonly Period[], period: Period) => selected.includes(period);

/** True when every overdue and pending month is marked: only then can months be advanced. */
export function canAdvance(
  months: readonly SelectableMonth[],
  selected: readonly Period[],
): boolean {
  return months
    .filter((month) => month.kind !== 'advance')
    .every((month) => isSelected(selected, month.period));
}

/**
 * The selection after touching `period`: unmarking it keeps only the earlier marked months;
 * marking it marks every month up to it. An advance month cannot be marked while an overdue or
 * pending month is unmarked (the selection does not change).
 */
export function toggleMonth(
  months: readonly SelectableMonth[],
  selected: readonly Period[],
  period: Period,
): Period[] {
  const index = months.findIndex((month) => month.period === period);
  if (index < 0) return [...selected];
  if (isSelected(selected, period)) {
    return months.slice(0, index).map((month) => month.period);
  }
  const target = months[index];
  if (target?.kind === 'advance' && !canAdvance(months, selected)) return [...selected];
  return months.slice(0, index + 1).map((month) => month.period);
}

/** The total of the marked months, in cents. */
export function selectionTotal(months: readonly SelectableMonth[], selected: readonly Period[]) {
  return months
    .filter((month) => isSelected(selected, month.period))
    .reduce((sum, month) => sum + month.total, 0);
}
