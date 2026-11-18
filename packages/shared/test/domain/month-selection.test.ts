import { describe, expect, it } from 'vitest';
import {
  type AccountStatementInput,
  computeAccountStatement,
} from '../../src/domain/account-statement.js';
import {
  canAdvance,
  selectableMonths,
  selectionTotal,
  toggleMonth,
} from '../../src/domain/month-selection.js';

// Chronological selection of F-02 (D-02, D-03, D-05, D-06). The statements come from the same
// function the API uses: 18 nov 2026, rates $40.00 from 2025-01 and $50.00 from 2026-01 and
// $60.00 from 2027-02.

const NOW = new Date('2026-11-18T18:00:00Z');
const RATES = [
  { id: 1, effectivePeriod: '2025-01', amount: 4_000 },
  { id: 2, effectivePeriod: '2026-01', amount: 5_000 },
  { id: 3, effectivePeriod: '2027-02', amount: 6_000 },
];

const statementFrom = (billingStartPeriod: string, extra: Partial<AccountStatementInput> = {}) =>
  computeAccountStatement({
    now: NOW,
    billingStartPeriod,
    lastBillablePeriod: null,
    rates: RATES,
    suspensions: [],
    coveredMonths: [],
    ...extra,
  });

const offer = (billingStart: string, extra: Partial<AccountStatementInput> = {}) =>
  selectableMonths(statementFrom(billingStart, extra), {
    rates: RATES,
    advanceCount: 3,
    suspensions: extra.suspensions ?? [],
  });

describe('selectableMonths: what F-02 offers', () => {
  it.each([
    // 3 overdue: the debt cycle is still closed, no surcharge (D-02).
    [
      '2026-08',
      [
        ['2026-08', 'overdue', 5_000],
        ['2026-09', 'overdue', 5_000],
        ['2026-10', 'overdue', 5_000],
        ['2026-11', 'pending', 5_000],
      ],
    ],
    // 4 overdue: the cycle opens and every overdue month pays the base rate twice.
    [
      '2026-07',
      [
        ['2026-07', 'overdue', 10_000],
        ['2026-08', 'overdue', 10_000],
        ['2026-09', 'overdue', 10_000],
        ['2026-10', 'overdue', 10_000],
        ['2026-11', 'pending', 5_000],
      ],
    ],
    // Up to date: only the month in course.
    ['2026-11', [['2026-11', 'pending', 5_000]]],
  ] as const)('from %s', (start, expected) => {
    const { months, blockedFrom } = offer(start);
    expect(blockedFrom).toBeNull();
    expect(
      months.filter((m) => m.kind !== 'advance').map((m) => [m.period, m.kind, m.total]),
    ).toEqual(expected);
  });

  it('with the surcharge, each overdue month shows its base and its surcharge', () => {
    const { months } = offer('2026-07');
    expect(months[0]).toEqual({
      period: '2026-07',
      kind: 'overdue',
      baseAmount: 5_000,
      surcharge: 5_000,
      total: 10_000,
    });
  });

  it('offers the advances after the month in course, each with its own rate and no surcharge', () => {
    expect(
      offer('2026-11')
        .months.filter((m) => m.kind === 'advance')
        .map((m) => [m.period, m.total, m.surcharge]),
    ).toEqual([
      ['2026-12', 5_000, 0],
      ['2027-01', 5_000, 0],
      ['2027-02', 6_000, 0],
    ]);
  });

  it('starts the advances after the last month already paid in advance', () => {
    const statement = statementFrom('2026-11', {
      coveredMonths: ['2026-11', '2026-12'].map((period) => ({
        period,
        paymentId: 1,
        paidAt: new Date('2026-11-05T18:00:00Z'),
        rateId: 2,
        baseAmount: 5_000,
        withSurcharge: false,
      })),
    });
    const { months } = selectableMonths(statement, { rates: RATES, advanceCount: 2 });
    expect(months.map((m) => [m.period, m.kind])).toEqual([
      ['2027-01', 'advance'],
      ['2027-02', 'advance'],
    ]);
  });

  it('a suspended month generates no fee and is never offered (D-06)', () => {
    const suspensions = [
      { from: '2026-09', to: '2026-09' },
      { from: '2027-01', to: '2027-01' },
    ];
    const periods = offer('2026-08', { suspensions }).months.map((m) => m.period);
    expect(periods).toEqual(['2026-08', '2026-10', '2026-11', '2026-12', '2027-02', '2027-03']);
  });

  it('stops at the first unpaid month without an approved rate (no gaps)', () => {
    const statement = computeAccountStatement({
      now: NOW,
      billingStartPeriod: '2024-11',
      lastBillablePeriod: null,
      rates: RATES,
      suspensions: [],
      coveredMonths: [],
    });
    const { months, blockedFrom } = selectableMonths(statement, { rates: RATES, advanceCount: 3 });
    expect(blockedFrom).toBe('2024-11');
    expect(months).toEqual([]);
  });
});

describe('toggleMonth: marking and unmarking', () => {
  const { months } = offer('2026-07'); // Jul–Oct overdue, Nov pending, Dec–Feb advances.

  it.each([
    ['marking the oldest marks only it', [], '2026-07', ['2026-07']],
    [
      'marking a later month marks the earlier ones',
      [],
      '2026-09',
      ['2026-07', '2026-08', '2026-09'],
    ],
    [
      'unmarking a month removes the later ones',
      ['2026-07', '2026-08', '2026-09', '2026-10'],
      '2026-08',
      ['2026-07'],
    ],
    ['unmarking the oldest clears everything', ['2026-07', '2026-08'], '2026-07', []],
    [
      'an advance cannot be marked while an overdue month is unmarked',
      ['2026-07', '2026-08'],
      '2026-12',
      ['2026-07', '2026-08'],
    ],
    [
      'with everything due marked, an advance can be added',
      ['2026-07', '2026-08', '2026-09', '2026-10', '2026-11'],
      '2026-12',
      ['2026-07', '2026-08', '2026-09', '2026-10', '2026-11', '2026-12'],
    ],
    [
      'a second advance brings the first one',
      ['2026-07', '2026-08', '2026-09', '2026-10', '2026-11'],
      '2027-01',
      ['2026-07', '2026-08', '2026-09', '2026-10', '2026-11', '2026-12', '2027-01'],
    ],
    ['a month that is not offered changes nothing', ['2026-07'], '2025-01', ['2026-07']],
  ] as const)('%s', (_case, selected, period, expected) => {
    expect(toggleMonth(months, selected, period)).toEqual(expected);
  });

  it('canAdvance only when every overdue and pending month is marked', () => {
    expect(canAdvance(months, ['2026-07', '2026-08', '2026-09', '2026-10'])).toBe(false);
    expect(canAdvance(months, ['2026-07', '2026-08', '2026-09', '2026-10', '2026-11'])).toBe(true);
  });

  it('adds up the marked months in cents', () => {
    expect(selectionTotal(months, ['2026-07', '2026-08'])).toBe(20_000);
    expect(selectionTotal(months, ['2026-07', '2026-08', '2026-09', '2026-10', '2026-11'])).toBe(
      45_000,
    );
  });
});
