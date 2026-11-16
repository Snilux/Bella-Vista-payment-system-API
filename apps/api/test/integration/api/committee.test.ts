import { randomUUID } from 'node:crypto';
import { expensePageSchema, plumberResponseSchema } from '@bella-vista/shared';
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { auditLog, cashbox, userAccount, vCashboxBalance } from '../../../src/db/schema/index.js';
import { testDatabaseUrl } from '../db/helpers.js';
import { useApiTestApp } from './fixture.js';

// API step 7, committee module: other incomes, expenses paid only with enough balance in the
// committee cashbox (D-17, D-21), refunds approved by the president, and the plumber with his
// salary history and one payment per period (D-24). The clock is fixed on 2026-11-16 (Mexico
// City); the committee cashbox of the development data starts empty. Cases run in order.

const NOW = new Date('2026-11-16T18:00:00Z');

describe.skipIf(!testDatabaseUrl)('committee', () => {
  const ctx = useApiTestApp();

  beforeAll(async () => {
    ctx.setNow(NOW);
    await ctx.owner
      .update(userAccount)
      .set({ mustChangePassword: false })
      .where(eq(userAccount.username, 'admin'));
  });

  const call = async (
    method: 'GET' | 'POST' | 'PATCH',
    url: string,
    username: string,
    payload?: Record<string, unknown>,
    idempotencyKey?: string,
  ) => {
    const res = await ctx.app.inject({
      method,
      url,
      headers: {
        ...(await ctx.authFor(username)),
        ...(idempotencyKey && { 'idempotency-key': idempotencyKey }),
      },
      ...(payload && { payload }),
    });
    return { status: res.statusCode, body: res.json(), headers: res.headers };
  };
  const post = (
    url: string,
    username: string,
    payload: Record<string, unknown>,
    key = randomUUID(),
  ) => call('POST', url, username, payload, key);
  const resolve = (approvalId: number, result: 'approved' | 'rejected') =>
    call('POST', `/v1/approvals/${approvalId}/resolve`, 'presidente', {
      result,
      ...(result === 'rejected' && { reason: 'No procede' }),
    });
  const newAgreement = async (
    result: 'approved_by_majority' | 'rejected' = 'approved_by_majority',
  ) =>
    (
      await call('POST', '/v1/agreements', 'secretario', {
        meetingDate: '2026-11-10',
        topic: 'Gastos del comité',
        result,
      })
    ).body.agreement.id as number;
  const committeeBalance = async () => {
    const [row] = await ctx.owner
      .select({ balance: vCashboxBalance.balance })
      .from(vCashboxBalance)
      .innerJoin(cashbox, eq(cashbox.id, vCashboxBalance.cashboxId))
      .where(eq(cashbox.type, 'committee'));
    return row?.balance ?? 0;
  };
  const addIncome = (amount: number) =>
    post('/v1/incomes', 'tesorero', { concept: 'Aportación de la feria', amount });
  const categoryId = async (name: string) => {
    const res = await call('GET', '/v1/expense-categories', 'tesorero');
    return res.body.categories.find((c: { name: string }) => c.name === name).id as number;
  };
  const newExpense = async (amount: number) =>
    post('/v1/expenses', 'tesorero', {
      categoryId: await categoryId('Electricidad'),
      description: 'Recibo de luz del pozo',
      amount,
      agreementId: await newAgreement(),
      voucherReference: 'CFE-1234',
    });

  // --- Incomes --------------------------------------------------------------------------------

  it('registers incomes into the committee cashbox (RF-GAS-01)', async () => {
    const res = await post('/v1/incomes', 'tesorero', {
      concept: 'Donación de la parroquia',
      amount: 300_000,
      voucherReference: 'Recibo 15',
    });
    expect(res).toMatchObject({
      status: 201,
      body: {
        income: {
          folio: expect.stringMatching(/^IN-\d{6}-\d{6}$/),
          amount: 300_000,
          date: '2026-11-16',
        },
      },
    });
    expect(await committeeBalance()).toBe(300_000);
    const future = await post('/v1/incomes', 'tesorero', {
      concept: 'X',
      amount: 1,
      date: '2026-11-17',
    });
    expect(future.body.error.code).toBe('VALIDATION_ERROR');
    const list = await call('GET', '/v1/incomes', 'secretario');
    expect(list.body.data).toHaveLength(1);
  });

  // --- Expenses -------------------------------------------------------------------------------

  it('lists the expense categories of the bootstrap', async () => {
    const res = await call('GET', '/v1/expense-categories', 'vocal');
    expect(res.body.categories).toContainEqual(
      expect.objectContaining({ name: 'Salario del fontanero', isPlumberSalary: true }),
    );
  });

  it('registers an expense with its agreement, pending payment (D-17)', async () => {
    const res = await newExpense(500_000);
    expect(res).toMatchObject({
      status: 201,
      body: {
        expense: {
          folio: expect.stringMatching(/^GA-\d{6}-\d{6}$/),
          category: { name: 'Electricidad' },
          amount: 500_000,
          status: 'pending_payment',
          plumberPayment: null,
        },
      },
    });

    const rejectedAgreement = await post('/v1/expenses', 'tesorero', {
      categoryId: await categoryId('Materiales'),
      description: 'Tubería',
      amount: 1_000,
      agreementId: await newAgreement('rejected'),
    });
    expect(rejectedAgreement.body.error.code).toBe('VALIDATION_ERROR');
    const salary = await post('/v1/expenses', 'tesorero', {
      categoryId: await categoryId('Salario del fontanero'),
      description: 'Salario',
      amount: 1_000,
      agreementId: await newAgreement(),
    });
    expect(salary.body.error.details.issues[0].message).toBe(
      'El salario del fontanero se paga desde su ficha, por periodo.',
    );
  });

  it('pays an expense only with enough balance (D-21)', async () => {
    const big = (await call('GET', '/v1/expenses?status=pending_payment', 'tesorero')).body.data[0];
    const refused = await post(`/v1/expenses/${big.id}/pay`, 'tesorero', {});
    expect(refused).toMatchObject({
      status: 422,
      body: {
        error: {
          code: 'INSUFFICIENT_BALANCE',
          message: 'El importe ($5,000.00) es mayor que lo disponible en la caja ($3,000.00).',
        },
      },
    });

    const small = await newExpense(100_000);
    const key = randomUUID();
    const paid = await post(`/v1/expenses/${small.body.expense.id}/pay`, 'tesorero', {}, key);
    expect(paid.body.expense).toMatchObject({ status: 'paid', paidOn: '2026-11-16' });
    expect(await committeeBalance()).toBe(200_000);
    const replay = await post(`/v1/expenses/${small.body.expense.id}/pay`, 'tesorero', {}, key);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect(await committeeBalance()).toBe(200_000);
    expect(
      (await post(`/v1/expenses/${small.body.expense.id}/pay`, 'tesorero', {})).body.error.code,
    ).toBe('INVALID_STATE');
  });

  it('rejects a pending expense with a reason; not a paid one', async () => {
    const pending = await newExpense(50_000);
    const id = pending.body.expense.id;
    const rejected = await call('POST', `/v1/expenses/${id}/reject`, 'tesorero', {
      reason: 'Se cobró dos veces',
    });
    expect(rejected.body.expense).toMatchObject({
      status: 'rejected',
      rejectionReason: 'Se cobró dos veces',
    });
    expect((await post(`/v1/expenses/${id}/pay`, 'tesorero', {})).body.error.code).toBe(
      'INVALID_STATE',
    );
    const paid = (await call('GET', '/v1/expenses?status=paid', 'tesorero')).body.data[0];
    expect(
      (await call('POST', `/v1/expenses/${paid.id}/reject`, 'tesorero', { reason: 'x' })).body.error
        .code,
    ).toBe('INVALID_STATE');
  });

  it('a refund needs the president: rejected changes nothing, approved returns the money', async () => {
    const paid = (await call('GET', '/v1/expenses?status=paid', 'tesorero')).body.data[0];
    const request = () =>
      post(`/v1/expenses/${paid.id}/request-refund`, 'tesorero', {
        reason: 'El proveedor devolvió el pago',
      });
    const first = await request();
    expect(first.body.expense.refunds).toEqual([expect.objectContaining({ status: 'pending' })]);
    expect((await request()).body.error.code).toBe('INVALID_STATE');
    const inbox = await call('GET', '/v1/approvals?status=pending', 'presidente');
    expect(
      inbox.body.approvals.find(
        (a: { id: number }) => a.id === first.body.expense.refunds[0].approvalId,
      )?.description,
    ).toMatch(/^Reintegro del gasto GA-\d{6}-\d{6} \(\$1,000\.00\)$/);

    await resolve(first.body.expense.refunds[0].approvalId, 'rejected');
    expect(await committeeBalance()).toBe(200_000);
    const second = await request();
    await resolve(second.body.expense.refunds[0].approvalId, 'approved');
    const detail = await call('GET', `/v1/expenses/${paid.id}`, 'vocal');
    expect(detail.body.expense.status).toBe('refunded');
    expect(await committeeBalance()).toBe(300_000);
    expect((await request()).body.error.code).toBe('INVALID_STATE');
  });

  // --- Plumber (D-24) -------------------------------------------------------------------------

  let plumberId: number;

  it('registers the plumber; a phone change is audited by the database', async () => {
    const res = await call('POST', '/v1/plumbers', 'tesorero', {
      name: 'Ramiro Fontanería',
      phone: '5550001111',
    });
    expect(res.status).toBe(201);
    expect(plumberResponseSchema.safeParse(res.body).success).toBe(true);
    plumberId = res.body.plumber.id;
    const updated = await call('PATCH', `/v1/plumbers/${plumberId}`, 'tesorero', {
      phone: '5550002222',
      reason: 'Cambió de número',
    });
    expect(updated.body.plumber.phone).toBe('5550002222');
    const audit = await ctx.owner
      .select({ action: auditLog.action, reason: auditLog.reason })
      .from(auditLog)
      .where(and(eq(auditLog.tableName, 'plumber'), eq(auditLog.recordId, plumberId)));
    expect(audit).toContainEqual({ action: 'update_contact', reason: 'Cambió de número' });
  });

  it('a salary needs the president; without one the plumber is not paid', async () => {
    const noSalary = await post(`/v1/plumbers/${plumberId}/payments`, 'tesorero', {
      date: '2026-11-10',
    });
    expect(noSalary.body.error.code).toBe('INVALID_STATE');

    const res = await call('POST', `/v1/plumbers/${plumberId}/salaries`, 'tesorero', {
      amount: 250_000,
      frequency: 'biweekly',
      effectiveFrom: '2026-11-01',
      agreementId: await newAgreement(),
    });
    expect(res).toMatchObject({
      status: 201,
      body: { salary: { amount: 250_000, frequency: 'biweekly', status: 'pending' } },
    });
    const second = await call('POST', `/v1/plumbers/${plumberId}/salaries`, 'tesorero', {
      amount: 260_000,
      frequency: 'biweekly',
      effectiveFrom: '2026-12-01',
      agreementId: await newAgreement(),
    });
    expect(second.body.error.code).toBe('INVALID_STATE');
    const inbox = await call('GET', '/v1/approvals?status=pending', 'presidente');
    expect(
      inbox.body.approvals.find((a: { id: number }) => a.id === res.body.salary.approvalId)
        ?.description,
    ).toBe('Salario quincenal de $2,500.00 para Ramiro Fontanería desde 2026-11-01');
    await resolve(res.body.salary.approvalId, 'approved');
  });

  it('pays the period of the date with the salary in force, once (D-24)', async () => {
    const res = await post(`/v1/plumbers/${plumberId}/payments`, 'tesorero', {
      date: '2026-11-10',
    });
    expect(res.status).toBe(201);
    expect(res.body.expense).toMatchObject({
      category: { name: 'Salario del fontanero' },
      amount: 250_000,
      status: 'paid',
      plumberPayment: { plumberId, periodStart: '2026-11-01', periodEnd: '2026-11-15' },
      agreement: { id: expect.any(Number) },
    });
    expect(await committeeBalance()).toBe(50_000);

    const again = await post(`/v1/plumbers/${plumberId}/payments`, 'tesorero', {
      date: '2026-11-03',
    });
    expect(again).toMatchObject({
      status: 409,
      body: {
        error: {
          code: 'PERIOD_ALREADY_PAID',
          message: 'El periodo del 2026-11-01 al 2026-11-15 ya está pagado al fontanero.',
        },
      },
    });
    // Today (the second fortnight) does not fit in the balance.
    const today = await post(`/v1/plumbers/${plumberId}/payments`, 'tesorero', {});
    expect(today.body.error.code).toBe('INSUFFICIENT_BALANCE');
    await addIncome(300_000);
    const paid = await post(`/v1/plumbers/${plumberId}/payments`, 'tesorero', {});
    expect(paid.body.expense.plumberPayment).toMatchObject({
      periodStart: '2026-11-16',
      periodEnd: '2026-11-30',
    });
    const future = await post(`/v1/plumbers/${plumberId}/payments`, 'tesorero', {
      date: '2026-12-01',
    });
    expect(future.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('a period is paid with the salary in force in it (salary change)', async () => {
    const res = await call('POST', `/v1/plumbers/${plumberId}/salaries`, 'tesorero', {
      amount: 400_000,
      frequency: 'monthly',
      effectiveFrom: '2026-10-01',
      agreementId: await newAgreement(),
    });
    await resolve(res.body.salary.approvalId, 'approved');
    await addIncome(400_000);
    const october = await post(`/v1/plumbers/${plumberId}/payments`, 'tesorero', {
      date: '2026-10-20',
    });
    expect(october.body.expense).toMatchObject({
      amount: 400_000,
      plumberPayment: { periodStart: '2026-10-01', periodEnd: '2026-10-31' },
    });

    const detail = await call('GET', `/v1/plumbers/${plumberId}`, 'secretario');
    expect(detail.body.plumber).toMatchObject({
      currentSalary: { amount: 250_000, frequency: 'biweekly' },
    });
    expect(
      detail.body.plumber.payments.map((p: { periodStart: string }) => p.periodStart).sort(),
    ).toEqual(['2026-10-01', '2026-11-01', '2026-11-16']);
    const list = await call('GET', '/v1/expenses', 'tesorero');
    expect(expensePageSchema.safeParse(list.body).success).toBe(true);
  });

  it('an inactive plumber is not paid', async () => {
    await call('PATCH', `/v1/plumbers/${plumberId}`, 'tesorero', { active: false });
    const res = await post(`/v1/plumbers/${plumberId}/payments`, 'tesorero', {
      date: '2026-09-15',
    });
    expect(res.body.error).toMatchObject({
      code: 'INVALID_STATE',
      message: 'El fontanero no está activo.',
    });
  });

  // --- Permissions ----------------------------------------------------------------------------

  it.each(['presidente', 'secretario', 'vocal', 'jm.s1m01', 'admin'])(
    'only the treasurer manages incomes, expenses and the plumber (%s gets 403)',
    async (username) => {
      const requests: [string, string, Record<string, unknown>][] = [
        ['POST', '/v1/incomes', { concept: 'X', amount: 1 }],
        ['POST', '/v1/expenses', { categoryId: 1, description: 'X', amount: 1, agreementId: 1 }],
        ['POST', '/v1/expenses/1/pay', {}],
        ['POST', '/v1/expenses/1/reject', { reason: 'x' }],
        ['POST', '/v1/expenses/1/request-refund', { reason: 'x' }],
        ['POST', '/v1/plumbers', { name: 'X' }],
        ['PATCH', `/v1/plumbers/${plumberId}`, { active: true }],
        [
          'POST',
          `/v1/plumbers/${plumberId}/salaries`,
          { amount: 1, frequency: 'monthly', effectiveFrom: '2026-12-01', agreementId: 1 },
        ],
        ['POST', `/v1/plumbers/${plumberId}/payments`, {}],
      ];
      for (const [method, url, body] of requests) {
        const res = await call(method as 'POST' | 'PATCH', url, username, body, randomUUID());
        expect(res.body.error?.code, `${method} ${url}`).toBe('FORBIDDEN');
      }
    },
  );

  it.each(['jm.s1m01', 'admin'])('%s does not read the committee data (403)', async (username) => {
    for (const url of ['/v1/incomes', '/v1/expenses', '/v1/expense-categories', '/v1/plumbers']) {
      expect((await call('GET', url, username)).body.error.code).toBe('FORBIDDEN');
    }
  });
});
