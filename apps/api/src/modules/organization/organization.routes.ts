import {
  blockListQuerySchema,
  blockListResponseSchema,
  blockResponseSchema,
  closeRoleAssignmentRequestSchema,
  createBlockRequestSchema,
  createRoleAssignmentSchema,
  createSectionRequestSchema,
  idParamsSchema,
  roleAssignmentListQuerySchema,
  roleAssignmentListResponseSchema,
  roleAssignmentResponseSchema,
  sectionListResponseSchema,
  sectionResponseSchema,
  updateBlockRequestSchema,
  updateSectionRequestSchema,
} from '@bella-vista/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { requireActor } from '../../plugins/audit-context.js';
import { requireAccount } from '../../plugins/auth.js';
import type { OrganizationService } from './organization.service.js';

// /v1/sections and /v1/blocks: the secretary registers and edits; the committee and the block
// leaders consult. /v1/role-assignments: the committee consults; the secretary registers
// (creating an approval for the president) and closes officers' terms.

type Options = { service: OrganizationService };

export const sectionRoutes: FastifyPluginAsyncZod<Options> = async (app, { service }) => {
  app.get(
    '/',
    {
      config: { permission: 'organization.view' },
      schema: { response: { 200: sectionListResponseSchema } },
    },
    async () => service.listSections(),
  );

  app.post(
    '/',
    {
      config: { permission: 'organization.manage' },
      schema: { body: createSectionRequestSchema, response: { 201: sectionResponseSchema } },
    },
    async (request, reply) =>
      reply.code(201).send(await service.createSection(requireActor(request), request.body)),
  );

  app.patch(
    '/:id',
    {
      config: { permission: 'organization.manage' },
      schema: {
        params: idParamsSchema,
        body: updateSectionRequestSchema,
        response: { 200: sectionResponseSchema },
      },
    },
    async (request) =>
      service.updateSection(requireActor(request), request.params.id, request.body),
  );
};

export const blockRoutes: FastifyPluginAsyncZod<Options> = async (app, { service }) => {
  app.get(
    '/',
    {
      config: { permission: 'organization.view' },
      schema: { querystring: blockListQuerySchema, response: { 200: blockListResponseSchema } },
    },
    async (request) => service.listBlocks(requireAccount(request), request.query.sectionId),
  );

  app.get(
    '/:id',
    {
      config: { permission: 'organization.view' },
      schema: { params: idParamsSchema, response: { 200: blockResponseSchema } },
    },
    async (request) => service.getBlock(requireAccount(request), request.params.id),
  );

  app.post(
    '/',
    {
      config: { permission: 'organization.manage' },
      schema: { body: createBlockRequestSchema, response: { 201: blockResponseSchema } },
    },
    async (request, reply) =>
      reply
        .code(201)
        .send(
          await service.createBlock(requireActor(request), requireAccount(request), request.body),
        ),
  );

  app.patch(
    '/:id',
    {
      config: { permission: 'organization.manage' },
      schema: {
        params: idParamsSchema,
        body: updateBlockRequestSchema,
        response: { 200: blockResponseSchema },
      },
    },
    async (request) =>
      service.updateBlock(
        requireActor(request),
        requireAccount(request),
        request.params.id,
        request.body,
      ),
  );
};

export const roleAssignmentRoutes: FastifyPluginAsyncZod<Options> = async (app, { service }) => {
  app.get(
    '/',
    {
      config: { permission: 'assignments.view' },
      schema: {
        querystring: roleAssignmentListQuerySchema,
        response: { 200: roleAssignmentListResponseSchema },
      },
    },
    async (request) => service.listAssignments(request.query),
  );

  app.post(
    '/',
    {
      config: { permission: 'assignments.register' },
      schema: { body: createRoleAssignmentSchema, response: { 201: roleAssignmentResponseSchema } },
    },
    async (request, reply) =>
      reply.code(201).send(await service.createAssignment(requireActor(request), request.body)),
  );

  app.post(
    '/:id/close',
    {
      config: { permission: 'assignments.close' },
      schema: {
        params: idParamsSchema,
        body: closeRoleAssignmentRequestSchema,
        response: { 200: roleAssignmentResponseSchema },
      },
    },
    async (request) =>
      service.closeAssignment(requireActor(request), request.params.id, request.body),
  );
};
