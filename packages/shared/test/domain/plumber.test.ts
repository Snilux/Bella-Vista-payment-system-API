import { describe, expect, it } from 'vitest';
import { plumberPayPeriod, type SalaryFrequency } from '../../src/domain/plumber.js';

// Pay periods of the plumber (D-24): weekly Monday to Sunday, biweekly 1-15 / 16-end,
// monthly the calendar month.

describe('plumberPayPeriod', () => {
  it.each<[SalaryFrequency, string, string, string]>([
    ['weekly', '2026-11-16', '2026-11-16', '2026-11-22'], // Monday
    ['weekly', '2026-11-22', '2026-11-16', '2026-11-22'], // Sunday
    ['weekly', '2026-11-19', '2026-11-16', '2026-11-22'],
    ['weekly', '2026-12-02', '2026-11-30', '2026-12-06'], // crosses months
    ['weekly', '2027-01-01', '2026-12-28', '2027-01-03'], // crosses years
    ['biweekly', '2026-11-01', '2026-11-01', '2026-11-15'],
    ['biweekly', '2026-11-15', '2026-11-01', '2026-11-15'],
    ['biweekly', '2026-11-16', '2026-11-16', '2026-11-30'],
    ['biweekly', '2028-02-20', '2028-02-16', '2028-02-29'], // leap year
    ['biweekly', '2026-02-20', '2026-02-16', '2026-02-28'],
    ['monthly', '2026-11-16', '2026-11-01', '2026-11-30'],
    ['monthly', '2026-12-31', '2026-12-01', '2026-12-31'],
    ['monthly', '2028-02-01', '2028-02-01', '2028-02-29'],
  ])('%s on %s → %s to %s', (frequency, date, start, end) => {
    expect(plumberPayPeriod(frequency, date)).toEqual({ start, end });
  });

  it.each(['2026-02-30', '2026-13-01', '26-11-16'])('rejects the invalid date %s', (date) => {
    expect(() => plumberPayPeriod('monthly', date)).toThrow(RangeError);
  });
});
