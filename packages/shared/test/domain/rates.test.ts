import { describe, expect, it } from 'vitest';
import { isValidRateEffectivePeriod, rateForPeriod } from '../../src/domain/rates.js';

describe('rateForPeriod', () => {
  const rates = [
    { id: 1, effectivePeriod: '2025-01', amount: 4_000 },
    { id: 2, effectivePeriod: '2026-01', amount: 5_000 },
  ];

  it.each([
    ['2024-12', null],
    ['2025-01', 1],
    ['2025-12', 1],
    ['2026-01', 2],
    ['2027-06', 2],
  ])('in %s uses rate %s', (period, id) => {
    expect(rateForPeriod(rates, period)?.id ?? null).toBe(id);
  });
});

describe('isValidRateEffectivePeriod (current month 2026-11)', () => {
  it.each([
    ['next month', '2026-12', '2025-01', true],
    ['a later month', '2027-03', '2025-01', true],
    ['the current month', '2026-11', '2025-01', false],
    ['a past month after the first rate', '2025-06', '2025-01', false],
    ['the month of the first rate', '2025-01', '2025-01', false],
    ['before the first rate (startup history, D-18)', '2024-06', '2025-01', true],
    ['a past month with no rate at all (startup)', '2026-03', null, true],
    ['next month with no rate at all', '2026-12', null, true],
  ])('%s (%s, earliest %s) → %s', (_, period, earliest, valid) => {
    expect(isValidRateEffectivePeriod(period, '2026-11', earliest)).toBe(valid);
  });
});
