import { randomUUID } from 'node:crypto';
import { eq, isNull, sql } from 'drizzle-orm';
import { hashPassword } from '../../lib/password.js';
import { type Actor, auditCreate, type Role } from '../audit.js';
import type { Database } from '../client.js';
import {
  agreement,
  approval,
  type approvalType,
  block,
  cashbox,
  connection,
  connectionBlock,
  coveredPeriod,
  paperReceipt,
  payment,
  paymentMonth,
  person,
  rate,
  roleAssignment,
  section,
  unit,
  unitHolder,
  userAccount,
} from '../schema/index.js';

// Development data (`pnpm db:seed:dev`, 3.1 §2.2): sections, blocks, leaders, members, homonyms,
// connections with several units, historical rates and some payments, to exercise the API.
// It runs on top of the bootstrap (it needs the superadmin and the officers) and never with
// NODE_ENV=production.

/** Password of every development account (printed by the CLI). */
export const DEV_PASSWORD = 'desarrollo-bella-vista';

export const DEV_AUDIT_REASON = 'Datos de desarrollo (pnpm db:seed:dev)';

export class DevSeedRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DevSeedRefusedError';
  }
}

export type DevSeedResult =
  | {
      status: 'created';
      accounts: { username: string; role: Role }[];
      counts: { people: number; connections: number; units: number; payments: number };
    }
  | { status: 'already_seeded' };

export interface DevSeedOptions {
  nodeEnv: string;
}

// Same lock as the bootstrap: neither script runs while the other one does.
const SEED_LOCK_KEY = 'bella-vista:db-seed';

type ApprovalType = (typeof approvalType.enumValues)[number];

interface PersonSeed {
  key: string;
  givenNames: string;
  paternalSurname: string;
  maternalSurname?: string;
  distinguishingNote?: string;
  phone?: string;
}

// Two homonym pairs (D-10): same name, told apart by their distinguishing note.
const PEOPLE: PersonSeed[] = [
  {
    key: 'laura',
    givenNames: 'Laura',
    paternalSurname: 'Méndez',
    maternalSurname: 'Ruiz',
    phone: '5551002001',
  },
  {
    key: 'rogelio',
    givenNames: 'Rogelio',
    paternalSurname: 'Castañeda',
    maternalSurname: 'Ortiz',
    phone: '5551002002',
  },
  {
    key: 'josefina',
    givenNames: 'Josefina',
    paternalSurname: 'Ramírez',
    maternalSurname: 'Luna',
    phone: '5551002003',
  },
  {
    key: 'joseLuisPapa',
    givenNames: 'José Luis',
    paternalSurname: 'Hernández',
    maternalSurname: 'García',
    distinguishingNote: 'Papá, Av. Hidalgo',
  },
  {
    key: 'joseLuisHijo',
    givenNames: 'José Luis',
    paternalSurname: 'Hernández',
    maternalSurname: 'García',
    distinguishingNote: 'Hijo, Calle Morelos',
  },
  {
    key: 'lupitaTienda',
    givenNames: 'María Guadalupe',
    paternalSurname: 'López',
    maternalSurname: 'Pérez',
    distinguishingNote: 'La de la tienda',
  },
  {
    key: 'lupitaMaestra',
    givenNames: 'María Guadalupe',
    paternalSurname: 'López',
    maternalSurname: 'Pérez',
    distinguishingNote: 'Maestra de la primaria',
  },
  { key: 'ernesto', givenNames: 'Ernesto', paternalSurname: 'Vázquez', maternalSurname: 'Soto' },
  { key: 'carmen', givenNames: 'Carmen', paternalSurname: 'Aguilar' },
  { key: 'rafael', givenNames: 'Rafael', paternalSurname: 'Domínguez', maternalSurname: 'Flores' },
  { key: 'teresa', givenNames: 'Teresa', paternalSurname: 'Navarro', maternalSurname: 'Cruz' },
  {
    key: 'pedro',
    givenNames: 'Pedro',
    paternalSurname: 'Ibarra',
    maternalSurname: 'Solís',
    phone: '5551002004',
  },
  { key: 'silvia', givenNames: 'Silvia', paternalSurname: 'Montes', phone: '5551002005' },
];

const SECTIONS = [
  { code: 'S1', name: 'Sección Centro', blocks: ['M01', 'M02'] },
  { code: 'S2', name: 'Sección Lomas', blocks: ['M01', 'M02'] },
] as const;

/** Block leaders; S2-M02 has none on purpose (a block without a leader). */
const LEADERS = [
  { block: 'S1-M01', person: 'laura', username: 'jm.s1m01' },
  { block: 'S1-M02', person: 'rogelio', username: 'jm.s1m02' },
  { block: 'S2-M01', person: 'josefina', username: 'jm.s2m01' },
] as const;

/** Committee members; silvia has no account yet. */
const MEMBERS: { person: string; username: string | null }[] = [
  { person: 'pedro', username: 'vocal' },
  { person: 'silvia', username: null },
];

interface UnitSeed {
  key: string;
  holder: string;
  reference?: string;
  /** null = registered, pending activation. */
  billingStart: string | null;
}

/** Connections that existed when the system started (D-18), with their units. */
const CONNECTIONS: { block: string; address: string; activatedOn: string; units: UnitSeed[] }[] = [
  {
    block: 'S1-M01',
    address: 'Av. Hidalgo 12',
    activatedOn: '2019-03-01',
    units: [
      {
        key: 'hidalgoFrente',
        holder: 'joseLuisPapa',
        reference: 'Casa del frente',
        billingStart: '2025-01-01',
      },
      {
        key: 'hidalgoAlta',
        holder: 'lupitaTienda',
        reference: 'Planta alta',
        billingStart: '2025-01-01',
      },
      {
        key: 'hidalgoFondo',
        holder: 'carmen',
        reference: 'Cuarto del fondo',
        billingStart: '2025-01-01',
      },
    ],
  },
  {
    block: 'S1-M01',
    address: 'Calle Morelos 45',
    activatedOn: '2021-07-15',
    units: [{ key: 'morelos', holder: 'joseLuisHijo', billingStart: '2025-01-01' }],
  },
  {
    block: 'S1-M02',
    address: 'Calle Juárez 8',
    activatedOn: '2020-05-10',
    units: [
      { key: 'juarezA', holder: 'ernesto', reference: 'Casa A', billingStart: '2025-01-01' },
      { key: 'juarezB', holder: 'lupitaMaestra', reference: 'Casa B', billingStart: '2025-01-01' },
    ],
  },
  {
    block: 'S2-M01',
    address: 'Privada Las Flores 3',
    activatedOn: '2022-02-01',
    units: [{ key: 'flores', holder: 'rafael', billingStart: '2025-06-01' }],
  },
  {
    block: 'S2-M02',
    address: 'Camino Real 101',
    activatedOn: '2023-09-01',
    units: [{ key: 'caminoReal', holder: 'teresa', billingStart: null }],
  },
];

/** Historical rates: $40.00 from 2025-01 and $50.00 from 2026-01 (cents). */
const RATES = [
  { effectivePeriod: '2025-01-01', amount: 4_000, meetingDate: '2024-12-07' },
  { effectivePeriod: '2026-01-01', amount: 5_000, meetingDate: '2025-12-06' },
] as const;

interface PaymentSeed {
  unit: string;
  occurredAt: string;
  from: string;
  to: string;
  withSurcharge?: boolean;
}

/**
 * Some payments. hidalgoAlta stopped paying in 2025-06 (now in a debt cycle); morelos paid
 * 2026 in advance; flores paid seven overdue months with surcharge (D-02: it had 8 overdue).
 */
const PAYMENTS: PaymentSeed[] = [
  {
    unit: 'hidalgoFrente',
    occurredAt: '2025-12-10T17:00:00Z',
    from: '2025-01-01',
    to: '2025-12-01',
  },
  {
    unit: 'hidalgoFrente',
    occurredAt: '2026-10-05T17:00:00Z',
    from: '2026-01-01',
    to: '2026-10-01',
  },
  { unit: 'hidalgoAlta', occurredAt: '2025-06-08T17:00:00Z', from: '2025-01-01', to: '2025-06-01' },
  { unit: 'morelos', occurredAt: '2025-12-20T17:00:00Z', from: '2025-01-01', to: '2025-12-01' },
  { unit: 'morelos', occurredAt: '2026-01-10T17:00:00Z', from: '2026-01-01', to: '2026-12-01' },
  { unit: 'juarezA', occurredAt: '2026-03-20T17:00:00Z', from: '2026-01-01', to: '2026-03-01' },
  {
    unit: 'flores',
    occurredAt: '2026-02-15T17:00:00Z',
    from: '2025-06-01',
    to: '2025-12-01',
    withSurcharge: true,
  },
];

export async function runDevSeed(db: Database, options: DevSeedOptions): Promise<DevSeedResult> {
  if (options.nodeEnv === 'production') {
    throw new DevSeedRefusedError(
      'pnpm db:seed:dev no se ejecuta con NODE_ENV=production: solo carga datos de prueba.',
    );
  }
  const devPasswordHash = await hashPassword(DEV_PASSWORD);

  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${SEED_LOCK_KEY}))`);

    const officers = await tx
      .select({
        assignmentId: roleAssignment.id,
        role: roleAssignment.role,
        userAccountId: userAccount.id,
      })
      .from(roleAssignment)
      .leftJoin(userAccount, eq(userAccount.roleAssignmentId, roleAssignment.id))
      .where(isNull(roleAssignment.endDate));
    const sa = officers.find((o) => o.role === 'superadmin');
    if (!sa?.userAccountId) {
      throw new DevSeedRefusedError(
        'La base no ha sido arrancada: ejecuta primero pnpm db:seed (D-27).',
      );
    }
    const [anySection] = await tx.select({ id: section.id }).from(section).limit(1);
    if (anySection) return { status: 'already_seeded' };

    const saActor: Actor = { userAccountId: sa.userAccountId, role: 'superadmin' };
    const audit = (
      actor: Actor,
      table: Parameters<typeof auditCreate>[2],
      id: number,
      after: object,
    ) => auditCreate(tx, actor, table, id, { ...after }, DEV_AUDIT_REASON);
    const accounts: { username: string; role: Role }[] = [];

    const createAccount = async (roleAssignmentId: number, username: string, role: Role) => {
      const row = one(
        await tx
          .insert(userAccount)
          .values({
            roleAssignmentId,
            username,
            passwordHash: devPasswordHash,
            mustChangePassword: false,
            createdBy: saActor.userAccountId,
          })
          .returning(),
      );
      const { passwordHash: _secret, ...withoutHash } = row;
      await audit(saActor, userAccount, row.id, withoutHash);
      accounts.push({ username, role });
      return { userAccountId: row.id, role } satisfies Actor;
    };

    // Accounts for the officers approved by the bootstrap (the SA would create them in the app).
    const officerActor = async (
      role: 'president' | 'treasurer' | 'secretary',
      username: string,
    ) => {
      const officer = officers.find((o) => o.role === role);
      if (!officer) {
        throw new DevSeedRefusedError(
          `Falta la asignación vigente de ${role}; revisa el arranque.`,
        );
      }
      if (officer.userAccountId) return { userAccountId: officer.userAccountId, role } as Actor;
      return createAccount(officer.assignmentId, username, role);
    };
    const president = await officerActor('president', 'presidente');
    const treasurer = await officerActor('treasurer', 'tesorero');
    const secretary = await officerActor('secretary', 'secretario');

    /** An approval requested by `requestedBy` and approved by the president on `on`. */
    const approved = async (type: ApprovalType, requestedBy: Actor, reason: string, on: string) => {
      const at = new Date(`${on}T18:00:00Z`);
      const row = one(
        await tx
          .insert(approval)
          .values({
            type,
            reason,
            requestedBy: requestedBy.userAccountId,
            requestedAt: at,
            result: 'approved',
            resolvedBy: president.userAccountId,
            resolvedAt: at,
            createdBy: requestedBy.userAccountId,
          })
          .returning(),
      );
      await audit(requestedBy, approval, row.id, row);
      return row;
    };

    // Historical rates, each with its meeting agreement, registered by the treasurer (D-20).
    const rates: { id: number; effectivePeriod: string }[] = [];
    for (const seed of RATES) {
      const rateAgreement = one(
        await tx
          .insert(agreement)
          .values({
            meetingDate: seed.meetingDate,
            topic: `Tarifa mensual de $${seed.amount / 100} a partir de ${seed.effectivePeriod.slice(0, 7)}`,
            result: 'approved_by_majority',
            votesFor: 62,
            votesAgainst: 5,
            abstentions: 3,
            minutesReference: `Acta de asamblea del ${seed.meetingDate}`,
            createdBy: secretary.userAccountId,
          })
          .returning(),
      );
      await audit(secretary, agreement, rateAgreement.id, rateAgreement);
      const rateApproval = await approved(
        'rate',
        treasurer,
        'Registro de tarifa',
        seed.meetingDate,
      );
      const row = one(
        await tx
          .insert(rate)
          .values({
            effectivePeriod: seed.effectivePeriod,
            amount: seed.amount,
            approvedOn: seed.meetingDate,
            agreementId: rateAgreement.id,
            approvalId: rateApproval.id,
            createdBy: treasurer.userAccountId,
          })
          .returning(),
      );
      await audit(treasurer, rate, row.id, row);
      rates.push(row);
    }
    const rateFor = (period: string) => {
      const match = rates.filter((r) => r.effectivePeriod <= period).at(-1);
      if (!match) throw new Error(`no rate in effect for ${period}`);
      return match.id;
    };

    // Sections, blocks and their cashboxes.
    const blocks = new Map<string, number>();
    const blockBoxes = new Map<string, number>();
    for (const seed of SECTIONS) {
      const sectionRow = one(
        await tx
          .insert(section)
          .values({ code: seed.code, name: seed.name, createdBy: saActor.userAccountId })
          .returning(),
      );
      await audit(saActor, section, sectionRow.id, sectionRow);
      for (const code of seed.blocks) {
        const blockRow = one(
          await tx
            .insert(block)
            .values({ sectionId: sectionRow.id, code, createdBy: saActor.userAccountId })
            .returning(),
        );
        await audit(saActor, block, blockRow.id, blockRow);
        const box = one(
          await tx
            .insert(cashbox)
            .values({ type: 'block', blockId: blockRow.id, createdBy: saActor.userAccountId })
            .returning(),
        );
        await audit(saActor, cashbox, box.id, box);
        blocks.set(`${seed.code}-${code}`, blockRow.id);
        blockBoxes.set(`${seed.code}-${code}`, box.id);
      }
    }

    // People, registered by the secretary.
    const people = new Map<string, number>();
    for (const seed of PEOPLE) {
      const row = one(
        await tx
          .insert(person)
          .values({
            givenNames: seed.givenNames,
            paternalSurname: seed.paternalSurname,
            maternalSurname: seed.maternalSurname ?? null,
            distinguishingNote: seed.distinguishingNote ?? null,
            phone: seed.phone ?? null,
            registeredOn: '2024-12-01',
            createdBy: secretary.userAccountId,
          })
          .returning(),
      );
      await audit(secretary, person, row.id, row);
      people.set(seed.key, row.id);
    }

    // Block leaders: registered by the secretary, approved by the president, with accounts.
    const leaders = new Map<string, Actor>();
    for (const seed of LEADERS) {
      const leaderApproval = await approved(
        'role_assignment',
        secretary,
        `Jefe de manzana ${seed.block}`,
        '2024-12-15',
      );
      const assignment = one(
        await tx
          .insert(roleAssignment)
          .values({
            personId: need(people, seed.person),
            role: 'block_leader',
            blockId: need(blocks, seed.block),
            contactPhone: PEOPLE.find((p) => p.key === seed.person)?.phone ?? null,
            startDate: '2024-12-15',
            approvalId: leaderApproval.id,
            createdBy: secretary.userAccountId,
          })
          .returning(),
      );
      await audit(secretary, roleAssignment, assignment.id, assignment);
      leaders.set(seed.block, await createAccount(assignment.id, seed.username, 'block_leader'));
    }

    // Committee members (vocales): one with an account, one still waiting for the superadmin
    // to create it (it appears among the assignments without account).
    for (const seed of MEMBERS) {
      const memberApproval = await approved(
        'role_assignment',
        secretary,
        'Vocal del comité',
        '2024-12-15',
      );
      const assignment = one(
        await tx
          .insert(roleAssignment)
          .values({
            personId: need(people, seed.person),
            role: 'member',
            startDate: '2024-12-15',
            approvalId: memberApproval.id,
            createdBy: secretary.userAccountId,
          })
          .returning(),
      );
      await audit(secretary, roleAssignment, assignment.id, assignment);
      if (seed.username) await createAccount(assignment.id, seed.username, 'member');
    }

    // Pre-existing connections and their units (captured at startup, D-18).
    const units = new Map<string, { id: number; block: string }>();
    let connectionCount = 0;
    for (const seed of CONNECTIONS) {
      const capturedBy = leaders.get(seed.block) ?? secretary;
      const conn = one(
        await tx
          .insert(connection)
          .values({
            address: seed.address,
            activatedOn: seed.activatedOn,
            createdBy: capturedBy.userAccountId,
          })
          .returning(),
      );
      await tx.insert(connectionBlock).values({
        connectionId: conn.id,
        blockId: need(blocks, seed.block),
        validFrom: seed.activatedOn,
        createdBy: capturedBy.userAccountId,
      });
      await audit(capturedBy, connection, conn.id, { ...conn, blockCode: seed.block });
      connectionCount++;

      for (const unitSeed of seed.units) {
        const row = one(
          await tx
            .insert(unit)
            .values({
              connectionId: conn.id,
              reference: unitSeed.reference ?? null,
              registeredOn: '2024-12-20',
              activatedOn: unitSeed.billingStart ? '2024-12-20' : null,
              billingStartPeriod: unitSeed.billingStart,
              createdBy: capturedBy.userAccountId,
            })
            .returning(),
        );
        const holderId = need(people, unitSeed.holder);
        await tx.insert(unitHolder).values({
          unitId: row.id,
          personId: holderId,
          validFrom: '2024-12-20',
          createdBy: capturedBy.userAccountId,
        });
        await audit(capturedBy, unit, row.id, { ...row, holderPersonId: holderId });
        units.set(unitSeed.key, { id: row.id, block: seed.block });
      }
    }

    // Payments captured by each block leader into their block cashbox, with paper receipt.
    const receiptCounters = new Map<number, number>();
    for (const seed of PAYMENTS) {
      const target = need(units, seed.unit);
      const leader = leaders.get(target.block);
      if (!leader) throw new Error(`block ${target.block} has no leader to capture payments`);
      const cashboxId = need(blockBoxes, target.block);
      const occurredAt = new Date(seed.occurredAt);
      const row = one(
        await tx
          .insert(payment)
          .values({
            unitId: target.id,
            cashboxId,
            occurredAt,
            idempotencyKey: randomUUID(),
            createdBy: leader.userAccountId,
          })
          .returning(),
      );
      const periods = monthRange(seed.from, seed.to);
      await tx.insert(paymentMonth).values(
        periods.map((period) => ({
          paymentId: row.id,
          period,
          rateId: rateFor(period),
          withSurcharge: seed.withSurcharge ?? false,
          createdBy: leader.userAccountId,
        })),
      );
      await tx.insert(coveredPeriod).values(
        periods.map((period) => ({
          unitId: target.id,
          period,
          paymentId: row.id,
          createdBy: leader.userAccountId,
        })),
      );
      const receiptNumber = (receiptCounters.get(cashboxId) ?? 0) + 1;
      receiptCounters.set(cashboxId, receiptNumber);
      await tx.insert(paperReceipt).values({
        paymentId: row.id,
        cashboxId,
        paperFolio: String(receiptNumber).padStart(4, '0'),
        type: 'original',
        issuedAt: occurredAt,
        createdBy: leader.userAccountId,
      });
      await audit(leader, payment, row.id, {
        ...row,
        periods,
        withSurcharge: seed.withSurcharge ?? false,
      });
    }

    return {
      status: 'created',
      accounts,
      counts: {
        people: people.size,
        connections: connectionCount,
        units: units.size,
        payments: PAYMENTS.length,
      },
    };
  });
}

/** First-of-month dates from `from` to `to`, inclusive (both YYYY-MM-01). */
export function monthRange(from: string, to: string): string[] {
  const periods: string[] = [];
  let year = Number(from.slice(0, 4));
  let month = Number(from.slice(5, 7));
  for (;;) {
    const period = `${year}-${String(month).padStart(2, '0')}-01`;
    if (period > to) break;
    periods.push(period);
    month++;
    if (month > 12) {
      month = 1;
      year++;
    }
  }
  return periods;
}

function need<K, V>(map: Map<K, V>, key: K): V {
  const value = map.get(key);
  if (value === undefined) throw new Error(`missing seed reference ${String(key)}`);
  return value;
}

function one<T>(rows: T[]): T {
  const [row] = rows;
  if (row === undefined || rows.length !== 1) throw new Error(`expected 1 row, got ${rows.length}`);
  return row;
}
