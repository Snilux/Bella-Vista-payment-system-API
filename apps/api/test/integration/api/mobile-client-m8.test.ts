import { randomUUID } from 'node:crypto';
import {
  type ApiClient,
  ApiError,
  createApiClient,
  describeError,
  type TokenStore,
} from '@bella-vista/mobile/api-client';
import {
  closingResponseSchema,
  communityReportResponseSchema,
  incomeResponseSchema,
  myCashboxResponseSchema,
  paymentPreviewResponseSchema,
  paymentResponseSchema,
  type SessionResponse,
  sessionResponseSchema,
} from '@bella-vista/shared';
import { eq, sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { connection, person, unit, unitHolder, userAccount } from '../../../src/db/schema/index.js';
import { DEV_PASSWORD } from '../../../src/db/seed/dev-data.js';
import { testDatabaseUrl } from '../db/helpers.js';
import { useApiTestApp } from './fixture.js';

// The app's own HTTP client (@bella-vista/mobile/api-client) against the real API and database,
// for M8 (3.2 §12): the treasurer prepares and counts the committee's October closing, the
// member reviews it but cannot close it, the president closes it, and a payment dated in
// October is then refused with PERIOD_CLOSED and the Spanish message the app shows. A monthly
// closing only covers a finished month, so the payment needs the test clock moved back to
// October (a real payment is always dated today). The report the PDF is built from is the
// same response the screen reads.

const NOVEMBER = new Date('2026-11-16T18:00:00Z');
const OCTOBER = new Date('2026-10-28T18:00:00Z');

describe.skipIf(!testDatabaseUrl)('the mobile client against the real API (M8)', () => {
  const ctx = useApiTestApp();
  let unitId = 0;

  beforeAll(async () => {
    ctx.setNow(NOVEMBER);
    await ctx.owner
      .update(userAccount)
      .set({ mustChangePassword: false })
      .where(eq(userAccount.username, 'admin'));
    // A family of S1-M02 billed from October: October is pending.
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
        reference: 'Cliente de la app (M8)',
        registeredOn: '2026-10-01',
        activatedOn: '2026-10-01',
        billingStartPeriod: '2026-10-01',
        createdBy,
      })
      .returning({ id: unit.id });
    unitId = row?.id ?? 0;
    await ctx.owner
      .insert(unitHolder)
      .values({ unitId, personId: holder?.id ?? 0, validFrom: '2026-10-01', createdBy });
  });

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

  const rejection = async (promise: Promise<unknown>) => {
    try {
      await promise;
    } catch (error) {
      return error;
    }
    throw new Error('expected the API to refuse it');
  };

  it('closing October blocks a payment in October; the member cannot close', async () => {
    const treasurer = await clientFor('tesorero');
    // The committee cashbox's first movement, in October (T-05 with a date).
    await treasurer.request({
      method: 'POST',
      path: '/incomes',
      body: { concept: 'Donativo', amount: 80_000, date: '2026-10-05' },
      schema: incomeResponseSchema,
      idempotencyKey: randomUUID(),
    });
    const mine = await treasurer.request({
      method: 'GET',
      path: '/cashboxes/mine',
      schema: myCashboxResponseSchema,
    });
    expect(mine.cashbox.nextClosingPeriod).toBe('2026-10');

    // T-13 "Preparar corte del comité", then G-08 "Guardar conteo".
    const opened = await treasurer.request({
      method: 'POST',
      path: '/closings',
      body: { type: 'monthly', period: '2026-10' },
      schema: closingResponseSchema,
    });
    const { closing } = opened;
    expect(closing.figures.expectedBalance).toBe(80_000);
    await treasurer.request({
      method: 'POST',
      path: `/closings/${closing.id}/count`,
      body: { countedCash: 80_000 },
      schema: closingResponseSchema,
    });

    // The member reviews, but closing is the president's.
    const member = await clientFor('vocal');
    const reviewed = await member.request({
      method: 'POST',
      path: `/closings/${closing.id}/review`,
      schema: closingResponseSchema,
    });
    expect(reviewed.closing.status).toBe('reviewed');
    const forbidden = await rejection(
      member.request({
        method: 'POST',
        path: `/closings/${closing.id}/close`,
        schema: closingResponseSchema,
      }),
    );
    expect(forbidden).toBeInstanceOf(ApiError);
    expect((forbidden as ApiError).code).toBe('FORBIDDEN');
    const president = await clientFor('presidente');
    const closed = await president.request({
      method: 'POST',
      path: `/closings/${closing.id}/close`,
      schema: closingResponseSchema,
    });
    expect(closed.closing.status).toBe('closed');
    expect(closed.closing.preparedBy.fullName).toMatch(/\S+ \S+/);

    // A payment dated in October, into the committee cashbox: refused, with the app's message.
    ctx.setNow(OCTOBER);
    const body = { unitId, periods: ['2026-10'], extraChargeIds: [] };
    const { preview } = await treasurer.request({
      method: 'POST',
      path: '/payments/preview',
      body,
      schema: paymentPreviewResponseSchema,
    });
    const refused = await rejection(
      treasurer.request({
        method: 'POST',
        path: '/payments',
        body: { ...body, paperFolio: 'APP-M8-1', expectedTotal: preview.total },
        schema: paymentResponseSchema,
        idempotencyKey: randomUUID(),
      }),
    );
    expect((refused as ApiError).code).toBe('PERIOD_CLOSED');
    expect(describeError(refused).message).toBe(
      'Ese mes ya tiene su corte cerrado y no admite movimientos. Registre la operación con una fecha del mes abierto; si es una corrección, se hace en el mes abierto.',
    );

    // In November (the open month) the same payment goes in.
    ctx.setNow(NOVEMBER);
    const { preview: again } = await treasurer.request({
      method: 'POST',
      path: '/payments/preview',
      body,
      schema: paymentPreviewResponseSchema,
    });
    const paid = await treasurer.request({
      method: 'POST',
      path: '/payments',
      body: { ...body, paperFolio: 'APP-M8-2', expectedTotal: again.total },
      schema: paymentResponseSchema,
      idempotencyKey: randomUUID(),
    });
    expect(paid.payment.months.map((month) => month.period)).toEqual(['2026-10']);
  });

  it('the community report the PDF is built from is the one the screen reads (closing differences)', async () => {
    const member = await clientFor('vocal');
    const { report } = await member.request({
      method: 'GET',
      path: '/reports/community',
      query: { from: '2026-10', to: '2026-10' },
      schema: communityReportResponseSchema,
    });
    expect(report.range).toMatchObject({ from: '2026-10', to: '2026-10', dateFrom: '2026-10-01' });
    expect(report.totals.closingDifferences).toBe(0);
    expect(report.committee.incomes).toBe(80_000);
  });
});
