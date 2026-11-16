import { z } from 'zod';
import { optionalText, page, paginationQuerySchema, requiredText } from './common.js';

// Committee cashbox: incomes, expenses, refunds and the plumber (/v1/incomes, /v1/expenses,
// /v1/expense-categories, /v1/plumbers; CU-19 to CU-21, RF-GAS; D-17, D-21, D-24). Amounts in
// integer cents.

const amountSchema = z
  .int({ error: 'El importe debe ser un número entero de centavos.' })
  .positive({ error: 'El importe debe ser mayor que cero.' })
  .max(100_000_000, { error: 'El importe es demasiado grande.' });

const APPROVAL_STATUS = z.enum(['pending', 'approved', 'rejected']);
const agreementRef = z.object({ id: z.int(), folio: z.string() });

// --- Incomes --------------------------------------------------------------------------------

export const incomeSchema = z.object({
  id: z.int(),
  folio: z.string(),
  concept: z.string(),
  amount: z.int(),
  date: z.iso.date(),
  voucherReference: z.string().nullable(),
});

export const createIncomeRequestSchema = z.object({
  concept: requiredText(200, 'Escribe el concepto del ingreso.'),
  amount: amountSchema,
  /** Today when omitted; never a future date. */
  date: z.iso.date({ error: 'La fecha debe tener el formato AAAA-MM-DD.' }).optional(),
  voucherReference: optionalText(100),
});

export const incomePageSchema = page(incomeSchema);
export const incomeResponseSchema = z.object({ income: incomeSchema });

// --- Expenses -------------------------------------------------------------------------------

export const expenseCategorySchema = z.object({
  id: z.int(),
  name: z.string(),
  isPlumberSalary: z.boolean(),
});

export const expenseCategoryListResponseSchema = z.object({
  categories: z.array(expenseCategorySchema),
});

export const EXPENSE_STATUSES = ['pending_payment', 'paid', 'rejected', 'refunded'] as const;

export const expenseSchema = z.object({
  id: z.int(),
  folio: z.string(),
  category: expenseCategorySchema,
  description: z.string(),
  /** The plumber's salary for a plumber payment (D-24). */
  amount: z.int(),
  agreement: agreementRef.nullable(),
  status: z.enum(EXPENSE_STATUSES),
  paidOn: z.iso.date().nullable(),
  rejectedOn: z.iso.date().nullable(),
  rejectionReason: z.string().nullable(),
  voucherReference: z.string().nullable(),
  plumberPayment: z
    .object({ plumberId: z.int(), periodStart: z.iso.date(), periodEnd: z.iso.date() })
    .nullable(),
  /** Refund requests, newest first. */
  refunds: z.array(z.object({ approvalId: z.int(), status: APPROVAL_STATUS, date: z.iso.date() })),
});

export const expenseListQuerySchema = paginationQuerySchema.extend({
  status: z.enum(EXPENSE_STATUSES).optional(),
});

export const expensePageSchema = page(expenseSchema);
export const expenseResponseSchema = z.object({ expense: expenseSchema });

export const createExpenseRequestSchema = z.object({
  categoryId: z.int({ error: 'Elige la categoría.' }).positive(),
  description: requiredText(300, 'Escribe la descripción del gasto.'),
  amount: amountSchema,
  /** Every expense needs a meeting agreement (D-17). */
  agreementId: z.int({ error: 'Indica el acuerdo de junta.' }).positive(),
  voucherReference: optionalText(100),
});

export const rejectExpenseRequestSchema = z.object({
  reason: requiredText(500, 'Escribe el motivo del rechazo.'),
});

export const refundExpenseRequestSchema = z.object({
  reason: requiredText(500, 'Escribe el motivo del reintegro.'),
});

// --- Plumber --------------------------------------------------------------------------------

export const SALARY_FREQUENCIES = ['weekly', 'biweekly', 'monthly'] as const;

export const plumberSalarySchema = z.object({
  id: z.int(),
  amount: z.int(),
  frequency: z.enum(SALARY_FREQUENCIES),
  effectiveFrom: z.iso.date(),
  agreement: agreementRef,
  status: APPROVAL_STATUS,
  approvalId: z.int(),
});

export const plumberPaymentSchema = z.object({
  expenseId: z.int(),
  folio: z.string(),
  periodStart: z.iso.date(),
  periodEnd: z.iso.date(),
  amount: z.int(),
  paidOn: z.iso.date().nullable(),
  status: z.enum(EXPENSE_STATUSES),
});

export const plumberSchema = z.object({
  id: z.int(),
  name: z.string(),
  phone: z.string().nullable(),
  active: z.boolean(),
  /** Approved salary in force today. */
  currentSalary: plumberSalarySchema.nullable(),
});

export const plumberDetailSchema = plumberSchema.extend({
  salaries: z.array(plumberSalarySchema),
  payments: z.array(plumberPaymentSchema),
});

export const plumberListResponseSchema = z.object({ plumbers: z.array(plumberSchema) });
export const plumberResponseSchema = z.object({ plumber: plumberDetailSchema });

export const createPlumberRequestSchema = z.object({
  name: requiredText(150, 'Escribe el nombre del fontanero.'),
  phone: optionalText(20),
});

export const updatePlumberRequestSchema = z
  .object({
    phone: optionalText(20),
    active: z.boolean().optional(),
    /** Why the contact data changed (kept in the audit log). */
    reason: optionalText(200),
  })
  .refine((body) => body.phone !== undefined || body.active !== undefined, {
    error: 'Indica el teléfono o si está activo.',
  });

export const createPlumberSalaryRequestSchema = z.object({
  amount: amountSchema,
  frequency: z.enum(SALARY_FREQUENCIES, { error: 'Indica la periodicidad.' }),
  effectiveFrom: z.iso.date({ error: 'La fecha debe tener el formato AAAA-MM-DD.' }),
  agreementId: z.int({ error: 'Indica el acuerdo de junta.' }).positive(),
  reason: optionalText(500),
});

export const plumberSalaryResponseSchema = z.object({ salary: plumberSalarySchema });

export const payPlumberRequestSchema = z.object({
  /** A day of the period to pay; today when omitted. */
  date: z.iso.date({ error: 'La fecha debe tener el formato AAAA-MM-DD.' }).optional(),
});

export type Income = z.infer<typeof incomeSchema>;
export type CreateIncomeRequest = z.infer<typeof createIncomeRequestSchema>;
export type Expense = z.infer<typeof expenseSchema>;
export type ExpenseListQuery = z.infer<typeof expenseListQuerySchema>;
export type CreateExpenseRequest = z.infer<typeof createExpenseRequestSchema>;
export type PlumberSalary = z.infer<typeof plumberSalarySchema>;
export type Plumber = z.infer<typeof plumberSchema>;
export type PlumberDetail = z.infer<typeof plumberDetailSchema>;
export type CreatePlumberRequest = z.infer<typeof createPlumberRequestSchema>;
export type UpdatePlumberRequest = z.infer<typeof updatePlumberRequestSchema>;
export type CreatePlumberSalaryRequest = z.infer<typeof createPlumberSalaryRequestSchema>;
