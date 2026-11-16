import { feeListResponseSchema, rateListResponseSchema } from '@bella-vista/shared';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { extraCharge, fee, unit, userAccount } from '../../../src/db/schema/index.js';
import { testDatabaseUrl } from '../db/helpers.js';
import { useApiTestApp } from './fixture.js';

// API step 6, rates module: rates registered by the treasurer and approved by the president
// (D-05, D-18, D-20) and fees with their amount history (D-13). The clock is fixed on
// 2026-11-16 (Mexico City); the development data has approved rates $40.00 from 2025-01 and
// $50.00 from 2026-01. Cases run in order.

const NOW = new Date('2026-11-16T18:00:00Z');

describe.skipIf(!testDatabaseUrl)('rates and fees', () => {
  const ctx = useApiTestApp();

  beforeAll(async () => {
    ctx.setNow(NOW);
    await ctx.owner
      .update(userAccount)
      .set({ mustChangePassword: false })
      .where(eq(userAccount.username, 'admin'));
  });

  const call = async (
    method: 'GET' | 'POST',
    url: string,
    username: string,
    payload?: Record<string, unknown>,
  ) => {
    const res = await ctx.app.inject({
      method,
      url,
      headers: await ctx.authFor(username),
      ...(payload && { payload }),
    });
    return { status: res.statusCode, body: res.json() };
  };
  const newAgreement = async (
    result: 'approved_by_majority' | 'rejected' = 'approved_by_majority',
  ) =>
    (
      await call('POST', '/v1/agreements', 'secretario', {
        meetingDate: '2026-11-10',
        topic: 'Tarifa de agua',
        result,
        votesFor: 30,
      })
    ).body.agreement.id as number;
  const register = async (effectivePeriod: string, amount: number, username = 'tesorero') =>
    call('POST', '/v1/rates', username, {
      effectivePeriod,
      amount,
      approvedOn: '2026-11-10',
      agreementId: await newAgreement(),
    });
  const resolve = (approvalId: number, result: 'approved' | 'rejected') =>
    call('POST', `/v1/approvals/${approvalId}/resolve`, 'presidente', {
      result,
      ...(result === 'rejected' && { reason: 'No corresponde' }),
    });
  const unitId = async (reference: string) => {
    const [row] = await ctx.owner
      .select({ id: unit.id })
      .from(unit)
      .where(eq(unit.reference, reference));
    if (!row) throw new Error(`no unit ${reference}`);
    return row.id;
  };

  // --- Rates ----------------------------------------------------------------------------------

  it('lists the rate history to everyone with an account', async () => {
    for (const username of ['tesorero', 'presidente', 'secretario', 'vocal', 'jm.s1m01']) {
      const res = await call('GET', '/v1/rates', username);
      expect(res.status).toBe(200);
      expect(rateListResponseSchema.safeParse(res.body).success).toBe(true);
    }
    const res = await call('GET', '/v1/rates', 'tesorero');
    expect(
      res.body.rates.map((r: { effectivePeriod: string; amount: number; status: string }) =>
        [r.effectivePeriod, r.amount, r.status].join(' '),
      ),
    ).toEqual(['2026-01 5000 approved', '2025-01 4000 approved']);
  });

  it('registers a rate from next month pending approval; it does not price months yet', async () => {
    const res = await register('2026-12', 6_000);
    expect(res.status).toBe(201);
    expect(res.body.rate).toMatchObject({
      effectivePeriod: '2026-12',
      amount: 6_000,
      status: 'pending',
    });

    const inbox = await call('GET', '/v1/approvals?status=pending', 'presidente');
    expect(inbox.body.approvals).toContainEqual(
      expect.objectContaining({
        id: res.body.rate.approvalId,
        type: 'rate',
        description: 'Tarifa de $60.00 desde Diciembre 2026',
      }),
    );

    // On 2027-01-10 the overdue 2026-12 of a unit still uses the approved $50.00.
    ctx.setNow(new Date('2027-01-10T18:00:00Z'));
    const statement = await call(
      'GET',
      `/v1/units/${await unitId('Planta alta')}/account-statement`,
      'tesorero',
    );
    ctx.setNow(NOW);
    expect(statement.body.statement.months).toContainEqual(
      expect.objectContaining({ period: '2026-12', baseAmount: 5_000 }),
    );
  });

  it('refuses a second rate for a period that already has one pending or approved', async () => {
    const res = await register('2026-12', 6_500);
    expect(res).toMatchObject({ status: 409, body: { error: { code: 'INVALID_STATE' } } });
    const approved = await register('2026-01', 6_500);
    expect(approved.body.error.code).toBe('INVALID_RATE_EFFECTIVE_PERIOD');
  });

  it('approving the rate makes it price its months (D-20)', async () => {
    const rates = (await call('GET', '/v1/rates', 'tesorero')).body.rates;
    const pending = rates.find((r: { effectivePeriod: string }) => r.effectivePeriod === '2026-12');
    expect((await resolve(pending.approvalId, 'approved')).status).toBe(200);

    ctx.setNow(new Date('2027-01-10T18:00:00Z'));
    const statement = await call(
      'GET',
      `/v1/units/${await unitId('Planta alta')}/account-statement`,
      'tesorero',
    );
    ctx.setNow(NOW);
    expect(statement.body.statement.months).toContainEqual(
      expect.objectContaining({ period: '2026-12', baseAmount: 6_000 }),
    );
  });

  it.each([
    ['the current month', '2026-11'],
    ['a past month after the first rate', '2025-06'],
    ['the month of the first rate', '2025-01'],
  ])('refuses %s as effective period (D-05)', async (_, period) => {
    const res = await register(period, 4_500);
    expect(res).toMatchObject({
      status: 422,
      body: {
        error: {
          code: 'INVALID_RATE_EFFECTIVE_PERIOD',
          message: 'Una tarifa nueva solo puede entrar en vigor a partir de Diciembre 2026.',
        },
      },
    });
  });

  it('accepts a past period before the earliest approved rate (startup history, D-18)', async () => {
    const res = await register('2024-06', 3_000);
    expect(res).toMatchObject({ status: 201, body: { rate: { effectivePeriod: '2024-06' } } });
  });

  it('a rejected rate frees its period', async () => {
    const first = await register('2027-02', 7_000);
    expect((await resolve(first.body.rate.approvalId, 'rejected')).status).toBe(200);
    const rates = (await call('GET', '/v1/rates', 'tesorero')).body.rates;
    expect(rates).toContainEqual(
      expect.objectContaining({ id: first.body.rate.id, status: 'rejected' }),
    );
    expect((await register('2027-02', 6_800)).status).toBe(201);
  });

  it('requires an agreement approved by majority', async () => {
    const res = await call('POST', '/v1/rates', 'tesorero', {
      effectivePeriod: '2027-03',
      amount: 6_000,
      approvedOn: '2026-11-10',
      agreementId: await newAgreement('rejected'),
    });
    expect(res).toMatchObject({ status: 400, body: { error: { code: 'VALIDATION_ERROR' } } });
    const missing = await call('POST', '/v1/rates', 'tesorero', {
      effectivePeriod: '2027-03',
      amount: 6_000,
      approvedOn: '2026-11-10',
      agreementId: 999_999,
    });
    expect(missing.body.error.code).toBe('NOT_FOUND');
  });

  it('validates the amount and the period format', async () => {
    const res = await call('POST', '/v1/rates', 'tesorero', {
      effectivePeriod: '2027-3',
      amount: 0,
      approvedOn: '2026-11-10',
      agreementId: 1,
    });
    expect(res.status).toBe(400);
    expect(res.body.error.details.issues.map((i: { path: string }) => i.path)).toEqual(
      expect.arrayContaining(['body.effectivePeriod', 'body.amount']),
    );
  });

  it.each(['presidente', 'secretario', 'vocal', 'jm.s1m01', 'admin'])(
    'only the treasurer registers rates (%s gets 403)',
    async (username) => {
      const res = await call('POST', '/v1/rates', username, {
        effectivePeriod: '2027-04',
        amount: 6_000,
        approvedOn: '2026-11-10',
        agreementId: 1,
      });
      expect(res).toMatchObject({ status: 403, body: { error: { code: 'FORBIDDEN' } } });
    },
  );

  it('the superadmin does not read rates', async () => {
    expect((await call('GET', '/v1/rates', 'admin')).body.error.code).toBe('FORBIDDEN');
    expect((await call('GET', '/v1/fees', 'admin')).body.error.code).toBe('FORBIDDEN');
  });

  // --- Fees -----------------------------------------------------------------------------------

  it('lists the fees of the bootstrap without amount', async () => {
    const res = await call('GET', '/v1/fees', 'jm.s1m01');
    expect(res.status).toBe(200);
    expect(feeListResponseSchema.safeParse(res.body).success).toBe(true);
    const opening = res.body.fees.find((f: { type: string }) => f.type === 'opening');
    expect(opening).toMatchObject({ currentAmount: null, amounts: [] });
  });

  it('creates a fee; the name is unique', async () => {
    const res = await call('POST', '/v1/fees', 'tesorero', {
      type: 'other',
      name: 'Cambio de medidor',
    });
    expect(res).toMatchObject({
      status: 201,
      body: { fee: { type: 'other', name: 'Cambio de medidor', currentAmount: null } },
    });
    const again = await call('POST', '/v1/fees', 'tesorero', {
      type: 'repair',
      name: 'Cambio de medidor',
    });
    expect(again).toMatchObject({ status: 409, body: { error: { code: 'DUPLICATE_CODE' } } });
  });

  it('keeps the amount history of a fee (D-13)', async () => {
    const fees = (await call('GET', '/v1/fees', 'tesorero')).body.fees;
    const meter = fees.find((f: { name: string }) => f.name === 'Cambio de medidor');
    const first = await call('POST', `/v1/fees/${meter.id}/amounts`, 'tesorero', {
      effectiveFrom: '2026-11-16',
      amount: 30_000,
    });
    expect(first.body.fee).toMatchObject({
      currentAmount: { effectiveFrom: '2026-11-16', amount: 30_000 },
    });
    const later = await call('POST', `/v1/fees/${meter.id}/amounts`, 'tesorero', {
      effectiveFrom: '2027-01-01',
      amount: 35_000,
    });
    expect(later.body.fee).toMatchObject({
      currentAmount: { amount: 30_000 },
      amounts: [
        { effectiveFrom: '2027-01-01', amount: 35_000 },
        { effectiveFrom: '2026-11-16', amount: 30_000 },
      ],
    });
    const repeated = await call('POST', `/v1/fees/${meter.id}/amounts`, 'tesorero', {
      effectiveFrom: '2027-01-01',
      amount: 36_000,
    });
    expect(repeated.body.error.code).toBe('INVALID_STATE');
  });

  it('refuses an amount for past dates or one that would change existing charges', async () => {
    const [meter] = await ctx.owner.select().from(fee).where(eq(fee.name, 'Cambio de medidor'));
    const past = await call('POST', `/v1/fees/${meter?.id}/amounts`, 'tesorero', {
      effectiveFrom: '2026-11-15',
      amount: 31_000,
    });
    expect(past).toMatchObject({ status: 400, body: { error: { code: 'VALIDATION_ERROR' } } });

    // A charge dated 2026-12-01 would be priced differently by an amount from 2026-12-01.
    await ctx.owner.insert(extraCharge).values({
      feeId: meter?.id ?? 0,
      unitId: await unitId('Planta alta'),
      chargedOn: '2026-12-01',
      createdBy: await ctx.accountId('tesorero'),
    });
    const res = await call('POST', `/v1/fees/${meter?.id}/amounts`, 'tesorero', {
      effectiveFrom: '2026-12-01',
      amount: 32_000,
    });
    expect(res).toMatchObject({ status: 409, body: { error: { code: 'INVALID_STATE' } } });
  });

  it.each(['presidente', 'secretario', 'vocal', 'jm.s1m01'])(
    'only the treasurer manages fees (%s gets 403)',
    async (username) => {
      expect(
        (await call('POST', '/v1/fees', username, { type: 'other', name: 'X' })).body.error.code,
      ).toBe('FORBIDDEN');
      expect(
        (
          await call('POST', '/v1/fees/1/amounts', username, {
            effectiveFrom: '2027-01-01',
            amount: 100,
          })
        ).body.error.code,
      ).toBe('FORBIDDEN');
    },
  );
});
