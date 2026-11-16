import {
  createFeeAmountRequestSchema,
  createFeeRequestSchema,
  createRateRequestSchema,
  feeListResponseSchema,
  feeResponseSchema,
  idParamsSchema,
  rateListResponseSchema,
  rateResponseSchema,
} from '@bella-vista/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { requireActor } from '../../plugins/audit-context.js';
import type { RatesService } from './rates.service.js';

// /v1/rates and /v1/fees (2.3 /tarifas, /conceptos): everyone with an account reads them; the
// treasurer registers (D-20).

type Options = { service: RatesService };

export const rateRoutes: FastifyPluginAsyncZod<Options> = async (app, { service }) => {
  app.get(
    '/',
    {
      config: { permission: 'rates.view' },
      schema: { response: { 200: rateListResponseSchema } },
    },
    async () => service.listRates(),
  );

  app.post(
    '/',
    {
      config: { permission: 'rates.register' },
      schema: { body: createRateRequestSchema, response: { 201: rateResponseSchema } },
    },
    async (request, reply) =>
      reply.code(201).send(await service.registerRate(requireActor(request), request.body)),
  );
};

export const feeRoutes: FastifyPluginAsyncZod<Options> = async (app, { service }) => {
  app.get(
    '/',
    {
      config: { permission: 'rates.view' },
      schema: { response: { 200: feeListResponseSchema } },
    },
    async () => service.listFees(),
  );

  app.post(
    '/',
    {
      config: { permission: 'rates.register' },
      schema: { body: createFeeRequestSchema, response: { 201: feeResponseSchema } },
    },
    async (request, reply) =>
      reply.code(201).send(await service.createFee(requireActor(request), request.body)),
  );

  app.post(
    '/:id/amounts',
    {
      config: { permission: 'rates.register' },
      schema: {
        params: idParamsSchema,
        body: createFeeAmountRequestSchema,
        response: { 201: feeResponseSchema },
      },
    },
    async (request, reply) =>
      reply
        .code(201)
        .send(await service.addFeeAmount(requireActor(request), request.params.id, request.body)),
  );
};
