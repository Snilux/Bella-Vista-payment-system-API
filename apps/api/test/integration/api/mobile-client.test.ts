import { randomUUID } from 'node:crypto';
import {
  type ApiClient,
  ApiError,
  createApiClient,
  type TokenStore,
} from '@bella-vista/mobile/api-client';
import {
  accountStatementResponseSchema,
  approvalResponseSchema,
  paymentPreviewResponseSchema,
  paymentResponseSchema,
  type SessionResponse,
  selectableMonths,
  sessionResponseSchema,
  toggleMonth,
} from '@bella-vista/shared';
import { eq, sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  connection,
  coveredPeriod,
  payment,
  person,
  unit,
  unitHolder,
  userAccount,
} from '../../../src/db/schema/index.js';
import { DEV_PASSWORD } from '../../../src/db/seed/dev-data.js';
import { testDatabaseUrl } from '../db/helpers.js';
import { useApiTestApp } from './fixture.js';

// The app's own HTTP client (@bella-vista/mobile/api-client) against the real API and database
// (3.2 §12, M6): the requests the payment flow makes, validated with the same schemas the app
// uses. Its fetch is wired to Fastify's inject; tokens live in memory. It registers a payment of
// two months, sends it again with the same Idempotency-Key (the retry after a lost answer: same
// payment, nothing duplicated), refuses skipped months and a repeated paper folio, and requests
// a cancellation that the president sees with its payment and authorizes: the months are unpaid
// again.

const NOW = new Date('2026-10-25T18:30:00Z');

describe.skipIf(!testDatabaseUrl)('the mobile client against the real API', () => {
  const ctx = useApiTestApp();
  let unitId = 0;

  beforeAll(async () => {
    ctx.setNow(NOW);
    await ctx.owner
      .update(userAccount)
      .set({ mustChangePassword: false })
      .where(eq(userAccount.username, 'admin'));
    // A family of S1-M01 billed from June: June–September overdue (4, debt cycle open) and
    // October pending.
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
        reference: 'Cliente de la app',
        registeredOn: '2026-06-01',
        activatedOn: '2026-06-01',
        billingStartPeriod: '2026-06-01',
        createdBy,
      })
      .returning({ id: unit.id });
    unitId = row?.id ?? 0;
    await ctx.owner
      .insert(unitHolder)
      .values({ unitId, personId: holder?.id ?? 0, validFrom: '2026-06-01', createdBy });
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

  const statementOf = async (client: ApiClient) =>
    (
      await client.request({
        method: 'GET',
        path: `/units/${unitId}/account-statement`,
        schema: accountStatementResponseSchema,
      })
    ).statement;

  const paymentsOfUnit = async () =>
    (await ctx.owner.select({ id: payment.id }).from(payment).where(eq(payment.unitId, unitId)))
      .length;

  let paymentId = 0;

  it('registers two months chosen as F-02 does, and the retry with the same key does not duplicate', async () => {
    const leader = await clientFor('jm.s1m01');
    const statement = await statementOf(leader);
    const offered = selectableMonths(statement, { rates: [], advanceCount: 0 });
    // Marking July marks June too (chronological order, D-03).
    const periods = toggleMonth(offered.months, [], '2026-07');
    expect(periods).toEqual(['2026-06', '2026-07']);

    const { preview } = await leader.request({
      method: 'POST',
      path: '/payments/preview',
      body: { unitId, periods },
      schema: paymentPreviewResponseSchema,
    });
    // Four overdue months: each one with its surcharge (D-02).
    expect(preview.total).toBe(20_000);

    const key = randomUUID();
    const body = { unitId, periods, paperFolio: 'APP-001', expectedTotal: preview.total };
    const first = await leader.request({
      method: 'POST',
      path: '/payments',
      body,
      idempotencyKey: key,
      schema: paymentResponseSchema,
    });
    paymentId = first.payment.id;
    expect(first.payment).toMatchObject({ total: 20_000, paperFolio: 'APP-001' });

    // "No sabemos si se registró" → Reintentar: the same data with the same key.
    const again = await leader.request({
      method: 'POST',
      path: '/payments',
      body,
      idempotencyKey: key,
      schema: paymentResponseSchema,
    });
    expect(again.payment.id).toBe(paymentId);
    expect(await paymentsOfUnit()).toBe(1);
    const after = await statementOf(leader);
    expect(after.months.filter((m) => m.status === 'paid').map((m) => m.period)).toEqual([
      '2026-06',
      '2026-07',
    ]);
  });

  it('refuses skipped months and a repeated paper folio, with the codes the app translates', async () => {
    const leader = await clientFor('jm.s1m01');
    const skipped = leader.request({
      method: 'POST',
      path: '/payments',
      body: { unitId, periods: ['2026-09'], paperFolio: 'APP-002', expectedTotal: 10_000 },
      idempotencyKey: randomUUID(),
      schema: paymentResponseSchema,
    });
    await expect(skipped).rejects.toMatchObject({ code: 'MONTH_ORDER' });

    const repeated = await leader
      .request({
        method: 'POST',
        path: '/payments',
        body: { unitId, periods: ['2026-08'], paperFolio: 'APP-001', expectedTotal: 10_000 },
        idempotencyKey: randomUUID(),
        schema: paymentResponseSchema,
      })
      .catch((error: unknown) => error);
    expect(repeated).toBeInstanceOf(ApiError);
    expect((repeated as ApiError).code).toBe('DUPLICATE_PAPER_FOLIO');
    expect(await paymentsOfUnit()).toBe(1);
  });

  it('a requested cancellation reaches the president with its payment; authorized, the months are unpaid again', async () => {
    const leader = await clientFor('jm.s1m01');
    const key = randomUUID();
    const requested = await leader.request({
      method: 'POST',
      path: `/payments/${paymentId}/request-cancellation`,
      body: { reason: 'Se registró en la familia equivocada.' },
      idempotencyKey: key,
      schema: paymentResponseSchema,
    });
    const approvalId = requested.payment.cancellations[0]?.approvalId ?? 0;

    const president = await clientFor('presidente');
    const { approval } = await president.request({
      method: 'GET',
      path: `/approvals/${approvalId}`,
      schema: approvalResponseSchema,
    });
    expect(approval).toMatchObject({
      type: 'payment_cancellation',
      status: 'pending',
      reason: 'Se registró en la familia equivocada.',
      subject: { type: 'payment', id: paymentId },
    });
    // R-03 opens the payment (G-05) with the president's own permissions.
    const { payment: detail } = await president.request({
      method: 'GET',
      path: `/payments/${approval.subject?.id}`,
      schema: paymentResponseSchema,
    });
    expect(detail.months.map((m) => m.period)).toEqual(['2026-06', '2026-07']);

    await president.request({
      method: 'POST',
      path: `/approvals/${approvalId}/resolve`,
      body: { result: 'approved' },
      schema: approvalResponseSchema,
    });
    const statement = await statementOf(leader);
    expect(
      statement.months
        .filter((m) => ['2026-06', '2026-07'].includes(m.period))
        .map((m) => [m.period, m.status]),
    ).toEqual([
      ['2026-06', 'overdue'],
      ['2026-07', 'overdue'],
    ]);
    expect(
      await ctx.owner.select().from(coveredPeriod).where(eq(coveredPeriod.paymentId, paymentId)),
    ).toEqual([]);
  });
});
