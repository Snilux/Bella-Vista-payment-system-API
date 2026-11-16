import { asc, count, eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { describe, expect, it } from 'vitest';
import type { Database } from '../../../src/db/client.js';
import * as schema from '../../../src/db/schema/index.js';
import {
  agreement,
  approval,
  auditLog,
  cashbox,
  expenseCategory,
  fee,
  feeAmount,
  person,
  roleAssignment,
  section,
  userAccount,
  vPaymentAmount,
  vUnit,
} from '../../../src/db/schema/index.js';
import { BOOTSTRAP_AUDIT_REASON, runBootstrap } from '../../../src/db/seed/bootstrap.js';
import { type BootstrapFile, parseBootstrapFile } from '../../../src/db/seed/bootstrap-file.js';
import {
  applyDevSuperadminPassword,
  DEV_PASSWORD,
  DevSeedRefusedError,
  runDevSeed,
} from '../../../src/db/seed/dev-data.js';
import { verifyPassword } from '../../../src/lib/password.js';
import { folioPattern, migrateDatabase, testDatabaseUrl, withFreshDatabase } from './helpers.js';

// Block 8 (D-27, 3.1 §2.2): `pnpm db:seed` and `pnpm db:seed:dev`. The scripts commit, so
// each case runs on a fresh, fully migrated database, connected as the API user agua_api
// (the role the scripts use through DATABASE_URL) to prove its grants are enough.

const NOW = new Date('2026-11-16T18:00:00Z');
const TIME_ZONE = 'America/Mexico_City';

const sampleFile = (overrides: Partial<Record<keyof BootstrapFile, unknown>> = {}) =>
  parseBootstrapFile({
    superadministrador: {
      nombres: 'Rolando',
      apellidoPaterno: 'Gómez',
      apellidoMaterno: 'Torres',
      telefono: '5551234567',
      usuario: 'admin',
    },
    acuerdo: {
      fechaJunta: '2026-11-01',
      tema: 'Elección del comité de agua 2026-2029',
      votosFavor: 80,
      votosContra: 4,
      abstenciones: 2,
      referenciaActa: 'Acta del 1 de noviembre de 2026, foja 3',
    },
    presidente: { nombres: 'Ana', apellidoPaterno: 'Salinas', fechaInicio: '2026-11-01' },
    tesorero: { nombres: 'Bruno', apellidoPaterno: 'Ochoa', fechaInicio: '2026-11-01' },
    secretario: { nombres: 'Celia', apellidoPaterno: 'Paredes', fechaInicio: '2026-11-02' },
    ...overrides,
  });

/** Opens a fresh migrated database and passes `fn` a Drizzle client acting as agua_api. */
function withSeedDatabase(fn: (db: Database) => Promise<void>): Promise<void> {
  return withFreshDatabase(async (url) => {
    await migrateDatabase(url);
    const client = postgres(url, {
      max: 4,
      connection: { TimeZone: 'UTC', options: '-c role=agua_api' },
      onnotice: () => {},
    });
    try {
      await fn(drizzle({ client, schema, casing: 'snake_case' }));
    } finally {
      await client.end();
    }
  });
}

const bootstrap = (db: Database, file = sampleFile(), password = 'Temporal-123') =>
  runBootstrap(db, file, { now: NOW, timeZone: TIME_ZONE, generatePassword: () => password });

/** Row count of every table the bootstrap writes to. */
async function counts(db: Database) {
  const tables = {
    person,
    roleAssignment,
    userAccount,
    agreement,
    approval,
    cashbox,
    expenseCategory,
    fee,
    feeAmount,
    auditLog,
  };
  const result: Record<string, number> = {};
  for (const [name, table] of Object.entries(tables)) {
    const [row] = await db.select({ n: count() }).from(table);
    result[name] = row?.n ?? -1;
  }
  return result;
}

describe.skipIf(!testDatabaseUrl)('pnpm db:seed (initial bootstrap)', () => {
  it('creates the initial data once; a second run changes nothing', { timeout: 60_000 }, () =>
    withSeedDatabase(async (db) => {
      const first = await bootstrap(db);
      expect(first).toMatchObject({ status: 'created', username: 'admin' });
      const afterFirst = await counts(db);
      expect(afterFirst).toMatchObject({
        person: 4,
        roleAssignment: 4,
        userAccount: 1,
        agreement: 1,
        approval: 3,
        cashbox: 1,
        expenseCategory: 6,
        fee: 3,
        feeAmount: 0,
      });

      const second = await bootstrap(db, sampleFile(), 'Otra-456');
      expect(second).toEqual({ status: 'already_bootstrapped', username: 'admin' });
      expect(await counts(db)).toEqual(afterFirst);
    }),
  );

  it(
    'stores the temporary password as an Argon2id hash that must be changed',
    { timeout: 60_000 },
    () =>
      withSeedDatabase(async (db) => {
        const result = await runBootstrap(db, sampleFile(), { now: NOW, timeZone: TIME_ZONE });
        if (result.status !== 'created') throw new Error('expected a new bootstrap');
        expect(result.temporaryPassword).toMatch(/^[a-zA-Z2-9]{12}$/);

        const [account] = await db.select().from(userAccount);
        expect(account?.mustChangePassword).toBe(true);
        expect(account?.passwordHash).toMatch(/^\$argon2id\$/);
        expect(await verifyPassword(account?.passwordHash ?? '', result.temporaryPassword)).toBe(
          true,
        );
        expect(await verifyPassword(account?.passwordHash ?? '', 'incorrecta')).toBe(false);

        // The hash never reaches the audit log.
        const [leak] = await db
          .select({ n: count() })
          .from(auditLog)
          .where(sql`${auditLog.after}::text LIKE ${`%${account?.passwordHash ?? ''}%`}`);
        expect(leak?.n).toBe(0);
      }),
  );

  it(
    'approves the officers by bootstrap and creates the committee catalogs',
    { timeout: 60_000 },
    () =>
      withSeedDatabase(async (db) => {
        const result = await bootstrap(db);
        if (result.status !== 'created') throw new Error('expected a new bootstrap');
        expect(result.agreementFolio).toMatch(folioPattern('AC'));

        const officers = await db
          .select({
            role: roleAssignment.role,
            startDate: roleAssignment.startDate,
            endDate: roleAssignment.endDate,
            result: approval.result,
            type: approval.type,
            reason: approval.reason,
            resolvedBy: approval.resolvedBy,
          })
          .from(roleAssignment)
          .innerJoin(approval, eq(approval.id, roleAssignment.approvalId))
          .orderBy(asc(roleAssignment.id));
        expect(officers.map((o) => o.role)).toEqual(['president', 'treasurer', 'secretary']);
        expect(officers.map((o) => o.startDate)).toEqual([
          '2026-11-01',
          '2026-11-01',
          '2026-11-02',
        ]);
        for (const officer of officers) {
          expect(officer).toMatchObject({
            endDate: null,
            result: 'approved',
            type: 'role_assignment',
            resolvedBy: result.superadminUserAccountId,
          });
          expect(officer.reason).toContain(result.agreementFolio);
        }
        // No accounts for the officers: the superadmin creates them from the app.
        const [accounts] = await db.select({ n: count() }).from(userAccount);
        expect(accounts?.n).toBe(1);

        const [sa] = await db
          .select({ role: roleAssignment.role, approvalId: roleAssignment.approvalId })
          .from(roleAssignment)
          .where(eq(roleAssignment.role, 'superadmin'));
        expect(sa).toEqual({ role: 'superadmin', approvalId: null });

        const boxes = await db.select({ type: cashbox.type }).from(cashbox);
        expect(boxes).toEqual([{ type: 'committee' }]);

        const categories = await db.select().from(expenseCategory).orderBy(asc(expenseCategory.id));
        expect(categories.map((c) => c.name)).toEqual([
          'Electricidad',
          'Reparaciones',
          'Materiales',
          'Instalaciones',
          'Salario del fontanero',
          'Otros',
        ]);
        expect(categories.filter((c) => c.isPlumberSalary).map((c) => c.name)).toEqual([
          'Salario del fontanero',
        ]);

        const fees = await db
          .select({ type: fee.type, name: fee.name })
          .from(fee)
          .orderBy(asc(fee.id));
        expect(fees).toEqual([
          { type: 'opening', name: 'Apertura de toma' },
          { type: 'reconnection', name: 'Reinstalación' },
          { type: 'repair', name: 'Reparación a usuario' },
        ]);

        // Every created row has a technical audit entry by the superadmin.
        const entries = await db.select().from(auditLog);
        const created = await counts(db);
        const { auditLog: _audited, ...createdRows } = created;
        const expected = Object.values(createdRows).reduce((sum, n) => sum + n, 0);
        expect(entries).toHaveLength(expected);
        for (const entry of entries) {
          expect(entry).toMatchObject({
            action: 'create',
            role: 'superadmin',
            isTechnical: true,
            reason: BOOTSTRAP_AUDIT_REASON,
            userAccountId: result.superadminUserAccountId,
          });
        }
      }),
  );

  it('reuses the person when the superadmin is also an officer (D-22)', { timeout: 60_000 }, () =>
    withSeedDatabase(async (db) => {
      const file = sampleFile({
        presidente: {
          nombres: 'rolando',
          apellidoPaterno: 'Gomez',
          apellidoMaterno: 'Torres',
          fechaInicio: '2026-11-01',
        },
      });
      expect((await bootstrap(db, file)).status).toBe('created');

      const roles = await db
        .select({ role: roleAssignment.role })
        .from(roleAssignment)
        .innerJoin(person, eq(person.id, roleAssignment.personId))
        .where(eq(person.givenNames, 'Rolando'))
        .orderBy(asc(roleAssignment.id));
      expect(roles.map((r) => r.role)).toEqual(['superadmin', 'president']);
      const [people] = await db.select({ n: count() }).from(person);
      expect(people?.n).toBe(3);
    }),
  );

  it('creates a single superadmin when two runs overlap', { timeout: 60_000 }, () =>
    withSeedDatabase(async (db) => {
      const results = await Promise.all([bootstrap(db), bootstrap(db)]);
      expect(results.map((r) => r.status).sort()).toEqual(['already_bootstrapped', 'created']);
      const [accounts] = await db.select({ n: count() }).from(userAccount);
      expect(accounts?.n).toBe(1);
    }),
  );
});

describe.skipIf(!testDatabaseUrl)('pnpm db:seed:dev (development data)', () => {
  it('refuses to run with NODE_ENV=production', async () => {
    // Refused before touching the database.
    const unusedDb = {} as Database;
    await expect(runDevSeed(unusedDb, { nodeEnv: 'production' })).rejects.toBeInstanceOf(
      DevSeedRefusedError,
    );
  });

  it('requires the initial bootstrap', { timeout: 60_000 }, () =>
    withSeedDatabase(async (db) => {
      await expect(runDevSeed(db, { nodeEnv: 'development' })).rejects.toThrow(/pnpm db:seed/);
      const [sections] = await db.select({ n: count() }).from(section);
      expect(sections?.n).toBe(0);
    }),
  );

  it('loads realistic data once, consistent with the views', { timeout: 60_000 }, () =>
    withSeedDatabase(async (db) => {
      await bootstrap(db);
      const result = await runDevSeed(db, { nodeEnv: 'development' });
      if (result.status !== 'created') throw new Error('expected new development data');
      expect(result.counts).toEqual({ people: 13, connections: 5, units: 8, payments: 7 });
      expect(result.accounts.map((a) => a.username)).toEqual([
        'presidente',
        'tesorero',
        'secretario',
        'jm.s1m01',
        'jm.s1m02',
        'jm.s2m01',
        'vocal',
      ]);

      // Development accounts log in with DEV_PASSWORD.
      const [leader] = await db
        .select()
        .from(userAccount)
        .where(eq(userAccount.username, 'jm.s1m01'));
      expect(await verifyPassword(leader?.passwordHash ?? '', DEV_PASSWORD)).toBe(true);

      // Homonyms: two pairs with the same normalized name and different distinguishing notes.
      const homonyms = await db.execute<{ n: number }>(sql`
        SELECT count(*)::int AS n FROM (
          SELECT f_normalize_name(given_names, paternal_surname, maternal_surname)
          FROM person GROUP BY 1 HAVING count(*) > 1) pairs`);
      expect(homonyms[0]?.n).toBe(2);

      // A connection with three families.
      const families = await db.execute<{ n: number }>(sql`
        SELECT max(c)::int AS n FROM (SELECT count(*) AS c FROM unit GROUP BY connection_id) u`);
      expect(families[0]?.n).toBe(3);

      const statuses = await db.select({ status: vUnit.status }).from(vUnit);
      expect(statuses.filter((s) => s.status === 'active')).toHaveLength(7);
      expect(statuses.filter((s) => s.status === 'pending_activation')).toHaveLength(1);

      // Totals: 2025 at $40.00, 2026 at $50.00; the flores payment doubles 7 months.
      const payments = await db.select().from(vPaymentAmount);
      expect(payments).toHaveLength(7);
      expect(payments.reduce((sum, p) => sum + p.total, 0)).toBe(301_000);
      expect(payments.map((p) => p.total).sort((a, b) => a - b)).toEqual([
        15_000, 24_000, 48_000, 48_000, 50_000, 56_000, 60_000,
      ]);
      for (const p of payments) {
        expect(p.receiverPersonId).not.toBeNull();
        expect(p.holderPersonId).not.toBeNull();
        expect(p.cancelled).toBe(false);
      }

      const before = await counts(db);
      expect(await runDevSeed(db, { nodeEnv: 'development' })).toEqual({
        status: 'already_seeded',
      });
      expect(await counts(db)).toEqual(before);
    }),
  );

  it('gives the superadmin the development password once', { timeout: 60_000 }, () =>
    withSeedDatabase(async (db) => {
      await bootstrap(db);
      expect(await applyDevSuperadminPassword(db, { nodeEnv: 'development' })).toEqual({
        username: 'admin',
        changed: true,
      });
      const [sa] = await db.select().from(userAccount).where(eq(userAccount.username, 'admin'));
      expect(sa?.mustChangePassword).toBe(false);
      expect(await verifyPassword(sa?.passwordHash ?? '', DEV_PASSWORD)).toBe(true);

      const before = await counts(db);
      expect(await applyDevSuperadminPassword(db, { nodeEnv: 'development' })).toEqual({
        username: 'admin',
        changed: false,
      });
      expect(await counts(db)).toEqual(before);
      await expect(
        applyDevSuperadminPassword(db, { nodeEnv: 'production' }),
      ).rejects.toBeInstanceOf(DevSeedRefusedError);
    }),
  );
});
