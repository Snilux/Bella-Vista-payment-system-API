import type { FastifyInstance } from 'fastify';
import { auditRoutes } from './audit.routes.js';
import { createAuditService } from './audit.service.js';

/** Registers /v1/audit-log. */
export async function registerAuditModule(app: FastifyInstance): Promise<void> {
  await app.register(auditRoutes, {
    prefix: '/v1/audit-log',
    service: createAuditService({ db: app.db }),
  });
}
