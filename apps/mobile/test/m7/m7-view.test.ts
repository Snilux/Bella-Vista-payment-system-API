import type { PlumberDetail } from '@bella-vista/shared';
import {
  adjustmentAmount,
  handoverAmountError,
  handoverDifference,
  monthOptions,
  openingRow,
} from '../../src/features/cashboxes/cashbox-view.js';
import {
  payablePeriods,
  payBlockedReason,
  payPeriodShort,
} from '../../src/features/committee/committee-view.js';

// The rules the M7 screens paint (D-16, D-18, D-24), as tables.

describe('handoverDifference (T-03)', () => {
  it.each([
    [300_000, null, 'none'],
    [300_000, 300_000, 'none'],
    [300_000, 295_000, 'shortfall'],
    [300_000, 0, 'shortfall'],
    [300_000, 310_000, 'over'],
  ] as const)('declared %i, received %p → %s', (declared, received, kind) => {
    expect(handoverDifference(declared, received).kind).toBe(kind);
  });

  it('says how much is missing and where it stays', () => {
    expect(handoverDifference(300_000, 295_000)).toEqual({
      kind: 'shortfall',
      amount: 5_000,
      message: 'Diferencia: faltan $50.00. Quedarán en la caja del jefe hasta aclararlo.',
    });
  });

  it('the adjustment is the whole difference, negative (it takes cash out)', () => {
    expect(adjustmentAmount({ difference: 5_000 })).toBe(-5_000);
  });
});

describe('handoverAmountError (J-03)', () => {
  const box = { available: 200_000, pendingHandover: 300_000 };
  it.each([
    [null, null],
    [200_000, null],
    [150_000, null],
    [0, 'El importe debe ser mayor que cero.'],
    [
      200_001,
      'Es mayor a lo que debe tener: puede entregar hasta $2,000.00 (ya tiene $3,000.00 en entregas por confirmar).',
    ],
  ] as const)('%p → %p', (amount, error) => {
    expect(handoverAmountError(amount, box)).toBe(error);
  });

  it('without pending handovers the reason is shorter', () => {
    expect(handoverAmountError(10_001, { available: 10_000, pendingHandover: 0 })).toBe(
      'Es mayor a lo que debe tener: puede entregar hasta $100.00.',
    );
  });
});

describe('payBlockedReason (T-06, T-07)', () => {
  it.each([
    [180_000, 1_240_000, false],
    [1_240_000, 1_240_000, false],
    [1_240_001, 1_240_000, true],
    [null, 0, false],
    [100, null, false],
  ] as const)('amount %p, balance %p → blocked %p', (amount, balance, blocked) => {
    expect(payBlockedReason(amount, balance) !== null).toBe(blocked);
  });
});

describe('openingRow (T-12)', () => {
  const opening = (status: 'approved' | 'pending' | 'rejected') => ({
    openingBalance: {
      id: 1,
      cashboxId: 1,
      amount: 400_000,
      date: '2026-01-02',
      status,
      approvalId: 2,
    },
  });
  it.each([
    [{ openingBalance: null }, 'Sin capturar', true],
    [opening('approved'), 'Confirmado por el presidente · 2026-01-02', false],
    [opening('pending'), 'Espera confirmación del presidente', false],
    [opening('rejected'), 'Rechazado: puede capturarlo de nuevo', true],
  ] as const)('%#: %s', (cashbox, subtitle, capturable) => {
    expect(openingRow(cashbox)).toMatchObject({ subtitle, capturable });
  });
});

describe('monthOptions (G-09)', () => {
  it('the current month first, across the year', () => {
    expect(monthOptions('2026-02-10', 3)).toEqual([
      { key: '2026-02', label: 'Febrero 2026', from: '2026-02-01', to: '2026-02-28' },
      { key: '2026-01', label: 'Enero 2026', from: '2026-01-01', to: '2026-01-31' },
      { key: '2025-12', label: 'Diciembre 2025', from: '2025-12-01', to: '2025-12-31' },
    ]);
  });
});

describe('plumber periods (T-08, T-09; D-24)', () => {
  const salary = (effectiveFrom: string, frequency: 'weekly' | 'biweekly' | 'monthly', id = 1) => ({
    id,
    amount: 250_000,
    frequency,
    effectiveFrom,
    agreement: { id: 38, folio: 'AC-000038' },
    status: 'approved' as const,
    approvalId: 12,
  });
  const plumber = (
    salaries: PlumberDetail['salaries'],
    paid: string[] = [],
  ): Pick<PlumberDetail, 'salaries' | 'payments'> => ({
    salaries,
    payments: paid.map((periodStart, index) => ({
      expenseId: index,
      folio: `GA-${index}`,
      periodStart,
      periodEnd: periodStart,
      amount: 250_000,
      paidOn: periodStart,
      status: 'paid',
    })),
  });

  it('walks back from today without the paid periods nor those before the salary', () => {
    const periods = payablePeriods(
      plumber([salary('2026-10-01', 'biweekly')], ['2026-10-01']),
      '2026-11-18',
    );
    expect(periods.map((p) => [p.start, p.end])).toEqual([
      ['2026-11-16', '2026-11-30'],
      ['2026-11-01', '2026-11-15'],
      ['2026-10-16', '2026-10-31'],
    ]);
  });

  it('uses the salary in force on each period (a pending one does not count)', () => {
    const pending = {
      ...salary('2026-11-01', 'biweekly', 2),
      amount: 300_000,
      status: 'pending' as const,
    };
    const periods = payablePeriods(
      plumber([salary('2026-10-01', 'monthly'), pending]),
      '2026-11-18',
      2,
    );
    expect(periods.map((p) => [p.start, p.end, p.salary.amount])).toEqual([
      ['2026-11-01', '2026-11-30', 250_000],
      ['2026-10-01', '2026-10-31', 250_000],
    ]);
  });

  it.each([
    ['2026-10-16', '2026-10-31', '2026-10-16 al 2026-10-31'],
    ['2026-09-28', '2026-10-04', '2026-09-28 al 2026-10-04'],
  ])('%s – %s', (start, end, text) => {
    expect(payPeriodShort(start, end)).toBe(text);
  });
});
