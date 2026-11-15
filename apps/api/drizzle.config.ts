import { defineConfig } from 'drizzle-kit';

// Migrations are generated from the TypeScript schema and stored in src/db/migrations.
// Constraints Drizzle cannot express (complex CHECKs, triggers, partial indexes on expressions,
// grants) are added as hand-written SQL migrations: `pnpm db:generate --custom`.
// Migrations connect as the owner through DATABASE_URL_MIGRATIONS, never through the API's
// DATABASE_URL (agua_api cannot create or alter objects).
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/index.ts',
  out: './src/db/migrations',
  dbCredentials: {
    url: process.env.DATABASE_URL_MIGRATIONS ?? '',
  },
  casing: 'snake_case',
  strict: true,
  verbose: true,
});
