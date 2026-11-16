import helmet from '@fastify/helmet';
import Fastify, { type FastifyServerOptions } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Env } from './config/env.js';
import type { Database } from './db/client.js';
import { registerErrorHandler } from './plugins/error-handler.js';
import { healthRoutes } from './routes/health.js';

// Validation messages in Spanish (es-MX users); the API turns them into VALIDATION_ERROR.
z.config(z.locales.es());

declare module 'fastify' {
  interface FastifyInstance {
    db: Database;
    env: Env;
    /** Current time; injectable so tests control dates (validity, lock expiry). */
    now: () => Date;
  }
}

export interface BuildAppOptions {
  env: Env;
  db: Database;
  logger?: FastifyServerOptions['logger'];
  now?: () => Date;
  healthTimeoutMs?: number;
}

/**
 * Builds the Fastify application without listening (server.ts listens; tests use inject()).
 * Module routes are registered under /v1 by the API steps that follow.
 */
export async function buildApp(options: BuildAppOptions) {
  const { env, db } = options;
  const now = options.now ?? (() => new Date());
  const app = Fastify({
    logger: options.logger ?? false,
    // Behind the platform's HTTPS proxy in production.
    trustProxy: env.NODE_ENV === 'production',
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate('db', db);
  app.decorate('env', env);
  app.decorate('now', now);

  registerErrorHandler(app);
  await app.register(helmet);

  await app.register(healthRoutes, { db, timeoutMs: options.healthTimeoutMs ?? 2_000 });

  return app;
}

export type App = Awaited<ReturnType<typeof buildApp>>;
