import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  adjustment,
  approval,
  cashbox,
  closing,
  expense,
  expenseCategory,
  handover,
  income,
  openingBalance,
  paymentCancellation,
  plumber,
  plumberPayment,
  plumberSalary,
  rate,
  unitChangeRequest,
  userAccount,
} from '../../../src/db/schema/index.js';
import { one, pgError, testDatabaseUrl, useTestDb } from './helpers.js';
import { moneyFixture, noonMx } from './money-fixture.js';

// Triggers of block 7 (3.1 §2.1) and the rules left pending in blocks 5 and 6.

describe.skipIf(!testDatabaseUrl)('triggers', () => {
  const { rollback, expectViolation, attempt } = useTestDb();

  describe('closed period (D-14)', () => {
    it('rejects payments dated in a closed month and accepts them in an open one', () =>
      rollback(async (tx) => {
        const { blockBox, newPayment, monthlyClosing } = await moneyFixture(tx);
        await monthlyClosing(blockBox.id, '2026-03', { closed: true });
        await expectViolation(tx, 'period_closed', () =>
          newPayment({ occurredAt: noonMx('2026-03-15') }),
        );
        await newPayment({ occurredAt: noonMx('2026-04-01') });
        // 05:30 UTC on April 1 is 23:30 on March 31 in Mexico City: still March.
        await expectViolation(tx, 'period_closed', () =>
          newPayment({ occurredAt: new Date('2026-04-01T05:30:00Z') }),
        );
      }));

    it('only locks monthly closings that are closed, and only for their cashbox', () =>
      rollback(async (tx) => {
        const { sa, blockBox, committeeBox, newPayment, monthlyClosing } = await moneyFixture(tx);
        await monthlyClosing(blockBox.id, '2026-02', { countedCash: 0 });
        await monthlyClosing(committeeBox.id, '2026-03', { closed: true });
        await tx.insert(closing).values({
          cashboxId: blockBox.id,
          type: 'extraordinary',
          dateFrom: '2026-03-01',
          dateTo: '2026-03-14',
          countedCash: 0,
          reviewedBy: sa.id,
          reviewedAt: noonMx('2026-03-14'),
          closedBy: sa.id,
          closedAt: noonMx('2026-03-14'),
          createdBy: sa.id,
        });
        await newPayment({ occurredAt: noonMx('2026-02-10') });
        await newPayment({ occurredAt: noonMx('2026-03-10') });
      }));

    it('rejects other movements dated in a closed month', () =>
      rollback(async (tx) => {
        const { sa, blockBox, committeeBox, approvedAgreement, newApproval, monthlyClosing } =
          await moneyFixture(tx);
        await monthlyClosing(blockBox.id, '2026-03', { closed: true });
        await monthlyClosing(committeeBox.id, '2026-03', { closed: true });

        const { id: openingApproval } = await newApproval('opening_balance');
        await expectViolation(tx, 'period_closed', (sp) =>
          sp.insert(openingBalance).values({
            cashboxId: blockBox.id,
            amount: 1_000,
            date: '2026-03-01',
            approvalId: openingApproval,
            createdBy: sa.id,
          }),
        );
        await expectViolation(tx, 'period_closed', (sp) =>
          sp
            .insert(income)
            .values({ concept: 'Donativo', amount: 1_000, date: '2026-03-20', createdBy: sa.id }),
        );
        const category = one(
          await tx
            .insert(expenseCategory)
            .values({ name: 'Materiales', createdBy: sa.id })
            .returning(),
        );
        const exp = one(
          await tx
            .insert(expense)
            .values({
              categoryId: category.id,
              description: 'Tubería',
              amount: 5_000,
              agreementId: approvedAgreement.id,
              createdBy: sa.id,
            })
            .returning(),
        );
        await expectViolation(tx, 'period_closed', (sp) =>
          sp.update(expense).set({ paidOn: '2026-03-25' }).where(eq(expense.id, exp.id)),
        );
        await tx.update(expense).set({ paidOn: '2026-04-01' }).where(eq(expense.id, exp.id));
      }));

    it('rejects confirming a handover into a closed month of either cashbox', () =>
      rollback(async (tx) => {
        const { sa, blockBox, committeeBox, monthlyClosing } = await moneyFixture(tx);
        await monthlyClosing(committeeBox.id, '2026-03', { closed: true });
        const pending = one(
          await tx
            .insert(handover)
            .values({
              sourceCashboxId: blockBox.id,
              declaredAmount: 5_000,
              date: '2026-03-30',
              createdBy: sa.id,
            })
            .returning(),
        );
        const confirm = (confirmedAt: Date) => (sp: typeof tx) =>
          sp
            .update(handover)
            .set({ receivedAmount: 5_000, confirmedAt, confirmedBy: sa.id })
            .where(eq(handover.id, pending.id));
        await expectViolation(tx, 'period_closed', confirm(noonMx('2026-03-31')));
        await confirm(noonMx('2026-04-01'))(tx);
      }));

    it('rejects approving a cancellation or adjustment whose movement falls in a closed month', () =>
      rollback(async (tx) => {
        const { sa, blockBox, newPayment, addMonth, newApproval, resolve, monthlyClosing } =
          await moneyFixture(tx);
        const pay = await newPayment();
        await addMonth(pay.id, '2026-01-01');
        const { id: cancellationApproval } = await newApproval('payment_cancellation');
        await tx
          .insert(paymentCancellation)
          .values({ paymentId: pay.id, approvalId: cancellationApproval, createdBy: sa.id });
        const { id: adjustmentApproval } = await newApproval('adjustment');
        const march = await monthlyClosing(blockBox.id, '2026-03', { countedCash: 0 });
        await tx.insert(adjustment).values({
          cashboxId: blockBox.id,
          closingId: march.id,
          amount: -500,
          date: '2026-03-31',
          approvalId: adjustmentApproval,
          createdBy: sa.id,
        });
        // March gets reviewed and closed before the approvals are resolved.
        await tx
          .update(closing)
          .set({
            reviewedBy: sa.id,
            reviewedAt: noonMx('2026-04-01'),
            closedBy: sa.id,
            closedAt: noonMx('2026-04-01'),
          })
          .where(eq(closing.id, march.id));

        await expectViolation(tx, 'period_closed', () =>
          resolve(cancellationApproval, 'approved', noonMx('2026-03-25')),
        );
        await expectViolation(tx, 'period_closed', () => resolve(adjustmentApproval));
        // The cancellation goes to the open period (D-14).
        await resolve(cancellationApproval, 'approved', noonMx('2026-04-02'));
      }));
  });

  describe('single approved rate and cancellation', () => {
    it('rejects approving a second rate for the same period', () =>
      rollback(async (tx) => {
        const { newRate, resolve } = await moneyFixture(tx);
        const first = await newRate('2026-07-01', 6_000);
        const second = await newRate('2026-07-01', 6_500);
        await resolve(first.approvalId);
        await expectViolation(tx, 'rate_single_approved', () => resolve(second.approvalId));
        // Rejecting it is fine.
        await resolve(second.approvalId, 'rejected');
      }));

    it('rejects inserting a rate with an approved approval for a period that already has one', () =>
      rollback(async (tx) => {
        const { sa, approvedAgreement, rate2026, newApproval, resolve } = await moneyFixture(tx);
        const { id: approvalId } = await newApproval('rate');
        await resolve(approvalId);
        await expectViolation(tx, 'rate_single_approved', (sp) =>
          sp.insert(rate).values({
            effectivePeriod: rate2026.effectivePeriod,
            amount: 7_000,
            approvedOn: '2026-01-01',
            agreementId: approvedAgreement.id,
            approvalId,
            createdBy: sa.id,
          }),
        );
      }));

    it('rejects approving a second cancellation of the same payment', () =>
      rollback(async (tx) => {
        const { sa, newPayment, newApproval, resolve } = await moneyFixture(tx);
        const pay = await newPayment();
        const cancel = async () => {
          const { id: approvalId } = await newApproval('payment_cancellation');
          await tx
            .insert(paymentCancellation)
            .values({ paymentId: pay.id, approvalId, createdBy: sa.id });
          return approvalId;
        };
        const first = await cancel();
        const second = await cancel();
        await resolve(first);
        await expectViolation(tx, 'payment_cancellation_single_approved', () => resolve(second));
      }));
  });

  describe('approval type matches the table', () => {
    it('rejects an approval of another type', () =>
      rollback(async (tx) => {
        const { sa, approvedAgreement, unit1, newApproval } = await moneyFixture(tx);
        const { id: wrong } = await newApproval('role_assignment');
        await expectViolation(tx, 'rate_approval_type', (sp) =>
          sp.insert(rate).values({
            effectivePeriod: '2026-08-01',
            amount: 6_000,
            approvedOn: '2026-07-01',
            agreementId: approvedAgreement.id,
            approvalId: wrong,
            createdBy: sa.id,
          }),
        );
        const { id: holderChange } = await newApproval('holder_change');
        await expectViolation(tx, 'unit_change_request_approval_type', (sp) =>
          sp.insert(unitChangeRequest).values({
            unitId: unit1.id,
            type: 'deactivation',
            approvalId: holderChange,
            createdBy: sa.id,
          }),
        );
        const { id: deactivation } = await newApproval('unit_deactivation');
        await tx.insert(unitChangeRequest).values({
          unitId: unit1.id,
          type: 'deactivation',
          approvalId: deactivation,
          createdBy: sa.id,
        });
      }));
  });

  describe('handover source cashbox', () => {
    it('rejects a handover from the committee cashbox and accepts one from a support cashbox', () =>
      rollback(async (tx) => {
        const { sa, committeeBox, newPerson } = await moneyFixture(tx);
        const values = (sourceCashboxId: number) => ({
          sourceCashboxId,
          declaredAmount: 5_000,
          date: '2026-03-31',
          createdBy: sa.id,
        });
        await expectViolation(tx, 'handover_source_type', (sp) =>
          sp.insert(handover).values(values(committeeBox.id)),
        );
        const support = one(
          await tx
            .insert(cashbox)
            .values({
              type: 'support',
              custodianPersonId: (await newPerson()).id,
              createdBy: sa.id,
            })
            .returning(),
        );
        await tx.insert(handover).values(values(support.id));
      }));
  });

  describe('expense amount and agreement (deferred)', () => {
    async function setup(tx: Parameters<Parameters<typeof rollback>[0]>[0]) {
      const fixture = await moneyFixture(tx);
      const { sa, approvedAgreement, newApproval } = fixture;
      const category = one(
        await tx
          .insert(expenseCategory)
          .values({ name: 'Salario del fontanero', isPlumberSalary: true, createdBy: sa.id })
          .returning(),
      );
      const plumber1 = one(
        await tx.insert(plumber).values({ name: 'Fontanero', createdBy: sa.id }).returning(),
      );
      const { id: approvalId } = await newApproval('plumber_salary');
      const salary = one(
        await tx
          .insert(plumberSalary)
          .values({
            plumberId: plumber1.id,
            amount: 150_000,
            frequency: 'monthly',
            effectiveFrom: '2026-01-01',
            agreementId: approvedAgreement.id,
            approvalId,
            createdBy: sa.id,
          })
          .returning(),
      );
      const bareExpense = async (sp: typeof tx) =>
        one(
          await sp
            .insert(expense)
            .values({ categoryId: category.id, description: 'Pago mensual', createdBy: sa.id })
            .returning(),
        );
      return { ...fixture, plumber1, salary, bareExpense };
    }

    const checkNow = (sp: Parameters<Parameters<typeof rollback>[0]>[0]) =>
      sp.execute(sql`SET CONSTRAINTS expense_amount_agreement_required IMMEDIATE`);

    it('rejects an expense without amount or agreement that is not a plumber payment', () =>
      rollback(async (tx) => {
        const { bareExpense } = await setup(tx);
        // Deferred: the insert itself passes; the check runs at commit (forced here).
        const caught = await attempt(tx, async (sp) => {
          await bareExpense(sp);
          await checkNow(sp);
        });
        expect(pgError(caught).constraint_name).toBe('expense_amount_agreement_required');
      }));

    it('accepts it once its plumber_payment is inserted in the same transaction', () =>
      rollback(async (tx) => {
        const { sa, plumber1, salary, bareExpense } = await setup(tx);
        const exp = await bareExpense(tx);
        await tx.insert(plumberPayment).values({
          expenseId: exp.id,
          plumberSalaryId: salary.id,
          plumberId: plumber1.id,
          periodStart: '2026-03-01',
          createdBy: sa.id,
        });
        await checkNow(tx);
      }));
  });

  describe('a closed closing is immutable', () => {
    it('accepts count, review and close while open, then rejects every change', () =>
      rollback(async (tx) => {
        const { sa, blockBox, monthlyClosing } = await moneyFixture(tx);
        const march = await monthlyClosing(blockBox.id, '2026-03');
        const update = (values: Partial<typeof closing.$inferInsert>) => (sp: typeof tx) =>
          sp.update(closing).set(values).where(eq(closing.id, march.id));

        // Open: every step is allowed, including correcting the count before review.
        await update({ countedCash: 9_000, notes: 'Conteo inicial' })(tx);
        await update({ countedCash: 9_500 })(tx);
        await update({ reviewedBy: sa.id, reviewedAt: noonMx('2026-04-01') })(tx);
        // The initial transition to closed.
        await update({ closedBy: sa.id, closedAt: noonMx('2026-04-02') })(tx);

        const attempts: Partial<typeof closing.$inferInsert>[] = [
          { countedCash: 10_000 },
          { notes: 'Corrección' },
          { reviewedAt: noonMx('2026-04-03') },
          { closedAt: noonMx('2026-04-03') },
          // Clearing the close (and the review) would reopen the month.
          { closedBy: null, closedAt: null },
          { closedBy: null, closedAt: null, reviewedBy: null, reviewedAt: null },
        ];
        for (const values of attempts) {
          await expectViolation(tx, 'closing_closed_immutable', update(values));
        }
        await expectViolation(tx, 'closing_closed_immutable', (sp) =>
          sp.delete(closing).where(eq(closing.id, march.id)),
        );

        const [row] = await tx.select().from(closing).where(eq(closing.id, march.id));
        expect(row).toMatchObject({ countedCash: 9_500, notes: 'Conteo inicial' });
        expect(row?.closedAt).toEqual(noonMx('2026-04-02'));
      }));
  });

  describe('a resolved approval is immutable', () => {
    it('allows the first resolution and rejects any later change, even back to pending', () =>
      rollback(async (tx) => {
        const { newApproval, resolve, assign, newPerson } = await moneyFixture(tx);
        const { id: approvalId } = await newApproval('opening_balance');
        // A second account to try a different resolver.
        const president = await assign({ personId: (await newPerson()).id, role: 'president' });
        const other = one(
          await tx
            .insert(userAccount)
            .values({ roleAssignmentId: president.id, username: 'presidente', passwordHash: 'x' })
            .returning(),
        );
        const update = (values: Partial<typeof approval.$inferInsert>) => (sp: typeof tx) =>
          sp.update(approval).set(values).where(eq(approval.id, approvalId));

        await resolve(approvalId, 'approved', noonMx('2026-03-20'));

        const attempts: Partial<typeof approval.$inferInsert>[] = [
          { result: 'rejected', resolutionReason: 'Cambio de opinión' },
          { result: null, resolvedBy: null, resolvedAt: null },
          { resolvedAt: noonMx('2026-03-21') },
          { resolutionReason: 'Nota agregada después' },
          { resolvedBy: other.id },
        ];
        for (const values of attempts) {
          await expectViolation(tx, 'approval_resolved_immutable', update(values));
        }
        const [row] = await tx.select().from(approval).where(eq(approval.id, approvalId));
        expect(row).toMatchObject({ result: 'approved', resolutionReason: null });
        expect(row?.resolvedAt).toEqual(noonMx('2026-03-20'));
      }));

    it('also freezes a rejected approval', () =>
      rollback(async (tx) => {
        const { newApproval, resolve } = await moneyFixture(tx);
        const { id: approvalId } = await newApproval('adjustment');
        await resolve(approvalId, 'rejected');
        await expectViolation(tx, 'approval_resolved_immutable', () =>
          resolve(approvalId, 'approved'),
        );
      }));
  });
});
