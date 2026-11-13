import { afterAll, expect } from 'vitest';
import { createDb, type Transaction } from '../../../src/db/client.js';
import {
  approval,
  type approvalType,
  block,
  person,
  roleAssignment,
  section,
  userAccount,
} from '../../../src/db/schema/index.js';

// Shared helpers for the schema integration tests (run against DATABASE_URL_TEST).
// Every case runs inside a transaction that is always rolled back.

export const testDatabaseUrl = process.env.DATABASE_URL_TEST;

class Rollback extends Error {}

/** Year and month (YYYYMM) of "now" in the business time zone, as used in folios. */
export function currentYearMonth(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Mexico_City',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return get('year') + get('month');
}

/** Matches a folio `<prefix>-AAAAMM-NNNNNN` created this month. */
export function folioPattern(prefix: string): RegExp {
  return new RegExp(`^${prefix}-${currentYearMonth()}-\\d{6}$`);
}

/** The single row a `returning()` query must produce. */
export function one<T>(rows: T[]): T {
  const [row] = rows;
  if (row === undefined || rows.length !== 1) throw new Error(`expected 1 row, got ${rows.length}`);
  return row;
}

/** Postgres error fields, whether thrown directly or wrapped by Drizzle. */
export interface PgErrorLike {
  code?: string;
  constraint_name?: string;
  message?: string;
  cause?: unknown;
}

export function pgError(error: unknown): PgErrorLike {
  let current = error as PgErrorLike | undefined;
  while (current && !current.code && current.cause) current = current.cause as PgErrorLike;
  return current ?? {};
}

type ApprovalType = (typeof approvalType.enumValues)[number];
type AssignableRole = 'president' | 'treasurer' | 'secretary' | 'member' | 'block_leader';

/**
 * Opens a pool on the test database for one `describe` block (closed in `afterAll`) and
 * returns the transaction helpers.
 */
export function useTestDb() {
  const { db, sql: client } = createDb(testDatabaseUrl ?? '', { max: 2 });
  afterAll(() => client.end());

  /** Runs `fn` in a transaction and rolls it back. */
  async function rollback(fn: (tx: Transaction) => Promise<void>): Promise<void> {
    await expect(
      db.transaction(async (tx) => {
        await fn(tx);
        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);
  }

  /** Runs `fn` in a savepoint and returns the error it raised (undefined if none). */
  async function attempt(
    tx: Transaction,
    fn: (sp: Transaction) => Promise<unknown>,
  ): Promise<unknown> {
    try {
      await tx.transaction(async (sp) => {
        await fn(sp);
      });
      return undefined;
    } catch (error) {
      return error;
    }
  }

  /** Expects `fn` to violate `constraint`; runs in a savepoint so the outer tx survives. */
  async function expectViolation(
    tx: Transaction,
    constraint: string,
    fn: (sp: Transaction) => Promise<unknown>,
  ): Promise<void> {
    const caught = await attempt(tx, fn);
    expect(caught, `expected violation of ${constraint}`).toBeDefined();
    expect(pgError(caught).constraint_name).toBe(constraint);
  }

  return { db, rollback, attempt, expectViolation };
}

/**
 * Base data for a test: the bootstrap superadmin (created_by null), section S1 with blocks
 * M01 and M02, and factories for people, approvals and role assignments.
 */
export async function bootstrap(tx: Transaction) {
  const saPerson = one(
    await tx
      .insert(person)
      .values({ givenNames: 'Admin', paternalSurname: 'Sistema', registeredOn: '2026-01-01' })
      .returning(),
  );
  const saAssignment = one(
    await tx
      .insert(roleAssignment)
      .values({ personId: saPerson.id, role: 'superadmin', startDate: '2026-01-01' })
      .returning(),
  );
  const sa = one(
    await tx
      .insert(userAccount)
      .values({ roleAssignmentId: saAssignment.id, username: 'admin', passwordHash: 'x' })
      .returning(),
  );
  const s1 = one(
    await tx
      .insert(section)
      .values({ code: 'S1', name: 'Sección 1', createdBy: sa.id })
      .returning(),
  );
  const m01 = one(
    await tx.insert(block).values({ sectionId: s1.id, code: 'M01', createdBy: sa.id }).returning(),
  );
  const m02 = one(
    await tx.insert(block).values({ sectionId: s1.id, code: 'M02', createdBy: sa.id }).returning(),
  );

  let n = 0;
  const newPerson = async (givenNames = `Persona${++n}`, paternalSurname = 'Prueba') =>
    one(
      await tx
        .insert(person)
        .values({ givenNames, paternalSurname, registeredOn: '2026-01-01', createdBy: sa.id })
        .returning(),
    );

  const newApproval = async (type: ApprovalType = 'role_assignment') =>
    one(
      await tx
        .insert(approval)
        .values({ type, reason: 'Solicitud de prueba', requestedBy: sa.id, createdBy: sa.id })
        .returning(),
    );

  const assign = async (values: {
    personId: number;
    role: AssignableRole;
    blockId?: number;
    contactPhone?: string;
    endDate?: string;
  }) => {
    const { id: approvalId } = await newApproval();
    return one(
      await tx
        .insert(roleAssignment)
        .values({ startDate: '2026-01-01', approvalId, createdBy: sa.id, ...values })
        .returning(),
    );
  };

  return { sa, saPerson, saAssignment, s1, m01, m02, newPerson, newApproval, assign };
}
