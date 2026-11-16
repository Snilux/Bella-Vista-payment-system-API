import { sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Database } from '../db/client.js';
import { errors } from '../lib/errors.js';

// GET /health (outside /v1, no session): answers 200 only when the database responds within
// `timeoutMs`; otherwise 503 DATABASE_UNAVAILABLE, so the container platform restarts or
// stops routing to the API.

export interface HealthOptions {
  db: Database;
  timeoutMs: number;
}

const healthResponse = z.object({ status: z.literal('ok'), database: z.literal('ok') });

export const healthRoutes: FastifyPluginAsyncZod<HealthOptions> = async (app, options) => {
  app.get('/health', { schema: { response: { 200: healthResponse } } }, async () => {
    await pingDatabase(options.db, options.timeoutMs);
    return { status: 'ok' as const, database: 'ok' as const };
  });
};

async function pingDatabase(db: Database, timeoutMs: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(errors.databaseUnavailable()), timeoutMs);
  });
  try {
    await Promise.race([db.execute(sql`SELECT 1`), timeout]);
  } catch {
    throw errors.databaseUnavailable();
  } finally {
    clearTimeout(timer);
  }
}
