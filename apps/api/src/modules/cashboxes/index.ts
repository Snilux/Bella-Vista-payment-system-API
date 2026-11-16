import type { FastifyInstance } from 'fastify';
import type { ApprovalRegistry } from '../approvals/approval-registry.js';
import { adjustmentRoutes, cashboxRoutes, handoverRoutes } from './cashboxes.routes.js';
import {
  adjustmentHandler,
  createCashboxesService,
  openingBalanceHandler,
} from './cashboxes.service.js';

/**
 * Registers /v1/cashboxes, /v1/handovers and /v1/adjustments, and the handlers of the
 * opening_balance and adjustment approvals.
 */
export async function registerCashboxesModule(
  app: FastifyInstance,
  registry: ApprovalRegistry,
): Promise<void> {
  const service = createCashboxesService({
    db: app.db,
    now: app.now,
    timeZone: app.env.BUSINESS_TIMEZONE,
  });
  registry.register('opening_balance', openingBalanceHandler);
  registry.register('adjustment', adjustmentHandler);
  await app.register(cashboxRoutes, { prefix: '/v1/cashboxes', service });
  await app.register(handoverRoutes, { prefix: '/v1/handovers', service });
  await app.register(adjustmentRoutes, { prefix: '/v1/adjustments', service });
}
