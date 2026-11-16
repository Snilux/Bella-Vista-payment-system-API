import { describe, expect, it } from 'vitest';
import {
  addMonths,
  comparePeriods,
  currentPeriod,
  isPeriod,
  periodOf,
  periodOfDate,
  periodRange,
} from '../../src/domain/periods.js';
import { rateForPeriod } from '../../src/domain/rates.js';

describe('periods', () => {
  it.each([
    // Mexico City is UTC-6 (no DST since 2022): the month changes at 06:00 UTC.
    ['2026-07-01T05:59:59Z', '2026-06'],
    ['2026-07-01T06:00:00Z', '2026-07'],
    ['2026-01-01T05:00:00Z', '2025-12'],
    ['2026-11-16T18:00:00Z', '2026-11'],
  ])('the instant %s is in %s in Mexico City', (instant, period) => {
    expect(currentPeriod(new Date(instant))).toBe(period);
    expect(periodOf(new Date(instant), 'America/Mexico_City')).toBe(period);
  });

  it('uses the time zone it is given', () => {
    expect(periodOf(new Date('2026-07-01T05:59:59Z'), 'UTC')).toBe('2026-07');
  });

  it.each([
    ['2026-11', 1, '2026-12'],
    ['2026-12', 1, '2027-01'],
    ['2026-01', -1, '2025-12'],
    ['2026-03', -15, '2024-12'],
    ['2026-05', 0, '2026-05'],
    ['2025-06', 18, '2026-12'],
  ])('%s + %i months = %s', (period, months, expected) => {
    expect(addMonths(period, months)).toBe(expected);
  });

  it('builds inclusive ranges and orders periods', () => {
    expect(periodRange('2025-11', '2026-02')).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
    expect(periodRange('2026-02', '2026-02')).toEqual(['2026-02']);
    expect(periodRange('2026-03', '2026-02')).toEqual([]);
    expect(comparePeriods('2025-12', '2026-01')).toBeLessThan(0);
    expect(comparePeriods('2026-01', '2026-01')).toBe(0);
    expect(['2026-02', '2025-12', '2026-01'].sort(comparePeriods)).toEqual([
      '2025-12',
      '2026-01',
      '2026-02',
    ]);
  });

  it('validates the AAAA-MM format', () => {
    expect(isPeriod('2026-11')).toBe(true);
    for (const bad of ['2026-13', '2026-1', '26-11', '2026-00', '2026-11-01']) {
      expect(isPeriod(bad)).toBe(false);
    }
    expect(() => addMonths('2026-13', 1)).toThrow(RangeError);
    expect(periodOfDate('2026-11-16')).toBe('2026-11');
  });
});

describe('rateForPeriod', () => {
  const rates = [
    { id: 1, effectivePeriod: '2025-01', amount: 4_000 },
    { id: 3, effectivePeriod: '2026-08', amount: 6_000 },
    { id: 2, effectivePeriod: '2026-01', amount: 5_000 },
  ];
  it.each([
    ['2024-12', null],
    ['2025-01', 1],
    ['2025-12', 1],
    ['2026-01', 2],
    ['2026-07', 2],
    ['2026-08', 3],
    ['2030-01', 3],
  ])('in %s the rate in force is %s', (period, id) => {
    expect(rateForPeriod(rates, period)?.id ?? null).toBe(id);
  });
});
