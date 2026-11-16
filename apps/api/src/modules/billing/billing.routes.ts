import { accountStatementResponseSchema, idParamsSchema } from '@bella-vista/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { requireAccount } from '../../plugins/auth.js';
import type { BillingService } from './billing.service.js';

// /v1/units/{id}/account-statement (2.3 /unidades/{id}/estado-cuenta): by scope.

export const accountStatementRoutes: FastifyPluginAsyncZod<{ service: BillingService }> = async (
  app,
  { service },
) => {
  app.get(
    '/:id/account-statement',
    {
      config: { permission: 'registry.view' },
      schema: { params: idParamsSchema, response: { 200: accountStatementResponseSchema } },
    },
    async (request) => service.getStatement(requireAccount(request), request.params.id),
  );
};
