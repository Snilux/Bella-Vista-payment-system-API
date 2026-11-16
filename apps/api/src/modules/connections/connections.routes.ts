import {
  activateConnectionRequestRequestSchema,
  activationResponseSchema,
  agreementPageSchema,
  agreementResponseSchema,
  cancelConnectionRequestRequestSchema,
  connectionRequestListQuerySchema,
  connectionRequestPageSchema,
  connectionRequestResponseSchema,
  connectionResponseSchema,
  createAgreementRequestSchema,
  createConnectionRequestRequestSchema,
  createPreexistingConnectionRequestSchema,
  idParamsSchema,
  paginationQuerySchema,
  resolveConnectionRequestRequestSchema,
} from '@bella-vista/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { requireActor } from '../../plugins/audit-context.js';
import { requireAccount } from '../../plugins/auth.js';
import type { ConnectionsService } from './connections.service.js';

// /v1/connections, /v1/agreements and /v1/connection-requests. Block leaders act only in
// their block (checked by the service).

type Options = { service: ConnectionsService };

export const connectionRoutes: FastifyPluginAsyncZod<Options> = async (app, { service }) => {
  app.post(
    '/pre-existing',
    {
      config: { permission: 'registry.manage' },
      schema: {
        body: createPreexistingConnectionRequestSchema,
        response: { 201: connectionResponseSchema },
      },
    },
    async (request, reply) =>
      reply
        .code(201)
        .send(
          await service.createPreexisting(
            requireActor(request),
            requireAccount(request),
            request.body,
          ),
        ),
  );

  app.get(
    '/:id',
    {
      config: { permission: 'registry.view' },
      schema: { params: idParamsSchema, response: { 200: connectionResponseSchema } },
    },
    async (request) => service.getConnection(requireAccount(request), request.params.id),
  );
};

export const agreementRoutes: FastifyPluginAsyncZod<Options> = async (app, { service }) => {
  app.get(
    '/',
    {
      config: { permission: 'agreements.view' },
      schema: { querystring: paginationQuerySchema, response: { 200: agreementPageSchema } },
    },
    async (request) => service.listAgreements(request.query),
  );

  app.post(
    '/',
    {
      config: { permission: 'agreements.manage' },
      schema: { body: createAgreementRequestSchema, response: { 201: agreementResponseSchema } },
    },
    async (request, reply) =>
      reply.code(201).send(await service.createAgreement(requireActor(request), request.body)),
  );
};

export const connectionRequestRoutes: FastifyPluginAsyncZod<Options> = async (app, { service }) => {
  app.get(
    '/',
    {
      config: { permission: 'connectionRequests.view' },
      schema: {
        querystring: connectionRequestListQuerySchema,
        response: { 200: connectionRequestPageSchema },
      },
    },
    async (request) => service.listRequests(requireAccount(request), request.query),
  );

  app.get(
    '/:id',
    {
      config: { permission: 'connectionRequests.view' },
      schema: { params: idParamsSchema, response: { 200: connectionRequestResponseSchema } },
    },
    async (request) => service.getRequest(requireAccount(request), request.params.id),
  );

  app.post(
    '/',
    {
      config: { permission: 'connectionRequests.manage' },
      schema: {
        body: createConnectionRequestRequestSchema,
        response: { 201: connectionRequestResponseSchema },
      },
    },
    async (request, reply) =>
      reply
        .code(201)
        .send(
          await service.createRequest(requireActor(request), requireAccount(request), request.body),
        ),
  );

  app.post(
    '/:id/resolve',
    {
      config: { permission: 'connectionRequests.resolve' },
      schema: {
        params: idParamsSchema,
        body: resolveConnectionRequestRequestSchema,
        response: { 200: connectionRequestResponseSchema },
      },
    },
    async (request) =>
      service.resolveRequest(
        requireActor(request),
        requireAccount(request),
        request.params.id,
        request.body,
      ),
  );

  app.post(
    '/:id/activate',
    {
      config: { permission: 'connectionRequests.manage' },
      schema: {
        params: idParamsSchema,
        body: activateConnectionRequestRequestSchema,
        response: { 201: activationResponseSchema },
      },
    },
    async (request, reply) =>
      reply
        .code(201)
        .send(
          await service.activateRequest(
            requireActor(request),
            requireAccount(request),
            request.params.id,
            request.body,
          ),
        ),
  );

  app.post(
    '/:id/cancel',
    {
      config: { permission: 'connectionRequests.manage' },
      schema: {
        params: idParamsSchema,
        body: cancelConnectionRequestRequestSchema,
        response: { 200: connectionRequestResponseSchema },
      },
    },
    async (request) =>
      service.cancelRequest(
        requireActor(request),
        requireAccount(request),
        request.params.id,
        request.body.reason,
      ),
  );
};
