import { randomUUID } from 'node:crypto';
import {
  type ApiClient,
  ApiError,
  createApiClient,
  type TokenStore,
} from '@bella-vista/mobile/api-client';
import {
  adjustmentResponseSchema,
  approvalResponseSchema,
  expenseResponseSchema,
  extraChargeListResponseSchema,
  extraChargeResponseSchema,
  handoverResponseSchema,
  incomeResponseSchema,
  myCashboxResponseSchema,
  paymentPreviewResponseSchema,
  paymentResponseSchema,
  plumberResponseSchema,
  plumberSalaryResponseSchema,
  type SessionResponse,
  sessionResponseSchema,
} from '@bella-vista/shared';
import { and, eq, sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  agreement,
  connection,
  expense,
  fee,
  feeAmount,
  person,
  plumberPayment,
  unit,
  unitHolder,
  userAccount,
} from '../../../src/db/schema/index.js';
import { DEV_PASSWORD } from '../../../src/db/seed/dev-data.js';
import { testDatabaseUrl } from '../db/helpers.js';
import { useApiTestApp } from './fixture.js';

// The app's own HTTP client (@bella-vista/mobile/api-client) against the real API and database,
// for M7 (3.2 §12): the requests of J-03, J-04, T-03, T-06/T-07, T-09 and F-02, validated with
// the same schemas the app uses. A handover confirmed with a shortfall moves both cashboxes by
// the amount received and keeps the difference (and its adjustment is fixed at it); a pending
// handover is withdrawn; an expense without balance is not paid; the plumber's payment sent
// again with the same key is not duplicated; a reconnection is paid with the months.

const NOW = new Date('2026-10-25T18:30:00Z');

describe.skipIf(!testDatabaseUrl)('the mobile client against the real API (M7)', () => {
  const ctx = useApiTestApp();
  let unitId = 0;
  let reconnectionFeeId = 0;
  let agreementId = 0;

  beforeAll(async () => {
    ctx.setNow(NOW);
    await ctx.owner
      .update(userAccount)
      .set({ mustChangePassword: false })
      .where(eq(userAccount.username, 'admin'));
    const treasurer = await ctx.accountId('tesorero');
    const [reconnection] = await ctx.owner
      .select({ id: fee.id })
      .from(fee)
      .where(eq(fee.type, 'reconnection'));
    reconnectionFeeId = reconnection?.id ?? 0;
    await ctx.owner.insert(feeAmount).values({
      feeId: reconnectionFeeId,
      effectiveFrom: '2026-01-01',
      amount: 30_000,
      createdBy: treasurer,
    });
    // A family of S1-M01 billed from September: September overdue, October pending.
    const [conn] = await ctx.owner
      .select({ id: connection.id })
      .from(connection)
      .where(sql`${connection.address} LIKE ${'Av. Hidalgo%'}`);
    const [holder] = await ctx.owner.select({ id: person.id }).from(person).limit(1);
    const createdBy = await ctx.accountId('secretario');
    const [row] = await ctx.owner
      .insert(unit)
      .values({
        connectionId: conn?.id ?? 0,
        reference: 'Cliente de la app (M7)',
        registeredOn: '2026-09-01',
        activatedOn: '2026-09-01',
        billingStartPeriod: '2026-09-01',
        createdBy,
      })
      .returning({ id: unit.id });
    unitId = row?.id ?? 0;
    await ctx.owner
      .insert(unitHolder)
      .values({ unitId, personId: holder?.id ?? 0, validFrom: '2026-09-01', createdBy });
    const [approved] = await ctx.owner
      .select({ id: agreement.id })
      .from(agreement)
      .where(eq(agreement.result, 'approved_by_majority'))
      .limit(1);
    agreementId = approved?.id ?? 0;
  });

  /** fetch → Fastify inject: the client's real requests, headers and bodies. */
  const fetchFn: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const res = await ctx.app.inject({
      method: (init?.method ?? 'GET') as 'GET',
      url: `${url.pathname}${url.search}`,
      headers: { ...(init?.headers as Record<string, string> | undefined) },
      ...(typeof init?.body === 'string' && { payload: init.body }),
    });
    return new Response(res.statusCode === 204 ? null : res.body, { status: res.statusCode });
  };

  /** The client signed in as `username`, as the app does after C-01. */
  async function clientFor(username: string): Promise<ApiClient> {
    let session: SessionResponse | null = null;
    const tokens: TokenStore = {
      getAccessToken: () => session?.accessToken ?? null,
      getRefreshToken: () => Promise.resolve(session?.refreshToken ?? null),
      save: (value) => {
        session = value;
        return Promise.resolve();
      },
      clear: () => {
        session = null;
        return Promise.resolve();
      },
    };
    const client = createApiClient({
      baseUrl: 'http://api.test',
      tokens,
      onSessionEnded: () => undefined,
      fetchFn,
    });
    await tokens.save(
      await client.request({
        method: 'POST',
        path: '/auth/login',
        auth: false,
        body: { username, password: DEV_PASSWORD },
        schema: sessionResponseSchema,
      }),
    );
    return client;
  }

  const mine = async (client: ApiClient) =>
    (
      await client.request({
        method: 'GET',
        path: '/cashboxes/mine',
        schema: myCashboxResponseSchema,
      })
    ).cashbox;

  /** J-03: the POST of useMoneyOperation (it adds the key). */
  const prepare = (client: ApiClient, declaredAmount: number, key = randomUUID()) =>
    client.request({
      method: 'POST',
      path: '/handovers',
      body: { declaredAmount },
      schema: handoverResponseSchema,
      idempotencyKey: key,
    });

  const rejection = async (promise: Promise<unknown>) => {
    try {
      await promise;
    } catch (error) {
      return error;
    }
    throw new Error('expected the API to refuse it');
  };

  it('F-02: a reconnection created by the treasurer is paid together with the months', async () => {
    const treasurer = await clientFor('tesorero');
    const { charge } = await treasurer.request({
      method: 'POST',
      path: '/extra-charges',
      body: { feeId: reconnectionFeeId, unitId },
      schema: extraChargeResponseSchema,
    });
    expect(charge).toMatchObject({ amount: 30_000, status: 'pending' });

    const leader = await clientFor('jm.s1m01');
    const { charges } = await leader.request({
      method: 'GET',
      path: `/units/${unitId}/extra-charges`,
      query: { status: 'pending' },
      schema: extraChargeListResponseSchema,
    });
    expect(charges.map((item) => item.id)).toEqual([charge.id]);

    const body = { unitId, periods: ['2026-09', '2026-10'], extraChargeIds: [charge.id] };
    const { preview } = await leader.request({
      method: 'POST',
      path: '/payments/preview',
      body,
      schema: paymentPreviewResponseSchema,
    });
    const { payment } = await leader.request({
      method: 'POST',
      path: '/payments',
      body: { ...body, paperFolio: 'APP-M7-1', expectedTotal: preview.total },
      schema: paymentResponseSchema,
      idempotencyKey: randomUUID(),
    });
    expect(payment.months.map((month) => month.period)).toEqual(['2026-09', '2026-10']);
    expect(payment.charges.map((item) => item.id)).toEqual([charge.id]);
    expect(payment.total).toBe(preview.total);
    const after = await leader.request({
      method: 'GET',
      path: `/units/${unitId}/extra-charges`,
      query: { status: 'pending' },
      schema: extraChargeListResponseSchema,
    });
    expect(after.charges).toEqual([]);
  });

  let shortfallId = 0;

  it('T-03: confirmed with a shortfall, both cashboxes move by the amount received and the difference stays', async () => {
    const leader = await clientFor('jm.s1m01');
    const treasurer = await clientFor('tesorero');
    const blockBefore = await mine(leader);
    const committeeBefore = await mine(treasurer);
    const declared = Math.min(blockBefore.available, 20_000);
    expect(declared).toBeGreaterThan(5_000);

    const { handover } = await prepare(leader, declared);
    // Pending: still in the block cashbox, shown as "Por confirmar" (D-16).
    const pending = await mine(leader);
    expect(pending.balance).toBe(blockBefore.balance);
    expect(pending.pendingHandover).toBe(blockBefore.pendingHandover + declared);

    const received = declared - 5_000;
    const confirmed = await treasurer.request({
      method: 'POST',
      path: `/handovers/${handover.id}/confirm`,
      body: { receivedAmount: received },
      schema: handoverResponseSchema,
      idempotencyKey: randomUUID(),
    });
    expect(confirmed.handover).toMatchObject({
      status: 'with_difference',
      receivedAmount: received,
      difference: 5_000,
    });
    expect((await mine(leader)).balance).toBe(blockBefore.balance - received);
    expect((await mine(treasurer)).balance).toBe(committeeBefore.balance + received);
    shortfallId = handover.id;

    // G-11: the adjustment is the whole difference with the model's sign; another amount is not.
    const wrong = await rejection(
      treasurer.request({
        method: 'POST',
        path: '/adjustments',
        body: { handoverId: handover.id, amount: -4_000, reason: 'Parcial' },
        schema: adjustmentResponseSchema,
        idempotencyKey: randomUUID(),
      }),
    );
    expect(wrong).toBeInstanceOf(ApiError);
    expect((wrong as ApiError).code).toBe('VALIDATION_ERROR');
    const { adjustment } = await treasurer.request({
      method: 'POST',
      path: '/adjustments',
      body: { handoverId: handover.id, amount: -5_000, reason: 'Billete falso' },
      schema: adjustmentResponseSchema,
      idempotencyKey: randomUUID(),
    });
    // R-03: the president opens the approval and its handover.
    const president = await clientFor('presidente');
    const { approval } = await president.request({
      method: 'GET',
      path: `/approvals/${adjustment.approvalId}`,
      schema: approvalResponseSchema,
    });
    expect(approval.subject).toEqual({ type: 'handover', id: handover.id });
    const seen = await president.request({
      method: 'GET',
      path: `/handovers/${handover.id}`,
      schema: handoverResponseSchema,
    });
    expect(seen.handover.preparedBy.fullName).toMatch(/\S+ \S+/);
  });

  it('J-04: a pending handover is withdrawn and the cash stays in the block cashbox', async () => {
    const leader = await clientFor('jm.s1m01');
    const before = await mine(leader);
    const { handover } = await prepare(leader, Math.min(before.available, 1_000));
    const { handover: withdrawn } = await leader.request({
      method: 'POST',
      path: `/handovers/${handover.id}/withdraw`,
      schema: handoverResponseSchema,
    });
    expect(withdrawn.status).toBe('withdrawn');
    const after = await mine(leader);
    expect(after.balance).toBe(before.balance);
    expect(after.pendingHandover).toBe(before.pendingHandover);
    expect(shortfallId).toBeGreaterThan(0);
  });

  it('T-06/T-07: an expense without balance is not paid; it stays pending', async () => {
    const treasurer = await clientFor('tesorero');
    const { balance } = await mine(treasurer);
    const { expense: created } = await treasurer.request({
      method: 'POST',
      path: '/expenses',
      body: {
        categoryId: 1,
        description: 'Bomba nueva',
        amount: balance + 100,
        agreementId,
      },
      schema: expenseResponseSchema,
      idempotencyKey: randomUUID(),
    });
    const refused = await rejection(
      treasurer.request({
        method: 'POST',
        path: `/expenses/${created.id}/pay`,
        schema: expenseResponseSchema,
        idempotencyKey: randomUUID(),
      }),
    );
    expect((refused as ApiError).code).toBe('INSUFFICIENT_BALANCE');
    const [row] = await ctx.owner
      .select({ paidOn: expense.paidOn })
      .from(expense)
      .where(eq(expense.id, created.id));
    expect(row?.paidOn).toBeNull();
    expect((await mine(treasurer)).balance).toBe(balance);
  });

  it('T-09: the plumber payment sent again with the same key is not duplicated', async () => {
    const treasurer = await clientFor('tesorero');
    // Cash for the payment (T-05) and a plumber with an authorized salary (T-08).
    await treasurer.request({
      method: 'POST',
      path: '/incomes',
      body: { concept: 'Donativo', amount: 500_000 },
      schema: incomeResponseSchema,
      idempotencyKey: randomUUID(),
    });
    const { plumber } = await treasurer.request({
      method: 'POST',
      path: '/plumbers',
      body: { name: 'Pedro Ramírez Cruz', phone: '2229876543' },
      schema: plumberResponseSchema,
    });
    const { salary } = await treasurer.request({
      method: 'POST',
      path: `/plumbers/${plumber.id}/salaries`,
      body: { amount: 250_000, frequency: 'biweekly', effectiveFrom: '2026-10-01', agreementId },
      schema: plumberSalaryResponseSchema,
    });
    expect(salary.status).toBe('pending');
    const president = await clientFor('presidente');
    await president.request({
      method: 'POST',
      path: `/approvals/${salary.approvalId}/resolve`,
      body: { result: 'approved' },
      schema: approvalResponseSchema,
    });

    const before = (await mine(treasurer)).balance;
    const key = randomUUID();
    const pay = () =>
      treasurer.request({
        method: 'POST',
        path: `/plumbers/${plumber.id}/payments`,
        body: { date: '2026-10-16' },
        schema: expenseResponseSchema,
        idempotencyKey: key,
      });
    const first = await pay();
    // "Reintentar" after a lost answer: the same key, the same expense.
    const again = await pay();
    expect(again.expense.id).toBe(first.expense.id);
    expect(first.expense.plumberPayment).toMatchObject({
      periodStart: '2026-10-16',
      periodEnd: '2026-10-31',
    });
    const payments = await ctx.owner
      .select({ id: plumberPayment.expenseId })
      .from(plumberPayment)
      .where(
        and(eq(plumberPayment.plumberId, plumber.id), eq(plumberPayment.periodStart, '2026-10-16')),
      );
    expect(payments).toHaveLength(1);
    expect((await mine(treasurer)).balance).toBe(before - 250_000);
  });
});
