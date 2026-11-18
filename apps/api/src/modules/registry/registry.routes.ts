import {
  createPersonRequestSchema,
  createSuspensionRequestSchema,
  createUnitRequestSchema,
  endSuspensionRequestSchema,
  idParamsSchema,
  personMatchesQuerySchema,
  personMatchesResponseSchema,
  personResponseSchema,
  searchQuerySchema,
  searchResponseSchema,
  suspensionListQuerySchema,
  suspensionPageSchema,
  suspensionResponseSchema,
  unitChangeRequestResponseSchema,
  unitDeactivationRequestSchema,
  unitHolderChangeRequestSchema,
  unitResponseSchema,
} from '@bella-vista/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { requireActor } from '../../plugins/audit-context.js';
import { requireAccount } from '../../plugins/auth.js';
import type { RegistryService } from './registry.service.js';

// /v1/search, /v1/people, /v1/units and /v1/suspensions (registry). Permissions follow the
// matrix of 1.1 §4; block leaders are limited to their block by the service.

type Options = { service: RegistryService };

export const searchRoutes: FastifyPluginAsyncZod<Options> = async (app, { service }) => {
  app.get(
    '/',
    {
      config: { permission: 'registry.view' },
      schema: { querystring: searchQuerySchema, response: { 200: searchResponseSchema } },
    },
    async (request) => service.search(requireAccount(request), request.query.q),
  );
};

export const peopleRoutes: FastifyPluginAsyncZod<Options> = async (app, { service }) => {
  app.get(
    '/matches',
    {
      config: { permission: 'registry.manage' },
      schema: {
        querystring: personMatchesQuerySchema,
        response: { 200: personMatchesResponseSchema },
      },
    },
    async (request) => service.matches(request.query),
  );

  app.post(
    '/',
    {
      config: { permission: 'registry.manage' },
      schema: { body: createPersonRequestSchema, response: { 201: personResponseSchema } },
    },
    async (request, reply) =>
      reply
        .code(201)
        .send(
          await service.createPerson(requireActor(request), requireAccount(request), request.body),
        ),
  );

  app.get(
    '/:id',
    {
      config: { permission: 'registry.view' },
      schema: { params: idParamsSchema, response: { 200: personResponseSchema } },
    },
    async (request) => service.getPerson(requireAccount(request), request.params.id),
  );
};

export const unitRoutes: FastifyPluginAsyncZod<Options> = async (app, { service }) => {
  app.post(
    '/',
    {
      config: { permission: 'registry.manage' },
      schema: { body: createUnitRequestSchema, response: { 201: unitResponseSchema } },
    },
    async (request, reply) =>
      reply
        .code(201)
        .send(
          await service.createUnit(requireActor(request), requireAccount(request), request.body),
        ),
  );

  app.get(
    '/:id',
    {
      config: { permission: 'registry.view' },
      schema: { params: idParamsSchema, response: { 200: unitResponseSchema } },
    },
    async (request) => service.getUnit(requireAccount(request), request.params.id),
  );

  app.post(
    '/:id/request-deactivation',
    {
      config: { permission: 'unitChanges.request' },
      schema: {
        params: idParamsSchema,
        body: unitDeactivationRequestSchema,
        response: { 201: unitChangeRequestResponseSchema },
      },
    },
    async (request, reply) =>
      reply
        .code(201)
        .send(
          await service.requestDeactivation(
            requireActor(request),
            requireAccount(request),
            request.params.id,
            request.body.reason,
          ),
        ),
  );

  app.post(
    '/:id/request-holder-change',
    {
      config: { permission: 'unitChanges.request' },
      schema: {
        params: idParamsSchema,
        body: unitHolderChangeRequestSchema,
        response: { 201: unitChangeRequestResponseSchema },
      },
    },
    async (request, reply) =>
      reply
        .code(201)
        .send(
          await service.requestHolderChange(
            requireActor(request),
            requireAccount(request),
            request.params.id,
            request.body,
          ),
        ),
  );
};

export const suspensionRoutes: FastifyPluginAsyncZod<Options> = async (app, { service }) => {
  app.get(
    '/',
    {
      config: { permission: 'suspensions.view' },
      schema: { querystring: suspensionListQuerySchema, response: { 200: suspensionPageSchema } },
    },
    async (request) => service.listSuspensions(request.query),
  );

  app.post(
    '/',
    {
      config: { permission: 'suspensions.manage' },
      schema: { body: createSuspensionRequestSchema, response: { 201: suspensionResponseSchema } },
    },
    async (request, reply) =>
      reply.code(201).send(await service.createSuspension(requireActor(request), request.body)),
  );

  app.post(
    '/:id/end',
    {
      config: { permission: 'suspensions.manage' },
      schema: {
        params: idParamsSchema,
        body: endSuspensionRequestSchema,
        response: { 200: suspensionResponseSchema },
      },
    },
    async (request) =>
      service.endSuspension(requireActor(request), request.params.id, request.body.periodTo),
  );
};
