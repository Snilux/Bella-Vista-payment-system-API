import { randomUUID } from 'node:crypto';
import {
  type AccountStatementResponse,
  addMonths,
  type createAgreementRequestSchema,
  type createConnectionRequestRequestSchema,
  type createExpenseRequestSchema,
  type createExtraChargeRequestSchema,
  type createPaymentRequestSchema,
  type createPersonRequestSchema,
  type createPreexistingConnectionRequestSchema,
  type createSuspensionRequestSchema,
  type createUnitRequestSchema,
  formatMoney,
} from '@bella-vista/shared';
import { eq } from 'drizzle-orm';
import type { z } from 'zod';
import { buildApp } from '../../app.js';
import { loadEnv } from '../../config/env.js';
import { businessDate } from '../../lib/dates.js';
import { createDb } from '../client.js';
import { agreement, roleAssignment, userAccount } from '../schema/index.js';
import { createSeedLogger } from './cli-support.js';

// `pnpm db:seed:demo`: more test data on top of `pnpm db:seed:dev`, loaded THROUGH THE API (the
// same rules, transactions, idempotency and audit log as the app), so every screen has
// something to show: families with debt in every block (S2-M02 has no leader: the president
// collects there in support), pending handovers, a suspension, extra charges, connection
// requests in every status, income and expenses, the plumber and approvals for the president.
// Dates are relative to today. It runs once: the marker agreement says it already ran.
// Refuses NODE_ENV=production.

const MARKER_TOPIC = 'Datos de prueba ampliados (pnpm db:seed:demo)';

const env = loadEnv();
const log = createSeedLogger(env);
if (env.NODE_ENV === 'production') {
  log.error('pnpm db:seed:demo no se ejecuta con NODE_ENV=production: solo carga datos de prueba.');
  process.exit(1);
}

type Body<S extends z.ZodType> = z.input<S>;
type Json = Record<string, unknown>;

class StepError extends Error {}

const { db, sql } = createDb(env.DATABASE_URL, { max: 2 });
const app = await buildApp({ env, db });
const today = businessDate(new Date(), env.BUSINESS_TIMEZONE);
const thisMonth = today.slice(0, 7);

/** Signs a token for a development account (as the integration tests do; no login attempts). */
async function tokenFor(username: string) {
  const [row] = await db
    .select({ id: userAccount.id, role: roleAssignment.role, blockId: roleAssignment.blockId })
    .from(userAccount)
    .innerJoin(roleAssignment, eq(roleAssignment.id, userAccount.roleAssignmentId))
    .where(eq(userAccount.username, username));
  if (!row) {
    throw new StepError(`No existe la cuenta ${username}: ejecute primero pnpm db:seed:dev.`);
  }
  return app.jwt.sign({ sub: String(row.id), username, role: row.role, blockId: row.blockId });
}

const tokens = new Map<string, string>();
/** Calls the API as `username`; money operations carry a fresh Idempotency-Key. */
async function call<T = Json>(
  username: string,
  method: 'GET' | 'POST',
  url: string,
  payload?: object,
  expected = method === 'GET' ? 200 : 201,
): Promise<T> {
  let token = tokens.get(username);
  if (!token) {
    token = await tokenFor(username);
    tokens.set(username, token);
  }
  const res = await app.inject({
    method,
    url: `/v1${url}`,
    headers: { authorization: `Bearer ${token}`, 'idempotency-key': randomUUID() },
    ...(payload ? { payload } : {}),
  });
  if (res.statusCode !== expected) {
    throw new StepError(`${method} ${url} como ${username} → ${res.statusCode}: ${res.body}`);
  }
  return res.json() as T;
}

const post = <T = Json>(username: string, url: string, body: object = {}, expected?: number) =>
  call<T>(username, 'POST', url, body, expected);
const get = <T = Json>(username: string, url: string) => call<T>(username, 'GET', url);

async function blockId(code: string) {
  const { blocks } = await get<{ blocks: { id: number; fullCode: string }[] }>(
    'secretario',
    '/blocks',
  );
  const found = blocks.find((b) => b.fullCode === code);
  if (!found)
    throw new StepError(`No existe la manzana ${code}: ejecute primero pnpm db:seed:dev.`);
  return found.id;
}

/** Pays the `count` oldest unpaid months of a unit (and charges, if given) as `username`. */
async function pay(
  username: string,
  unitId: number,
  count: number,
  folio: string,
  extraChargeIds: number[] = [],
) {
  const { statement } = await get<AccountStatementResponse>(
    username,
    `/units/${unitId}/account-statement`,
  );
  const periods = statement.months
    .filter((m) => m.status === 'overdue' || m.status === 'pending')
    .slice(0, count)
    .map((m) => m.period);
  const selection: Body<typeof createPaymentRequestSchema> = {
    unitId,
    periods,
    extraChargeIds,
    paperFolio: folio,
    expectedTotal: 0,
  };
  const { preview } = await post<{ preview: { total: number } }>(
    username,
    '/payments/preview',
    { unitId, periods, extraChargeIds },
    200,
  );
  const { payment } = await post<{ payment: { id: number } }>(username, '/payments', {
    ...selection,
    expectedTotal: preview.total,
  });
  return { id: payment.id, total: preview.total, periods };
}

const summary: string[] = [];
const note = (line: string) => {
  summary.push(line);
  log.info(line);
};

try {
  const [already] = await db
    .select({ id: agreement.id })
    .from(agreement)
    .where(eq(agreement.topic, MARKER_TOPIC))
    .limit(1);
  if (already) {
    log.warn(
      'Los datos de prueba ampliados ya se cargaron antes (pnpm db:seed:demo); no se cargó nada.',
    );
    process.exit(0);
  }

  const s1m01 = await blockId('S1-M01');
  const s1m02 = await blockId('S1-M02');
  const s2m01 = await blockId('S2-M01');
  const s2m02 = await blockId('S2-M02');

  // --- Meeting agreements ---------------------------------------------------------------------
  const newAgreement = async (body: Body<typeof createAgreementRequestSchema>) =>
    (await post<{ agreement: { id: number; folio: string } }>('secretario', '/agreements', body))
      .agreement;
  const approvedAgreement = await newAgreement({
    meetingDate: addMonths(thisMonth, -1).concat('-05'),
    topic: MARKER_TOPIC,
    result: 'approved_by_majority',
    votesFor: 55,
    votesAgainst: 4,
    abstentions: 3,
    minutesReference: 'Acta de prueba: suspensiones, tomas nuevas, gastos y salario',
  });
  const rejectedAgreement = await newAgreement({
    meetingDate: addMonths(thisMonth, -1).concat('-05'),
    topic: 'Toma en Calle Nogal 9: no hay presión en esa línea',
    result: 'rejected',
    votesFor: 10,
    votesAgainst: 40,
    abstentions: 2,
  });
  note(`Acuerdos: ${approvedAgreement.folio} (aprobado) y ${rejectedAgreement.folio} (rechazado).`);

  // --- People -----------------------------------------------------------------------------------
  const PEOPLE = {
    alberto: {
      givenNames: 'Alberto',
      paternalSurname: 'Ríos',
      maternalSurname: 'Mejía',
      phone: '5552003001',
    },
    beatriz: { givenNames: 'Beatriz', paternalSurname: 'Salas', maternalSurname: 'Ochoa' },
    claudia: {
      givenNames: 'Claudia',
      paternalSurname: 'Fuentes',
      maternalSurname: 'Vega',
      phone: '5552003003',
    },
    daniel: { givenNames: 'Daniel', paternalSurname: 'Ortega', maternalSurname: 'Paz' },
    estela: { givenNames: 'Estela', paternalSurname: 'Juárez', maternalSurname: 'Lara' },
    fernando: { givenNames: 'Fernando', paternalSurname: 'Cano', maternalSurname: 'Ruiz' },
    gabriela: {
      givenNames: 'Gabriela',
      paternalSurname: 'Mora',
      maternalSurname: 'Téllez',
      phone: '5552003007',
    },
    hugo: { givenNames: 'Hugo', paternalSurname: 'Peña', maternalSurname: 'Díaz' },
    irma: { givenNames: 'Irma', paternalSurname: 'Campos', maternalSurname: 'Rivas' },
    jorge: { givenNames: 'Jorge', paternalSurname: 'Luna', maternalSurname: 'Ortiz' },
  } satisfies Record<string, Body<typeof createPersonRequestSchema>>;
  const people = {} as Record<keyof typeof PEOPLE, number>;
  for (const [key, body] of Object.entries(PEOPLE) as [
    keyof typeof PEOPLE,
    Body<typeof createPersonRequestSchema>,
  ][]) {
    people[key] = (await post<{ person: { id: number } }>('secretario', '/people', body)).person.id;
  }
  note(`Personas nuevas: ${Object.keys(PEOPLE).length}.`);

  // --- Connections with debt in every block (captured as they were at startup, D-18) ----------
  const preexisting = async (
    username: string,
    body: Body<typeof createPreexistingConnectionRequestSchema>,
  ) =>
    (
      await post<{ connection: { id: number; units: { id: number }[] } }>(
        username,
        '/connections/pre-existing',
        body,
      )
    ).connection;
  const allende22 = await preexisting('jm.s1m01', {
    address: 'Calle Allende 22',
    blockId: s1m01,
    unit: { holderPersonId: people.alberto, billingStartPeriod: addMonths(thisMonth, -10) },
  });
  const allende30 = await preexisting('jm.s1m02', {
    address: 'Calle Allende 30',
    blockId: s1m02,
    unit: { holderPersonId: people.beatriz, billingStartPeriod: addMonths(thisMonth, -3) },
  });
  const palmas5 = await preexisting('jm.s2m01', {
    address: 'Av. Las Palmas 5',
    blockId: s2m01,
    unit: {
      holderPersonId: people.claudia,
      reference: 'Departamento 1',
      billingStartPeriod: addMonths(thisMonth, -14),
    },
  });
  const unitBody: Body<typeof createUnitRequestSchema> = {
    connectionId: palmas5.id,
    holderPersonId: people.fernando,
    reference: 'Departamento 2',
  };
  const palmas5b = (await post<{ unit: { id: number } }>('jm.s2m01', '/units', unitBody)).unit;
  // S2-M02 has no leader: the secretary captures, the president collects in support (D-07).
  const encino14 = await preexisting('secretario', {
    address: 'Calle Encino 14',
    blockId: s2m02,
    unit: { holderPersonId: people.daniel, billingStartPeriod: addMonths(thisMonth, -6) },
  });
  const encino16 = await preexisting('secretario', {
    address: 'Calle Encino 16',
    blockId: s2m02,
    unit: { holderPersonId: people.estela, billingStartPeriod: addMonths(thisMonth, -1) },
  });
  const unitOf = (c: { units: { id: number }[] }) => {
    const first = c.units[0];
    if (!first) throw new StepError('La toma se creó sin familia.');
    return first.id;
  };
  note(
    'Tomas nuevas: Calle Allende 22 (S1-M01), Calle Allende 30 (S1-M02), Av. Las Palmas 5 con 2 familias (S2-M01), Calle Encino 14 y 16 (S2-M02, sin jefe).',
  );

  // --- Fees and extra charges (only the treasurer sets amounts, D-13 / D-28) -------------------
  const { fees } = await get<{
    fees: { id: number; type: string; name: string; currentAmount: { amount: number } | null }[];
  }>('tesorero', '/fees');
  const AMOUNTS: Record<string, number> = {
    opening: 150_000,
    reconnection: 80_000,
    repair: 35_000,
  };
  for (const fee of fees) {
    const amount = AMOUNTS[fee.type];
    if (fee.currentAmount === null && amount !== undefined) {
      await post('tesorero', `/fees/${fee.id}/amounts`, { effectiveFrom: today, amount });
      note(`Concepto «${fee.name}»: ${formatMoney(amount)} desde hoy.`);
    }
  }
  const feeId = (type: string) => {
    const found = fees.find((f) => f.type === type);
    if (!found) throw new StepError(`No existe el concepto ${type}.`);
    return found.id;
  };
  const charge = async (body: Body<typeof createExtraChargeRequestSchema>) =>
    (await post<{ charge: { id: number } }>('tesorero', '/extra-charges', body)).charge.id;
  await charge({ feeId: feeId('reconnection'), unitId: unitOf(palmas5) });
  const repairCharge = await charge({ feeId: feeId('repair'), connectionId: allende22.id });
  note(
    'Cargos extraordinarios pendientes: reinstalación a Claudia (Las Palmas 5) y reparación a la toma Calle Allende 22.',
  );

  // --- Payments into every kind of cashbox -------------------------------------------------------
  const alberto = await pay('jm.s1m01', unitOf(allende22), 4, 'DEMO-0001', [repairCharge]);
  const claudia = await pay('jm.s2m01', unitOf(palmas5), 3, 'DEMO-0002');
  const beatriz = await pay('jm.s1m02', unitOf(allende30), 2, 'DEMO-0003');
  const daniel = await pay('presidente', unitOf(encino14), 2, 'DEMO-0004');
  const estela = await pay('tesorero', unitOf(encino16), 1, 'DEMO-0005');
  note(
    `Pagos: Alberto ${alberto.periods.length} meses + reparación (caja S1-M01), Claudia ${claudia.periods.length} meses (S2-M01), Beatriz ${beatriz.periods.length} (S1-M02), Daniel ${daniel.periods.length} en apoyo del presidente (S2-M02), Estela ${estela.periods.length} directo al comité.`,
  );

  // A cancellation waiting for the president (R-02).
  await post('jm.s1m02', `/payments/${beatriz.id}/request-cancellation`, {
    reason: 'Se registró a la familia equivocada (dato de prueba)',
  });
  note('Autorización pendiente: cancelar el pago de Beatriz (lo pidió jm.s1m02).');

  // --- Handovers ------------------------------------------------------------------------------
  const available = async (username: string) =>
    (await get<{ cashbox: { available: number } }>(username, '/cashboxes/mine')).cashbox.available;
  const s2m01Cash = await available('jm.s2m01');
  const confirmed = (
    await post<{ handover: { id: number } }>('jm.s2m01', '/handovers', {
      declaredAmount: s2m01Cash,
      notes: 'Entrega de prueba confirmada',
    })
  ).handover;
  await post('tesorero', `/handovers/${confirmed.id}/confirm`, { receivedAmount: s2m01Cash }, 200);
  const s1m01Cash = Math.floor((await available('jm.s1m01')) / 2);
  await post('jm.s1m01', '/handovers', {
    declaredAmount: s1m01Cash,
    notes: 'Entrega de prueba por confirmar',
  });
  note(
    `Entregas: S2-M01 entregó ${formatMoney(s2m01Cash)} (confirmada); S1-M01 preparó ${formatMoney(s1m01Cash)} (el tesorero la confirma en T-02). La caja de apoyo del presidente queda con efectivo para entregar (R-06).`,
  );

  // --- Suspension ---------------------------------------------------------------------------
  const suspension: Body<typeof createSuspensionRequestSchema> = {
    unitId: palmas5b.id,
    periodFrom: thisMonth,
    reason: 'Fuga sin reparar en el departamento (dato de prueba)',
    agreementId: approvedAgreement.id,
  };
  await post('secretario', '/suspensions', suspension);
  note('Suspensión vigente: Fernando Cano, Departamento 2 de Av. Las Palmas 5.');

  // --- Connection requests in every status ----------------------------------------------------
  const request = async (
    username: string,
    body: Body<typeof createConnectionRequestRequestSchema>,
  ) =>
    (await post<{ request: { id: number; folio: string } }>(username, '/connection-requests', body))
      .request;
  const toResolve = await request('jm.s1m01', {
    applicantId: people.gabriela,
    address: 'Calle Nogal 3',
    blockId: s1m01,
  });
  const toPay = await request('secretario', {
    applicantId: people.hugo,
    address: 'Calle Nogal 7',
    blockId: s1m02,
  });
  await post(
    'secretario',
    `/connection-requests/${toPay.id}/resolve`,
    { agreementId: approvedAgreement.id },
    200,
  );
  const rejected = await request('secretario', {
    applicantId: people.irma,
    address: 'Calle Nogal 9',
    blockId: s2m01,
  });
  await post(
    'secretario',
    `/connection-requests/${rejected.id}/resolve`,
    {
      agreementId: rejectedAgreement.id,
      resolutionReason: 'No hay presión suficiente en esa línea.',
    },
    200,
  );
  const cancelled = await request('jm.s2m01', {
    applicantId: people.jorge,
    address: 'Calle Nogal 11',
    blockId: s2m01,
  });
  await post(
    'jm.s2m01',
    `/connection-requests/${cancelled.id}/cancel`,
    { reason: 'El solicitante la retiró' },
    200,
  );
  note(
    `Solicitudes de toma: ${toResolve.folio} por resolver (S-03), ${toPay.folio} aprobada con la apertura por cobrar, ${rejected.folio} rechazada y ${cancelled.folio} cancelada.`,
  );

  // --- Committee: income, expenses, plumber and a rate for the president ----------------------
  await post('tesorero', '/incomes', {
    concept: 'Donativo de la cooperativa (prueba)',
    amount: 200_000,
  });
  const { categories } = await get<{
    categories: { id: number; name: string; isPlumberSalary: boolean }[];
  }>('tesorero', '/expense-categories');
  const category = (name: string) =>
    categories.find((c) => c.name === name)?.id ??
    categories.find((c) => !c.isPlumberSalary)?.id ??
    0;
  const expense = async (body: Body<typeof createExpenseRequestSchema>) =>
    (await post<{ expense: { id: number } }>('tesorero', '/expenses', body)).expense.id;
  const paidExpense = await expense({
    categoryId: category('Materiales'),
    description: 'Cloro para el tanque (prueba)',
    amount: 30_000,
    agreementId: approvedAgreement.id,
    voucherReference: 'Nota 118',
  });
  await post('tesorero', `/expenses/${paidExpense}/pay`, {}, 200);
  await expense({
    categoryId: category('Materiales'),
    description: 'Cambio de válvula de la calle Allende (prueba)',
    amount: 65_000,
    agreementId: approvedAgreement.id,
  });
  note('Comité: ingreso de $2,000.00, gasto pagado de $300.00 y gasto de $650.00 por pagar.');

  const { plumbers } = await get<{ plumbers: unknown[] }>('tesorero', '/plumbers');
  if (plumbers.length === 0) {
    const { plumber } = await post<{ plumber: { id: number } }>('tesorero', '/plumbers', {
      name: 'Martín Salgado',
      phone: '5551004001',
    });
    await post('tesorero', `/plumbers/${plumber.id}/salaries`, {
      amount: 50_000,
      frequency: 'weekly',
      effectiveFrom: today,
      agreementId: approvedAgreement.id,
      reason: 'Salario acordado en asamblea (prueba)',
    });
    note('Fontanero Martín Salgado con salario semanal de $500.00 por autorizar (presidente).');
  } else {
    note('Ya había fontanero registrado: no se agregó otro.');
  }

  const nextYear = `${Number(thisMonth.slice(0, 4)) + 1}-01`;
  const rate = await app.inject({
    method: 'POST',
    url: '/v1/rates',
    headers: { authorization: `Bearer ${await tokenFor('tesorero')}` },
    payload: {
      effectivePeriod: nextYear,
      amount: 6_000,
      approvedOn: addMonths(thisMonth, -1).concat('-05'),
      agreementId: approvedAgreement.id,
      reason: 'Aumento propuesto (prueba)',
    },
  });
  note(
    rate.statusCode === 201
      ? `Tarifa de $60.00 desde ${nextYear} por autorizar (presidente).`
      : `No se agregó la tarifa ${nextYear}: ${rate.json().error?.message ?? rate.statusCode}.`,
  );

  process.stdout.write(
    [
      '',
      '  Datos de prueba ampliados cargados (contraseña de todas las cuentas: desarrollo-bella-vista):',
      ...summary.map((line) => `  - ${line}`),
      '',
      '  Guía para probarlos: README → «Datos de prueba ampliados».',
      '',
    ].join('\n'),
  );
} catch (error) {
  if (error instanceof StepError) {
    log.error(error.message);
  } else {
    log.error({ err: error }, 'La carga de datos de prueba ampliados falló.');
  }
  log.error(
    'Lo que ya se guardó se queda (cada paso es una operación de la API). Para empezar de cero, recree la base (vea el README).',
  );
  process.exitCode = 1;
} finally {
  await app.close();
  await sql.end();
}
