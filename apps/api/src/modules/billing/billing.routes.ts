import {
  accountStatementResponseSchema,
  cancelExtraChargeRequestSchema,
  createExtraChargeRequestSchema,
  createPaymentRequestSchema,
  extraChargeListQuerySchema,
  extraChargeListResponseSchema,
  extraChargeResponseSchema,
  idParamsSchema,
  paperReceiptReplacementRequestSchema,
  paymentCancellationRequestSchema,
  paymentListQuerySchema,
  paymentPageSchema,
  paymentPreviewRequestSchema,
  paymentPreviewResponseSchema,
  paymentResponseSchema,
} from '@bella-vista/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { requireActor } from '../../plugins/audit-context.js';
import { requireAccount } from '../../plugins/auth.js';
import { requireIdempotency, sendIdempotent } from '../../plugins/idempotency.js';
import type { BillingService } from './billing.service.js';

// /v1/units/{id}/account-statement (2.3 /unidades/{id}/estado-cuenta) and /v1/payments
// (2.3 /pagos). Block leaders act only in their block (checked by the service); the POSTs
// that move money require an Idempotency-Key.

type Options = { service: BillingService };

export const accountStatementRoutes: FastifyPluginAsyncZod<Options> = async (app, { service }) => {
  app.get(
    '/:id/account-statement',
    {
      config: { permission: 'registry.view' },
      schema: { params: idParamsSchema, response: { 200: accountStatementResponseSchema } },
    },
    async (request) => service.getStatement(requireAccount(request), request.params.id),
  );

  app.get(
    '/:id/extra-charges',
    {
      config: { permission: 'payments.view' },
      schema: {
        params: idParamsSchema,
        querystring: extraChargeListQuerySchema,
        response: { 200: extraChargeListResponseSchema },
      },
    },
    async (request) =>
      service.listExtraCharges(requireAccount(request), request.params.id, request.query),
  );
};

/** /v1/extra-charges: only the treasurer creates and cancels them (D-28). */
export const extraChargeRoutes: FastifyPluginAsyncZod<Options> = async (app, { service }) => {
  app.post(
    '/',
    {
      config: { permission: 'charges.manage' },
      schema: {
        body: createExtraChargeRequestSchema,
        response: { 201: extraChargeResponseSchema },
      },
    },
    async (request, reply) =>
      reply.code(201).send(await service.createExtraCharge(requireActor(request), request.body)),
  );

  app.post(
    '/:id/cancel',
    {
      config: { permission: 'charges.manage' },
      schema: {
        params: idParamsSchema,
        body: cancelExtraChargeRequestSchema,
        response: { 200: extraChargeResponseSchema },
      },
    },
    async (request) =>
      service.cancelExtraCharge(requireActor(request), request.params.id, request.body.reason),
  );
};

export const paymentRoutes: FastifyPluginAsyncZod<Options> = async (app, { service }) => {
  app.post(
    '/preview',
    {
      config: { permission: 'billing.collect' },
      schema: {
        body: paymentPreviewRequestSchema,
        response: { 200: paymentPreviewResponseSchema },
      },
    },
    async (request) => service.preview(requireAccount(request), request.body),
  );

  app.post(
    '/',
    {
      config: { permission: 'billing.collect', idempotent: true },
      schema: { body: createPaymentRequestSchema, response: { 201: paymentResponseSchema } },
    },
    async (request, reply) =>
      sendIdempotent(
        reply,
        await service.register(
          requireActor(request),
          requireAccount(request),
          requireIdempotency(request),
          request.body,
        ),
      ),
  );

  app.get(
    '/',
    {
      config: { permission: 'payments.view' },
      schema: { querystring: paymentListQuerySchema, response: { 200: paymentPageSchema } },
    },
    async (request) => service.list(requireAccount(request), request.query),
  );

  app.get(
    '/:id',
    {
      config: { permission: 'payments.view' },
      schema: { params: idParamsSchema, response: { 200: paymentResponseSchema } },
    },
    async (request) => service.get(requireAccount(request), request.params.id),
  );

  app.post(
    '/:id/replacements',
    {
      config: { permission: 'receipts.replace' },
      schema: {
        params: idParamsSchema,
        body: paperReceiptReplacementRequestSchema,
        response: { 201: paymentResponseSchema },
      },
    },
    async (request, reply) =>
      reply
        .code(201)
        .send(
          await service.replaceReceipt(
            requireActor(request),
            requireAccount(request),
            request.params.id,
            request.body.paperFolio,
          ),
        ),
  );

  app.post(
    '/:id/request-cancellation',
    {
      config: { permission: 'payments.requestCancellation', idempotent: true },
      schema: {
        params: idParamsSchema,
        body: paymentCancellationRequestSchema,
        response: { 201: paymentResponseSchema },
      },
    },
    async (request, reply) =>
      sendIdempotent(
        reply,
        await service.requestCancellation(
          requireActor(request),
          requireAccount(request),
          requireIdempotency(request),
          request.params.id,
          request.body.reason,
        ),
      ),
  );
};
