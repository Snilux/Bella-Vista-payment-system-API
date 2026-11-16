import type { FastifyInstance } from 'fastify';
import type { ApprovalRegistry } from '../approvals/approval-registry.js';
import { feeRoutes, rateRoutes } from './rates.routes.js';
import { createRatesService, rateApprovalHandler } from './rates.service.js';

/** Registers /v1/rates and /v1/fees, and the handler of the rate approvals. */
export async function registerRatesModule(
  app: FastifyInstance,
  registry: ApprovalRegistry,
): Promise<void> {
  const service = createRatesService({
    db: app.db,
    now: app.now,
    timeZone: app.env.BUSINESS_TIMEZONE,
  });
  registry.register('rate', rateApprovalHandler);
  await app.register(rateRoutes, { prefix: '/v1/rates', service });
  await app.register(feeRoutes, { prefix: '/v1/fees', service });
}
