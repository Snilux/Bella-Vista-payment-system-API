import {
  type CreateExpenseRequest,
  type CreateIncomeRequest,
  type CreatePlumberRequest,
  type CreatePlumberSalaryRequest,
  type Expense,
  type ExpenseListQuery,
  formatMoney,
  type PaginationQuery,
  type Plumber,
  type PlumberDetail,
  type PlumberSalary,
  plumberPayPeriod,
  type UpdatePlumberRequest,
} from '@bella-vista/shared';
import { type Actor, applyAuditContext, writeAudit } from '../../db/audit.js';
import type { Database, Transaction } from '../../db/client.js';
import { isUniqueViolation } from '../../db/errors.js';
import {
  type IdempotencyContext,
  type IdempotentResult,
  idempotentTransaction,
} from '../../db/idempotency.js';
import { lockRecord } from '../../db/locks.js';
import { businessDate } from '../../lib/dates.js';
import { AppError, errors } from '../../lib/errors.js';
import type { ApprovalHandler } from '../approvals/approval-registry.js';
import { balanceOf, committeeCashbox } from '../cashboxes/cashboxes.repository.js';
import { cashboxErrors } from '../cashboxes/cashboxes.service.js';
import * as repo from './committee.repository.js';

// Committee cashbox (CU-19 to CU-21; RF-GAS; D-17, D-21, D-24): other incomes, expenses paid
// only with enough balance, refunds approved by the president, and the plumber with his salary
// history and one payment per period.

export interface CommitteeServiceDeps {
  db: Database;
  now: () => Date;
  timeZone: string;
}

type Executor = Database | Transaction;

const FREQUENCY_LABELS: Record<string, string> = {
  weekly: 'semanal',
  biweekly: 'quincenal',
  monthly: 'mensual',
};

const EXPENSE_LABELS: Record<string, string> = {
  pending_payment: 'pendiente de pago',
  paid: 'pagado',
  rejected: 'rechazado',
  refunded: 'reintegrado',
};

export const committeeErrors = {
  expenseNotFound: () => new AppError('NOT_FOUND', 404, 'No existe ese gasto.'),
  plumberNotFound: () => new AppError('NOT_FOUND', 404, 'No existe ese fontanero.'),
  agreementNotFound: () => new AppError('NOT_FOUND', 404, 'No existe ese acuerdo de junta.'),
  agreementNotApproved: () =>
    errors.validation({
      issues: [{ path: 'body.agreementId', message: 'El acuerdo de junta no fue aprobado.' }],
    }),
  futureDate: (path: string) =>
    errors.validation({ issues: [{ path, message: 'La fecha no puede ser posterior a hoy.' }] }),
  expenseState: (status: string, action: string) =>
    errors.invalidState(`El gasto está ${EXPENSE_LABELS[status] ?? status}.`, status, action),
  periodAlreadyPaid: (start: string, end: string) =>
    new AppError(
      'PERIOD_ALREADY_PAID',
      409,
      `El periodo del ${start} al ${end} ya está pagado al fontanero.`,
      { periodStart: start, periodEnd: end },
    ),
};

const nextPage = <T extends { id: number }>(rows: T[], limit: number) => {
  const data = rows.slice(0, limit);
  return { data, next: rows.length > limit ? String(data.at(-1)?.id) : null };
};

const toSalary = (row: repo.SalaryRow): PlumberSalary => ({
  id: row.id,
  amount: row.amount,
  frequency: row.frequency,
  effectiveFrom: row.effectiveFrom,
  agreement: { id: row.agreementId, folio: row.agreementFolio },
  status: row.result ?? 'pending',
  approvalId: row.approvalId,
});

/** Committee cashbox locked, with its expected balance (D-21: it never goes negative). */
async function lockCommitteeBalance(tx: Transaction) {
  const id = await committeeCashbox(tx);
  if (id === null) throw errors.internal(); // created by the bootstrap (D-27)
  await lockRecord(tx, 'cashbox', id);
  return { id, balance: await balanceOf(tx, id) };
}

export function createCommitteeService(deps: CommitteeServiceDeps) {
  const { db } = deps;
  const today = () => businessDate(deps.now(), deps.timeZone);

  async function toExpenses(exec: Executor, rows: repo.ExpenseRow[]): Promise<Expense[]> {
    const refunds = await repo.refundsOf(
      exec,
      rows.map((r) => r.id),
    );
    return rows.map((row) => ({
      id: row.id,
      folio: row.folio,
      category: {
        id: row.categoryId,
        name: row.categoryName,
        isPlumberSalary: row.isPlumberSalary,
      },
      description: row.description,
      amount: row.amount,
      agreement:
        row.agreementId !== null && row.agreementFolio !== null
          ? { id: row.agreementId, folio: row.agreementFolio }
          : null,
      status: row.status,
      paidOn: row.paidOn,
      rejectedOn: row.rejectedOn,
      rejectionReason: row.rejectionReason,
      voucherReference: row.voucherReference,
      plumberPayment:
        row.plumberId !== null && row.periodStart !== null && row.frequency !== null
          ? {
              plumberId: row.plumberId,
              periodStart: row.periodStart,
              periodEnd: plumberPayPeriod(row.frequency, row.periodStart).end,
            }
          : null,
      refunds: refunds
        .filter((r) => r.expenseId === row.id)
        .map((r) => ({ approvalId: r.approvalId, status: r.result ?? 'pending', date: r.date })),
    }));
  }

  async function expenseOrThrow(exec: Executor, id: number): Promise<Expense> {
    const row = await repo.findExpense(exec, id);
    if (!row) throw committeeErrors.expenseNotFound();
    const [item] = await toExpenses(exec, [row]);
    if (!item) throw errors.internal();
    return item;
  }

  async function approvedAgreement(exec: Executor, id: number) {
    const found = await repo.findAgreement(exec, id);
    if (!found) throw committeeErrors.agreementNotFound();
    if (found.result !== 'approved_by_majority') throw committeeErrors.agreementNotApproved();
    return found;
  }

  async function plumberDetail(exec: Executor, id: number): Promise<PlumberDetail> {
    const found = await repo.findPlumber(exec, id);
    if (!found) throw committeeErrors.plumberNotFound();
    const [salaries, payments] = await Promise.all([
      repo.salariesOf(exec, [id]),
      repo.listExpenses(exec, { plumberId: id, limit: 1000 }),
    ]);
    const on = today();
    const current = salaries.find((s) => s.result === 'approved' && s.effectiveFrom <= on);
    return {
      ...found,
      currentSalary: current ? toSalary(current) : null,
      salaries: salaries.map(toSalary),
      payments: payments.map((p) => ({
        expenseId: p.id,
        folio: p.folio,
        periodStart: p.periodStart ?? '',
        periodEnd:
          p.frequency && p.periodStart ? plumberPayPeriod(p.frequency, p.periodStart).end : '',
        amount: p.amount,
        paidOn: p.paidOn,
        status: p.status,
      })),
    };
  }

  return {
    // --- Incomes --------------------------------------------------------------------------------

    async listIncomes(query: PaginationQuery) {
      return nextPage(await repo.listIncomes(db, query), query.limit);
    },

    /** Other income of the committee cashbox (RF-GAS-01). */
    async createIncome(
      actor: Actor,
      idempotency: IdempotencyContext,
      input: CreateIncomeRequest,
    ): Promise<IdempotentResult> {
      const on = input.date ?? today();
      if (on > today()) throw committeeErrors.futureDate('body.date');
      return idempotentTransaction(db, idempotency, async (tx) => {
        const row = await repo.insertIncome(tx, {
          concept: input.concept,
          amount: input.amount,
          date: on,
          voucherReference: input.voucherReference,
          createdBy: actor.userAccountId,
        });
        await writeAudit(tx, actor, {
          action: 'create',
          table: 'income',
          recordId: row.id,
          after: { concept: input.concept, amount: input.amount, date: on },
        });
        return {
          status: 201,
          body: {
            income: {
              id: row.id,
              folio: row.folio,
              concept: row.concept,
              amount: row.amount,
              date: row.date,
              voucherReference: row.voucherReference,
            },
          },
        };
      });
    },

    // --- Expenses -------------------------------------------------------------------------------

    async listCategories() {
      return { categories: await repo.listCategories(db) };
    },

    async listExpenses(query: ExpenseListQuery) {
      const page = nextPage(
        await repo.listExpenses(db, {
          status: query.status,
          cursor: query.cursor,
          limit: query.limit,
        }),
        query.limit,
      );
      return { data: await toExpenses(db, page.data), next: page.next };
    },

    async getExpense(id: number) {
      return { expense: await expenseOrThrow(db, id) };
    },

    /** Registers an expense pending payment, with its meeting agreement (D-17, RF-GAS-02). */
    async createExpense(
      actor: Actor,
      idempotency: IdempotencyContext,
      input: CreateExpenseRequest,
    ): Promise<IdempotentResult> {
      return idempotentTransaction(db, idempotency, async (tx) => {
        const categories = await repo.listCategories(tx);
        const category = categories.find((c) => c.id === input.categoryId);
        if (!category) {
          throw errors.validation({
            issues: [{ path: 'body.categoryId', message: 'No existe esa categoría.' }],
          });
        }
        if (category.isPlumberSalary) {
          throw errors.validation({
            issues: [
              {
                path: 'body.categoryId',
                message: 'El salario del fontanero se paga desde su ficha, por periodo.',
              },
            ],
          });
        }
        await approvedAgreement(tx, input.agreementId);
        const id = await repo.insertExpense(tx, {
          categoryId: input.categoryId,
          description: input.description,
          amount: input.amount,
          agreementId: input.agreementId,
          voucherReference: input.voucherReference,
          createdBy: actor.userAccountId,
        });
        await writeAudit(tx, actor, {
          action: 'create',
          table: 'expense',
          recordId: id,
          after: { ...input },
        });
        return { status: 201, body: { expense: await expenseOrThrow(tx, id) } };
      });
    },

    /**
     * Pays a pending expense from the committee cashbox (RF-GAS-03): never more than its
     * expected balance (D-21).
     */
    async payExpense(
      actor: Actor,
      idempotency: IdempotencyContext,
      id: number,
    ): Promise<IdempotentResult> {
      const on = today();
      return idempotentTransaction(db, idempotency, async (tx) => {
        if (!(await repo.lockExpense(tx, id))) throw committeeErrors.expenseNotFound();
        const row = await repo.findExpense(tx, id);
        if (!row) throw committeeErrors.expenseNotFound();
        if (row.status !== 'pending_payment') throw committeeErrors.expenseState(row.status, 'pay');
        const box = await lockCommitteeBalance(tx);
        if (row.amount > box.balance) {
          throw cashboxErrors.insufficientBalance(row.amount, box.balance, {});
        }
        await repo.markExpensePaid(tx, id, on);
        await writeAudit(tx, actor, {
          action: 'pay',
          table: 'expense',
          recordId: id,
          before: { paidOn: null },
          after: { paidOn: on, amount: row.amount, cashboxId: box.id },
        });
        return { status: 200, body: { expense: await expenseOrThrow(tx, id) } };
      });
    },

    async rejectExpense(actor: Actor, id: number, reason: string) {
      const on = today();
      return db.transaction(async (tx) => {
        if (!(await repo.lockExpense(tx, id))) throw committeeErrors.expenseNotFound();
        const row = await repo.findExpense(tx, id);
        if (!row) throw committeeErrors.expenseNotFound();
        if (row.status !== 'pending_payment') {
          throw committeeErrors.expenseState(row.status, 'reject');
        }
        await repo.markExpenseRejected(tx, id, on, reason);
        await writeAudit(tx, actor, {
          action: 'reject',
          table: 'expense',
          recordId: id,
          before: { rejectedOn: null },
          after: { rejectedOn: on },
          reason,
        });
        return { expense: await expenseOrThrow(tx, id) };
      });
    },

    /** Refund of a paid expense (RF-GAS-04): the president approves it. */
    async requestRefund(
      actor: Actor,
      idempotency: IdempotencyContext,
      id: number,
      reason: string,
    ): Promise<IdempotentResult> {
      const now = deps.now();
      const on = today();
      return idempotentTransaction(db, idempotency, async (tx) => {
        if (!(await repo.lockExpense(tx, id))) throw committeeErrors.expenseNotFound();
        const row = await repo.findExpense(tx, id);
        if (!row) throw committeeErrors.expenseNotFound();
        if (row.status !== 'paid') throw committeeErrors.expenseState(row.status, 'request_refund');
        const refunds = await repo.refundsOf(tx, [id]);
        if (refunds.some((r) => r.result === null)) {
          throw errors.invalidState(
            'El gasto ya tiene un reintegro pendiente de autorizar.',
            'refund_pending',
            'request_refund',
          );
        }
        const approvalId = await repo.insertApproval(tx, {
          type: 'expense_refund',
          reason,
          requestedBy: actor.userAccountId,
          requestedAt: now,
        });
        const refundId = await repo.insertRefund(tx, {
          expenseId: id,
          date: on,
          approvalId,
          createdBy: actor.userAccountId,
        });
        await writeAudit(tx, actor, {
          action: 'request_refund',
          table: 'expense_refund',
          recordId: refundId,
          after: { expenseId: id, date: on, approvalId },
          reason,
        });
        return { status: 201, body: { expense: await expenseOrThrow(tx, id) } };
      });
    },

    // --- Plumber --------------------------------------------------------------------------------

    async listPlumbers(): Promise<{ plumbers: Plumber[] }> {
      const rows = await repo.listPlumbers(db);
      const salaries = await repo.salariesOf(
        db,
        rows.map((r) => r.id),
      );
      const on = today();
      return {
        plumbers: rows.map((row) => {
          const current = salaries.find(
            (s) => s.plumberId === row.id && s.result === 'approved' && s.effectiveFrom <= on,
          );
          return { ...row, currentSalary: current ? toSalary(current) : null };
        }),
      };
    },

    async getPlumber(id: number) {
      return { plumber: await plumberDetail(db, id) };
    },

    async createPlumber(actor: Actor, input: CreatePlumberRequest) {
      return db.transaction(async (tx) => {
        const id = await repo.insertPlumber(tx, {
          name: input.name,
          phone: input.phone,
          createdBy: actor.userAccountId,
        });
        await writeAudit(tx, actor, {
          action: 'create',
          table: 'plumber',
          recordId: id,
          after: { name: input.name, phone: input.phone },
        });
        return { plumber: await plumberDetail(tx, id) };
      });
    },

    /** Phone and active flag; a phone change is audited by the database (migration 0015). */
    async updatePlumber(actor: Actor, id: number, input: UpdatePlumberRequest) {
      return db.transaction(async (tx) => {
        const current = await repo.lockPlumber(tx, id);
        if (!current) throw committeeErrors.plumberNotFound();
        await applyAuditContext(tx, actor, input.reason ?? undefined);
        const changes: { phone?: string | null; active?: boolean } = {};
        if (input.phone !== undefined && input.phone !== current.phone) changes.phone = input.phone;
        if (input.active !== undefined && input.active !== current.active) {
          changes.active = input.active;
        }
        if (Object.keys(changes).length > 0) {
          await repo.updatePlumber(tx, id, changes);
          if (changes.active !== undefined) {
            await writeAudit(tx, actor, {
              action: 'update',
              table: 'plumber',
              recordId: id,
              before: { active: current.active },
              after: { active: changes.active },
              reason: input.reason,
            });
          }
        }
        return { plumber: await plumberDetail(tx, id) };
      });
    },

    /** New salary with its agreement, pending the president's approval (D-24, RF-GAS-07). */
    async requestSalary(actor: Actor, plumberId: number, input: CreatePlumberSalaryRequest) {
      const now = deps.now();
      return db.transaction(async (tx) => {
        const found = await repo.lockPlumber(tx, plumberId);
        if (!found) throw committeeErrors.plumberNotFound();
        const agreement = await approvedAgreement(tx, input.agreementId);
        const open = await repo.openSalaries(tx, plumberId);
        if (open.some((s) => s.result === null)) {
          throw errors.invalidState(
            'El fontanero ya tiene un salario pendiente de autorizar.',
            'salary_pending',
            'request_salary',
          );
        }
        if (open.some((s) => s.effectiveFrom === input.effectiveFrom)) {
          throw errors.invalidState(
            'Ya hay un salario autorizado desde esa fecha.',
            'salary_exists',
            'request_salary',
          );
        }
        const reason =
          input.reason ??
          `Salario ${FREQUENCY_LABELS[input.frequency]} de ${formatMoney(input.amount)} desde ${input.effectiveFrom} (acuerdo ${agreement.folio}).`;
        const approvalId = await repo.insertApproval(tx, {
          type: 'plumber_salary',
          reason,
          requestedBy: actor.userAccountId,
          requestedAt: now,
        });
        const id = await repo.insertSalary(tx, {
          plumberId,
          amount: input.amount,
          frequency: input.frequency,
          effectiveFrom: input.effectiveFrom,
          agreementId: input.agreementId,
          approvalId,
          createdBy: actor.userAccountId,
        });
        await writeAudit(tx, actor, {
          action: 'request_salary',
          table: 'plumber_salary',
          recordId: id,
          after: { plumberId, ...input, approvalId },
          reason,
        });
        const row = await repo.findSalary(tx, id);
        if (!row) throw errors.internal();
        return { salary: toSalary(row) };
      });
    },

    /**
     * Pays the plumber the period that contains `date` (RF-GAS-08, D-24): the period follows
     * the frequency of the salary in force, the amount is that salary, it is an expense of the
     * plumber salary category paid from the committee cashbox (D-21) and a period is paid once.
     */
    async payPlumber(
      actor: Actor,
      idempotency: IdempotencyContext,
      plumberId: number,
      date: string | undefined,
    ): Promise<IdempotentResult> {
      const on = today();
      const day = date ?? on;
      if (day > on) throw committeeErrors.futureDate('body.date');
      try {
        return await idempotentTransaction(db, idempotency, async (tx) => {
          const found = await repo.lockPlumber(tx, plumberId);
          if (!found) throw committeeErrors.plumberNotFound();
          if (!found.active) {
            throw errors.invalidState('El fontanero no está activo.', 'inactive', 'pay_plumber');
          }
          const atDay = await repo.salaryInForce(tx, plumberId, day);
          const period = atDay ? plumberPayPeriod(atDay.frequency, day) : null;
          const salary = period ? await repo.salaryInForce(tx, plumberId, period.start) : null;
          if (!period || !salary) {
            throw errors.invalidState(
              'El fontanero no tiene un salario autorizado vigente para ese periodo.',
              'no_salary',
              'pay_plumber',
            );
          }
          if (await repo.periodPaid(tx, plumberId, period.start)) {
            throw committeeErrors.periodAlreadyPaid(period.start, period.end);
          }
          const category = await repo.plumberSalaryCategory(tx);
          if (category === null) throw errors.internal(); // created by the bootstrap (D-27)
          const box = await lockCommitteeBalance(tx);
          if (salary.amount > box.balance) {
            throw cashboxErrors.insufficientBalance(salary.amount, box.balance, {});
          }
          // Amount and agreement come from the salary (v_expense); paid at once (D-24).
          const expenseId = await repo.insertExpense(tx, {
            categoryId: category,
            description: `Salario de ${found.name}, del ${period.start} al ${period.end}`,
            paidOn: on,
            createdBy: actor.userAccountId,
          });
          await repo.insertPlumberPayment(tx, {
            expenseId,
            plumberSalaryId: salary.id,
            plumberId,
            periodStart: period.start,
            createdBy: actor.userAccountId,
          });
          await writeAudit(tx, actor, {
            action: 'pay_plumber',
            table: 'expense',
            recordId: expenseId,
            after: {
              plumberId,
              plumberSalaryId: salary.id,
              periodStart: period.start,
              periodEnd: period.end,
              amount: salary.amount,
              paidOn: on,
            },
          });
          return { status: 201, body: { expense: await expenseOrThrow(tx, expenseId) } };
        });
      } catch (error) {
        if (isUniqueViolation(error, 'plumber_payment_plumber_period_unique')) {
          throw errors.invalidState('Ese periodo ya está pagado.', 'paid', 'pay_plumber');
        }
        throw error;
      }
    },
  };
}

export type CommitteeService = ReturnType<typeof createCommitteeService>;

/** expense_refund: once approved the expense is refunded and its amount returns (D-21). */
export const expenseRefundHandler: ApprovalHandler = {
  async onApproved() {},
  async onRejected() {},
  async describe(db, approvalIds) {
    const rows = await repo.refundsByApproval(db, approvalIds);
    return new Map(
      rows.map((r) => [r.approvalId, `Reintegro del gasto ${r.folio} (${formatMoney(r.amount)})`]),
    );
  },
};

/**
 * plumber_salary: approving makes it the salary from its effective date (D-24). A second
 * approved salary with the same date is refused.
 */
export const plumberSalaryHandler: ApprovalHandler = {
  async onApproved({ tx, approvalId }) {
    const [salary] = await repo.salariesByApproval(tx, [approvalId]);
    if (!salary) return;
    await repo.lockPlumber(tx, salary.plumberId);
    const open = await repo.openSalaries(tx, salary.plumberId);
    if (
      open.some(
        (s) =>
          s.id !== salary.id && s.result === 'approved' && s.effectiveFrom === salary.effectiveFrom,
      )
    ) {
      throw errors.invalidState(
        'Ya hay un salario autorizado desde esa fecha.',
        'salary_exists',
        'approve_salary',
      );
    }
  },
  async onRejected() {},
  async describe(db, approvalIds) {
    const rows = await repo.salariesByApproval(db, approvalIds);
    return new Map(
      rows.map((r) => [
        r.approvalId,
        `Salario ${FREQUENCY_LABELS[r.frequency] ?? r.frequency} de ${formatMoney(r.amount)} para ${r.plumberName} desde ${r.effectiveFrom}`,
      ]),
    );
  },
};
