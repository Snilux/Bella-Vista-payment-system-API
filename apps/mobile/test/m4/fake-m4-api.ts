import type {
  Approval,
  Block,
  Closing,
  CommunityReport,
  Payment,
  PersonBasic,
  RoleAssignment,
  Section,
  SuspensionListItem,
} from '@bella-vista/shared';
import { apiError, type Call, json, type Reply } from '../api/fake-api.js';

// M4 · Organización y autorizaciones: an in-memory API with enough of /v1/sections, /v1/blocks,
// /v1/role-assignments, /v1/approvals, /v1/reports/community, /v1/closings, /v1/search and the
// G-11 requests for the screens. Every answer satisfies the shared schemas (the client
// validates them). Tests change `state` or `override` to script each case.

const person = (id: number, fullName: string, note: string | null = null): PersonBasic => ({
  id,
  folio: `P-${String(id).padStart(6, '0')}`,
  fullName,
  distinguishingNote: note,
});

export const PEOPLE = {
  laura: person(1, 'Laura Méndez Ruiz'),
  rogelio: person(2, 'Rogelio Castañeda Ortiz'),
  ernesto: person(8, 'Ernesto Vázquez Soto'),
  teresa: person(11, 'Teresa Navarro Cruz'),
  roberto: person(20, 'Roberto Sánchez Gil'),
} as const;

export function assignment(change: Partial<RoleAssignment> & Pick<RoleAssignment, 'id'>) {
  const base: RoleAssignment = {
    id: change.id,
    role: 'block_leader',
    status: 'active',
    person: { ...PEOPLE.laura },
    blockId: 1,
    blockCode: 'S1-M01',
    contactPhone: '5551002001',
    startDate: '2026-01-01',
    endDate: null,
    approvalId: null,
    hasAccount: true,
  };
  return { ...base, ...change };
}

export function approval(change: Partial<Approval> & Pick<Approval, 'id' | 'type'>): Approval {
  return {
    status: 'pending',
    reason: 'Motivo de prueba',
    description: null,
    subject: null,
    requestedBy: {
      userAccountId: 4,
      username: 'secretario',
      role: 'secretary',
      fullName: 'Silvia Montes',
    },
    requestedAt: '2026-11-17T16:00:00.000Z',
    resolvedBy: null,
    resolvedAt: null,
    resolutionReason: null,
    ...change,
  };
}

export function closing(change: Partial<Closing> & Pick<Closing, 'id'>): Closing {
  return {
    folio: `CC-${String(change.id).padStart(6, '0')}`,
    cashbox: { id: 10, type: 'block', label: 'S1-M01' },
    type: 'extraordinary',
    dateFrom: '2026-11-01',
    dateTo: '2026-11-17',
    status: 'counted',
    figures: {
      startingBalance: 0,
      openingBalances: 0,
      payments: 50_000,
      cancellations: 0,
      handoversOut: 0,
      handoversIn: 0,
      incomes: 0,
      expenses: 0,
      refunds: 0,
      adjustments: 0,
      expectedBalance: 50_000,
    },
    countedCash: 50_000,
    difference: 0,
    notes: null,
    preparedBy: { userAccountId: 2, username: 'tesorero' },
    reviewedBy: null,
    reviewedAt: null,
    closedBy: null,
    closedAt: null,
    ...change,
  };
}

const figures = { collected: 0, totalDue: 0, advances: 0, handedOver: 0, cashWithLeader: 0 };

export const REPORT: CommunityReport = {
  range: {
    from: '2026-11',
    to: '2026-11',
    dateFrom: '2026-11-01',
    dateTo: '2026-11-30',
    debtAsOf: '2026-11-18T12:00:00.000Z',
  },
  sections: [
    {
      id: 1,
      code: 'S1',
      name: 'Sección Centro',
      blocks: [],
      totals: { ...figures, activeUnits: 38 },
    },
    {
      id: 2,
      code: 'S2',
      name: 'Sección Lomas',
      blocks: [],
      totals: { ...figures, activeUnits: 12 },
    },
  ],
  supportCashboxes: [],
  committee: {
    cashboxId: 1,
    openingBalance: 0,
    collected: 0,
    handoversReceived: 0,
    incomes: 0,
    expensesByCategory: [],
    expenses: 0,
    refunds: 0,
    adjustments: 0,
    balance: 1_240_000,
  },
  totals: {
    collected: 0,
    cashWithLeaders: 1_945_000,
    cashInSupport: 0,
    committeeBalance: 1_240_000,
    expectedCommunityFunds: 3_185_000,
    totalDue: 4_830_000,
    advances: 0,
    closingDifferences: 0,
  },
};

const payment = (id: number): Payment => ({
  id,
  folio: 'PG-000981',
  unit: null,
  blockId: 1,
  months: [],
  charges: [],
  total: 20_000,
  cashbox: { id: 10, type: 'block', label: 'S1-M01' },
  paperFolio: '001234',
  receipts: [],
  occurredAt: '2026-11-10T16:00:00.000Z',
  capturedBy: { userAccountId: 6, username: 'jm.s1m01' },
  cancelled: false,
  cancellations: [
    {
      status: 'pending',
      approvalId: 90,
      reason: 'Se registró en la familia equivocada.',
      requestedAt: '2026-11-18T16:00:00.000Z',
      resolvedAt: null,
    },
  ],
});

export function initialState() {
  const sections: Section[] = [
    { id: 1, code: 'S1', name: 'Sección Centro', active: true },
    { id: 2, code: 'S2', name: 'Sección Lomas', active: true },
  ];
  const blocks: Block[] = [
    {
      id: 1,
      sectionId: 1,
      code: 'M01',
      fullCode: 'S1-M01',
      name: null,
      active: true,
      leader: { personId: 1, fullName: 'Laura Méndez Ruiz', contactPhone: '5551002001' },
    },
    {
      id: 2,
      sectionId: 1,
      code: 'M02',
      fullCode: 'S1-M02',
      name: null,
      active: true,
      leader: { personId: 2, fullName: 'Rogelio Castañeda Ortiz', contactPhone: '5551002002' },
    },
    {
      id: 3,
      sectionId: 2,
      code: 'M02',
      fullCode: 'S2-M02',
      name: null,
      active: true,
      leader: null,
    },
    {
      id: 4,
      sectionId: 2,
      code: 'M01',
      fullCode: 'S2-M01',
      name: null,
      active: true,
      leader: null,
    },
  ];
  const assignments: RoleAssignment[] = [
    assignment({
      id: 1,
      role: 'president',
      person: { ...PEOPLE.roberto },
      blockId: null,
      blockCode: null,
      contactPhone: null,
    }),
    assignment({ id: 2 }),
    assignment({
      id: 3,
      person: { ...PEOPLE.rogelio },
      blockId: 2,
      blockCode: 'S1-M02',
      contactPhone: '5551002002',
    }),
    assignment({
      id: 4,
      status: 'pending',
      person: { ...PEOPLE.teresa },
      blockId: 3,
      blockCode: 'S2-M02',
      contactPhone: '5551009999',
      startDate: '2026-11-18',
      approvalId: 31,
      hasAccount: false,
    }),
  ];
  const approvals: Approval[] = [
    approval({
      id: 31,
      type: 'role_assignment',
      reason: 'Acuerdo de asamblea del 15 de noviembre',
      description: 'Jefe de manzana S2-M02: Teresa Navarro Cruz, desde el 18 nov 2026',
    }),
    approval({
      id: 32,
      type: 'payment_cancellation',
      reason: 'Se registró en la familia equivocada.',
      description: 'Cancelar el pago PG-000981 ($200.00)',
      requestedBy: {
        userAccountId: 6,
        username: 'jm.s1m01',
        role: 'block_leader',
        fullName: 'Laura Méndez Ruiz',
      },
    }),
    approval({
      id: 33,
      type: 'payment_cancellation',
      description: 'Cancelar el pago PG-000990 ($50.00)',
    }),
  ];
  const closings: Closing[] = [];
  const suspensions: SuspensionListItem[] = [
    {
      id: 1,
      target: 'connection',
      connectionId: 3,
      unitId: null,
      periodFrom: '2026-08',
      periodTo: null,
      reason: 'Fuga sin reparar',
      agreementId: 40,
      agreement: { id: 40, folio: 'AC-000040' },
      connection: {
        id: 3,
        folio: 'T-0140',
        address: 'Calle Sauce 5',
        blockCode: 'S1-M02',
        unitCount: 2,
      },
      unit: null,
      createdAt: '2026-08-01T16:00:00.000Z',
    },
  ];
  return { sections, blocks, assignments, approvals, closings, suspensions, nextId: 100 };
}

export type M4State = ReturnType<typeof initialState>;

export function fakeM4Api() {
  const state = initialState();
  const calls: Call[] = [];
  /** A reply for the next matching call, before the in-memory answer. */
  const overrides: { match: (call: Call) => boolean; reply: Reply; once: boolean }[] = [];

  const route = (call: Call): Reply => {
    calls.push(call);
    const override = overrides.find((item) => item.match(call));
    if (override) {
      if (override.once) overrides.splice(overrides.indexOf(override), 1);
      return override.reply;
    }
    const url = new URL(call.url);
    const pathName = url.pathname.replace(/^\/v1/, '');
    const body = (call.body ?? {}) as Record<string, unknown>;
    const get = call.method === 'GET';

    if (get && pathName === '/sections') return json(200, { sections: state.sections });
    if (get && pathName === '/blocks') return json(200, { blocks: state.blocks });
    if (get && pathName === '/role-assignments') {
      return json(200, { assignments: state.assignments });
    }
    if (get && pathName === '/reports/community') return json(200, { report: REPORT });
    if (get && pathName === '/connection-requests') return json(200, { data: [], next: null });
    if (get && pathName === '/suspensions')
      return json(200, { data: state.suspensions, next: null });
    if (get && pathName === '/closings') {
      const status = url.searchParams.get('status');
      return json(200, {
        data: state.closings.filter((item) => !status || item.status === status),
        next: null,
      });
    }
    if (get && pathName === '/search') {
      const q = (url.searchParams.get('q') ?? '').toLowerCase();
      return json(200, {
        people: Object.values(PEOPLE).filter((item) => item.fullName.toLowerCase().includes(q)),
        connections: [],
        units: [],
      });
    }
    if (get && pathName === '/approvals') {
      const status = url.searchParams.get('status') ?? 'pending';
      const approvals = state.approvals.filter((item) =>
        status === 'all'
          ? true
          : status === 'pending'
            ? item.status === 'pending'
            : item.status !== 'pending',
      );
      return json(200, { approvals });
    }

    const one = /^\/approvals\/(\d+)$/.exec(pathName);
    if (get && one) {
      const found = state.approvals.find((item) => item.id === Number(one[1]));
      return found ? json(200, { approval: found }) : apiError(404, 'NOT_FOUND', 'No existe.');
    }
    const resolve = /^\/approvals\/(\d+)\/resolve$/.exec(pathName);
    if (call.method === 'POST' && resolve) {
      const id = Number(resolve[1]);
      const current = state.approvals.find((item) => item.id === id);
      if (!current) return apiError(404, 'NOT_FOUND', 'No existe esa solicitud.');
      if (current.status !== 'pending') {
        return apiError(409, 'APPROVAL_ALREADY_RESOLVED', 'Esta solicitud ya fue resuelta.');
      }
      const result = body.result === 'approved' ? 'approved' : 'rejected';
      if (result === 'rejected' && !body.reason) {
        return apiError(400, 'VALIDATION_ERROR', 'Datos inválidos', {
          issues: [{ path: 'body.reason', message: 'Escriba el motivo del rechazo.' }],
        });
      }
      const next: Approval = {
        ...current,
        status: result,
        resolvedBy: {
          userAccountId: 3,
          username: 'presidente',
          role: 'president',
          fullName: 'Roberto Sánchez Gil',
        },
        resolvedAt: '2026-11-18T17:00:00.000Z',
        resolutionReason: typeof body.reason === 'string' ? body.reason : null,
      };
      state.approvals = state.approvals.map((item) => (item.id === id ? next : item));
      return json(200, { approval: next });
    }

    if (call.method === 'POST' && pathName === '/blocks') {
      const section = state.sections.find((item) => item.id === body.sectionId);
      const code = String(body.code);
      const block: Block = {
        id: state.nextId++,
        sectionId: Number(body.sectionId),
        code,
        fullCode: `${section?.code ?? '?'}-${code}`,
        name: (body.name as string | null) ?? null,
        active: true,
        leader: null,
      };
      state.blocks = [...state.blocks, block];
      return json(201, { block });
    }
    if (call.method === 'POST' && pathName === '/sections') {
      const section: Section = {
        id: state.nextId++,
        code: String(body.code),
        name: String(body.name),
        active: true,
      };
      state.sections = [...state.sections, section];
      return json(201, { section });
    }
    if (call.method === 'POST' && pathName === '/role-assignments') {
      const chosen =
        Object.values(PEOPLE).find((item) => item.id === body.personId) ?? PEOPLE.ernesto;
      const block = state.blocks.find((item) => item.id === body.blockId);
      const created = assignment({
        id: state.nextId++,
        role: body.role as RoleAssignment['role'],
        status: 'pending',
        person: { ...chosen },
        blockId: block?.id ?? null,
        blockCode: block?.fullCode ?? null,
        contactPhone: (body.contactPhone as string | null) ?? null,
        startDate: String(body.startDate),
        approvalId: state.nextId++,
        hasAccount: false,
      });
      state.assignments = [...state.assignments, created];
      return json(201, { assignment: created });
    }
    const substitution = /^\/blocks\/(\d+)\/leader-substitution$/.exec(pathName);
    if (call.method === 'POST' && substitution) {
      const blockId = Number(substitution[1]);
      const outgoing = state.assignments.find(
        (item) => item.blockId === blockId && item.status === 'active',
      );
      if (!outgoing) return apiError(409, 'INVALID_STATE', 'Sin jefe', { status: 'no_leader' });
      const chosen =
        Object.values(PEOPLE).find((item) => item.id === body.personId) ?? PEOPLE.ernesto;
      const ended = { ...outgoing, status: 'closed' as const, endDate: String(body.startDate) };
      const incoming = assignment({
        id: state.nextId++,
        status: 'pending',
        person: { ...chosen },
        blockId,
        blockCode: outgoing.blockCode,
        contactPhone: String(body.contactPhone),
        startDate: String(body.startDate),
        approvalId: state.nextId++,
        hasAccount: false,
      });
      state.assignments = [
        ...state.assignments.map((item) => (item.id === outgoing.id ? ended : item)),
        incoming,
      ];
      return json(200, { outgoing: ended, incoming });
    }

    const request = /^\/(units|payments|expenses)\/(\d+)\/(request-[a-z-]+)$/.exec(pathName);
    if (call.method === 'POST' && request) {
      const id = Number(request[2]);
      if (request[1] === 'payments') return json(201, { payment: payment(id) });
      if (request[1] === 'units') {
        return json(201, {
          request: {
            id: state.nextId++,
            unitId: id,
            type: request[3] === 'request-deactivation' ? 'deactivation' : 'holder_change',
            newHolder: request[3] === 'request-holder-change' ? { ...PEOPLE.ernesto } : null,
            approvalId: state.nextId++,
          },
        });
      }
    }
    return apiError(404, 'NOT_FOUND', 'No existe.');
  };

  return {
    route,
    calls,
    state,
    /** The next call that matches gets `reply` (only once unless `once` is false). */
    override(match: (call: Call) => boolean, reply: Reply, once = true) {
      overrides.push({ match, reply, once });
    },
    posts: (suffix: string) =>
      calls.filter((item) => item.method === 'POST' && new URL(item.url).pathname.endsWith(suffix)),
  };
}
