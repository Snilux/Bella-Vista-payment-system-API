import type { FastifyInstance } from 'fastify';
import type { ApprovalRegistry } from './approval-registry.js';
import { approvalsRoutes } from './approvals.routes.js';
import { createApprovalsService } from './approvals.service.js';

/** Registers /v1/approvals; the registry receives the handlers of the other modules. */
export async function registerApprovalsModule(
  app: FastifyInstance,
  registry: ApprovalRegistry,
): Promise<void> {
  const service = createApprovalsService({
    db: app.db,
    now: app.now,
    timeZone: app.env.BUSINESS_TIMEZONE,
    registry,
  });
  await app.register(approvalsRoutes, { prefix: '/v1/approvals', service });
}
