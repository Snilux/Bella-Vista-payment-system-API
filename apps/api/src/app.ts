import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyServerOptions } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Env } from './config/env.js';
import type { Database } from './db/client.js';
import { errors } from './lib/errors.js';
import { registerAccountsModule } from './modules/accounts/index.js';
import {
  type ApprovalRegistry,
  createApprovalRegistry,
} from './modules/approvals/approval-registry.js';
import { registerApprovalsModule } from './modules/approvals/index.js';
import { registerAuditModule } from './modules/audit/index.js';
import { registerAuthModule } from './modules/auth/index.js';
import { registerBillingModule } from './modules/billing/index.js';
import { registerCashboxesModule } from './modules/cashboxes/index.js';
import { registerClosingsModule } from './modules/closings/index.js';
import { registerCommitteeModule } from './modules/committee/index.js';
import { registerConnectionsModule } from './modules/connections/index.js';
import { registerOrganizationModule } from './modules/organization/index.js';
import { registerRatesModule } from './modules/rates/index.js';
import { registerRegistryModule } from './modules/registry/index.js';
import { registerReportsModule } from './modules/reports/index.js';
import { registerAuth } from './plugins/auth.js';
import { registerErrorHandler } from './plugins/error-handler.js';
import { registerIdempotency } from './plugins/idempotency.js';
import { registerPermissions } from './plugins/permissions.js';
import { healthRoutes } from './routes/health.js';

// Validation messages in Spanish (es-MX users); the API turns them into VALIDATION_ERROR.
z.config(z.locales.es());

declare module 'fastify' {
  interface FastifyInstance {
    db: Database;
    env: Env;
    /** Current time; injectable so tests control dates (validity, lock expiry). */
    now: () => Date;
    /** Approval handlers registered by the modules (approvals/approval-registry.ts). */
    approvalRegistry: ApprovalRegistry;
  }
}

export interface BuildAppOptions {
  env: Env;
  db: Database;
  logger?: FastifyServerOptions['logger'];
  now?: () => Date;
  healthTimeoutMs?: number;
  /**
   * Login and refresh limit per client IP, also applied to login attempts per username
   * (RNF-SEG-07); tests raise it.
   */
  loginRateLimit?: { max: number; timeWindow: number | string };
}

export const DEFAULT_LOGIN_RATE_LIMIT = { max: 10, timeWindow: '1 minute' };

/**
 * Builds the Fastify application without listening (server.ts listens; tests use inject()).
 * Module routes live under /v1; each API step registers its modules here.
 */
export async function buildApp(options: BuildAppOptions) {
  const { env, db } = options;
  const now = options.now ?? (() => new Date());
  const hops = env.TRUST_PROXY;
  const app = Fastify({
    logger: options.logger ?? false,
    // Only the proxies named by TRUST_PROXY may set X-Forwarded-For (request.ip); with
    // `true` any client could pick its own IP and escape the login rate limit.
    // A hop count trusts that many proxies nearest to the API (as proxy-addr does).
    trustProxy: typeof hops === 'number' ? (_address: string, hop: number) => hop < hops : hops,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate('db', db);
  app.decorate('env', env);
  app.decorate('now', now);
  const approvalRegistry = createApprovalRegistry();
  app.decorate('approvalRegistry', approvalRegistry);

  registerErrorHandler(app);
  await app.register(helmet);
  // Only routes that set config.rateLimit are limited (login and refresh). In memory: the API
  // runs as a single instance.
  await app.register(rateLimit, {
    global: false,
    errorResponseBuilder: () => errors.tooManyRequests(),
  });
  // Hook order matters: authentication, then permissions (onRequest), then idempotency
  // (preHandler, after body validation).
  await registerAuth(app, {
    db,
    jwtSecret: env.JWT_ACCESS_SECRET,
    accessTokenTtl: env.JWT_ACCESS_TTL,
    timeZone: env.BUSINESS_TIMEZONE,
    now,
  });
  registerPermissions(app);
  registerIdempotency(app, { db });

  await app.register(healthRoutes, { db, timeoutMs: options.healthTimeoutMs ?? 2_000 });
  await registerAuthModule(app, { rateLimit: options.loginRateLimit ?? DEFAULT_LOGIN_RATE_LIMIT });
  await registerAccountsModule(app);
  await registerApprovalsModule(app, approvalRegistry);
  await registerOrganizationModule(app, approvalRegistry);
  await registerRegistryModule(app, approvalRegistry);
  await registerConnectionsModule(app);
  await registerRatesModule(app, approvalRegistry);
  await registerBillingModule(app, approvalRegistry);
  await registerCashboxesModule(app, approvalRegistry);
  await registerCommitteeModule(app, approvalRegistry);
  await registerClosingsModule(app);
  await registerReportsModule(app);
  await registerAuditModule(app);

  return app;
}

export type App = Awaited<ReturnType<typeof buildApp>>;
