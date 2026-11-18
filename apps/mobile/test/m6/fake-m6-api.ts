import type {
  AccountStatementResponse,
  Approval,
  ConnectionRequest,
  ExtraCharge,
  Fee,
  Payment,
  Rate,
  UnitDetail,
} from '@bella-vista/shared';
import { apiError, type Call, json, type Reply } from '../api/fake-api.js';
import { ROSTER } from '../m5/fake-m5-api.js';

// M6 · Estado de cuenta y cobro: an in-memory API with the family, its account statement, the
// preview and registration of payments (with the Idempotency-Key semantics of the real API: the
// same key answers the same payment), receipts, cancellations, rates, fees, "Mi caja" and one
// approval with its subject. The statement is fixed (October 2026 in course): June to September
// overdue with surcharge (4, D-02), October pending, May paid.

type Statement = AccountStatementResponse['statement'];

const month = (
  period: string,
  status: 'pending' | 'overdue' | 'paid' | 'advance',
  surcharge: number,
  paymentId: number | null = null,
) => ({
  period,
  status,
  rateId: 2,
  baseAmount: 5_000,
  surcharge,
  total: 5_000 + surcharge,
  paymentId,
});

export const STATEMENT: Statement = {
  unitId: 45,
  currentPeriod: '2026-10',
  months: [
    month('2026-05', 'paid', 0, 900),
    month('2026-06', 'overdue', 5_000),
    month('2026-07', 'overdue', 5_000),
    month('2026-08', 'overdue', 5_000),
    month('2026-09', 'overdue', 5_000),
    month('2026-10', 'pending', 0),
  ],
  summary: {
    overdueCount: 4,
    pendingCount: 1,
    inDebtCycle: true,
    overdueTotal: 40_000,
    pendingTotal: 5_000,
    surchargeTotal: 20_000,
    totalDue: 45_000,
    advanceCount: 0,
  },
  missingRatePeriods: [],
};

export const UNIT: UnitDetail = {
  id: 45,
  folio: 'U-000045',
  reference: null,
  status: 'active',
  registeredOn: '2024-03-12',
  activatedOn: '2024-03-12',
  billingStartPeriod: '2024-04',
  deactivatedOn: null,
  connection: {
    id: 1,
    folio: 'T-000123',
    address: 'Calle Pino 12',
    blockId: 1,
    blockCode: 'S1-M01',
  },
  holder: { id: 4, folio: 'P-000004', fullName: 'Juan Pérez López', distinguishingNote: null },
  holders: [],
  suspensions: [],
  payments: [
    {
      id: 900,
      folio: 'PG-000900',
      occurredAt: '2026-05-10T16:00:00.000Z',
      total: 5_000,
      cancelled: false,
    },
  ],
  pendingChange: null,
};

export const RATES: Rate[] = [
  {
    id: 1,
    effectivePeriod: '2025-01',
    amount: 4_000,
    approvedOn: '2024-12-07',
    agreement: { id: 1, folio: 'AC-000001' },
    status: 'approved',
    approvalId: 1,
    createdAt: '2024-12-07T16:00:00.000Z',
  },
  {
    id: 2,
    effectivePeriod: '2026-01',
    amount: 5_000,
    approvedOn: '2025-12-06',
    agreement: { id: 2, folio: 'AC-000030' },
    status: 'approved',
    approvalId: 2,
    createdAt: '2025-12-06T16:00:00.000Z',
  },
  {
    id: 3,
    effectivePeriod: '2027-01',
    amount: 6_000,
    approvedOn: '2026-11-10',
    agreement: { id: 50, folio: 'AC-000050' },
    status: 'pending',
    approvalId: 70,
    createdAt: '2026-11-10T16:00:00.000Z',
  },
];

export const FEES: Fee[] = [
  {
    id: 1,
    type: 'opening',
    name: 'Apertura de toma',
    currentAmount: { effectiveFrom: '2026-01-01', amount: 150_000 },
    amounts: [
      { effectiveFrom: '2026-01-01', amount: 150_000 },
      { effectiveFrom: '2025-01-01', amount: 120_000 },
    ],
  },
  { id: 2, type: 'repair', name: 'Reparación a usuario', currentAmount: null, amounts: [] },
];

export const OPENING_REQUEST: ConnectionRequest = {
  id: 5,
  folio: 'ST-000015',
  status: 'approved_pending_payment',
  applicant: { id: 8, folio: 'P-000008', fullName: 'Rosa Díaz Mena', distinguishingNote: null },
  address: 'Calle Encino 8',
  blockId: 1,
  blockCode: 'S1-M01',
  requestedOn: '2026-10-03',
  agreement: { id: 47, folio: 'AC-000047', result: 'approved_by_majority' },
  resolutionReason: null,
  cancelledOn: null,
  cancellationReason: null,
  openingCharge: {
    id: 9,
    feeName: 'Apertura de toma',
    amount: 150_000,
    chargedOn: '2026-10-24',
    cancelledOn: null,
  },
  connectionId: null,
};

export const paymentOf = (id: number, change: Partial<Payment> = {}): Payment => ({
  id,
  folio: `PG-000${id}`,
  unit: { id: 45, folio: 'U-000045', holder: 'Juan Pérez López' },
  blockId: 1,
  months: [
    { period: '2026-06', baseAmount: 5_000, surcharge: 5_000, total: 10_000 },
    { period: '2026-07', baseAmount: 5_000, surcharge: 5_000, total: 10_000 },
  ],
  charges: [],
  total: 20_000,
  cashbox: { id: 2, type: 'block', label: 'S1-M01' },
  paperFolio: '001234',
  receipts: [
    { id: 1, paperFolio: '001234', type: 'original', issuedAt: '2026-10-25T18:30:00.000Z' },
  ],
  occurredAt: '2026-10-25T18:30:00.000Z',
  capturedBy: { userAccountId: 6, username: 'jm.s1m01' },
  cancelled: false,
  cancellations: [],
  ...change,
});

export const CANCELLATION: Approval = {
  id: 32,
  type: 'payment_cancellation',
  status: 'pending',
  reason: 'Se registró en la familia equivocada.',
  description: 'Cancelar el pago PG-000981 ($200.00)',
  subject: { type: 'payment', id: 981 },
  requestedBy: {
    userAccountId: 6,
    username: 'jm.s1m01',
    role: 'block_leader',
    fullName: 'Laura Méndez Ruiz',
  },
  requestedAt: '2026-10-26T16:00:00.000Z',
  resolvedBy: null,
  resolvedAt: null,
  resolutionReason: null,
};

export function fakeM6Api() {
  const state = {
    unit: UNIT,
    statement: STATEMENT,
    request: OPENING_REQUEST,
    payments: new Map<number, Payment>([[981, paymentOf(981)]]),
    /** Idempotency-Key → payment id (the API answers the stored payment). */
    keys: new Map<string, number>(),
    usedFolios: new Set<string>(['001234']),
    rates: RATES,
    fees: FEES,
    /** The family's pending extra charges (GET /units/45/extra-charges; M7). */
    charges: [] as ExtraCharge[],
    nextId: 1000,
  };
  const calls: Call[] = [];
  const overrides: { match: (call: Call) => boolean; reply: Reply }[] = [];

  const priced = (periods: string[]) =>
    state.statement.months.filter((m) => periods.includes(m.period));

  const route = (call: Call): Reply => {
    calls.push(call);
    const override = overrides.find((item) => item.match(call));
    if (override) {
      overrides.splice(overrides.indexOf(override), 1);
      return override.reply;
    }
    const url = new URL(call.url);
    const path = url.pathname.replace(/^\/v1/, '');
    const body = (call.body ?? {}) as Record<string, unknown>;
    const get = call.method === 'GET';
    const post = call.method === 'POST';

    if (get && path === '/units/45') return json(200, { unit: state.unit });
    if (get && path === '/units/45/account-statement')
      return json(200, { statement: state.statement });
    if (get && path === '/units/45/extra-charges') {
      return json(200, {
        charges: state.charges.filter(
          (charge) => url.searchParams.get('status') === 'all' || charge.status === 'pending',
        ),
      });
    }
    if (get && path === '/rates') return json(200, { rates: state.rates });
    if (get && path === '/fees') return json(200, { fees: state.fees });
    if (get && path === '/connection-requests/5') return json(200, { request: state.request });
    if (get && path === '/reports/block') return json(200, { report: ROSTER });
    if (get && path === '/cashboxes/mine') {
      return json(200, {
        cashbox: {
          cashbox: { id: 2, type: 'block', label: 'S1-M01' },
          balance: 345_000,
          collected: 595_000,
          handedOver: 300_000,
          pendingHandover: 100_000,
          available: 245_000,
          openingBalance: null,
        },
      });
    }
    if (get && path === '/handovers') return json(200, { data: [], next: null });
    if (get && path === '/approvals/32') return json(200, { approval: CANCELLATION });
    if (get && path === '/approvals') return json(200, { approvals: [CANCELLATION] });

    const payment = /^\/payments\/(\d+)$/.exec(path);
    if (get && payment) {
      const found = state.payments.get(Number(payment[1]));
      return found ? json(200, { payment: found }) : apiError(404, 'NOT_FOUND', 'No existe.');
    }

    if (post && (path === '/payments/preview' || path === '/payments')) {
      const periods = (body.periods as string[] | undefined) ?? [];
      const chargeIds = (body.extraChargeIds as number[] | undefined) ?? [];
      const months = priced(periods).map((m) => ({
        period: m.period,
        baseAmount: m.baseAmount ?? 0,
        surcharge: m.surcharge ?? 0,
        total: m.total ?? 0,
        kind: m.status === 'overdue' ? ('overdue' as const) : ('pending' as const),
      }));
      const opening = chargeIds.includes(9)
        ? [
            {
              id: 9,
              feeName: 'Apertura de toma',
              feeType: 'opening' as ExtraCharge['fee']['type'],
              amount: 150_000,
              connectionRequestId: 5 as number | null,
            },
          ]
        : [];
      const charges = [
        ...opening,
        ...state.charges
          .filter((charge) => chargeIds.includes(charge.id))
          .map((charge) => ({
            id: charge.id,
            feeName: charge.fee.name,
            feeType: charge.fee.type,
            amount: charge.amount,
            connectionRequestId: null,
          })),
      ];
      const total =
        months.reduce((sum, m) => sum + m.total, 0) + charges.reduce((s, c) => s + c.amount, 0);
      const unit = body.unitId ? { id: 45, folio: 'U-000045', holder: 'Juan Pérez López' } : null;
      if (path === '/payments/preview') {
        return json(200, {
          preview: {
            unit,
            months,
            charges,
            total,
            cashbox: { id: 2, type: 'block', label: 'S1-M01' },
          },
        });
      }
      const key = call.headers['Idempotency-Key'];
      if (!key) return apiError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Falta la clave.');
      const replayed = state.keys.get(key);
      if (replayed !== undefined) return json(201, { payment: state.payments.get(replayed) });
      if (body.expectedTotal !== total) {
        return apiError(409, 'TOTAL_CHANGED', 'El total cambió.', {
          total,
          expectedTotal: body.expectedTotal,
        });
      }
      const folio = String(body.paperFolio);
      if (state.usedFolios.has(folio)) {
        return apiError(409, 'DUPLICATE_PAPER_FOLIO', 'Folio repetido.');
      }
      const id = state.nextId++;
      const created = paymentOf(id, {
        unit,
        months: months.map(({ kind: _k, ...m }) => m),
        charges,
        total,
        paperFolio: folio,
        receipts: [
          { id, paperFolio: folio, type: 'original', issuedAt: '2026-10-25T18:30:00.000Z' },
        ],
      });
      state.payments.set(id, created);
      state.keys.set(key, id);
      state.usedFolios.add(folio);
      return json(201, { payment: created });
    }

    const replacement = /^\/payments\/(\d+)\/replacements$/.exec(path);
    if (post && replacement) {
      const id = Number(replacement[1]);
      const current = state.payments.get(id);
      if (!current) return apiError(404, 'NOT_FOUND', 'No existe.');
      const folio = String(body.paperFolio);
      if (state.usedFolios.has(folio)) return apiError(409, 'DUPLICATE_PAPER_FOLIO', 'Repetido.');
      state.usedFolios.add(folio);
      const next = {
        ...current,
        receipts: [
          ...current.receipts,
          {
            id: state.nextId++,
            paperFolio: folio,
            type: 'replacement' as const,
            issuedAt: '2026-10-26T18:30:00.000Z',
          },
        ],
      };
      state.payments.set(id, next);
      return json(201, { payment: next });
    }

    if (post && path === '/rates') {
      const created: Rate = {
        id: state.nextId++,
        effectivePeriod: String(body.effectivePeriod),
        amount: Number(body.amount),
        approvedOn: String(body.approvedOn),
        agreement: { id: Number(body.agreementId), folio: 'AC-000047' },
        status: 'pending',
        approvalId: state.nextId++,
        createdAt: '2026-11-18T16:00:00.000Z',
      };
      state.rates = [...state.rates, created];
      return json(201, { rate: created });
    }
    const amounts = /^\/fees\/(\d+)\/amounts$/.exec(path);
    if (post && amounts) {
      const fee = state.fees.find((item) => item.id === Number(amounts[1]));
      if (!fee) return apiError(404, 'NOT_FOUND', 'No existe.');
      const amount = { effectiveFrom: String(body.effectiveFrom), amount: Number(body.amount) };
      const next = { ...fee, currentAmount: amount, amounts: [amount, ...fee.amounts] };
      state.fees = state.fees.map((item) => (item.id === fee.id ? next : item));
      return json(201, { fee: next });
    }
    if (get && path === '/agreements') {
      return json(200, {
        data: [
          {
            id: 47,
            folio: 'AC-000047',
            meetingDate: '2026-10-24',
            topic: 'Tarifa 2027',
            result: 'approved_by_majority',
            votesFor: 7,
            votesAgainst: 2,
            abstentions: 1,
            minutesReference: null,
            correctsId: null,
          },
        ],
        next: null,
      });
    }
    return apiError(404, 'NOT_FOUND', `No existe ${call.method} ${path}.`);
  };

  return {
    route,
    calls,
    state,
    override(match: (call: Call) => boolean, reply: Reply) {
      overrides.push({ match, reply });
    },
    posts: (path: string) =>
      calls.filter((item) => item.method === 'POST' && new URL(item.url).pathname === `/v1${path}`),
  };
}
