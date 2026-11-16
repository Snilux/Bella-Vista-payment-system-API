import type { FastifyInstance } from 'fastify';
import type { ApprovalRegistry } from '../approvals/approval-registry.js';
import {
  expenseCategoryRoutes,
  expenseRoutes,
  incomeRoutes,
  plumberRoutes,
} from './committee.routes.js';
import {
  createCommitteeService,
  expenseRefundHandler,
  plumberSalaryHandler,
} from './committee.service.js';

/**
 * Registers /v1/incomes, /v1/expenses, /v1/expense-categories and /v1/plumbers, and the
 * handlers of the expense_refund and plumber_salary approvals.
 */
export async function registerCommitteeModule(
  app: FastifyInstance,
  registry: ApprovalRegistry,
): Promise<void> {
  const service = createCommitteeService({
    db: app.db,
    now: app.now,
    timeZone: app.env.BUSINESS_TIMEZONE,
  });
  registry.register('expense_refund', expenseRefundHandler);
  registry.register('plumber_salary', plumberSalaryHandler);
  await app.register(incomeRoutes, { prefix: '/v1/incomes', service });
  await app.register(expenseCategoryRoutes, { prefix: '/v1/expense-categories', service });
  await app.register(expenseRoutes, { prefix: '/v1/expenses', service });
  await app.register(plumberRoutes, { prefix: '/v1/plumbers', service });
}
