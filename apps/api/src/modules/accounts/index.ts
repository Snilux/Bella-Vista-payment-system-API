import type { FastifyInstance } from 'fastify';
import { accountsRoutes } from './accounts.routes.js';
import { type AccountsService, createAccountsService } from './accounts.service.js';

/** Builds the accounts service from the app and registers /v1/accounts. */
export async function registerAccountsModule(app: FastifyInstance): Promise<AccountsService> {
  const service = createAccountsService({
    db: app.db,
    now: app.now,
    timeZone: app.env.BUSINESS_TIMEZONE,
  });
  await app.register(accountsRoutes, { prefix: '/v1/accounts', service });
  return service;
}
