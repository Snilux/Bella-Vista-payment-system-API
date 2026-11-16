// Billing periods as text AAAA-MM (2.3). Calendar months are those of the business time zone
// (America/Mexico_City, RNF-INT-03): an instant belongs to the month it is in Mexico City,
// not in UTC. Pure functions; "now" always comes from the caller.

export type Period = string;

export const BUSINESS_TIME_ZONE = 'America/Mexico_City';

const PERIOD = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function isPeriod(value: string): boolean {
  return PERIOD.test(value);
}

function parts(period: Period): { year: number; month: number } {
  const match = PERIOD.exec(period);
  if (!match) throw new RangeError(`invalid period ${period}`);
  return { year: Number(match[1]), month: Number(match[2]) };
}

/** Period (AAAA-MM) an instant falls in, in the business time zone. */
export function periodOf(instant: Date, timeZone: string = BUSINESS_TIME_ZONE): Period {
  const formatted = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(instant);
  const year = formatted.find((p) => p.type === 'year')?.value;
  const month = formatted.find((p) => p.type === 'month')?.value;
  return `${year}-${month}`;
}

/** The month in course at `now` (D-01: its fee is pending, earlier ones are overdue). */
export const currentPeriod = periodOf;

/** Period of a calendar date (YYYY-MM-DD). */
export function periodOfDate(date: string): Period {
  const period = date.slice(0, 7);
  parts(period);
  return period;
}

export function addMonths(period: Period, months: number): Period {
  const { year, month } = parts(period);
  const index = year * 12 + (month - 1) + months;
  const nextYear = Math.floor(index / 12);
  const nextMonth = (index % 12) + 1;
  return `${String(nextYear).padStart(4, '0')}-${String(nextMonth).padStart(2, '0')}`;
}

/** Negative, zero or positive, like a sort comparator (AAAA-MM sorts as text). */
export function comparePeriods(a: Period, b: Period): number {
  parts(a);
  parts(b);
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Every period from `from` to `to`, both inclusive (empty when `from` is after `to`). */
export function periodRange(from: Period, to: Period): Period[] {
  const periods: Period[] = [];
  for (let p = from; comparePeriods(p, to) <= 0; p = addMonths(p, 1)) periods.push(p);
  return periods;
}

export function minPeriod(a: Period, b: Period): Period {
  return comparePeriods(a, b) <= 0 ? a : b;
}
