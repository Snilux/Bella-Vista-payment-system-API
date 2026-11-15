import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  adjustment,
  agreement,
  connection,
  connectionBlock,
  connectionRequest,
  expense,
  expenseCategory,
  expenseRefund,
  extraCharge,
  fee,
  feeAmount,
  handover,
  openingBalance,
  paymentCancellation,
  paymentCharge,
  plumber,
  plumberPayment,
  plumberSalary,
  suspension,
  unit,
  vBlock,
  vCashboxBalance,
  vCashboxMovement,
  vClosing,
  vConnection,
  vConnectionRequest,
  vExpense,
  vHandover,
  vPaymentAmount,
  vPendingApproval,
  vUnit,
} from '../../../src/db/schema/index.js';
import { one, testDatabaseUrl, useTestDb } from './helpers.js';
import { moneyFixture, noonMx, RATE } from './money-fixture.js';

// One test per view of 2.2 §5 with known data (3.1, block 7). Amounts in cents.

describe.skipIf(!testDatabaseUrl)('views', () => {
  const { rollback } = useTestDb();

  it('v_block: code S1-M01 and the approved current leader only', () =>
    rollback(async (tx) => {
      const { m01, m02, newPerson, assign } = await moneyFixture(tx);
      // A pending leader for M02 does not count yet.
      await assign({
        personId: (await newPerson('Pedro', 'Pendiente')).id,
        role: 'block_leader',
        blockId: m02.id,
        contactPhone: '5550002222',
      });
      const rows = await tx.select().from(vBlock).orderBy(vBlock.code);
      expect(rows.find((r) => r.id === m01.id)).toMatchObject({
        code: 'S1-M01',
        leaderName: 'Laura Jefa',
        leaderContactPhone: '5550001111',
      });
      expect(rows.find((r) => r.id === m02.id)).toMatchObject({
        code: 'S1-M02',
        leaderPersonId: null,
      });
    }));

  it('v_connection: current block, status and number of families', () =>
    rollback(async (tx) => {
      const { sa, m02, conn, approvedAgreement } = await moneyFixture(tx);
      // A second unit that was deactivated does not count as a family.
      await tx.insert(unit).values({
        connectionId: conn.id,
        registeredOn: '2026-01-01',
        deactivatedOn: '2026-02-01',
        createdBy: sa.id,
      });
      // Moved from M01 to M02.
      await tx
        .update(connectionBlock)
        .set({ validTo: '2026-06-01' })
        .where(eq(connectionBlock.connectionId, conn.id));
      await tx.insert(connectionBlock).values({
        connectionId: conn.id,
        blockId: m02.id,
        validFrom: '2026-06-01',
        createdBy: sa.id,
      });

      const suspended = one(
        await tx
          .insert(connection)
          .values({ address: 'Calle 2 #20', activatedOn: '2026-01-01', createdBy: sa.id })
          .returning(),
      );
      await tx.insert(suspension).values({
        connectionId: suspended.id,
        periodFrom: '2026-01-01',
        reason: 'Fuga',
        agreementId: approvedAgreement.id,
        createdBy: sa.id,
      });
      const deactivated = one(
        await tx
          .insert(connection)
          .values({
            address: 'Calle 3 #30',
            activatedOn: '2026-01-01',
            deactivatedOn: '2026-02-01',
            deactivationReason: 'Baja voluntaria',
            createdBy: sa.id,
          })
          .returning(),
      );

      const rows = await tx.select().from(vConnection);
      const byId = (id: number) => rows.find((r) => r.id === id);
      expect(byId(conn.id)).toMatchObject({ blockId: m02.id, status: 'active', unitCount: 1 });
      expect(byId(suspended.id)).toMatchObject({ status: 'suspended', unitCount: 0 });
      expect(byId(deactivated.id)).toMatchObject({ status: 'deactivated' });
    }));

  it('v_connection_request: every status of the opening process', () =>
    rollback(async (tx) => {
      const { sa, m01, holder, approvedAgreement, blockBox, newPayment } = await moneyFixture(tx);
      const rejectedAgreement = one(
        await tx
          .insert(agreement)
          .values({
            meetingDate: '2026-02-01',
            topic: 'Toma',
            result: 'rejected',
            createdBy: sa.id,
          })
          .returning(),
      );
      const opening = one(
        await tx
          .insert(fee)
          .values({ type: 'opening', name: 'Apertura de toma', createdBy: sa.id })
          .returning(),
      );
      await tx.insert(feeAmount).values({
        feeId: opening.id,
        effectiveFrom: '2026-01-01',
        amount: 150_000,
        createdBy: sa.id,
      });

      const request = async (values: Partial<typeof connectionRequest.$inferInsert> = {}) =>
        one(
          await tx
            .insert(connectionRequest)
            .values({
              applicantId: holder.id,
              address: 'Calle Nueva #1',
              blockId: m01.id,
              requestedOn: '2026-02-01',
              createdBy: sa.id,
              ...values,
            })
            .returning(),
        );
      const charge = async (requestId: number) =>
        one(
          await tx
            .insert(extraCharge)
            .values({
              feeId: opening.id,
              connectionRequestId: requestId,
              chargedOn: '2026-02-10',
              createdBy: sa.id,
            })
            .returning(),
        );
      const payCharge = async (extraChargeId: number) => {
        const pay = await newPayment({ unitId: null, cashboxId: blockBox.id });
        await tx
          .insert(paymentCharge)
          .values({ paymentId: pay.id, extraChargeId, createdBy: sa.id });
        return pay;
      };

      const requested = await request();
      const rejected = await request({
        agreementId: rejectedAgreement.id,
        resolutionReason: 'Sin red cercana',
      });
      const cancelled = await request({
        cancelledOn: '2026-02-05',
        cancellationReason: 'Retirada por el solicitante',
      });
      const pendingPayment = await request({ agreementId: approvedAgreement.id });
      await charge(pendingPayment.id);
      const pendingInstallation = await request({ agreementId: approvedAgreement.id });
      const paid = await payCharge((await charge(pendingInstallation.id)).id);
      const installed = await request({ agreementId: approvedAgreement.id });
      await payCharge((await charge(installed.id)).id);
      await tx.insert(connection).values({
        connectionRequestId: installed.id,
        address: 'Calle Nueva #1',
        activatedOn: '2026-03-01',
        createdBy: sa.id,
      });

      const rows = await tx.select().from(vConnectionRequest);
      const status = (id: number) => rows.find((r) => r.id === id)?.status;
      expect(status(requested.id)).toBe('requested');
      expect(status(rejected.id)).toBe('rejected');
      expect(status(cancelled.id)).toBe('cancelled');
      expect(status(pendingPayment.id)).toBe('approved_pending_payment');
      expect(status(pendingInstallation.id)).toBe('pending_installation');
      expect(status(installed.id)).toBe('installed');

      // The payment's block comes from the request (it has no unit) and its total is the fee.
      const [amount] = await tx.select().from(vPaymentAmount).where(eq(vPaymentAmount.id, paid.id));
      expect(amount).toMatchObject({ blockId: m01.id, total: 150_000, chargesAmount: 150_000 });
    }));

  it('v_unit: current holder and status', () =>
    rollback(async (tx) => {
      const { sa, conn, unit1, holder, approvedAgreement } = await moneyFixture(tx);
      const newUnit = async (values: Partial<typeof unit.$inferInsert>) =>
        one(
          await tx
            .insert(unit)
            .values({
              connectionId: conn.id,
              registeredOn: '2026-01-01',
              createdBy: sa.id,
              ...values,
            })
            .returning(),
        );
      const pending = await newUnit({});
      const suspended = await newUnit({
        activatedOn: '2026-01-01',
        billingStartPeriod: '2026-01-01',
      });
      await tx.insert(suspension).values({
        unitId: suspended.id,
        periodFrom: '2026-01-01',
        reason: 'Adeudo',
        agreementId: approvedAgreement.id,
        createdBy: sa.id,
      });
      const deactivated = await newUnit({ deactivatedOn: '2026-02-01' });

      const rows = await tx.select().from(vUnit);
      const byId = (id: number) => rows.find((r) => r.id === id);
      expect(byId(unit1.id)).toMatchObject({ status: 'active', holderPersonId: holder.id });
      expect(byId(pending.id)?.status).toBe('pending_activation');
      expect(byId(suspended.id)?.status).toBe('suspended');
      expect(byId(deactivated.id)?.status).toBe('deactivated');
    }));

  it('v_payment_amount: months with surcharge, extra charge and context on the payment date', () =>
    rollback(async (tx) => {
      const { sa, m01, unit1, holder, leader, newPayment, addMonth, newApproval, resolve } =
        await moneyFixture(tx);
      const repair = one(
        await tx
          .insert(fee)
          .values({ type: 'repair', name: 'Reparación', createdBy: sa.id })
          .returning(),
      );
      await tx.insert(feeAmount).values({
        feeId: repair.id,
        effectiveFrom: '2026-01-01',
        amount: 30_000,
        createdBy: sa.id,
      });
      const charge = one(
        await tx
          .insert(extraCharge)
          .values({ feeId: repair.id, unitId: unit1.id, chargedOn: '2026-03-01', createdBy: sa.id })
          .returning(),
      );
      const pay = await newPayment();
      await addMonth(pay.id, '2026-01-01', true);
      await addMonth(pay.id, '2026-02-01');
      await tx
        .insert(paymentCharge)
        .values({ paymentId: pay.id, extraChargeId: charge.id, createdBy: sa.id });

      const read = async () =>
        one(await tx.select().from(vPaymentAmount).where(eq(vPaymentAmount.id, pay.id)));
      expect(await read()).toMatchObject({
        occurredOn: '2026-03-05',
        monthsAmount: 2 * RATE + RATE,
        chargesAmount: 30_000,
        total: 3 * RATE + 30_000,
        blockId: m01.id,
        holderPersonId: holder.id,
        receiverPersonId: leader.id,
        isSupport: false,
        cancelled: false,
      });

      const { id: approvalId } = await newApproval('payment_cancellation');
      await tx
        .insert(paymentCancellation)
        .values({ paymentId: pay.id, approvalId, createdBy: sa.id });
      expect((await read()).cancelled).toBe(false);
      await resolve(approvalId);
      expect(await read()).toMatchObject({ cancelled: true });
    }));

  it('v_cashbox_movement and v_cashbox_balance: surcharge payment, cancelled payment, opening balance', () =>
    rollback(async (tx) => {
      const { sa, blockBox, committeeBox, newPayment, addMonth, newApproval, resolve } =
        await moneyFixture(tx);
      // Paid with surcharge: $50 x 2 = $100.
      const withSurcharge = await newPayment();
      await addMonth(withSurcharge.id, '2026-01-01', true);
      // Paid $50 and then cancelled with approval: net 0.
      const cancelled = await newPayment({ occurredAt: noonMx('2026-03-06') });
      await addMonth(cancelled.id, '2026-02-01');
      const { id: cancellationApproval } = await newApproval('payment_cancellation');
      await tx
        .insert(paymentCancellation)
        .values({ paymentId: cancelled.id, approvalId: cancellationApproval, createdBy: sa.id });
      await resolve(cancellationApproval, 'approved', noonMx('2026-03-20'));
      // Opening balance $200, approved; a pending one would not count.
      const { id: openingApproval } = await newApproval('opening_balance');
      await tx.insert(openingBalance).values({
        cashboxId: blockBox.id,
        amount: 20_000,
        date: '2026-01-01',
        approvalId: openingApproval,
        createdBy: sa.id,
      });
      await resolve(openingApproval);

      const movements = await tx
        .select()
        .from(vCashboxMovement)
        .where(eq(vCashboxMovement.cashboxId, blockBox.id))
        .orderBy(vCashboxMovement.occurredOn, vCashboxMovement.kind);
      expect(
        movements.map(({ occurredOn, kind, amount }) => ({ occurredOn, kind, amount })),
      ).toEqual([
        { occurredOn: '2026-01-01', kind: 'opening_balance', amount: 20_000 },
        { occurredOn: '2026-03-05', kind: 'payment', amount: 2 * RATE },
        { occurredOn: '2026-03-06', kind: 'payment', amount: RATE },
        { occurredOn: '2026-03-20', kind: 'payment_cancellation', amount: -RATE },
      ]);

      const balances = await tx.select().from(vCashboxBalance);
      expect(balances.find((b) => b.cashboxId === blockBox.id)?.balance).toBe(20_000 + 2 * RATE);
      expect(balances.find((b) => b.cashboxId === committeeBox.id)?.balance).toBe(0);
    }));

  it('v_handover: a confirmed handover with a shortfall, then adjusted', () =>
    rollback(async (tx) => {
      const { sa, blockBox, committeeBox, newApproval, resolve } = await moneyFixture(tx);
      const short = one(
        await tx
          .insert(handover)
          .values({
            sourceCashboxId: blockBox.id,
            declaredAmount: 100_000,
            date: '2026-03-31',
            receivedAmount: 90_000,
            confirmedAt: noonMx('2026-03-31'),
            confirmedBy: sa.id,
            createdBy: sa.id,
          })
          .returning(),
      );
      const pending = one(
        await tx
          .insert(handover)
          .values({
            sourceCashboxId: blockBox.id,
            declaredAmount: 5_000,
            date: '2026-04-01',
            createdBy: sa.id,
          })
          .returning(),
      );
      const read = async (id: number) =>
        one(await tx.select().from(vHandover).where(eq(vHandover.id, id)));
      expect(await read(short.id)).toMatchObject({ status: 'with_difference', difference: 10_000 });
      expect(await read(pending.id)).toMatchObject({ status: 'pending', difference: null });

      // The cash moves on confirmation, for the amount received only (D-16).
      const balances = await tx.select().from(vCashboxBalance);
      const balance = (id: number) => balances.find((b) => b.cashboxId === id)?.balance;
      expect(balance(blockBox.id)).toBe(-90_000);
      expect(balance(committeeBox.id)).toBe(90_000);

      const { id: approvalId } = await newApproval('adjustment');
      await tx.insert(adjustment).values({
        cashboxId: blockBox.id,
        handoverId: short.id,
        amount: -10_000,
        date: '2026-04-02',
        approvalId,
        createdBy: sa.id,
      });
      expect((await read(short.id)).status).toBe('with_difference');
      await resolve(approvalId);
      expect(await read(short.id)).toMatchObject({ status: 'adjusted', adjustedAmount: -10_000 });
    }));

  it('v_expense: statuses and the effective amount of a plumber payment', () =>
    rollback(async (tx) => {
      const { sa, approvedAgreement, committeeBox, newApproval, resolve } = await moneyFixture(tx);
      const category = one(
        await tx
          .insert(expenseCategory)
          .values({ name: 'Reparaciones', createdBy: sa.id })
          .returning(),
      );
      const salaryCategory = one(
        await tx
          .insert(expenseCategory)
          .values({ name: 'Salario del fontanero', isPlumberSalary: true, createdBy: sa.id })
          .returning(),
      );
      const newExpense = async (values: Partial<typeof expense.$inferInsert> = {}) =>
        one(
          await tx
            .insert(expense)
            .values({
              categoryId: category.id,
              description: 'Gasto de prueba',
              amount: 40_000,
              agreementId: approvedAgreement.id,
              createdBy: sa.id,
              ...values,
            })
            .returning(),
        );
      const pending = await newExpense();
      const paid = await newExpense({ paidOn: '2026-03-10' });
      const rejected = await newExpense({ rejectedOn: '2026-03-10', rejectionReason: 'Duplicado' });
      const refunded = await newExpense({ paidOn: '2026-03-10' });
      const { id: refundApproval } = await newApproval('expense_refund');
      await tx.insert(expenseRefund).values({
        expenseId: refunded.id,
        date: '2026-03-15',
        approvalId: refundApproval,
        createdBy: sa.id,
      });
      await resolve(refundApproval);

      const plumber1 = one(
        await tx.insert(plumber).values({ name: 'Fontanero', createdBy: sa.id }).returning(),
      );
      const { id: salaryApproval } = await newApproval('plumber_salary');
      const salary = one(
        await tx
          .insert(plumberSalary)
          .values({
            plumberId: plumber1.id,
            amount: 150_000,
            frequency: 'biweekly',
            effectiveFrom: '2026-01-01',
            agreementId: approvedAgreement.id,
            approvalId: salaryApproval,
            createdBy: sa.id,
          })
          .returning(),
      );
      const plumberExpense = await newExpense({
        categoryId: salaryCategory.id,
        amount: null,
        agreementId: null,
        paidOn: '2026-03-16',
      });
      await tx.insert(plumberPayment).values({
        expenseId: plumberExpense.id,
        plumberSalaryId: salary.id,
        plumberId: plumber1.id,
        periodStart: '2026-03-01',
        createdBy: sa.id,
      });

      const rows = await tx.select().from(vExpense);
      const byId = (id: number) => rows.find((r) => r.id === id);
      expect(byId(pending.id)?.status).toBe('pending_payment');
      expect(byId(paid.id)).toMatchObject({ status: 'paid', effectiveAmount: 40_000 });
      expect(byId(rejected.id)?.status).toBe('rejected');
      expect(byId(refunded.id)?.status).toBe('refunded');
      expect(byId(plumberExpense.id)).toMatchObject({
        status: 'paid',
        effectiveAmount: 150_000,
        effectiveAgreementId: approvedAgreement.id,
        plumberId: plumber1.id,
      });

      // Committee box: -400 (paid) -400 (refunded) +400 (refund) -1,500 (plumber).
      const [balance] = await tx
        .select()
        .from(vCashboxBalance)
        .where(eq(vCashboxBalance.cashboxId, committeeBox.id));
      expect(balance?.balance).toBe(-40_000 - 150_000);
    }));

  it('v_closing: starting balance, totals by kind, expected balance and difference', () =>
    rollback(async (tx) => {
      const {
        sa,
        blockBox,
        committeeBox,
        newPayment,
        addMonth,
        newApproval,
        resolve,
        monthlyClosing,
      } = await moneyFixture(tx);
      // February: one month paid ($50) -> starting balance of March.
      const february = await newPayment({ occurredAt: noonMx('2026-02-10') });
      await addMonth(february.id, '2026-01-01');
      // March: two months, one with surcharge ($100 + $50).
      const march = await newPayment();
      await addMonth(march.id, '2026-02-01', true);
      await addMonth(march.id, '2026-03-01');
      // March 31: handover of $100 declared, $90 received, and its $10 adjustment approved.
      const short = one(
        await tx
          .insert(handover)
          .values({
            sourceCashboxId: blockBox.id,
            declaredAmount: 10_000,
            date: '2026-03-31',
            receivedAmount: 9_000,
            confirmedAt: noonMx('2026-03-31'),
            confirmedBy: sa.id,
            createdBy: sa.id,
          })
          .returning(),
      );
      const { id: approvalId } = await newApproval('adjustment');
      await tx.insert(adjustment).values({
        cashboxId: blockBox.id,
        handoverId: short.id,
        amount: -1_000,
        date: '2026-03-31',
        approvalId,
        createdBy: sa.id,
      });
      await resolve(approvalId);
      // April: outside the range.
      const april = await newPayment({ occurredAt: noonMx('2026-04-02') });
      await addMonth(april.id, '2026-04-01');

      const closing = await monthlyClosing(blockBox.id, '2026-03', { countedCash: 9_500 });
      const row = one(await tx.select().from(vClosing).where(eq(vClosing.id, closing.id)));
      expect(row).toMatchObject({
        startingBalance: RATE,
        totalPayments: 3 * RATE,
        totalHandoversOut: -9_000,
        totalAdjustments: -1_000,
        totalCancellations: 0,
        totalHandoversIn: 0,
        expectedBalance: RATE + 3 * RATE - 9_000 - 1_000,
        difference: 9_500 - 10_000,
        status: 'counted',
      });

      // The committee box received the $90.
      const committee = await monthlyClosing(committeeBox.id, '2026-03');
      const committeeRow = one(
        await tx.select().from(vClosing).where(eq(vClosing.id, committee.id)),
      );
      expect(committeeRow).toMatchObject({
        totalHandoversIn: 9_000,
        expectedBalance: 9_000,
        difference: null,
        status: 'draft',
      });
    }));

  it('v_pending_approval: pending approvals with the record that uses them', () =>
    rollback(async (tx) => {
      const { sa, newRate, newApproval, resolve, blockBox } = await moneyFixture(tx);
      const pendingRate = await newRate('2026-07-01', 6_000);
      const { id: openingApproval } = await newApproval('opening_balance');
      await tx.insert(openingBalance).values({
        cashboxId: blockBox.id,
        amount: 1_000,
        date: '2026-01-01',
        approvalId: openingApproval,
        createdBy: sa.id,
      });
      await resolve(openingApproval);

      const rows = await tx.select().from(vPendingApproval);
      expect(rows.find((r) => r.id === pendingRate.approvalId)).toMatchObject({
        type: 'rate',
        tableName: 'rate',
        recordId: pendingRate.id,
        requestedBy: sa.id,
      });
      expect(rows.some((r) => r.id === openingApproval)).toBe(false);
    }));
});
