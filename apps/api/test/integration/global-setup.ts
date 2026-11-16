import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

/** Databases created per test file (api/fixture.ts, db/helpers.ts withFreshDatabase). */
const TEMPORARY_DATABASE = /^agua_test_(api|tmp)_[0-9a-f]{8}$/;

// Brings the test database (DATABASE_URL_TEST) up to the latest migration before the suite,
// after dropping the per-file databases an interrupted run left behind.
export default async function setup(): Promise<void> {
  const url = process.env.DATABASE_URL_TEST;
  if (!url) return;
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    const leftovers = await sql<{ datname: string }[]>`
      SELECT datname FROM pg_database WHERE datname LIKE 'agua_test_%'`;
    for (const { datname } of leftovers) {
      if (TEMPORARY_DATABASE.test(datname)) {
        await sql.unsafe(`DROP DATABASE IF EXISTS ${datname} WITH (FORCE)`);
      }
    }
    const migrationsFolder = fileURLToPath(new URL('../../src/db/migrations', import.meta.url));
    await migrate(drizzle({ client: sql }), { migrationsFolder });
  } finally {
    await sql.end();
  }
}
