import { buildApp } from './app.js';
import { loadEnv } from './config/env.js';
import { loggerOptions } from './config/logger.js';
import { createDb } from './db/client.js';

// Process entry point: validates the environment, opens the database pool, builds the app
// and listens. Shuts down cleanly on SIGINT/SIGTERM (Fastify first, then the pool).

const env = loadEnv();
const { db, sql } = createDb(env.DATABASE_URL);

const app = await buildApp({
  env,
  db,
  logger: loggerOptions(env),
});

let closing = false;
const shutdown = async (signal: string) => {
  if (closing) return;
  closing = true;
  app.log.info({ signal }, 'shutting down');
  try {
    await app.close();
    await sql.end({ timeout: 5 });
    process.exit(0);
  } catch (error) {
    app.log.error({ err: error }, 'shutdown failed');
    process.exit(1);
  }
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await app.listen({ port: env.API_PORT, host: '0.0.0.0' });
} catch (error) {
  app.log.error({ err: error }, 'failed to start');
  await sql.end({ timeout: 5 });
  process.exit(1);
}
