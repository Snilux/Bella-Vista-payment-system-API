import type { FastifyInstance } from 'fastify';
import type { ApprovalRegistry } from '../approvals/approval-registry.js';
import { peopleRoutes, searchRoutes, suspensionRoutes, unitRoutes } from './registry.routes.js';
import {
  createRegistryService,
  holderChangeHandler,
  unitDeactivationHandler,
} from './registry.service.js';

/**
 * Registers /v1/search, /v1/people, /v1/units and /v1/suspensions, and the handlers of the
 * unit_deactivation and holder_change approvals.
 */
export async function registerRegistryModule(
  app: FastifyInstance,
  registry: ApprovalRegistry,
): Promise<void> {
  const service = createRegistryService({
    db: app.db,
    now: app.now,
    timeZone: app.env.BUSINESS_TIMEZONE,
  });
  registry.register('unit_deactivation', unitDeactivationHandler);
  registry.register('holder_change', holderChangeHandler);
  await app.register(searchRoutes, { prefix: '/v1/search', service });
  await app.register(peopleRoutes, { prefix: '/v1/people', service });
  await app.register(unitRoutes, { prefix: '/v1/units', service });
  await app.register(suspensionRoutes, { prefix: '/v1/suspensions', service });
}
