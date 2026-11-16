import { comparePeriods, type Period } from './periods.js';

// Monthly rate in force (D-05, D-20, RF-MEN-03): the approved rate with the latest effective
// period that is not after the month. Amounts are integer cents.

export interface RateInput {
  id: number;
  /** First month the rate applies to (AAAA-MM). */
  effectivePeriod: Period;
  /** Cents. */
  amount: number;
}

/** Approved rate in force in `period`, or null when none started yet. */
export function rateForPeriod(rates: readonly RateInput[], period: Period): RateInput | null {
  let best: RateInput | null = null;
  for (const rate of rates) {
    if (comparePeriods(rate.effectivePeriod, period) > 0) continue;
    if (best === null || comparePeriods(rate.effectivePeriod, best.effectivePeriod) > 0)
      best = rate;
  }
  return best;
}
