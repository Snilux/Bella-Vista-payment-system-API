import type { FastifyInstance } from 'fastify';
import type { ApprovalRegistry } from '../approvals/approval-registry.js';
import { accountStatementRoutes, paymentRoutes } from './billing.routes.js';
import { createBillingService, paymentCancellationHandler } from './billing.service.js';

/**
 * Registers /v1/units/{id}/account-statement and /v1/payments, and the handler of the
 * payment_cancellation approvals.
 */
export async function registerBillingModule(
  app: FastifyInstance,
  registry: ApprovalRegistry,
): Promise<void> {
  const service = createBillingService({
    db: app.db,
    now: app.now,
    timeZone: app.env.BUSINESS_TIMEZONE,
  });
  registry.register('payment_cancellation', paymentCancellationHandler);
  await app.register(accountStatementRoutes, { prefix: '/v1/units', service });
  await app.register(paymentRoutes, { prefix: '/v1/payments', service });
}
