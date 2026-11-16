import { auditLogPageSchema, auditLogQuerySchema } from '@bella-vista/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { requireAccount } from '../../plugins/auth.js';
import type { AuditService } from './audit.service.js';

// /v1/audit-log (2.3 /bitacora): PRE (full) and SA (technical entries only).

export const auditRoutes: FastifyPluginAsyncZod<{ service: AuditService }> = async (
  app,
  { service },
) => {
  app.get(
    '/',
    {
      config: { permission: 'auditLog.view' },
      schema: { querystring: auditLogQuerySchema, response: { 200: auditLogPageSchema } },
    },
    async (request) => service.list(requireAccount(request), request.query),
  );
};
