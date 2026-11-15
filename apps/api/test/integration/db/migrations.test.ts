import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { describe, expect, it } from 'vitest';
import { testDatabaseUrl } from './helpers.js';

// Applies every migration from scratch on a new, empty database (created and dropped through
// the DATABASE_URL_TEST server). It proves the migration history is reproducible without
// Docker: extensions, generated and hand-written migrations, in journal order.

const migrationsFolder = fileURLToPath(new URL('../../../src/db/migrations', import.meta.url));

/** Tables each implementation block must leave behind. */
const expectedTables = [
  // Block 1: organization and access
  'section',
  'block',
  'person',
  'agreement',
  'approval',
  'role_assignment',
  'user_account',
  'refresh_token',
  // Block 2: registry and connections
  'connection_request',
  'connection',
  'connection_block',
  'unit',
  'unit_holder',
  'suspension',
  'unit_change_request',
  // Block 3: rates and fees
  'rate',
  'fee',
  'fee_amount',
  'extra_charge',
];

describe.skipIf(!testDatabaseUrl)('migrations from scratch', () => {
  it('applies all migrations on an empty database', { timeout: 60_000 }, async () => {
    const adminUrl = new URL(testDatabaseUrl ?? '');
    const dbName = `agua_test_mig_${randomBytes(4).toString('hex')}`;
    const freshUrl = new URL(adminUrl);
    freshUrl.pathname = `/${dbName}`;

    const admin = postgres(adminUrl.toString(), { max: 1, onnotice: () => {} });
    await admin.unsafe(`CREATE DATABASE ${dbName}`);
    try {
      const fresh = postgres(freshUrl.toString(), { max: 1, onnotice: () => {} });
      try {
        await migrate(drizzle({ client: fresh }), { migrationsFolder });

        const journal = JSON.parse(
          await readFile(`${migrationsFolder}/meta/_journal.json`, 'utf8'),
        ) as { entries: unknown[] };
        const [applied] = await fresh<{ count: number }[]>`
          SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations`;
        expect(applied?.count).toBe(journal.entries.length);

        const rows = await fresh<{ table_name: string }[]>`
          SELECT table_name FROM information_schema.tables
          WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`;
        const tables = rows.map((row) => row.table_name);
        expect(tables).toEqual(expect.arrayContaining(expectedTables));
      } finally {
        await fresh.end();
      }
    } finally {
      await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
      await admin.end();
    }
  });
});
