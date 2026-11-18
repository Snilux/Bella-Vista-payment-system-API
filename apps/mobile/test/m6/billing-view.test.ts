import {
  breakdown,
  monthsSummary,
  monthTag,
  overdueNotice,
  totalLabel,
  uniformRate,
} from '../../src/features/billing/billing-view.js';
import { dateError, isCalendarDate } from '../../src/ui/DateField.js';

// The words of the billing screens (3.2 §10.2, §10.3) and the dates (DateField, AAAA-MM-DD).

describe('monthsSummary: the months as on the paper receipt', () => {
  it.each([
    [['2026-06'], 'Junio 2026'],
    [['2026-07', '2026-06'], 'Junio y julio 2026'],
    [['2026-06', '2026-07', '2026-08', '2026-09'], 'Junio a septiembre 2026'],
    [['2026-12', '2027-01'], 'Diciembre 2026 y enero 2027'],
    [['2026-11', '2026-12', '2027-01', '2027-02'], 'Noviembre 2026 a febrero 2027'],
    [[], ''],
  ])('%j → %s', (periods, expected) => {
    expect(monthsSummary(periods)).toBe(expected);
  });
});

describe('monthTag: the status in words', () => {
  it.each([
    [{ status: 'overdue', surcharge: 5_000 }, 'Recargo'],
    [{ status: 'overdue', surcharge: 0 }, 'Vencido'],
    [{ status: 'pending', surcharge: 0 }, 'Pendiente'],
    [{ status: 'paid', surcharge: null }, 'Pagado'],
    [{ status: 'advance', surcharge: 0 }, 'Anticipo'],
  ] as const)('%j → %s', (month, label) => {
    expect(monthTag(month).label).toBe(label);
  });
});

describe('summary texts', () => {
  it('says the surcharge only when the debt cycle is open (D-02)', () => {
    expect(overdueNotice({ overdueCount: 0, inDebtCycle: false })).toBeNull();
    expect(overdueNotice({ overdueCount: 3, inDebtCycle: false })).toBe('Tiene 3 meses vencidos.');
    expect(overdueNotice({ overdueCount: 4, inDebtCycle: true })).toBe(
      'Tiene 4 meses vencidos. Cada mes vencido paga doble.',
    );
  });

  it('breaks down a month and names the rate when it is the same for every month', () => {
    expect(breakdown({ baseAmount: 5_000, surcharge: 5_000 })).toBe('$50.00 + recargo $50.00');
    expect(breakdown({ baseAmount: 5_000, surcharge: 0 })).toBe('$50.00');
    expect(uniformRate([{ baseAmount: 5_000 }, { baseAmount: 5_000 }])).toBe('$50.00 por mes');
    expect(uniformRate([{ baseAmount: 5_000 }, { baseAmount: 6_000 }])).toBeNull();
    expect(totalLabel(2, 0)).toBe('Total (2 meses)');
    expect(totalLabel(0, 1)).toBe('Total (1 concepto)');
  });
});

describe('DateField: AAAA-MM-DD', () => {
  it.each([
    ['2026-10-25', true],
    ['2028-02-29', true],
    ['2026-02-29', false],
    ['2026-13-01', false],
    ['25/10/2026', false],
    ['2026-1-5', false],
  ])('%s → %s', (text, valid) => {
    expect(isCalendarDate(text)).toBe(valid);
  });

  it('empty is fine unless required', () => {
    expect(dateError('')).toBeNull();
    expect(dateError('', true)).toBe('Escriba la fecha.');
    expect(dateError('2026-02-30')).toMatch(/^Escriba la fecha como AAAA-MM-DD/);
  });
});
