import { describe, expect, it } from 'vitest';
import { formatMoney, formatPeriod, parseMoney } from '../../src/format/index.js';

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

describe('parseMoney', () => {
  it.each([
    ['0', 0],
    ['50', 5_000],
    ['1234', 123_400],
    ['1,234', 123_400],
    ['1,234.5', 123_450],
    ['1,234.56', 123_456],
    ['$1,234.56', 123_456],
    [' $ 1,234.56 ', 123_456],
    ['1,000,000.00', 100_000_000],
    ['.5', 50],
    ['0.1', 10],
    ['0.29', 29],
    ['12.', 1_200],
  ])('reads %j as %i cents', (text, cents) => {
    expect(parseMoney(text)).toBe(cents);
  });

  it.each([
    [''],
    ['   '],
    ['.'],
    ['$'],
    ['-50'],
    ['1.234'],
    ['12,34'],
    ['1,2345'],
    [',123'],
    ['1.2.3'],
    ['abc'],
    ['50 pesos'],
    ['1e3'],
    ['99999999999999999999'],
  ])('rejects %j', (text) => {
    expect(parseMoney(text)).toBeNull();
  });

  it('reads back what formatMoney writes', () => {
    expect(parseMoney(formatMoney(123_456))).toBe(123_456);
  });
});
