import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { z } from 'zod';
import { envSchema } from '../config/env.js';
import { apiLoginFromUrls, checkLogin, syncApiRole } from './api-role.js';
import { createSeedLogger, parseCliEnv } from './seed/cli-support.js';

// `pnpm db:migrate`: applies pending migrations as the owner (DATABASE_URL_MIGRATIONS), then
// sets the password of agua_api to the one in DATABASE_URL and checks the API can log in.
// In production (without tsx): `node dist/db/migrate-cli.js` from apps/api.

const migrateEnvSchema = envSchema
  .pick({ NODE_ENV: true, LOG_LEVEL: true, DATABASE_URL: true })
  .extend({ DATABASE_URL_MIGRATIONS: z.url({ protocol: /^postgres(ql)?$/ }) });

// Same path from src/db (tsx) and dist/db (build): migrations ship in src/db/migrations.
const migrationsFolder = fileURLToPath(new URL('../../src/db/migrations', import.meta.url));

const env = parseCliEnv(migrateEnvSchema);
const log = createSeedLogger(env);

const owner = postgres(env.DATABASE_URL_MIGRATIONS, { max: 1, onnotice: () => {} });
try {
  await migrate(drizzle({ client: owner }), { migrationsFolder });
  log.info('Migraciones aplicadas.');

  const login = apiLoginFromUrls(env.DATABASE_URL, env.DATABASE_URL_MIGRATIONS);
  if (login === null) {
    log.warn(
      'DATABASE_URL usa el mismo usuario que las migraciones; no se ajustó la contraseña de agua_api.',
    );
  } else {
    await syncApiRole(owner, login);
    const user = await checkLogin(env.DATABASE_URL);
    log.info(`Contraseña de ${user} ajustada a la de DATABASE_URL; la API puede conectarse.`);
  }
} catch (error) {
  log.error({ err: error }, 'pnpm db:migrate falló.');
  process.exitCode = 1;
} finally {
  await owner.end();
}
