import { defineConfig } from 'drizzle-kit';

// Migrations are generated from the TypeScript schema and stored in src/db/migrations.
// Constraints Drizzle cannot express (complex CHECKs, triggers, partial indexes on expressions,
// grants) are added as hand-written SQL migrations: `pnpm db:generate --custom`.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/index.ts',
  out: './src/db/migrations',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
  casing: 'snake_case',
  strict: true,
  verbose: true,
});
