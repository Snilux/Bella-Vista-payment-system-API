import { describe, expect, it } from 'vitest';
import {
  formatDate,
  formatDateInWords,
  formatDateTime,
  formatMoney,
  formatPeriod,
  parseMoney,
} from '../../src/format/index.js';

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

describe('formatDate', () => {
  it.each([
    ['2026-10-25', '2026-10-25'],
    ['2026-01-05', '2026-01-05'],
    ['2025-12-31', '2025-12-31'],
  ])('shows %s as %s (AAAA-MM-DD everywhere)', (date, text) => {
    expect(formatDate(date)).toBe(text);
  });

  it('rejects an invalid date', () => {
    expect(() => formatDate('2026-13-01')).toThrow(RangeError);
    expect(() => formatDate('25 oct 2026')).toThrow(RangeError);
  });
});

describe('formatDateInWords', () => {
  it.each([
    ['2026-10-25', '25 de octubre de 2026'],
    ['2026-01-05', '5 de enero de 2026'],
  ])('%s → %s', (date, text) => {
    expect(formatDateInWords(date)).toBe(text);
  });

  it('rejects an invalid date', () => {
    expect(() => formatDateInWords('2026-02-30x')).toThrow(RangeError);
  });
});

describe('formatDateTime', () => {
  it.each([
    // Mexico City is UTC-6 all year (no daylight saving time since 2022).
    ['2026-10-25T18:30:00.000Z', '2026-10-25 12:30'],
    // Past midnight in UTC is still the previous day in Mexico City.
    ['2026-11-01T03:05:00.000Z', '2026-10-31 21:05'],
    ['2026-01-01T06:00:00.000Z', '2026-01-01 00:00'],
  ])('formats %s as %s', (instant, text) => {
    expect(formatDateTime(instant)).toBe(text);
  });

  it('rejects an invalid instant', () => {
    expect(() => formatDateTime('ayer')).toThrow(RangeError);
  });
});
