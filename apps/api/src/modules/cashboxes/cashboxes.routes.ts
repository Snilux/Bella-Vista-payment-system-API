import {
  adjustmentResponseSchema,
  cashboxListResponseSchema,
  cashboxMovementPageSchema,
  cashboxMovementQuerySchema,
  confirmHandoverRequestSchema,
  createAdjustmentRequestSchema,
  handoverListQuerySchema,
  handoverPageSchema,
  handoverResponseSchema,
  idParamsSchema,
  myCashboxResponseSchema,
  openingBalanceRequestSchema,
  openingBalanceResponseSchema,
  prepareHandoverRequestSchema,
} from '@bella-vista/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { requireActor } from '../../plugins/audit-context.js';
import { requireAccount } from '../../plugins/auth.js';
import { requireIdempotency, sendIdempotent } from '../../plugins/idempotency.js';
import type { CashboxesService } from './cashboxes.service.js';

// /v1/cashboxes, /v1/handovers and /v1/adjustments (2.3 /cajas, /entregas, /aclaraciones).
// Block leaders only see their own cashbox (checked by the service); the POSTs that move money
// require an Idempotency-Key.

type Options = { service: CashboxesService };

export const cashboxRoutes: FastifyPluginAsyncZod<Options> = async (app, { service }) => {
  app.get(
    '/mine',
    {
      config: { permission: 'cashboxes.view' },
      schema: { response: { 200: myCashboxResponseSchema } },
    },
    async (request) => service.mine(requireAccount(request)),
  );

  app.get(
    '/',
    {
      config: { permission: 'committee.view' },
      schema: { response: { 200: cashboxListResponseSchema } },
    },
    async () => service.list(),
  );

  app.get(
    '/:id/movements',
    {
      config: { permission: 'cashboxes.view' },
      schema: {
        params: idParamsSchema,
        querystring: cashboxMovementQuerySchema,
        response: { 200: cashboxMovementPageSchema },
      },
    },
    async (request) => service.movements(requireAccount(request), request.params.id, request.query),
  );

  app.post(
    '/:id/opening-balance',
    {
      config: { permission: 'openingBalances.register', idempotent: true },
      schema: {
        params: idParamsSchema,
        body: openingBalanceRequestSchema,
        response: { 201: openingBalanceResponseSchema },
      },
    },
    async (request, reply) =>
      sendIdempotent(
        reply,
        await service.requestOpeningBalance(
          requireActor(request),
          requireIdempotency(request),
          request.params.id,
          request.body,
        ),
      ),
  );
};

export const handoverRoutes: FastifyPluginAsyncZod<Options> = async (app, { service }) => {
  app.get(
    '/',
    {
      config: { permission: 'handovers.view' },
      schema: { querystring: handoverListQuerySchema, response: { 200: handoverPageSchema } },
    },
    async (request) => service.listHandovers(requireAccount(request), request.query),
  );

  app.get(
    '/:id',
    {
      config: { permission: 'handovers.view' },
      schema: { params: idParamsSchema, response: { 200: handoverResponseSchema } },
    },
    async (request) => service.getHandover(requireAccount(request), request.params.id),
  );

  app.post(
    '/',
    {
      config: { permission: 'handovers.prepare', idempotent: true },
      schema: { body: prepareHandoverRequestSchema, response: { 201: handoverResponseSchema } },
    },
    async (request, reply) =>
      sendIdempotent(
        reply,
        await service.prepareHandover(
          requireActor(request),
          requireAccount(request),
          requireIdempotency(request),
          request.body,
        ),
      ),
  );

  app.post(
    '/:id/withdraw',
    {
      config: { permission: 'handovers.prepare' },
      schema: { params: idParamsSchema, response: { 200: handoverResponseSchema } },
    },
    async (request) =>
      service.withdrawHandover(requireActor(request), requireAccount(request), request.params.id),
  );

  app.post(
    '/:id/confirm',
    {
      config: { permission: 'handovers.confirm', idempotent: true },
      schema: {
        params: idParamsSchema,
        body: confirmHandoverRequestSchema,
        response: { 200: handoverResponseSchema },
      },
    },
    async (request, reply) =>
      sendIdempotent(
        reply,
        await service.confirmHandover(
          requireActor(request),
          requireIdempotency(request),
          request.params.id,
          request.body.receivedAmount,
        ),
      ),
  );
};

export const adjustmentRoutes: FastifyPluginAsyncZod<Options> = async (app, { service }) => {
  app.post(
    '/',
    {
      config: { permission: 'adjustments.propose', idempotent: true },
      schema: { body: createAdjustmentRequestSchema, response: { 201: adjustmentResponseSchema } },
    },
    async (request, reply) =>
      sendIdempotent(
        reply,
        await service.proposeAdjustment(
          requireActor(request),
          requireIdempotency(request),
          request.body,
        ),
      ),
  );
};
