import { readFile } from 'node:fs/promises';
import postgres from 'postgres';
import { describe, expect, it } from 'vitest';
import {
  migrateDatabase,
  migrationsFolder,
  testDatabaseUrl,
  withFreshDatabase,
} from './helpers.js';

// Applies every migration from scratch on a new, empty database (created and dropped through
// the DATABASE_URL_TEST server). It proves the migration history is reproducible without
// Docker: extensions, generated and hand-written migrations, in journal order.

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
  // Block 4: cashboxes and billing
  'cashbox',
  'opening_balance',
  'payment',
  'payment_month',
  'covered_period',
  'payment_charge',
  'paper_receipt',
  'payment_cancellation',
  // Block 5: handovers and committee
  'handover',
  'income',
  'expense_category',
  'expense',
  'expense_refund',
  'plumber',
  'plumber_salary',
  'plumber_payment',
];

describe.skipIf(!testDatabaseUrl)('migrations from scratch', () => {
  it('applies all migrations on an empty database', { timeout: 60_000 }, () =>
    withFreshDatabase(async (url) => {
      await migrateDatabase(url);

      const fresh = postgres(url, { max: 1, onnotice: () => {} });
      try {
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
    }),
  );
});
