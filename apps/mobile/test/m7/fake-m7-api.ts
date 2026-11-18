import type {
  Approval,
  CashboxListItem,
  CashboxMovement,
  Expense,
  Handover,
  MyCashbox,
  PlumberDetail,
} from '@bella-vista/shared';
import { apiError, type Call, json, type Reply } from '../api/fake-api.js';

// API simulada de M7 (cajas, entregas, gastos, fontanero, saldos iniciales): it keeps the
// balances of the block cashbox S1-M03 (id 3) and the committee cashbox (id 1) the way the API
// does (D-16: a handover moves cash only when confirmed, by the amount received), stores the
// answer of each Idempotency-Key (a repeated key answers the same, nothing is applied twice) and
// can lose the answer of a request after applying it (`loseAnswer`), like a dropped connection.

const BLOCK = { id: 3, type: 'block' as const, label: 'S1-M03' };
const COMMITTEE = { id: 1, type: 'committee' as const, label: 'Comité' };
const SUPPORT = { id: 9, type: 'support' as const, label: 'Apoyo · Rosa Díaz' };

const LEADER_REF = { userAccountId: 7, username: 'jm.s1m03', fullName: 'María López Torres' };
const TREASURER_REF = { userAccountId: 3, username: 'tesorero' };

export const handover = (overrides: Partial<Handover> = {}): Handover => ({
  id: 31,
  folio: 'EN-202610-000031',
  cashbox: BLOCK,
  date: '2026-10-25',
  declaredAmount: 300_000,
  receivedAmount: null,
  difference: null,
  adjustedAmount: null,
  notes: null,
  status: 'pending',
  preparedBy: LEADER_REF,
  withdrawnAt: null,
  confirmedAt: null,
  confirmedBy: null,
  ...overrides,
});

const REPAIRS = { id: 2, name: 'Reparaciones', isPlumberSalary: false };
const PLUMBER_SALARY = { id: 5, name: 'Salario del fontanero', isPlumberSalary: true };
const CATEGORIES = [
  { id: 1, name: 'Electricidad', isPlumberSalary: false },
  REPAIRS,
  PLUMBER_SALARY,
];

const AGREEMENT = {
  id: 45,
  folio: 'AC-000045',
  meetingDate: '2026-10-12',
  topic: 'Gastos de octubre',
  result: 'approved_by_majority',
  votesFor: 7,
  votesAgainst: 1,
  abstentions: 0,
  minutesReference: null,
  correctsId: null,
};

export const expense = (overrides: Partial<Expense> = {}): Expense => ({
  id: 89,
  folio: 'GA-202610-000089',
  category: { id: 2, name: 'Reparaciones', isPlumberSalary: false },
  description: 'Cambio de válvula',
  amount: 180_000,
  agreement: { id: 45, folio: 'AC-000045' },
  status: 'pending_payment',
  paidOn: null,
  rejectedOn: null,
  rejectionReason: null,
  voucherReference: 'Nota 5521',
  plumberPayment: null,
  refunds: [],
  ...overrides,
});

const SALARY = {
  id: 4,
  amount: 250_000,
  frequency: 'biweekly' as const,
  effectiveFrom: '2026-01-01',
  agreement: { id: 38, folio: 'AC-000038' },
  status: 'approved' as const,
  approvalId: 12,
};

const PLUMBER: PlumberDetail = {
  id: 2,
  name: 'Pedro Ramírez Cruz',
  phone: '222 987 6543',
  active: true,
  currentSalary: SALARY,
  salaries: [SALARY],
  payments: [
    {
      expenseId: 88,
      folio: 'GA-202610-000088',
      periodStart: '2026-10-01',
      periodEnd: '2026-10-15',
      amount: 250_000,
      paidOn: '2026-10-15',
      status: 'paid',
    },
  ],
};

export const ADJUSTMENT_APPROVAL: Approval = {
  id: 61,
  type: 'adjustment',
  status: 'pending',
  description: 'Aclaración de -$50.00 en la entrega EN-202610-000031',
  reason: 'Billete falso',
  requestedBy: {
    userAccountId: 3,
    username: 'tesorero',
    role: 'treasurer',
    fullName: 'Jorge Méndez Soto',
  },
  requestedAt: '2026-10-25T18:00:00.000Z',
  resolvedBy: null,
  resolvedAt: null,
  resolutionReason: null,
  subject: { type: 'handover', id: 31 },
};

export function fakeM7Api() {
  const state = {
    /** Whose cashbox /cashboxes/mine answers (the session's role decides it in the API). */
    mine: 'block' as 'block' | 'committee' | 'support',
    block: { balance: 500_000, collected: 650_000, handedOver: 200_000, opening: 50_000 },
    committee: { balance: 1_240_000 },
    support: { balance: 25_000, collected: 25_000 },
    handovers: [handover()] as Handover[],
    expenses: [expense()] as Expense[],
    plumber: PLUMBER,
    movements: [
      {
        occurredOn: '2026-10-25',
        kind: 'payment',
        amount: 20_000,
        tableName: 'payment',
        recordId: 412,
        folio: 'PG-202610-000412',
        detail: 'Ana Torres Ruiz',
      },
      {
        occurredOn: '2026-10-01',
        kind: 'opening_balance',
        amount: 50_000,
        tableName: 'opening_balance',
        recordId: 3,
        folio: null,
        detail: null,
      },
    ] as CashboxMovement[],
    openings: new Map<number, CashboxListItem['openingBalance']>([
      [
        1,
        {
          id: 1,
          cashboxId: 1,
          amount: 400_000,
          date: '2026-01-02',
          status: 'approved',
          approvalId: 2,
        },
      ],
      [
        3,
        {
          id: 2,
          cashboxId: 3,
          amount: 35_000,
          date: '2026-01-02',
          status: 'pending',
          approvalId: 3,
        },
      ],
    ]),
    /** Idempotency-Key → the reply it got (the API answers it again, nothing applied twice). */
    keys: new Map<string, Reply>(),
    nextId: 100,
  };
  const calls: Call[] = [];
  const overrides: { match: (call: Call) => boolean; reply: Reply }[] = [];
  const lost: ((call: Call) => boolean)[] = [];

  const pendingOf = (cashboxId: number) =>
    state.handovers
      .filter((item) => item.cashbox.id === cashboxId && item.status === 'pending')
      .reduce((sum, item) => sum + item.declaredAmount, 0);

  const mine = (): MyCashbox => {
    if (state.mine === 'committee') {
      return {
        cashbox: COMMITTEE,
        balance: state.committee.balance,
        collected: 0,
        handedOver: 0,
        pendingHandover: 0,
        available: state.committee.balance,
        openingBalance: state.openings.get(1) ?? null,
        nextClosingPeriod: null,
      };
    }
    if (state.mine === 'support') {
      const pending = pendingOf(SUPPORT.id);
      return {
        cashbox: SUPPORT,
        balance: state.support.balance,
        collected: state.support.collected,
        handedOver: 0,
        pendingHandover: pending,
        available: state.support.balance - pending,
        openingBalance: null,
        nextClosingPeriod: null,
      };
    }
    const pending = pendingOf(BLOCK.id);
    return {
      cashbox: BLOCK,
      balance: state.block.balance,
      collected: state.block.collected,
      handedOver: state.block.handedOver,
      pendingHandover: pending,
      available: state.block.balance - pending,
      openingBalance: {
        id: 9,
        cashboxId: 3,
        amount: state.block.opening,
        date: '2026-01-02',
        status: 'approved',
        approvalId: 4,
      },
      nextClosingPeriod: null,
    };
  };

  const list = (): CashboxListItem[] => [
    {
      ...COMMITTEE,
      balance: state.committee.balance,
      openingBalance: state.openings.get(1) ?? null,
      nextClosingPeriod: null,
    },
    {
      ...BLOCK,
      balance: state.block.balance,
      openingBalance: state.openings.get(3) ?? null,
      nextClosingPeriod: null,
    },
    {
      id: 4,
      type: 'block',
      label: 'S2-M01',
      balance: 0,
      openingBalance: state.openings.get(4) ?? null,
      nextClosingPeriod: null,
    },
  ];

  /** Applies a money POST; with a key it is applied once and its reply stored. */
  const keyed = (call: Call, apply: () => Reply): Reply => {
    const key = call.headers['Idempotency-Key'];
    if (key) {
      const stored = state.keys.get(key);
      if (stored) return stored;
    }
    const reply = apply();
    if (key) state.keys.set(key, reply);
    return reply;
  };

  const handle = (call: Call): Reply => {
    const url = new URL(call.url);
    const path = url.pathname.replace(/^\/v1/, '');
    const body = (call.body ?? {}) as Record<string, unknown>;
    const get = call.method === 'GET';
    const post = call.method === 'POST';

    if (get && path === '/cashboxes/mine') return json(200, { cashbox: mine() });
    if (get && path === '/cashboxes') return json(200, { cashboxes: list() });
    if (get && /^\/cashboxes\/\d+\/movements$/.test(path)) {
      return json(200, { data: state.movements, next: null });
    }
    const opening = /^\/cashboxes\/(\d+)\/opening-balance$/.exec(path);
    if (post && opening) {
      return keyed(call, () => {
        const cashboxId = Number(opening[1]);
        const item = {
          id: ++state.nextId,
          cashboxId,
          amount: Number(body.amount),
          date: String(body.date),
          status: 'pending' as const,
          approvalId: ++state.nextId,
        };
        state.openings.set(cashboxId, item);
        return json(201, { openingBalance: item });
      });
    }

    // --- Handovers ---
    if (get && path === '/handovers') {
      const status = url.searchParams.get('status');
      const own = state.mine === 'committee' ? null : mine().cashbox.id;
      return json(200, {
        data: state.handovers.filter(
          (item) =>
            (!status || item.status === status) && (own === null || item.cashbox.id === own),
        ),
        next: null,
      });
    }
    if (post && path === '/handovers') {
      return keyed(call, () => {
        const box = mine();
        const declared = Number(body.declaredAmount);
        if (declared > box.available) {
          return apiError(409, 'INSUFFICIENT_BALANCE', 'El importe es mayor que lo disponible.');
        }
        const created = handover({
          id: ++state.nextId,
          folio: `EN-202610-0000${state.nextId}`,
          cashbox: box.cashbox.id === SUPPORT.id ? SUPPORT : BLOCK,
          declaredAmount: declared,
          notes: (body.notes as string | undefined) ?? null,
        });
        state.handovers = [created, ...state.handovers];
        return json(201, { handover: created });
      });
    }
    const one = /^\/handovers\/(\d+)(\/withdraw|\/confirm)?$/.exec(path);
    if (one) {
      const id = Number(one[1]);
      const found = state.handovers.find((item) => item.id === id);
      if (!found) return apiError(404, 'NOT_FOUND', 'No existe esa entrega.');
      if (get && !one[2]) return json(200, { handover: found });
      if (post && one[2] === '/withdraw') {
        if (found.status !== 'pending')
          return apiError(409, 'INVALID_STATE', 'Ya no está pendiente.');
        const next = {
          ...found,
          status: 'withdrawn' as const,
          withdrawnAt: '2026-10-25T19:00:00Z',
        };
        state.handovers = state.handovers.map((item) => (item.id === id ? next : item));
        return json(200, { handover: next });
      }
      if (post && one[2] === '/confirm') {
        return keyed(call, () => {
          if (found.status !== 'pending') {
            return apiError(409, 'INVALID_STATE', 'La entrega ya está confirmada.');
          }
          const received = Number(body.receivedAmount);
          const difference = found.declaredAmount - received;
          // D-16: the source only goes down by what was received; the committee goes up the same.
          state.block.balance -= received;
          state.block.handedOver += received;
          state.committee.balance += received;
          const next: Handover = {
            ...found,
            receivedAmount: received,
            difference,
            status: difference > 0 ? 'with_difference' : 'confirmed',
            confirmedAt: '2026-10-25T19:00:00Z',
            confirmedBy: TREASURER_REF,
          };
          state.handovers = state.handovers.map((item) => (item.id === id ? next : item));
          return json(200, { handover: next });
        });
      }
    }
    if (post && path === '/adjustments') {
      return keyed(call, () =>
        json(201, {
          adjustment: {
            id: ++state.nextId,
            cashboxId: 3,
            handoverId: body.handoverId,
            closingId: null,
            amount: body.amount,
            date: '2026-10-25',
            status: 'pending',
            approvalId: 61,
          },
        }),
      );
    }

    // --- Committee ---
    if (get && path === '/expense-categories') return json(200, { categories: CATEGORIES });
    if (get && path === '/agreements') return json(200, { data: [AGREEMENT], next: null });
    if (get && path === '/expenses') {
      const status = url.searchParams.get('status');
      return json(200, {
        data: state.expenses.filter((item) => !status || item.status === status),
        next: null,
      });
    }
    if (post && path === '/expenses') {
      return keyed(call, () => {
        const category = CATEGORIES.find((item) => item.id === body.categoryId) ?? REPAIRS;
        const created = expense({
          id: ++state.nextId,
          folio: `GA-202610-000${state.nextId}`,
          category,
          description: String(body.description),
          amount: Number(body.amount),
          voucherReference: (body.voucherReference as string | undefined) ?? null,
        });
        state.expenses = [created, ...state.expenses];
        return json(201, { expense: created });
      });
    }
    const exp = /^\/expenses\/(\d+)(\/pay|\/reject|\/request-refund)?$/.exec(path);
    if (exp) {
      const id = Number(exp[1]);
      const found = state.expenses.find((item) => item.id === id);
      if (!found) return apiError(404, 'NOT_FOUND', 'No existe ese gasto.');
      const save = (next: Expense) => {
        state.expenses = state.expenses.map((item) => (item.id === id ? next : item));
        return json(200, { expense: next });
      };
      if (get && !exp[2]) return json(200, { expense: found });
      if (post && exp[2] === '/pay') {
        return keyed(call, () => {
          if (found.amount > state.committee.balance) {
            return apiError(
              409,
              'INSUFFICIENT_BALANCE',
              'El importe es mayor que lo disponible en la caja.',
            );
          }
          state.committee.balance -= found.amount;
          return save({ ...found, status: 'paid', paidOn: '2026-10-25' });
        });
      }
      if (post && exp[2] === '/reject') {
        return save({
          ...found,
          status: 'rejected',
          rejectedOn: '2026-10-25',
          rejectionReason: String(body.reason),
        });
      }
      if (post && exp[2] === '/request-refund') {
        return keyed(call, () =>
          save({ ...found, refunds: [{ approvalId: 70, status: 'pending', date: '2026-10-25' }] }),
        );
      }
    }
    if (get && path === '/plumbers') return json(200, { plumbers: [state.plumber] });
    if (get && path === '/plumbers/2') return json(200, { plumber: state.plumber });
    if (post && path === '/plumbers/2/payments') {
      return keyed(call, () => {
        const date = String(body.date);
        const start = date.slice(8) <= '15' ? `${date.slice(0, 8)}01` : `${date.slice(0, 8)}16`;
        if (state.plumber.payments.some((item) => item.periodStart === start)) {
          return apiError(409, 'PERIOD_ALREADY_PAID', 'Ese periodo ya está pagado.');
        }
        state.committee.balance -= SALARY.amount;
        const id = ++state.nextId;
        const [year, month] = date.split('-').map(Number);
        const last = new Date(Date.UTC(year ?? 2026, month ?? 1, 0)).getUTCDate();
        const end = start.endsWith('01') ? `${date.slice(0, 8)}15` : `${date.slice(0, 8)}${last}`;
        state.plumber = {
          ...state.plumber,
          payments: [
            {
              expenseId: id,
              folio: `GA-202610-000${id}`,
              periodStart: start,
              periodEnd: end,
              amount: SALARY.amount,
              paidOn: '2026-10-25',
              status: 'paid',
            },
            ...state.plumber.payments,
          ],
        };
        return json(201, {
          expense: expense({
            id,
            folio: `GA-202610-000${id}`,
            category: PLUMBER_SALARY,
            description: `Salario de Pedro Ramírez Cruz, del ${start} al ${end}`,
            amount: SALARY.amount,
            agreement: SALARY.agreement,
            status: 'paid',
            paidOn: '2026-10-25',
            voucherReference: null,
            plumberPayment: { plumberId: 2, periodStart: start, periodEnd: end },
          }),
        });
      });
    }
    if (get && path === '/approvals/61') return json(200, { approval: ADJUSTMENT_APPROVAL });
    if (get && path === '/approvals') return json(200, { approvals: [ADJUSTMENT_APPROVAL] });
    if (get && path === '/reports/community') return apiError(404, 'NOT_FOUND', 'Sin reporte.');
    return apiError(404, 'NOT_FOUND', `No existe ${call.method} ${path}.`);
  };

  const route = (call: Call): Reply => {
    calls.push(call);
    const override = overrides.find((item) => item.match(call));
    if (override) {
      overrides.splice(overrides.indexOf(override), 1);
      return override.reply;
    }
    const reply = handle(call);
    const lose = lost.find((match) => match(call));
    if (lose) {
      lost.splice(lost.indexOf(lose), 1);
      return { networkError: true };
    }
    return reply;
  };

  const pathOf = (call: Call) => new URL(call.url).pathname.replace(/^\/v1/, '');
  return {
    route,
    calls,
    state,
    /** The next matching request gets this reply instead (nothing is applied). */
    override(match: (call: Call) => boolean, reply: Reply) {
      overrides.push({ match, reply });
    },
    /** The next matching request is applied, but its answer never arrives. */
    loseAnswer(match: (call: Call) => boolean) {
      lost.push(match);
    },
    posts: (path: string) =>
      calls.filter((item) => item.method === 'POST' && pathOf(item) === path),
  };
}
