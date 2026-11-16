import type { FastifyInstance } from 'fastify';
import { accountStatementRoutes } from './billing.routes.js';
import { createBillingService } from './billing.service.js';

/** Registers /v1/units/{id}/account-statement (payments arrive in API step 6). */
export async function registerBillingModule(app: FastifyInstance): Promise<void> {
  const service = createBillingService({
    db: app.db,
    now: app.now,
    timeZone: app.env.BUSINESS_TIMEZONE,
  });
  await app.register(accountStatementRoutes, { prefix: '/v1/units', service });
}
