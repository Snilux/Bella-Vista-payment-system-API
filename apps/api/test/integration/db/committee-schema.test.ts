import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { Transaction } from '../../../src/db/client.js';
import {
  agreement,
  approval,
  cashbox,
  expense,
  expenseCategory,
  expenseRefund,
  handover,
  income,
  plumber,
  plumberPayment,
  plumberSalary,
} from '../../../src/db/schema/index.js';
import { bootstrap, folioPattern, one, testDatabaseUrl, useTestDb } from './helpers.js';

// Verifies the constraints of the "handovers and committee" block (3.1, block 5).

/**
 * Block 1-4 data (an approved agreement, a block cashbox for M01, the committee cashbox)
 * plus expense categories, a plumber with a salary, and factories for handovers, expenses,
 * salaries and plumber payments.
 */
async function fixture(tx: Transaction) {
  const base = await bootstrap(tx);
  const { sa, m01 } = base;
  const approvedAgreement = one(
    await tx
      .insert(agreement)
      .values({
        meetingDate: '2026-01-10',
        topic: 'Gastos y salario del fontanero',
        result: 'approved_by_majority',
        createdBy: sa.id,
      })
      .returning(),
  );
  const blockBox = one(
    await tx
      .insert(cashbox)
      .values({ type: 'block', blockId: m01.id, createdBy: sa.id })
      .returning(),
  );
  const committeeBox = one(
    await tx.insert(cashbox).values({ type: 'committee', createdBy: sa.id }).returning(),
  );
  const repairs = one(
    await tx.insert(expenseCategory).values({ name: 'Reparaciones', createdBy: sa.id }).returning(),
  );
  const salaryCategory = one(
    await tx
      .insert(expenseCategory)
      .values({ name: 'Salario del fontanero', isPlumberSalary: true, createdBy: sa.id })
      .returning(),
  );

  const newPlumber = async (name = 'Fontanero Uno') =>
    one(await tx.insert(plumber).values({ name, createdBy: sa.id }).returning());
  const newSalary = async (plumberId: number, amount = 150_000) => {
    const { id: approvalId } = await base.newApproval('plumber_salary');
    return one(
      await tx
        .insert(plumberSalary)
        .values({
          plumberId,
          amount,
          frequency: 'biweekly',
          effectiveFrom: '2026-01-01',
          agreementId: approvedAgreement.id,
          approvalId,
          createdBy: sa.id,
        })
        .returning(),
    );
  };
  const plumber1 = await newPlumber();
  const salary1 = await newSalary(plumber1.id);

  const handoverValues = (values: Partial<typeof handover.$inferInsert> = {}) => ({
    sourceCashboxId: blockBox.id,
    declaredAmount: 100_000,
    date: '2026-03-31',
    createdBy: sa.id,
    ...values,
  });
  const expenseValues = (values: Partial<typeof expense.$inferInsert> = {}) => ({
    categoryId: repairs.id,
    description: 'Cambio de válvula',
    amount: 45_000,
    agreementId: approvedAgreement.id,
    createdBy: sa.id,
    ...values,
  });
  const newExpense = async (values: Partial<typeof expense.$inferInsert> = {}) =>
    one(await tx.insert(expense).values(expenseValues(values)).returning());
  /** A plumber expense (no amount or agreement of its own) for `periodStart`. */
  const plumberExpense = () =>
    newExpense({
      categoryId: salaryCategory.id,
      description: 'Pago quincenal del fontanero',
      amount: null,
      agreementId: null,
    });
  const payPlumber = (
    expenseId: number,
    periodStart: string,
    plumberId = plumber1.id,
    plumberSalaryId = salary1.id,
  ) =>
    tx
      .insert(plumberPayment)
      .values({ expenseId, plumberSalaryId, plumberId, periodStart, createdBy: sa.id });

  return {
    ...base,
    approvedAgreement,
    blockBox,
    committeeBox,
    repairs,
    salaryCategory,
    plumber1,
    salary1,
    newPlumber,
    newSalary,
    handoverValues,
    expenseValues,
    newExpense,
    plumberExpense,
    payPlumber,
  };
}

const confirmedAt = new Date('2026-04-01T16:00:00Z');
const withdrawnAt = new Date('2026-03-31T20:00:00Z');

describe.skipIf(!testDatabaseUrl)('handovers and committee schema', () => {
  const { rollback, expectViolation } = useTestDb();

  describe('3.1 minimum tests', () => {
    it('rejects a handover withdrawn and confirmed at the same time', () =>
      rollback(async (tx) => {
        const { sa, handoverValues } = await fixture(tx);
        await expectViolation(tx, 'handover_not_withdrawn_and_confirmed', (sp) =>
          sp.insert(handover).values(
            handoverValues({
              withdrawnAt,
              receivedAmount: 100_000,
              confirmedAt,
              confirmedBy: sa.id,
            }),
          ),
        );
      }));

    it('rejects a second plumber salary category', () =>
      rollback(async (tx) => {
        const { sa } = await fixture(tx);
        await expectViolation(tx, 'expense_category_plumber_salary_uq', (sp) =>
          sp
            .insert(expenseCategory)
            .values({ name: 'Sueldo fontanero', isPlumberSalary: true, createdBy: sa.id }),
        );
      }));

    it('rejects paying the same plumber period twice', () =>
      rollback(async (tx) => {
        const { plumberExpense, payPlumber } = await fixture(tx);
        await payPlumber((await plumberExpense()).id, '2026-03-01');
        const second = await plumberExpense();
        await expectViolation(tx, 'plumber_payment_plumber_period_unique', () =>
          payPlumber(second.id, '2026-03-01'),
        );
      }));
  });

  describe('handover', () => {
    it('generates an EN- folio and accepts pending, withdrawn and confirmed handovers', () =>
      rollback(async (tx) => {
        const { sa, handoverValues } = await fixture(tx);
        const rows = await tx
          .insert(handover)
          .values([
            handoverValues(),
            handoverValues({ withdrawnAt }),
            // Received less than declared: the shortfall stays in the block cashbox (D-16).
            handoverValues({ receivedAmount: 90_000, confirmedAt, confirmedBy: sa.id }),
            handoverValues({ receivedAmount: 0, confirmedAt, confirmedBy: sa.id }),
          ])
          .returning();
        expect(rows).toHaveLength(4);
        for (const row of rows) expect(row.folio).toMatch(folioPattern('EN'));
      }));

    it('rejects partial confirmation data', () =>
      rollback(async (tx) => {
        const { sa, handoverValues } = await fixture(tx);
        const partial = [
          { receivedAmount: 100_000 },
          { confirmedAt },
          { confirmedBy: sa.id },
          { receivedAmount: 100_000, confirmedAt },
          { receivedAmount: 100_000, confirmedBy: sa.id },
          { confirmedAt, confirmedBy: sa.id },
        ];
        for (const values of partial) {
          await expectViolation(tx, 'handover_confirmation_complete', (sp) =>
            sp.insert(handover).values(handoverValues(values)),
          );
        }
      }));

    it('rejects a declared amount of 0 and a negative received amount', () =>
      rollback(async (tx) => {
        const { sa, handoverValues } = await fixture(tx);
        await expectViolation(tx, 'handover_declared_amount_positive', (sp) =>
          sp.insert(handover).values(handoverValues({ declaredAmount: 0 })),
        );
        await expectViolation(tx, 'handover_received_amount_not_negative', (sp) =>
          sp
            .insert(handover)
            .values(handoverValues({ receivedAmount: -1, confirmedAt, confirmedBy: sa.id })),
        );
      }));
  });

  describe('income and expense_category', () => {
    it('generates an IN- folio and rejects an amount of 0', () =>
      rollback(async (tx) => {
        const { sa } = await fixture(tx);
        const values = { concept: 'Donativo', amount: 20_000, date: '2026-03-10' };
        const row = one(
          await tx
            .insert(income)
            .values({ ...values, createdBy: sa.id })
            .returning(),
        );
        expect(row.folio).toMatch(folioPattern('IN'));
        await expectViolation(tx, 'income_amount_positive', (sp) =>
          sp.insert(income).values({ ...values, amount: 0, createdBy: sa.id }),
        );
      }));

    it('rejects a repeated category name and allows many non-salary categories', () =>
      rollback(async (tx) => {
        const { sa } = await fixture(tx);
        await tx.insert(expenseCategory).values([
          { name: 'Electricidad', createdBy: sa.id },
          { name: 'Materiales', isPlumberSalary: false, createdBy: sa.id },
        ]);
        await expectViolation(tx, 'expense_category_name_unique', (sp) =>
          sp.insert(expenseCategory).values({ name: 'Reparaciones', createdBy: sa.id }),
        );
      }));
  });

  describe('expense and expense_refund', () => {
    it('generates a GA- folio and accepts paid and rejected expenses', () =>
      rollback(async (tx) => {
        const { newExpense } = await fixture(tx);
        const paid = await newExpense({ paidOn: '2026-03-15' });
        const rejected = await newExpense({
          rejectedOn: '2026-03-15',
          rejectionReason: 'Sin presupuesto',
        });
        expect(paid.folio).toMatch(folioPattern('GA'));
        expect(rejected.folio).toMatch(folioPattern('GA'));
      }));

    it('rejects an expense paid and rejected at the same time', () =>
      rollback(async (tx) => {
        const { expenseValues } = await fixture(tx);
        await expectViolation(tx, 'expense_not_paid_and_rejected', (sp) =>
          sp.insert(expense).values(
            expenseValues({
              paidOn: '2026-03-15',
              rejectedOn: '2026-03-15',
              rejectionReason: 'Duplicado',
            }),
          ),
        );
      }));

    it('requires a reason exactly when the expense is rejected', () =>
      rollback(async (tx) => {
        const { expenseValues } = await fixture(tx);
        await expectViolation(tx, 'expense_rejection_reason', (sp) =>
          sp.insert(expense).values(expenseValues({ rejectedOn: '2026-03-15' })),
        );
        await expectViolation(tx, 'expense_rejection_reason', (sp) =>
          sp.insert(expense).values(expenseValues({ rejectionReason: 'Sin presupuesto' })),
        );
        await expectViolation(tx, 'expense_rejection_reason_not_blank', (sp) =>
          sp
            .insert(expense)
            .values(expenseValues({ rejectedOn: '2026-03-15', rejectionReason: '  ' })),
        );
      }));

    it('rejects an amount of 0', () =>
      rollback(async (tx) => {
        const { expenseValues } = await fixture(tx);
        await expectViolation(tx, 'expense_amount_positive', (sp) =>
          sp.insert(expense).values(expenseValues({ amount: 0 })),
        );
      }));

    it('rejects a second open refund of the same expense; a rejected one frees it', () =>
      rollback(async (tx) => {
        const { sa, newExpense, newApproval } = await fixture(tx);
        const paid = await newExpense({ paidOn: '2026-03-15' });
        const refund = async (sp: Transaction) => {
          const { id: approvalId } = await newApproval('expense_refund');
          await sp
            .insert(expenseRefund)
            .values({ expenseId: paid.id, date: '2026-03-20', approvalId, createdBy: sa.id });
          return approvalId;
        };
        const firstApproval = await refund(tx);
        await expectViolation(tx, 'expense_refund_single_open', refund);
        await tx
          .update(approval)
          .set({
            result: 'rejected',
            resolvedBy: sa.id,
            resolvedAt: new Date(),
            resolutionReason: 'No procede',
          })
          .where(eq(approval.id, firstApproval));
        await refund(tx);
      }));
  });

  describe('plumber_salary and plumber_payment', () => {
    it('rejects a salary of 0', () =>
      rollback(async (tx) => {
        const { plumber1, newSalary } = await fixture(tx);
        await expectViolation(tx, 'plumber_salary_amount_positive', () =>
          newSalary(plumber1.id, 0),
        );
      }));

    it('rejects a payment with the salary of another plumber', () =>
      rollback(async (tx) => {
        const { salary1, newPlumber, plumberExpense, payPlumber } = await fixture(tx);
        const plumber2 = await newPlumber('Fontanero Dos');
        const exp = await plumberExpense();
        await expectViolation(tx, 'plumber_payment_salary_plumber_fk', () =>
          payPlumber(exp.id, '2026-03-01', plumber2.id, salary1.id),
        );
      }));

    it('lets another plumber be paid for the same period', () =>
      rollback(async (tx) => {
        const { newPlumber, newSalary, plumberExpense, payPlumber } = await fixture(tx);
        await payPlumber((await plumberExpense()).id, '2026-03-01');
        const plumber2 = await newPlumber('Fontanero Dos');
        const salary2 = await newSalary(plumber2.id);
        await payPlumber((await plumberExpense()).id, '2026-03-01', plumber2.id, salary2.id);
      }));

    it('rejects two plumber payments for the same expense', () =>
      rollback(async (tx) => {
        const { plumberExpense, payPlumber } = await fixture(tx);
        const exp = await plumberExpense();
        await payPlumber(exp.id, '2026-03-01');
        await expectViolation(tx, 'plumber_payment_pkey', () => payPlumber(exp.id, '2026-03-16'));
      }));
  });
});
