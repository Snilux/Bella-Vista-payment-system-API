import {
  approvalListQuerySchema,
  approvalListResponseSchema,
  approvalResponseSchema,
  resolveApprovalRequestSchema,
} from '@bella-vista/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireActor } from '../../plugins/audit-context.js';
import { requireAccount } from '../../plugins/auth.js';
import type { ApprovalsService } from './approvals.service.js';

// /v1/approvals: inbox and detail (president: all; everyone else: their own) and resolution
// (president).

const idParams = z.object({ id: z.coerce.number().int().positive() });

export const approvalsRoutes: FastifyPluginAsyncZod<{ service: ApprovalsService }> = async (
  app,
  { service },
) => {
  app.get(
    '/',
    {
      config: { permission: 'approvals.view' },
      schema: {
        querystring: approvalListQuerySchema,
        response: { 200: approvalListResponseSchema },
      },
    },
    async (request) => service.list(requireAccount(request), request.query),
  );

  app.get(
    '/:id',
    {
      config: { permission: 'approvals.view' },
      schema: { params: idParams, response: { 200: approvalResponseSchema } },
    },
    async (request) => service.get(requireAccount(request), request.params.id),
  );

  app.post(
    '/:id/resolve',
    {
      config: { permission: 'approvals.resolve' },
      schema: {
        params: idParams,
        body: resolveApprovalRequestSchema,
        response: { 200: approvalResponseSchema },
      },
    },
    async (request) => service.resolve(requireActor(request), request.params.id, request.body),
  );
};
