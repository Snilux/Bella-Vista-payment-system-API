import {
  createExpenseRequestSchema,
  createIncomeRequestSchema,
  createPlumberRequestSchema,
  createPlumberSalaryRequestSchema,
  expenseCategoryListResponseSchema,
  expenseListQuerySchema,
  expensePageSchema,
  expenseResponseSchema,
  idParamsSchema,
  incomePageSchema,
  incomeResponseSchema,
  paginationQuerySchema,
  payPlumberRequestSchema,
  plumberListResponseSchema,
  plumberResponseSchema,
  plumberSalaryResponseSchema,
  refundExpenseRequestSchema,
  rejectExpenseRequestSchema,
  updatePlumberRequestSchema,
} from '@bella-vista/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { requireActor } from '../../plugins/audit-context.js';
import { requireIdempotency, sendIdempotent } from '../../plugins/idempotency.js';
import type { CommitteeService } from './committee.service.js';

// /v1/incomes, /v1/expenses, /v1/expense-categories and /v1/plumbers (2.3 /ingresos, /gastos,
// /fontaneros): the committee reads them, the treasurer manages them. The POSTs that move
// money require an Idempotency-Key.

type Options = { service: CommitteeService };

export const incomeRoutes: FastifyPluginAsyncZod<Options> = async (app, { service }) => {
  app.get(
    '/',
    {
      config: { permission: 'committee.view' },
      schema: { querystring: paginationQuerySchema, response: { 200: incomePageSchema } },
    },
    async (request) => service.listIncomes(request.query),
  );

  app.post(
    '/',
    {
      config: { permission: 'committee.manage', idempotent: true },
      schema: { body: createIncomeRequestSchema, response: { 201: incomeResponseSchema } },
    },
    async (request, reply) =>
      sendIdempotent(
        reply,
        await service.createIncome(
          requireActor(request),
          requireIdempotency(request),
          request.body,
        ),
      ),
  );
};

export const expenseCategoryRoutes: FastifyPluginAsyncZod<Options> = async (app, { service }) => {
  app.get(
    '/',
    {
      config: { permission: 'committee.view' },
      schema: { response: { 200: expenseCategoryListResponseSchema } },
    },
    async () => service.listCategories(),
  );
};

export const expenseRoutes: FastifyPluginAsyncZod<Options> = async (app, { service }) => {
  app.get(
    '/',
    {
      config: { permission: 'committee.view' },
      schema: { querystring: expenseListQuerySchema, response: { 200: expensePageSchema } },
    },
    async (request) => service.listExpenses(request.query),
  );

  app.get(
    '/:id',
    {
      config: { permission: 'committee.view' },
      schema: { params: idParamsSchema, response: { 200: expenseResponseSchema } },
    },
    async (request) => service.getExpense(request.params.id),
  );

  app.post(
    '/',
    {
      config: { permission: 'committee.manage', idempotent: true },
      schema: { body: createExpenseRequestSchema, response: { 201: expenseResponseSchema } },
    },
    async (request, reply) =>
      sendIdempotent(
        reply,
        await service.createExpense(
          requireActor(request),
          requireIdempotency(request),
          request.body,
        ),
      ),
  );

  app.post(
    '/:id/pay',
    {
      config: { permission: 'committee.manage', idempotent: true },
      schema: { params: idParamsSchema, response: { 200: expenseResponseSchema } },
    },
    async (request, reply) =>
      sendIdempotent(
        reply,
        await service.payExpense(
          requireActor(request),
          requireIdempotency(request),
          request.params.id,
        ),
      ),
  );

  app.post(
    '/:id/reject',
    {
      config: { permission: 'committee.manage' },
      schema: {
        params: idParamsSchema,
        body: rejectExpenseRequestSchema,
        response: { 200: expenseResponseSchema },
      },
    },
    async (request) =>
      service.rejectExpense(requireActor(request), request.params.id, request.body.reason),
  );

  app.post(
    '/:id/request-refund',
    {
      config: { permission: 'committee.manage', idempotent: true },
      schema: {
        params: idParamsSchema,
        body: refundExpenseRequestSchema,
        response: { 201: expenseResponseSchema },
      },
    },
    async (request, reply) =>
      sendIdempotent(
        reply,
        await service.requestRefund(
          requireActor(request),
          requireIdempotency(request),
          request.params.id,
          request.body.reason,
        ),
      ),
  );
};

export const plumberRoutes: FastifyPluginAsyncZod<Options> = async (app, { service }) => {
  app.get(
    '/',
    {
      config: { permission: 'committee.view' },
      schema: { response: { 200: plumberListResponseSchema } },
    },
    async () => service.listPlumbers(),
  );

  app.get(
    '/:id',
    {
      config: { permission: 'committee.view' },
      schema: { params: idParamsSchema, response: { 200: plumberResponseSchema } },
    },
    async (request) => service.getPlumber(request.params.id),
  );

  app.post(
    '/',
    {
      config: { permission: 'committee.manage' },
      schema: { body: createPlumberRequestSchema, response: { 201: plumberResponseSchema } },
    },
    async (request, reply) =>
      reply.code(201).send(await service.createPlumber(requireActor(request), request.body)),
  );

  app.patch(
    '/:id',
    {
      config: { permission: 'committee.manage' },
      schema: {
        params: idParamsSchema,
        body: updatePlumberRequestSchema,
        response: { 200: plumberResponseSchema },
      },
    },
    async (request) =>
      service.updatePlumber(requireActor(request), request.params.id, request.body),
  );

  app.post(
    '/:id/salaries',
    {
      config: { permission: 'committee.manage' },
      schema: {
        params: idParamsSchema,
        body: createPlumberSalaryRequestSchema,
        response: { 201: plumberSalaryResponseSchema },
      },
    },
    async (request, reply) =>
      reply
        .code(201)
        .send(await service.requestSalary(requireActor(request), request.params.id, request.body)),
  );

  app.post(
    '/:id/payments',
    {
      config: { permission: 'committee.manage', idempotent: true },
      schema: {
        params: idParamsSchema,
        body: payPlumberRequestSchema,
        response: { 201: expenseResponseSchema },
      },
    },
    async (request, reply) =>
      sendIdempotent(
        reply,
        await service.payPlumber(
          requireActor(request),
          requireIdempotency(request),
          request.params.id,
          request.body.date,
        ),
      ),
  );
};
