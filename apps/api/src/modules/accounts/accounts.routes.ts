import {
  accountIdParamsSchema,
  accountListResponseSchema,
  accountReasonRequestSchema,
  accountResponseSchema,
  accountWithTemporaryPasswordSchema,
  createAccountRequestSchema,
  resetPasswordRequestSchema,
} from '@bella-vista/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { requireActor } from '../../plugins/audit-context.js';
import type { AccountsService } from './accounts.service.js';

// /v1/accounts: superadmin only (permission accounts.manage, D-19). No public sign-up exists.

export const accountsRoutes: FastifyPluginAsyncZod<{ service: AccountsService }> = async (
  app,
  { service },
) => {
  const config = { permission: 'accounts.manage' as const };

  app.get('/', { config, schema: { response: { 200: accountListResponseSchema } } }, async () =>
    service.list(),
  );

  app.post(
    '/',
    {
      config,
      schema: {
        body: createAccountRequestSchema,
        response: { 201: accountWithTemporaryPasswordSchema },
      },
    },
    async (request, reply) =>
      reply.code(201).send(await service.create(requireActor(request), request.body)),
  );

  app.post(
    '/:id/reset-password',
    {
      config,
      schema: {
        params: accountIdParamsSchema,
        body: resetPasswordRequestSchema,
        response: { 200: accountWithTemporaryPasswordSchema },
      },
    },
    async (request) =>
      service.resetPassword(requireActor(request), request.params.id, request.body?.reason),
  );

  for (const action of ['lock', 'unlock', 'deactivate'] as const) {
    app.post(
      `/:id/${action}`,
      {
        config,
        schema: {
          params: accountIdParamsSchema,
          body: accountReasonRequestSchema,
          response: { 200: accountResponseSchema },
        },
      },
      async (request) => ({
        account: await service[action](
          requireActor(request),
          request.params.id,
          request.body.reason,
        ),
      }),
    );
  }
};
