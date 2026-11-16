import { describe, expect, it } from 'vitest';
import { formatMoney, formatPeriod } from '../../src/format/index.js';

describe('formatMoney', () => {
  it.each([
    [0, '$0.00'],
    [5, '$0.05'],
    [5_000, '$50.00'],
    [123_456, '$1,234.56'],
    [100_000_000, '$1,000,000.00'],
    [-20_000, '-$200.00'],
  ])('formats %i cents as %s', (cents, text) => {
    expect(formatMoney(cents)).toBe(text);
  });

  it('rejects fractions of a cent', () => {
    expect(() => formatMoney(10.5)).toThrow(RangeError);
  });
});

describe('formatPeriod', () => {
  it.each([
    ['2026-01', 'Enero 2026'],
    ['2026-06', 'Junio 2026'],
    ['2025-12', 'Diciembre 2025'],
  ])('formats %s as %s', (period, text) => {
    expect(formatPeriod(period)).toBe(text);
  });

  it('rejects an invalid period', () => {
    expect(() => formatPeriod('2026-13')).toThrow(RangeError);
  });
});
