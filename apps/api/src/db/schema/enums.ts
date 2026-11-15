import { pgEnum } from 'drizzle-orm/pg-core';

// Values translated per docs/glosario.md ("Valores de enum").

export const role = pgEnum('role', [
  'superadmin',
  'president',
  'treasurer',
  'secretary',
  'member',
  'block_leader',
]);

export const agreementResult = pgEnum('agreement_result', ['approved_by_majority', 'rejected']);

export const approvalType = pgEnum('approval_type', [
  'role_assignment',
  'rate',
  'plumber_salary',
  'opening_balance',
  'unit_deactivation',
  'holder_change',
  'payment_cancellation',
  'adjustment',
  'expense_refund',
]);

export const approvalResult = pgEnum('approval_result', ['approved', 'rejected']);

export const unitChangeType = pgEnum('unit_change_type', ['deactivation', 'holder_change']);

export const feeType = pgEnum('fee_type', ['opening', 'reconnection', 'repair', 'other']);

export const cashboxType = pgEnum('cashbox_type', ['block', 'committee', 'support']);

export const receiptType = pgEnum('receipt_type', ['original', 'replacement']);

export const salaryFrequency = pgEnum('salary_frequency', ['weekly', 'biweekly', 'monthly']);
