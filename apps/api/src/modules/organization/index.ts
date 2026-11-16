import type { FastifyInstance } from 'fastify';
import type { ApprovalRegistry } from '../approvals/approval-registry.js';
import { blockRoutes, roleAssignmentRoutes, sectionRoutes } from './organization.routes.js';
import {
  createOrganizationService,
  roleAssignmentApprovalHandler,
} from './organization.service.js';

/**
 * Registers /v1/sections, /v1/blocks and /v1/role-assignments, and the handler of the
 * role_assignment approvals.
 */
export async function registerOrganizationModule(
  app: FastifyInstance,
  registry: ApprovalRegistry,
): Promise<void> {
  const service = createOrganizationService({
    db: app.db,
    now: app.now,
    timeZone: app.env.BUSINESS_TIMEZONE,
  });
  registry.register('role_assignment', roleAssignmentApprovalHandler);
  await app.register(sectionRoutes, { prefix: '/v1/sections', service });
  await app.register(blockRoutes, { prefix: '/v1/blocks', service });
  await app.register(roleAssignmentRoutes, { prefix: '/v1/role-assignments', service });
}
