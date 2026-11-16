import {
  closingListQuerySchema,
  closingPageSchema,
  closingResponseSchema,
  countClosingRequestSchema,
  idParamsSchema,
  openClosingRequestSchema,
} from '@bella-vista/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { requireActor } from '../../plugins/audit-context.js';
import { requireAccount } from '../../plugins/auth.js';
import type { ClosingsService } from './closings.service.js';

// /v1/closings (2.3 /cortes): the custodian opens and counts; the president or a member
// reviews and closes. Block leaders only see the closings of their block cashbox.

type Options = { service: ClosingsService };

export const closingRoutes: FastifyPluginAsyncZod<Options> = async (app, { service }) => {
  app.get(
    '/',
    {
      config: { permission: 'closings.view' },
      schema: { querystring: closingListQuerySchema, response: { 200: closingPageSchema } },
    },
    async (request) => service.list(requireAccount(request), request.query),
  );

  app.get(
    '/:id',
    {
      config: { permission: 'closings.view' },
      schema: { params: idParamsSchema, response: { 200: closingResponseSchema } },
    },
    async (request) => service.get(requireAccount(request), request.params.id),
  );

  app.post(
    '/',
    {
      config: { permission: 'closings.prepare' },
      schema: { body: openClosingRequestSchema, response: { 201: closingResponseSchema } },
    },
    async (request, reply) =>
      reply
        .code(201)
        .send(await service.open(requireActor(request), requireAccount(request), request.body)),
  );

  app.post(
    '/:id/count',
    {
      config: { permission: 'closings.prepare' },
      schema: {
        params: idParamsSchema,
        body: countClosingRequestSchema,
        response: { 200: closingResponseSchema },
      },
    },
    async (request) =>
      service.count(
        requireActor(request),
        requireAccount(request),
        request.params.id,
        request.body,
      ),
  );

  app.post(
    '/:id/review',
    {
      config: { permission: 'closings.review' },
      schema: { params: idParamsSchema, response: { 200: closingResponseSchema } },
    },
    async (request) => service.review(requireActor(request), request.params.id),
  );

  app.post(
    '/:id/close',
    {
      config: { permission: 'closings.review' },
      schema: { params: idParamsSchema, response: { 200: closingResponseSchema } },
    },
    async (request) => service.close(requireActor(request), request.params.id),
  );
};
