import type {
  Agreement,
  BlockReport,
  ConnectionDetail,
  ConnectionRequest,
  Fee,
  PersonBasic,
  PersonDetail,
  Rate,
  SearchResponse,
  SuspensionListItem,
  UnitDetail,
} from '@bella-vista/shared';
import { apiError, type Call, json, type Reply } from '../api/fake-api.js';

// M5 · Padrón y tomas: an in-memory API with enough of /v1/search, /v1/people, /v1/connections,
// /v1/units, /v1/reports/block, /v1/rates, /v1/fees, /v1/connection-requests, /v1/agreements and
// /v1/suspensions for the screens. Every answer satisfies the shared schemas (the client
// validates them). What a role receives is what each test puts in `state` (the API decides it).

const debt = (totalDue = 0, overdueCount = 0) => ({
  totalDue,
  overdueCount,
  inDebtCycle: overdueCount > 0,
});

export const JOSE: PersonBasic = {
  id: 4,
  folio: 'P-000004',
  fullName: 'José Luis Hernández García',
  distinguishingNote: 'Papá, Av. Hidalgo',
};
export const ERNESTO: PersonBasic = {
  id: 8,
  folio: 'P-000008',
  fullName: 'Ernesto Vázquez Soto',
  distinguishingNote: null,
};

/** Full file of José: a family in S1-M01 and one in another block. */
export const JOSE_FULL: PersonDetail = {
  ...JOSE,
  access: 'full',
  givenNames: 'José Luis',
  paternalSurname: 'Hernández',
  maternalSurname: 'García',
  phone: '5551009090',
  registeredOn: '2024-03-12',
  units: [
    {
      scope: 'own',
      id: 1,
      folio: 'U-000001',
      reference: null,
      status: 'active',
      connectionId: 1,
      connectionFolio: 'T-000001',
      address: 'Av. Hidalgo 12',
      blockCode: 'S1-M01',
      holderSince: '2024-03-12',
      debt: debt(45_000, 4),
    },
    { scope: 'other_block' },
  ],
  totalDue: 45_000,
  connectionRequests: [],
};

export const CONNECTION: ConnectionDetail = {
  id: 1,
  folio: 'T-000001',
  address: 'Av. Hidalgo 12',
  status: 'active',
  activatedOn: '2019-01-15',
  deactivatedOn: null,
  blockId: 1,
  blockCode: 'S1-M01',
  connectionRequestId: null,
  units: [
    {
      id: 1,
      folio: 'U-000001',
      reference: null,
      status: 'active',
      billingStartPeriod: '2025-07',
      holder: JOSE,
      debt: debt(45_000, 4),
    },
    {
      id: 2,
      folio: 'U-000002',
      reference: 'Casa de atrás',
      status: 'active',
      billingStartPeriod: '2026-11',
      holder: ERNESTO,
      debt: debt(5_000, 0),
    },
  ],
  totalDue: 50_000,
};

const reportUnit = (
  id: number,
  holder: string,
  status: 'active' | 'suspended',
  owes: ReturnType<typeof debt>,
) => ({
  id,
  folio: `U-00000${id}`,
  reference: null,
  holder: { fullName: holder, distinguishingNote: null },
  registeredOn: '2025-01-01',
  activatedOn: '2025-01-01',
  status,
  payments: [],
  debtMonths: [],
  debt: owes,
  advances: [],
});

export const ROSTER: BlockReport = {
  range: {
    from: '2026-11',
    to: '2026-11',
    dateFrom: '2026-11-01',
    dateTo: '2026-11-30',
    debtAsOf: '2026-11-18T12:00:00.000Z',
  },
  block: {
    id: 1,
    code: 'S1-M01',
    name: null,
    section: { id: 1, code: 'S1', name: 'Sección Centro' },
    leader: { fullName: 'Laura Méndez Ruiz', phone: '5551002001' },
  },
  connections: [
    {
      id: 1,
      folio: 'T-000001',
      address: 'Av. Hidalgo 12',
      status: 'active',
      units: [
        reportUnit(1, 'José Luis Hernández García', 'active', debt(45_000, 4)),
        reportUnit(2, 'Ernesto Vázquez Soto', 'active', debt(5_000, 0)),
      ],
    },
    {
      id: 2,
      folio: 'T-000002',
      address: 'Calle Juárez 8',
      status: 'suspended',
      units: [reportUnit(3, 'Carmen Aguilar', 'suspended', debt(0, 0))],
    },
    {
      id: 3,
      folio: 'T-000003',
      address: 'Calle Morelos 45',
      status: 'active',
      units: [reportUnit(4, 'Rafael Domínguez Flores', 'active', debt(0, 0))],
    },
  ],
  cashbox: {
    id: 2,
    label: 'S1-M01',
    openingBalance: null,
    collectedFees: 0,
    collectedCharges: 0,
    cancellations: 0,
    collected: 0,
    handedOver: 0,
    pendingHandover: 0,
    expectedBalance: 0,
    lastClosing: null,
  },
  totals: { activeUnits: 4, collected: 0, totalDue: 50_000, advances: 0 },
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
    agreement: { id: 2, folio: 'AC-000002' },
    status: 'approved',
    approvalId: 2,
    createdAt: '2025-12-06T16:00:00.000Z',
  },
];

export const OPENING_FEE: Fee = {
  id: 1,
  type: 'opening',
  name: 'Apertura de toma',
  currentAmount: { effectiveFrom: '2025-01-01', amount: 150_000 },
  amounts: [{ effectiveFrom: '2025-01-01', amount: 150_000 }],
};

export const agreement = (id: number, result: Agreement['result'], topic: string): Agreement => ({
  id,
  folio: `AC-0000${id}`,
  meetingDate: '2026-10-24',
  topic,
  result,
  votesFor: 7,
  votesAgainst: 2,
  abstentions: 1,
  minutesReference: 'Acta 2026-19',
  correctsId: null,
});

export function request(change: Partial<ConnectionRequest> & Pick<ConnectionRequest, 'id'>) {
  const base: ConnectionRequest = {
    id: change.id,
    folio: `ST-00001${change.id}`,
    status: 'requested',
    applicant: ERNESTO,
    address: 'Calle Encino 8',
    blockId: 1,
    blockCode: 'S1-M01',
    requestedOn: '2026-10-03',
    agreement: null,
    resolutionReason: null,
    cancelledOn: null,
    cancellationReason: null,
    openingCharge: null,
    connectionId: null,
  };
  return { ...base, ...change };
}

export function initialState() {
  return {
    /** What GET /v1/search answers (the API already filtered it by role). */
    search: {
      people: [
        JOSE,
        { ...JOSE, id: 5, folio: 'P-000005', distinguishingNote: 'Hijo, Calle Morelos' },
      ],
      connections: [
        {
          id: 1,
          folio: 'T-000001',
          address: 'Av. Hidalgo 12',
          blockCode: 'S1-M01',
          status: 'active',
          unitCount: 2,
        },
      ],
      units: [
        {
          id: 1,
          folio: 'U-000001',
          reference: null,
          status: 'active',
          connectionId: 1,
          connectionFolio: 'T-000001',
          address: 'Av. Hidalgo 12',
          blockCode: 'S1-M01',
          holder: JOSE,
          debt: debt(45_000, 4),
        },
      ],
    } as SearchResponse,
    people: new Map<number, PersonDetail>([[JOSE.id, JOSE_FULL]]),
    /** GET /v1/people/matches. */
    matches: { exact: [] as PersonBasic[], similar: [] as PersonBasic[] },
    connections: new Map<number, ConnectionDetail>([[CONNECTION.id, CONNECTION]]),
    requests: [
      request({ id: 3 }),
      request({
        id: 4,
        status: 'pending_installation',
        applicant: JOSE,
        agreement: { id: 47, folio: 'AC-000047', result: 'approved_by_majority' },
        openingCharge: {
          id: 9,
          feeName: 'Apertura de toma',
          amount: 150_000,
          chargedOn: '2026-10-24',
          cancelledOn: null,
        },
      }),
      request({
        id: 5,
        status: 'approved_pending_payment',
        agreement: { id: 47, folio: 'AC-000047', result: 'approved_by_majority' },
        openingCharge: {
          id: 10,
          feeName: 'Apertura de toma',
          amount: 150_000,
          chargedOn: '2026-10-24',
          cancelledOn: null,
        },
      }),
    ] as ConnectionRequest[],
    agreements: [
      agreement(47, 'approved_by_majority', 'Solicitud de toma ST-000013'),
      agreement(44, 'rejected', 'Solicitud de toma ST-000010'),
    ],
    suspensions: [
      {
        id: 1,
        target: 'connection',
        connectionId: 2,
        unitId: null,
        periodFrom: '2026-08',
        periodTo: null,
        reason: 'Fuga sin reparar',
        agreementId: 40,
        agreement: { id: 40, folio: 'AC-000040' },
        connection: {
          id: 2,
          folio: 'T-000002',
          address: 'Calle Juárez 8',
          blockCode: 'S1-M01',
          unitCount: 2,
        },
        unit: null,
        createdAt: '2026-08-01T16:00:00.000Z',
      },
      {
        id: 2,
        target: 'unit',
        connectionId: null,
        unitId: 77,
        periodFrom: '2026-09',
        periodTo: null,
        reason: 'A petición del titular',
        agreementId: 43,
        agreement: { id: 43, folio: 'AC-000043' },
        connection: {
          id: 5,
          folio: 'T-000005',
          address: 'Calle Olmo 2',
          blockCode: 'S2-M01',
          unitCount: 1,
        },
        unit: { id: 77, folio: 'U-000077', reference: null, holderName: 'Luis Mora' },
        createdAt: '2026-09-01T16:00:00.000Z',
      },
    ] as SuspensionListItem[],
    nextId: 100,
  };
}

const unitDetail = (id: number, connection: ConnectionDetail, holder: PersonBasic): UnitDetail => ({
  id,
  folio: `U-0000${id}`,
  reference: null,
  status: 'active',
  registeredOn: '2026-11-18',
  activatedOn: '2026-11-18',
  billingStartPeriod: '2026-11',
  deactivatedOn: null,
  connection: {
    id: connection.id,
    folio: connection.folio,
    address: connection.address,
    blockId: connection.blockId,
    blockCode: connection.blockCode,
  },
  holder,
  holders: [],
  suspensions: [],
  payments: [],
  pendingChange: null,
});

export function fakeM5Api() {
  const state = initialState();
  const calls: Call[] = [];
  const overrides: { match: (call: Call) => boolean; reply: Reply }[] = [];

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
    const idOf = (pattern: RegExp) => Number(pattern.exec(path)?.[1]);

    if (get && path === '/search') return json(200, state.search);
    if (get && path === '/people/matches') return json(200, state.matches);
    if (get && /^\/people\/\d+$/.test(path)) {
      const person = state.people.get(idOf(/^\/people\/(\d+)$/));
      return person ? json(200, { person }) : apiError(404, 'NOT_FOUND', 'No existe.');
    }
    if (post && path === '/people') {
      const id = state.nextId++;
      const person: PersonDetail = {
        id,
        folio: `P-000${id}`,
        fullName: [body.givenNames, body.paternalSurname, body.maternalSurname]
          .filter(Boolean)
          .join(' '),
        distinguishingNote: (body.distinguishingNote as string | null) ?? null,
        access: 'full',
        givenNames: String(body.givenNames),
        paternalSurname: String(body.paternalSurname),
        maternalSurname: (body.maternalSurname as string | null) ?? null,
        phone: (body.phone as string | null) ?? null,
        registeredOn: '2026-11-18',
        units: [],
        totalDue: 0,
        connectionRequests: [],
      };
      state.people.set(id, person);
      return json(201, { person });
    }
    if (get && /^\/connections\/\d+$/.test(path)) {
      const connection = state.connections.get(idOf(/^\/connections\/(\d+)$/));
      return connection ? json(200, { connection }) : apiError(404, 'NOT_FOUND', 'No existe.');
    }
    if (post && path === '/connections/pre-existing') {
      const id = state.nextId++;
      const connection: ConnectionDetail = {
        ...CONNECTION,
        id,
        folio: `T-0000${id}`,
        address: String(body.address),
        units: [],
        totalDue: 0,
      };
      state.connections.set(id, connection);
      return json(201, { connection });
    }
    if (post && path === '/units') {
      const connection = state.connections.get(Number(body.connectionId)) ?? CONNECTION;
      return json(201, { unit: unitDetail(state.nextId++, connection, ERNESTO) });
    }
    if (get && path === '/reports/block') return json(200, { report: ROSTER });
    if (get && path === '/rates') return json(200, { rates: RATES });
    if (get && path === '/fees') return json(200, { fees: [OPENING_FEE] });
    if (get && path === '/blocks') {
      return json(200, {
        blocks: [
          {
            id: 1,
            sectionId: 1,
            code: 'M01',
            fullCode: 'S1-M01',
            name: null,
            active: true,
            leader: null,
          },
          {
            id: 2,
            sectionId: 1,
            code: 'M02',
            fullCode: 'S1-M02',
            name: null,
            active: true,
            leader: null,
          },
        ],
      });
    }

    if (get && path === '/connection-requests') {
      const status = url.searchParams.get('status');
      return json(200, {
        data: state.requests.filter((item) => !status || item.status === status),
        next: null,
      });
    }
    if (get && /^\/connection-requests\/\d+$/.test(path)) {
      const found = state.requests.find((item) => item.id === idOf(/(\d+)$/));
      return found ? json(200, { request: found }) : apiError(404, 'NOT_FOUND', 'No existe.');
    }
    if (post && path === '/connection-requests') {
      const created = request({
        id: state.nextId++,
        address: String(body.address),
        requestedOn: String(body.requestedOn),
      });
      state.requests = [created, ...state.requests];
      return json(201, { request: created });
    }
    const action = /^\/connection-requests\/(\d+)\/(resolve|activate|cancel)$/.exec(path);
    if (post && action) {
      const id = Number(action[1]);
      const current = state.requests.find((item) => item.id === id);
      if (!current) return apiError(404, 'NOT_FOUND', 'No existe.');
      let next: ConnectionRequest = current;
      if (action[2] === 'resolve') {
        const chosen = state.agreements.find((item) => item.id === body.agreementId);
        const approved = chosen?.result === 'approved_by_majority';
        next = {
          ...current,
          status: approved ? 'approved_pending_payment' : 'rejected',
          agreement: chosen ? { id: chosen.id, folio: chosen.folio, result: chosen.result } : null,
          resolutionReason: (body.resolutionReason as string | null) ?? null,
          openingCharge: approved
            ? {
                id: 11,
                feeName: 'Apertura de toma',
                amount: 150_000,
                chargedOn: '2026-11-18',
                cancelledOn: null,
              }
            : null,
        };
      } else if (action[2] === 'cancel') {
        next = {
          ...current,
          status: 'cancelled',
          cancelledOn: '2026-11-18',
          cancellationReason: String(body.reason),
        };
      } else {
        if (current.status !== 'pending_installation') {
          return apiError(422, 'OPENING_NOT_PAID', 'La apertura no está pagada.');
        }
        const connection: ConnectionDetail = { ...CONNECTION, id: 50, folio: 'T-000050' };
        state.connections.set(50, connection);
        next = { ...current, status: 'installed', connectionId: 50 };
        state.requests = state.requests.map((item) => (item.id === id ? next : item));
        return json(200, { request: next, connection });
      }
      state.requests = state.requests.map((item) => (item.id === id ? next : item));
      return json(200, { request: next });
    }

    if (get && path === '/agreements') return json(200, { data: state.agreements, next: null });
    if (post && path === '/agreements') {
      const created: Agreement = {
        ...agreement(state.nextId++, body.result as Agreement['result'], String(body.topic)),
        meetingDate: String(body.meetingDate),
        votesFor: (body.votesFor as number | null) ?? null,
        votesAgainst: (body.votesAgainst as number | null) ?? null,
        abstentions: (body.abstentions as number | null) ?? null,
        minutesReference: (body.minutesReference as string | null) ?? null,
      };
      state.agreements = [created, ...state.agreements];
      return json(201, { agreement: created });
    }

    if (get && path === '/suspensions') {
      const status = url.searchParams.get('status') ?? 'active';
      return json(200, {
        data: state.suspensions.filter(
          (item) => (status === 'active') === (item.periodTo === null),
        ),
        next: null,
      });
    }
    if (post && path === '/suspensions') {
      return json(201, {
        suspension: {
          id: state.nextId++,
          connectionId: (body.connectionId as number | undefined) ?? null,
          unitId: (body.unitId as number | undefined) ?? null,
          periodFrom: String(body.periodFrom),
          periodTo: null,
          reason: String(body.reason),
          agreementId: Number(body.agreementId),
        },
      });
    }
    const end = /^\/suspensions\/(\d+)\/end$/.exec(path);
    if (post && end) {
      const id = Number(end[1]);
      const current = state.suspensions.find((item) => item.id === id);
      if (!current) return apiError(404, 'NOT_FOUND', 'No existe.');
      const ended = { ...current, periodTo: String(body.periodTo) };
      state.suspensions = state.suspensions.map((item) => (item.id === id ? ended : item));
      const {
        agreement: _a,
        connection: _c,
        unit: _u,
        target: _t,
        createdAt: _d,
        ...suspension
      } = ended;
      return json(200, { suspension });
    }
    return apiError(404, 'NOT_FOUND', `No existe ${call.method} ${path}.`);
  };

  return {
    route,
    calls,
    state,
    /** The next call that matches gets `reply`. */
    override(match: (call: Call) => boolean, reply: Reply) {
      overrides.push({ match, reply });
    },
    gets: (path: string) =>
      calls.filter((item) => item.method === 'GET' && new URL(item.url).pathname === `/v1${path}`),
    posts: (path: string) =>
      calls.filter((item) => item.method === 'POST' && new URL(item.url).pathname === `/v1${path}`),
  };
}
