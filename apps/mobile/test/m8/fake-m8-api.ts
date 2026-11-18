import type {
  AuditEntry,
  BlockReport,
  CashboxListItem,
  Closing,
  MyCashbox,
} from '@bella-vista/shared';
import { apiError, type Call, json, type Reply } from '../api/fake-api.js';
import { closing, REPORT } from '../m4/fake-m4-api.js';
import { ROSTER } from '../m5/fake-m5-api.js';

// API simulada de M8: closings that go draft → counted → reviewed → closed with the rules of the
// API (notes required with a difference, only who prepared it counts, only the president
// closes), the two reports and the audit log. The block report carries a holder with < & " to
// check that the PDF escapes it.

export const TRICKY_NAME = 'Ñandú <López> & "Hijos"';

export const BLOCK_REPORT: BlockReport = {
  ...ROSTER,
  connections: ROSTER.connections.map((connection, index) =>
    index === 0
      ? {
          ...connection,
          units: connection.units.map((unit, unitIndex) =>
            unitIndex === 0
              ? { ...unit, holder: { fullName: TRICKY_NAME, distinguishingNote: null } }
              : unit,
          ),
        }
      : connection,
  ),
};

const MONTH_FIGURES = {
  startingBalance: 235_000,
  openingBalances: 0,
  payments: 210_000,
  cancellations: 0,
  handoversOut: -100_000,
  handoversIn: 0,
  incomes: 0,
  expenses: 0,
  refunds: 0,
  adjustments: 0,
  expectedBalance: 345_000,
};

export const LEADER_OCTOBER = (change: Partial<Closing> = {}): Closing =>
  closing({
    id: 41,
    folio: 'CO-202610-000041',
    cashbox: { id: 10, type: 'block', label: 'S1-M01' },
    type: 'monthly',
    dateFrom: '2026-10-01',
    dateTo: '2026-10-31',
    status: 'draft',
    figures: MONTH_FIGURES,
    countedCash: null,
    difference: null,
    preparedBy: { userAccountId: 6, username: 'jm.s1m01', fullName: 'Laura Méndez Ruiz' },
    ...change,
  });

const audit = (change: Partial<AuditEntry> & Pick<AuditEntry, 'id'>): AuditEntry => ({
  userAccountId: 6,
  username: 'jm.s1m01',
  fullName: 'Laura Méndez Ruiz',
  role: 'block_leader',
  action: 'create',
  tableName: 'payment',
  recordId: 981,
  before: null,
  after: { folio: 'PG-202610-000981', total: 20_000 },
  reason: null,
  isTechnical: false,
  createdAt: '2026-10-25T18:30:00.000Z',
  ...change,
});

export const AUDIT: AuditEntry[] = [
  audit({ id: 3 }),
  audit({
    id: 2,
    userAccountId: 1,
    username: 'admin',
    fullName: 'Rolando Gómez Torres',
    role: 'superadmin',
    action: 'reset_password',
    tableName: 'user_account',
    recordId: 4,
    before: { mustChangePassword: false },
    after: { mustChangePassword: true, passwordHash: 'argon2id$secreto', refreshToken: 'tok' },
    reason: 'Olvidó su contraseña',
    isTechnical: true,
  }),
];

export function fakeM8Api() {
  const state = {
    /** The account the fake answers /cashboxes/mine for. */
    mine: 'block' as 'block' | 'committee',
    /** Who prepares the closings it opens (the token says nothing in this fake). */
    preparer: 'leader' as 'leader' | 'treasurer',
    nextBlock: '2026-10' as string | null,
    nextCommittee: '2026-10' as string | null,
    closings: [] as Closing[],
    nextId: 50,
  };
  const calls: Call[] = [];
  const overrides: { match: (call: Call) => boolean; reply: Reply }[] = [];

  const myCashbox = (): MyCashbox => ({
    cashbox:
      state.mine === 'block'
        ? { id: 10, type: 'block', label: 'S1-M01' }
        : { id: 1, type: 'committee', label: 'Comité' },
    balance: 345_000,
    collected: 210_000,
    handedOver: 100_000,
    pendingHandover: 0,
    available: 345_000,
    openingBalance: null,
    nextClosingPeriod: state.mine === 'block' ? state.nextBlock : state.nextCommittee,
  });
  const cashboxes = (): CashboxListItem[] => [
    {
      id: 1,
      type: 'committee',
      label: 'Comité',
      balance: 1_240_000,
      openingBalance: null,
      nextClosingPeriod: state.nextCommittee,
    },
    {
      id: 10,
      type: 'block',
      label: 'S1-M01',
      balance: 345_000,
      openingBalance: null,
      nextClosingPeriod: state.nextBlock,
    },
    {
      id: 11,
      type: 'block',
      label: 'S1-M02',
      balance: 0,
      openingBalance: null,
      nextClosingPeriod: null,
    },
  ];
  const save = (next: Closing) => {
    state.closings = [next, ...state.closings.filter((item) => item.id !== next.id)];
    return json(200, { closing: next });
  };

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

    if (get && path === '/cashboxes/mine') return json(200, { cashbox: myCashbox() });
    if (get && path === '/cashboxes') return json(200, { cashboxes: cashboxes() });
    if (get && path === '/handovers') return json(200, { data: [], next: null });
    if (get && path === '/reports/block') return json(200, { report: BLOCK_REPORT });
    if (get && path === '/reports/community') return json(200, { report: REPORT });
    if (get && path === '/approvals') return json(200, { approvals: [] });

    if (get && path === '/closings') {
      const status = url.searchParams.get('status');
      const period = url.searchParams.get('period');
      const cashboxId = url.searchParams.get('cashboxId');
      return json(200, {
        data: state.closings.filter(
          (item) =>
            (!status || item.status === status) &&
            (!period || item.dateFrom.startsWith(period) || item.dateTo.startsWith(period)) &&
            (!cashboxId || item.cashbox.id === Number(cashboxId)),
        ),
        next: null,
      });
    }
    if (post && path === '/closings') {
      const id = ++state.nextId;
      const monthly = body.type === 'monthly';
      const period = String(body.period ?? '2026-11');
      const box =
        body.cashboxId !== undefined
          ? cashboxes().find((item) => item.id === body.cashboxId)
          : cashboxes().find((item) => item.id === myCashbox().cashbox.id);
      const created = LEADER_OCTOBER({
        id,
        folio: `CO-202611-0000${id}`,
        cashbox: { id: box?.id ?? 10, type: box?.type ?? 'block', label: box?.label ?? 'S1-M01' },
        type: monthly ? 'monthly' : 'extraordinary',
        dateFrom: monthly ? `${period}-01` : '2026-11-01',
        dateTo: monthly ? `${period}-31` : '2026-11-18',
        preparedBy:
          state.preparer === 'treasurer'
            ? { userAccountId: 2, username: 'tesorero', fullName: 'Jorge Méndez Soto' }
            : { userAccountId: 6, username: 'jm.s1m01', fullName: 'Laura Méndez Ruiz' },
      });
      state.closings = [created, ...state.closings];
      return json(201, { closing: created });
    }
    const one = /^\/closings\/(\d+)(\/count|\/review|\/close)?$/.exec(path);
    if (one) {
      const found = state.closings.find((item) => item.id === Number(one[1]));
      if (!found) return apiError(404, 'NOT_FOUND', 'No existe ese corte.');
      if (get && !one[2]) return json(200, { closing: found });
      if (post && one[2] === '/count') {
        const counted = Number(body.countedCash);
        const difference = counted - found.figures.expectedBalance;
        const notes = typeof body.notes === 'string' ? body.notes : null;
        if (difference !== 0 && !notes) {
          return apiError(400, 'VALIDATION_ERROR', 'Datos inválidos', {
            issues: [
              { path: 'body.notes', message: 'Escriba las observaciones de la diferencia.' },
            ],
          });
        }
        return save({ ...found, status: 'counted', countedCash: counted, difference, notes });
      }
      if (post && one[2] === '/review') {
        return save({
          ...found,
          status: 'reviewed',
          reviewedBy: {
            userAccountId: 3,
            username: 'presidente',
            fullName: 'Rosa Elena Vargas Luna',
          },
          reviewedAt: '2026-11-02T18:00:00.000Z',
        });
      }
      if (post && one[2] === '/close') {
        return save({
          ...found,
          status: 'closed',
          closedBy: {
            userAccountId: 3,
            username: 'presidente',
            fullName: 'Rosa Elena Vargas Luna',
          },
          closedAt: '2026-11-02T19:00:00.000Z',
        });
      }
    }
    if (get && path === '/audit-log') {
      const tableName = url.searchParams.get('tableName');
      const role = url.searchParams.get('role');
      return json(200, {
        data: AUDIT.filter(
          (item) => (!tableName || item.tableName === tableName) && (!role || item.role === role),
        ),
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
