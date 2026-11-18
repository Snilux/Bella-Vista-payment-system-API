import {
  type CreateExpenseRequest,
  type CreateIncomeRequest,
  type CreatePlumberRequest,
  type CreatePlumberSalaryRequest,
  type Expense,
  type ExpenseListQuery,
  expenseCategoryListResponseSchema,
  expensePageSchema,
  expenseResponseSchema,
  incomeResponseSchema,
  plumberListResponseSchema,
  plumberResponseSchema,
  plumberSalaryResponseSchema,
} from '@bella-vista/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { FetchPage } from '../ui/PaginatedList.js';
import { requireApiClient } from './api.js';
import { queryKeys } from './keys.js';
import { COUNT_LIMIT } from './useOrganization.js';

// Caja del comité: ingresos, gastos y fontanero (docs/api.md "Comité"; T-04 to T-09; D-17, D-21,
// D-24). Registering an income, an expense, paying one and paying the plumber move money: their
// screens send them through useMoneyOperation with its Idempotency-Key (the functions below).
// Rejecting an expense and a salary change move none: plain mutations.

const withKey = (idempotencyKey: string | undefined) => (idempotencyKey ? { idempotencyKey } : {});

export const createIncome = (body: CreateIncomeRequest, idempotencyKey: string | undefined) =>
  requireApiClient().request({
    method: 'POST',
    path: '/incomes',
    body,
    schema: incomeResponseSchema,
    ...withKey(idempotencyKey),
  });

export function useExpenseCategories() {
  return useQuery({
    queryKey: queryKeys.expenseCategories,
    queryFn: ({ signal }) =>
      requireApiClient().request({
        method: 'GET',
        path: '/expense-categories',
        schema: expenseCategoryListResponseSchema,
        signal,
      }),
    select: (data) => data.categories,
  });
}

/** T-01 and T-04: the expenses of a status (the first 100 are enough to count and list). */
export function useExpenses(status: ExpenseListQuery['status']) {
  return useQuery({
    queryKey: [...queryKeys.expenses, 'list', status ?? 'all'],
    queryFn: ({ signal }) =>
      requireApiClient().request({
        method: 'GET',
        path: '/expenses',
        query: { status, limit: COUNT_LIMIT },
        schema: expensePageSchema,
        signal,
      }),
    select: (page) => ({ expenses: page.data, more: page.next !== null }),
  });
}

export const expensePages = (
  status?: ExpenseListQuery['status'],
): { queryKey: readonly unknown[]; fetchPage: FetchPage<Expense> } => ({
  queryKey: [...queryKeys.expenses, 'pages', status ?? 'all'],
  fetchPage: ({ limit, cursor, signal }) =>
    requireApiClient().request({
      method: 'GET',
      path: '/expenses',
      query: { status, limit, cursor },
      schema: expensePageSchema,
      signal,
    }),
});

/** T-07 and R-03. */
export function useExpense(id: number) {
  return useQuery({
    queryKey: queryKeys.expense(id),
    queryFn: ({ signal }) =>
      requireApiClient().request({
        method: 'GET',
        path: `/expenses/${id}`,
        schema: expenseResponseSchema,
        signal,
      }),
    select: (data) => data.expense,
    enabled: Number.isInteger(id) && id > 0,
  });
}

/** T-06: registered pending payment ("Guardar como pendiente", the first step of "Guardar y pagar"). */
export const createExpense = (body: CreateExpenseRequest, idempotencyKey: string | undefined) =>
  requireApiClient().request({
    method: 'POST',
    path: '/expenses',
    body,
    schema: expenseResponseSchema,
    ...withKey(idempotencyKey),
  });

/** T-06 and T-07: pays it from the committee cashbox (INSUFFICIENT_BALANCE without cash). */
export const payExpense = (id: number, idempotencyKey: string | undefined) =>
  requireApiClient().request({
    method: 'POST',
    path: `/expenses/${id}/pay`,
    schema: expenseResponseSchema,
    ...withKey(idempotencyKey),
  });

export function useRejectExpense(id: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (reason: string) =>
      requireApiClient().request({
        method: 'POST',
        path: `/expenses/${id}/reject`,
        body: { reason },
        schema: expenseResponseSchema,
      }),
    onSuccess: ({ expense }) => {
      queryClient.setQueryData(queryKeys.expense(id), { expense });
      void queryClient.invalidateQueries({ queryKey: queryKeys.expenses });
    },
  });
}

// --- Plumber --------------------------------------------------------------------------------

export function usePlumbers() {
  return useQuery({
    queryKey: queryKeys.plumbers,
    queryFn: ({ signal }) =>
      requireApiClient().request({
        method: 'GET',
        path: '/plumbers',
        schema: plumberListResponseSchema,
        signal,
      }),
    select: (data) => data.plumbers,
  });
}

/** T-08 and T-09: the plumber with the salary history and the payments. */
export function usePlumber(id: number | null) {
  return useQuery({
    queryKey: queryKeys.plumber(id ?? 0),
    queryFn: ({ signal }) =>
      requireApiClient().request({
        method: 'GET',
        path: `/plumbers/${id}`,
        schema: plumberResponseSchema,
        signal,
      }),
    select: (data) => data.plumber,
    enabled: id !== null && id > 0,
  });
}

export function useCreatePlumber() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreatePlumberRequest) =>
      requireApiClient().request({
        method: 'POST',
        path: '/plumbers',
        body,
        schema: plumberResponseSchema,
      }),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: queryKeys.plumbers }),
  });
}

/** T-08 "Cambiar salario": it stays pending until the president authorizes it. */
export function useCreateSalary(plumberId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreatePlumberSalaryRequest) =>
      requireApiClient().request({
        method: 'POST',
        path: `/plumbers/${plumberId}/salaries`,
        body,
        schema: plumberSalaryResponseSchema,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.plumbers });
      void queryClient.invalidateQueries({ queryKey: queryKeys.approvals });
    },
  });
}

/** T-09: pays the period that contains `date` (the salary is the amount; once per period). */
export const payPlumber = (
  vars: { plumberId: number; date: string },
  idempotencyKey: string | undefined,
) =>
  requireApiClient().request({
    method: 'POST',
    path: `/plumbers/${vars.plumberId}/payments`,
    body: { date: vars.date },
    schema: expenseResponseSchema,
    ...withKey(idempotencyKey),
  });
