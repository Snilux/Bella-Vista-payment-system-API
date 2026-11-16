import { describe, expect, it } from 'vitest';
import {
  type AccountStatementInput,
  computeAccountStatement,
} from '../../src/domain/account-statement.js';
import {
  type PaymentSelectionIssueCode,
  priceSelection,
  validatePaymentSelection,
} from '../../src/domain/payment-order.js';

// Payment order (D-03, D-05, RF-PAG-02). Scenario: now 2026-06-15; billing from 2026-02;
// 2026-02..05 overdue (4: debt cycle open) and 2026-06 pending; 2026-01 already paid as an
// advance does not apply here. Rates $50.00 from 2026-01 and $60.00 from 2026-08; the unit is
// suspended in 2026-10.

const at = (day: string) => new Date(`${day}T18:00:00Z`);

const scenario: AccountStatementInput = {
  now: at('2026-06-15'),
  billingStartPeriod: '2026-02',
  lastBillablePeriod: null,
  rates: [
    { id: 2, effectivePeriod: '2026-01', amount: 5_000 },
    { id: 3, effectivePeriod: '2026-08', amount: 6_000 },
  ],
  suspensions: [{ from: '2026-10', to: '2026-10' }],
  coveredMonths: [],
};
const statement = computeAccountStatement(scenario);
const ALL_DUE = ['2026-02', '2026-03', '2026-04', '2026-05', '2026-06'];

const codes = (selected: string[], input = scenario, st = statement) =>
  validatePaymentSelection(input, st, selected).map((issue) => `${issue.code} ${issue.period}`);

describe('validatePaymentSelection', () => {
  it.each([
    ['the oldest overdue month', ['2026-02']],
    ['the two oldest, in any order', ['2026-03', '2026-02']],
    ['everything due', ALL_DUE],
    ['everything due plus the next month in advance', [...ALL_DUE, '2026-07']],
    ['advances across a rate change', [...ALL_DUE, '2026-07', '2026-08', '2026-09']],
    [
      'advances skipping a suspended month',
      [...ALL_DUE, '2026-07', '2026-08', '2026-09', '2026-11'],
    ],
  ])('accepts %s', (_name, selected) => {
    expect(codes(selected)).toEqual([]);
  });

  it.each<[string, string[], string[]]>([
    ['an empty selection', [], ['EMPTY_SELECTION null']],
    ['a malformed period', ['2026-13'], ['INVALID_PERIOD 2026-13']],
    ['a repeated period', ['2026-02', '2026-02'], ['DUPLICATE_PERIOD 2026-02']],
    ['skipping the oldest overdue month', ['2026-03'], ['MONTH_ORDER 2026-03']],
    ['a gap', ['2026-02', '2026-04'], ['MONTH_ORDER 2026-04']],
    ['an advance while something is unpaid', ['2026-02', '2026-07'], ['MONTH_ORDER 2026-07']],
    ['an advance skipping a month', [...ALL_DUE, '2026-08'], ['MONTH_ORDER 2026-08']],
    ['a month before the billing start', ['2026-01'], ['PERIOD_NOT_BILLABLE 2026-01']],
    [
      'a suspended month in advance',
      [...ALL_DUE, '2026-07', '2026-08', '2026-09', '2026-10'],
      ['PERIOD_NOT_BILLABLE 2026-10'],
    ],
  ])('rejects %s', (_name, selected, expected) => {
    expect(codes(selected)).toEqual(expected as PaymentSelectionIssueCode[]);
  });

  it('rejects months already paid (PERIOD_ALREADY_PAID)', () => {
    const input: AccountStatementInput = {
      ...scenario,
      coveredMonths: [
        {
          period: '2026-02',
          paymentId: 1,
          paidAt: at('2026-06-01'),
          rateId: 2,
          baseAmount: 5_000,
          withSurcharge: true,
        },
      ],
    };
    expect(codes(['2026-02', '2026-03'], input, computeAccountStatement(input))).toEqual([
      'PERIOD_ALREADY_PAID 2026-02',
    ]);
  });

  it('rejects months without an approved rate (RATE_MISSING)', () => {
    const input: AccountStatementInput = {
      ...scenario,
      rates: [{ id: 3, effectivePeriod: '2026-03', amount: 5_000 }],
    };
    expect(codes(['2026-02'], input, computeAccountStatement(input))).toEqual([
      'RATE_MISSING 2026-02',
    ]);
  });

  it('does not allow advances past the deactivation month', () => {
    const input: AccountStatementInput = { ...scenario, lastBillablePeriod: '2026-06' };
    expect(codes([...ALL_DUE, '2026-07'], input, computeAccountStatement(input))).toEqual([
      'PERIOD_NOT_BILLABLE 2026-07',
    ]);
  });
});

describe('priceSelection', () => {
  it('prices overdue months with surcharge in a debt cycle, the pending month and advances without it (D-02, D-05)', () => {
    const selected = [...ALL_DUE, '2026-07', '2026-08'];
    expect(codes(selected)).toEqual([]);
    const priced = priceSelection(scenario, statement, selected);
    expect(
      priced.months.map((m) => `${m.period} ${m.kind} ${m.baseAmount}+${m.surcharge}`),
    ).toEqual([
      '2026-02 overdue 5000+5000',
      '2026-03 overdue 5000+5000',
      '2026-04 overdue 5000+5000',
      '2026-05 overdue 5000+5000',
      '2026-06 pending 5000+0',
      '2026-07 advance 5000+0',
      '2026-08 advance 6000+0',
    ]);
    expect(priced.total).toBe(4 * 10_000 + 5_000 + 5_000 + 6_000);
    expect(priced.months.filter((m) => m.withSurcharge).map((m) => m.period)).toEqual([
      '2026-02',
      '2026-03',
      '2026-04',
      '2026-05',
    ]);
  });

  it('keeps the surcharge on what is left after a partial payment (D-02)', () => {
    const input: AccountStatementInput = {
      ...scenario,
      coveredMonths: ['2026-02', '2026-03'].map((period) => ({
        period,
        paymentId: 1,
        paidAt: at('2026-06-10'),
        rateId: 2,
        baseAmount: 5_000,
        withSurcharge: true,
      })),
    };
    const st = computeAccountStatement(input);
    expect(priceSelection(input, st, ['2026-04']).months[0]).toMatchObject({
      surcharge: 5_000,
      total: 10_000,
    });
  });
});
