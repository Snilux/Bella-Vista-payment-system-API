import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

// Brings the test database (DATABASE_URL_TEST) up to the latest migration before the suite.
export default async function setup(): Promise<void> {
  const url = process.env.DATABASE_URL_TEST;
  if (!url) return;
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    const migrationsFolder = fileURLToPath(new URL('../../src/db/migrations', import.meta.url));
    await migrate(drizzle({ client: sql }), { migrationsFolder });
  } finally {
    await sql.end();
  }
}
