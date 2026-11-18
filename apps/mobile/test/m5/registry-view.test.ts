import {
  canCancelRequest,
  debtView,
  estimateDebt,
  filterRoster,
  monthOptions,
  reactivationOptions,
  rosterRows,
} from '../../src/features/registry/registry-view.js';
import { RATES, ROSTER, request } from './fake-m5-api.js';

// The registry rules of the screens, without the screens (3.2 §10.4, §10.7; D-06, D-12, D-18).

// 18 Nov 2026 at noon in Mexico City: November is the month in course.
const NOW = new Date('2026-11-18T18:00:00.000Z');

describe('debtView', () => {
  it.each([
    [{ totalDue: 0, overdueCount: 0 }, 'Al corriente', 'Pagado'],
    [{ totalDue: 5_000, overdueCount: 0 }, 'Debe $50.00', 'Pendiente'],
    [{ totalDue: 45_000, overdueCount: 4 }, 'Debe $450.00', 'Recargo'],
  ])('%j → %s with %s', (debt, text, tag) => {
    expect(debtView(debt)).toMatchObject({ text, tag: { label: tag } });
  });
});

describe('filterRoster', () => {
  const rows = rosterRows(ROSTER);
  const folios = (filter: Parameters<typeof filterRoster>[1], text = '') =>
    filterRoster(rows, filter, text).map((row) => row.title.slice(0, 8));

  it.each([
    ['all', '', ['U-000001', 'U-000002', 'U-000003', 'U-000004']],
    ['debt', '', ['U-000001', 'U-000002']],
    ['surcharge', '', ['U-000001']],
    ['suspended', '', ['U-000003']],
    ['all', 'JUAREZ', ['U-000003']],
    ['all', 'hernandez hidalgo', ['U-000001']],
    ['debt', 'morelos', []],
  ] as const)('%s with «%s»', (filter, text, expected) => {
    expect(folios(filter, text)).toEqual(expected);
  });

  it('a family of a suspended connection counts as suspended', () => {
    expect(rows.find((row) => row.unitId === 3)?.tag).toEqual({
      tone: 'cancelled',
      label: 'Suspendida',
    });
  });
});

describe('reactivationOptions (S-08)', () => {
  it.each([
    // Suspended since August: billing again from November (to = October) or December.
    [
      '2026-08',
      [
        ['2026-11', '2026-10'],
        ['2026-12', '2026-11'],
      ],
    ],
    // Suspended since this month: only from next month (to = November).
    ['2026-11', [['2026-12', '2026-11']]],
    // Starts next month: nothing to reactivate yet.
    ['2026-12', []],
  ] as const)('since %s', (periodFrom, expected) => {
    expect(
      reactivationOptions(periodFrom, NOW).map((option) => [option.value, option.periodTo]),
    ).toEqual(expected);
  });
});

describe('estimateDebt (P-03)', () => {
  const rates = RATES.map(({ id, effectivePeriod, amount }) => ({ id, effectivePeriod, amount }));

  it.each([
    // November only: the month in course, pending, $50.00.
    ['2026-11', 5_000, 'Debería noviembre pendiente: $50.00.'],
    // October overdue, without surcharge (the cycle opens at 4 overdue, D-02), and November.
    ['2026-10', 10_000, 'Debería 1 mes vencido y noviembre pendiente: $100.00.'],
    // Three overdue months: still no surcharge.
    ['2026-08', 20_000, 'Debería 3 meses vencidos y noviembre pendiente: $200.00.'],
    // Four overdue: the cycle opens and each one pays double (as in Figma P-03, $450.00).
    ['2026-07', 45_000, 'Debería 4 meses vencidos con recargo y noviembre pendiente: $450.00.'],
  ])('from %s', (start, totalDue, text) => {
    expect(estimateDebt(start, rates, NOW)).toEqual({ text, totalDue, missingRates: 0 });
  });

  it('says how many months have no approved rate', () => {
    expect(estimateDebt('2024-11', rates, NOW).missingRates).toBe(2);
  });
});

describe('monthOptions', () => {
  it('lists the months newest first, in words', () => {
    expect(monthOptions('2026-10', '2026-12')).toEqual([
      { value: '2026-12', label: 'Diciembre 2026' },
      { value: '2026-11', label: 'Noviembre 2026' },
      { value: '2026-10', label: 'Octubre 2026' },
    ]);
  });
});

describe('canCancelRequest (D-12)', () => {
  it.each([
    ['requested', true],
    ['approved_pending_payment', true],
    ['pending_installation', false],
    ['installed', false],
    ['rejected', false],
    ['cancelled', false],
  ] as const)('%s → %s', (status, expected) => {
    expect(canCancelRequest(request({ id: 1, status }))).toBe(expected);
  });
});
