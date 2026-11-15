import { bigint, boolean, date, integer, pgView, text } from 'drizzle-orm/pg-core';
import { timestamptz } from './columns.js';
import { approvalType, closingType } from './enums.js';

// Typed definitions of the views created by hand in migration 0013 (2.2 §5). `.existing()`
// tells drizzle-kit not to generate them; keep the columns in sync with the SQL.
// Status values: docs/glosario.md, "Estados calculados en vistas".

const idColumn = () => bigint({ mode: 'number' });
const amount = () => bigint({ mode: 'number' });
const day = () => date({ mode: 'string' });

export const vBlock = pgView('v_block', {
  id: idColumn().notNull(),
  sectionId: idColumn().notNull(),
  code: text().notNull(),
  name: text(),
  active: boolean().notNull(),
  leaderPersonId: idColumn(),
  leaderName: text(),
  leaderContactPhone: text(),
}).existing();

export const vConnection = pgView('v_connection', {
  id: idColumn().notNull(),
  folio: text().notNull(),
  address: text().notNull(),
  activatedOn: day().notNull(),
  deactivatedOn: day(),
  blockId: idColumn(),
  status: text({ enum: ['active', 'suspended', 'deactivated'] }).notNull(),
  unitCount: integer().notNull(),
}).existing();

export const vPaymentAmount = pgView('v_payment_amount', {
  id: idColumn().notNull(),
  folio: text().notNull(),
  unitId: idColumn(),
  cashboxId: idColumn().notNull(),
  occurredAt: timestamptz().notNull(),
  occurredOn: day().notNull(),
  monthsAmount: amount().notNull(),
  chargesAmount: amount().notNull(),
  total: amount().notNull(),
  blockId: idColumn(),
  holderPersonId: idColumn(),
  receiverPersonId: idColumn(),
  isSupport: boolean().notNull(),
  cancelled: boolean().notNull(),
  cancelledAt: timestamptz(),
}).existing();

export const vConnectionRequest = pgView('v_connection_request', {
  id: idColumn().notNull(),
  folio: text().notNull(),
  applicantId: idColumn().notNull(),
  address: text().notNull(),
  blockId: idColumn().notNull(),
  requestedOn: day().notNull(),
  agreementId: idColumn(),
  cancelledOn: day(),
  connectionId: idColumn(),
  openingChargeId: idColumn(),
  status: text({
    enum: [
      'requested',
      'approved_pending_payment',
      'pending_installation',
      'rejected',
      'cancelled',
      'installed',
    ],
  }).notNull(),
}).existing();

export const vUnit = pgView('v_unit', {
  id: idColumn().notNull(),
  folio: text().notNull(),
  connectionId: idColumn().notNull(),
  reference: text(),
  registeredOn: day().notNull(),
  activatedOn: day(),
  billingStartPeriod: day(),
  deactivatedOn: day(),
  holderPersonId: idColumn(),
  status: text({ enum: ['pending_activation', 'active', 'suspended', 'deactivated'] }).notNull(),
}).existing();

export const vExpense = pgView('v_expense', {
  id: idColumn().notNull(),
  folio: text().notNull(),
  categoryId: idColumn().notNull(),
  description: text().notNull(),
  paidOn: day(),
  rejectedOn: day(),
  effectiveAmount: amount(),
  effectiveAgreementId: idColumn(),
  plumberId: idColumn(),
  status: text({ enum: ['pending_payment', 'paid', 'rejected', 'refunded'] }).notNull(),
}).existing();

export const cashboxMovementKinds = [
  'opening_balance',
  'payment',
  'payment_cancellation',
  'handover_out',
  'handover_in',
  'income',
  'expense',
  'expense_refund',
  'adjustment',
] as const;

export const vCashboxMovement = pgView('v_cashbox_movement', {
  cashboxId: idColumn().notNull(),
  occurredOn: day().notNull(),
  kind: text({ enum: cashboxMovementKinds }).notNull(),
  amount: amount().notNull(),
  tableName: text().notNull(),
  recordId: idColumn().notNull(),
}).existing();

export const vCashboxBalance = pgView('v_cashbox_balance', {
  cashboxId: idColumn().notNull(),
  balance: amount().notNull(),
}).existing();

export const vHandover = pgView('v_handover', {
  id: idColumn().notNull(),
  folio: text().notNull(),
  sourceCashboxId: idColumn().notNull(),
  date: day().notNull(),
  declaredAmount: amount().notNull(),
  receivedAmount: amount(),
  withdrawnAt: timestamptz(),
  confirmedAt: timestamptz(),
  difference: amount(),
  adjustedAmount: amount(),
  status: text({
    enum: ['pending', 'withdrawn', 'confirmed', 'with_difference', 'adjusted'],
  }).notNull(),
}).existing();

export const vClosing = pgView('v_closing', {
  id: idColumn().notNull(),
  folio: text().notNull(),
  cashboxId: idColumn().notNull(),
  type: closingType().notNull(),
  dateFrom: day().notNull(),
  dateTo: day().notNull(),
  countedCash: amount(),
  reviewedAt: timestamptz(),
  closedAt: timestamptz(),
  startingBalance: amount().notNull(),
  totalOpeningBalances: amount().notNull(),
  totalPayments: amount().notNull(),
  totalCancellations: amount().notNull(),
  totalHandoversOut: amount().notNull(),
  totalHandoversIn: amount().notNull(),
  totalIncomes: amount().notNull(),
  totalExpenses: amount().notNull(),
  totalRefunds: amount().notNull(),
  totalAdjustments: amount().notNull(),
  expectedBalance: amount().notNull(),
  difference: amount(),
  status: text({ enum: ['draft', 'counted', 'reviewed', 'closed'] }).notNull(),
}).existing();

export const vPendingApproval = pgView('v_pending_approval', {
  id: idColumn().notNull(),
  type: approvalType().notNull(),
  reason: text().notNull(),
  requestedBy: idColumn().notNull(),
  requestedAt: timestamptz().notNull(),
  tableName: text(),
  recordId: idColumn(),
}).existing();
