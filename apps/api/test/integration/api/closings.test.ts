import { randomUUID } from 'node:crypto';
import { closingResponseSchema } from '@bella-vista/shared';
import { and, eq, lte, sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  cashbox,
  connection,
  person,
  unit,
  unitHolder,
  userAccount,
  vBlock,
  vCashboxMovement,
} from '../../../src/db/schema/index.js';
import { testDatabaseUrl } from '../db/helpers.js';
import { useApiTestApp } from './fixture.js';

// API step 8, closings: monthly closings of finished months closed in order, the count with
// notes when there is a difference, review and close by the president or a member, the month
// locked once closed (D-14), extraordinary closings and closing adjustments. The clock is fixed
// on 2026-11-16 (Mexico City); the committee cashbox of the development data starts empty and
// gets backdated incomes here. Cases run in order.

const NOW = new Date('2026-11-16T18:00:00Z');

describe.skipIf(!testDatabaseUrl)('closings', () => {
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
    return { status: res.statusCode, body: res.json() };
  };
  const post = (url: string, username: string, payload: Record<string, unknown> = {}) =>
    call('POST', url, username, payload, randomUUID());
  const income = (date: string, amount: number) =>
    post('/v1/incomes', 'tesorero', { concept: 'Cooperación', amount, date });
  const committeeBox = async () => {
    const [row] = await ctx.owner
      .select({ id: cashbox.id })
      .from(cashbox)
      .where(eq(cashbox.type, 'committee'));
    return row?.id ?? 0;
  };
  const blockBox = async (code: string) => {
    const [row] = await ctx.owner
      .select({ id: cashbox.id })
      .from(cashbox)
      .innerJoin(vBlock, eq(vBlock.id, cashbox.blockId))
      .where(eq(vBlock.code, code));
    return row?.id ?? 0;
  };
  const balanceUntil = async (cashboxId: number, date: string) => {
    const [row] = await ctx.owner
      .select({ total: sql<number>`coalesce(sum(${vCashboxMovement.amount}), 0)`.mapWith(Number) })
      .from(vCashboxMovement)
      .where(
        and(eq(vCashboxMovement.cashboxId, cashboxId), lte(vCashboxMovement.occurredOn, date)),
      );
    return row?.total ?? 0;
  };
  const open = (username: string, body: Record<string, unknown>) =>
    call('POST', '/v1/closings', username, body);

  let september: number;
  let october: number;

  // --- Monthly closings -----------------------------------------------------------------------

  it('opens a monthly closing of a finished month with the figures of its movements', async () => {
    expect((await income('2026-09-10', 120_000)).status).toBe(201);
    expect((await income('2026-10-05', 80_000)).status).toBe(201);
    // J-01, J-05, T-13: the month of the first movement is the next to close.
    const mine = async () => (await call('GET', '/v1/cashboxes/mine', 'tesorero')).body.cashbox;
    expect((await mine()).nextClosingPeriod).toBe('2026-09');

    const res = await open('tesorero', { type: 'monthly', period: '2026-09' });
    expect(res.status).toBe(201);
    expect(closingResponseSchema.safeParse(res.body).success).toBe(true);
    expect(res.body.closing).toMatchObject({
      folio: expect.stringMatching(/^CO-\d{6}-\d{6}$/),
      cashbox: { id: await committeeBox(), label: 'Comité' },
      type: 'monthly',
      dateFrom: '2026-09-01',
      dateTo: '2026-09-30',
      status: 'draft',
      figures: { startingBalance: 0, incomes: 120_000, expectedBalance: 120_000 },
      countedCash: null,
      difference: null,
      preparedBy: { username: 'tesorero' },
    });
    expect(res.body.closing.figures.expectedBalance).toBe(
      await balanceUntil(await committeeBox(), '2026-09-30'),
    );
    september = res.body.closing.id;

    const oct = await open('tesorero', { type: 'monthly', period: '2026-10' });
    expect(oct.body.closing.figures).toMatchObject({
      startingBalance: 120_000,
      incomes: 80_000,
      expectedBalance: 200_000,
    });
    october = oct.body.closing.id;
  });

  it('refuses the current month and a repeated closing', async () => {
    const current = await open('tesorero', { type: 'monthly', period: '2026-11' });
    expect(current.body.error).toMatchObject({ code: 'VALIDATION_ERROR' });
    const again = await open('tesorero', { type: 'monthly', period: '2026-09' });
    expect(again).toMatchObject({ status: 409, body: { error: { code: 'INVALID_STATE' } } });
  });

  it('counts: a difference needs notes, and only who prepared it counts', async () => {
    const noNotes = await call('POST', `/v1/closings/${september}/count`, 'tesorero', {
      countedCash: 119_500,
    });
    expect(noNotes).toMatchObject({
      status: 400,
      body: {
        error: {
          code: 'VALIDATION_ERROR',
          details: { issues: [{ path: 'body.notes', message: expect.stringContaining('-$5.00') }] },
        },
      },
    });
    expect(
      (await call('POST', `/v1/closings/${september}/count`, 'jm.s1m01', { countedCash: 1 })).body
        .error.code,
    ).toBe('OUT_OF_SCOPE');

    const counted = await call('POST', `/v1/closings/${september}/count`, 'tesorero', {
      countedCash: 119_500,
      notes: 'Faltan $5.00 en monedas',
    });
    expect(counted.body.closing).toMatchObject({
      status: 'counted',
      countedCash: 119_500,
      difference: -500,
      notes: 'Faltan $5.00 en monedas',
    });
    const exact = await call('POST', `/v1/closings/${october}/count`, 'tesorero', {
      countedCash: 199_500,
      notes: 'Arrastra el faltante de septiembre',
    });
    expect(exact.body.closing.status).toBe('counted');
  });

  it('reviews and closes in order; a closed month refuses movements (D-14)', async () => {
    expect(
      (await call('POST', `/v1/closings/${october}/close`, 'presidente')).body.error.code,
    ).toBe('INVALID_STATE');
    expect(
      (await call('POST', `/v1/closings/${october}/review`, 'vocal')).body.closing,
    ).toMatchObject({
      status: 'reviewed',
      reviewedBy: { username: 'vocal' },
    });
    const outOfOrder = await call('POST', `/v1/closings/${october}/close`, 'presidente');
    expect(outOfOrder.body.error).toMatchObject({
      code: 'INVALID_STATE',
      message: 'Primero hay que cerrar el corte de Septiembre 2026 de esta caja.',
    });

    await call('POST', `/v1/closings/${september}/review`, 'presidente');
    // The member reviews but never closes (M8): only the president locks the month.
    expect((await call('POST', `/v1/closings/${september}/close`, 'vocal')).body.error.code).toBe(
      'FORBIDDEN',
    );
    const closed = await call('POST', `/v1/closings/${september}/close`, 'presidente');
    expect(closed.body.closing).toMatchObject({
      status: 'closed',
      closedBy: { username: 'presidente' },
    });
    expect(closed.body.closing.preparedBy.fullName).toMatch(/\S+ \S+/);
    const next = async () =>
      (await call('GET', '/v1/cashboxes', 'presidente')).body.cashboxes.find(
        (item: { type: string }) => item.type === 'committee',
      ).nextClosingPeriod;
    expect(await next()).toBe('2026-10');
    expect(
      (await call('POST', `/v1/closings/${october}/close`, 'presidente')).body.closing.status,
    ).toBe('closed');

    // Closed: no count, no review, no movement in September or October.
    expect(
      (
        await call('POST', `/v1/closings/${september}/count`, 'tesorero', {
          countedCash: 1,
          notes: 'x',
        })
      ).body.error.code,
    ).toBe('INVALID_STATE');
    expect((await income('2026-10-20', 1_000)).body.error.code).toBe('PERIOD_CLOSED');
    // Earlier months without a closing are locked too (they would change the closed figures).
    expect((await income('2026-08-01', 1_000)).body.error.code).toBe('PERIOD_CLOSED');
    expect((await income('2026-11-01', 1_000)).status).toBe(201);
    // November has not ended: nothing to close yet.
    expect(
      (await call('GET', '/v1/cashboxes/mine', 'tesorero')).body.cashbox.nextClosingPeriod,
    ).toBeNull();
  });

  it('refuses payments and handover confirmations dated in a closed month', async () => {
    // A unit of S1-M02 billed from 2026-10, paid on 2026-10-25 by the treasurer (committee).
    const [conn] = await ctx.owner
      .select({ id: connection.id })
      .from(connection)
      .where(sql`${connection.address} LIKE 'Calle Juárez%'`);
    const [holder] = await ctx.owner.select({ id: person.id }).from(person).limit(1);
    const createdBy = await ctx.accountId('secretario');
    const [target] = await ctx.owner
      .insert(unit)
      .values({
        connectionId: conn?.id ?? 0,
        reference: 'Mes cerrado',
        registeredOn: '2026-01-10',
        activatedOn: '2026-01-10',
        billingStartPeriod: '2026-10-01',
        createdBy,
      })
      .returning();
    await ctx.owner.insert(unitHolder).values({
      unitId: target?.id ?? 0,
      personId: holder?.id ?? 0,
      validFrom: '2026-01-10',
      createdBy,
    });

    const handover = await post('/v1/handovers', 'jm.s1m02', { declaredAmount: 1_000 });
    ctx.setNow(new Date('2026-10-25T18:00:00Z'));
    const payment = await post('/v1/payments', 'tesorero', {
      unitId: target?.id,
      periods: ['2026-10'],
      paperFolio: 'CERRADO-1',
      expectedTotal: 5_000,
    });
    const confirm = await post(`/v1/handovers/${handover.body.handover.id}/confirm`, 'tesorero', {
      receivedAmount: 1_000,
    });
    ctx.setNow(NOW);
    expect(payment.body.error.code).toBe('PERIOD_CLOSED');
    expect(confirm.body.error.code).toBe('PERIOD_CLOSED');
  });

  // --- Block leaders --------------------------------------------------------------------------

  it('a block leader closes only their own cashbox; the committee sees all', async () => {
    const res = await open('jm.s1m01', { type: 'monthly', period: '2026-10' });
    expect(res.body.closing.cashbox).toMatchObject({
      id: await blockBox('S1-M01'),
      label: 'S1-M01',
    });
    const id = res.body.closing.id;
    expect((await call('GET', `/v1/closings/${id}`, 'jm.s1m02')).body.error.code).toBe(
      'OUT_OF_SCOPE',
    );
    expect(
      (
        await open('jm.s1m01', {
          type: 'monthly',
          period: '2026-08',
          cashboxId: await committeeBox(),
        })
      ).body.error.code,
    ).toBe('OUT_OF_SCOPE');
    expect((await call('GET', '/v1/closings', 'jm.s1m02')).body.data).toEqual([]);
    const leaderList = await call('GET', '/v1/closings', 'jm.s1m01');
    expect(leaderList.body.data.map((c: { id: number }) => c.id)).toEqual([id]);
    const all = await call('GET', '/v1/closings?period=2026-10', 'secretario');
    expect(all.body.data).toHaveLength(2);

    // The block cashbox has movements since 2025: closing October needs September closed.
    await call('POST', `/v1/closings/${id}/count`, 'jm.s1m01', {
      countedCash: res.body.closing.figures.expectedBalance,
    });
    await call('POST', `/v1/closings/${id}/review`, 'vocal');
    expect((await call('POST', `/v1/closings/${id}/close`, 'presidente')).body.error.code).toBe(
      'INVALID_STATE',
    );
  });

  it('opens an extraordinary closing up to today (handover record, D-08)', async () => {
    const res = await open('jm.s1m01', { type: 'extraordinary' });
    expect(res.body.closing).toMatchObject({
      type: 'extraordinary',
      dateFrom: '2026-11-01',
      dateTo: '2026-11-16',
    });
    const box = await blockBox('S1-M01');
    expect(res.body.closing.figures.expectedBalance).toBe(await balanceUntil(box, '2026-11-16'));
  });

  // --- Closing adjustments --------------------------------------------------------------------

  it('adjusts the difference of a closed closing in the open period', async () => {
    const res = await post('/v1/adjustments', 'tesorero', {
      closingId: september,
      amount: -500,
      reason: 'Faltante del corte de septiembre',
    });
    expect(res).toMatchObject({
      status: 201,
      body: {
        adjustment: { closingId: september, handoverId: null, amount: -500, date: '2026-11-16' },
      },
    });
    const inbox = await call('GET', '/v1/approvals?status=pending', 'presidente');
    expect(
      inbox.body.approvals.find((a: { id: number }) => a.id === res.body.adjustment.approvalId)
        ?.description,
    ).toMatch(/^Aclaración de -\$5\.00 en el corte CO-\d{6}-\d{6}$/);
    const both = await post('/v1/adjustments', 'tesorero', {
      closingId: september,
      handoverId: 1,
      amount: 1,
      reason: 'x',
    });
    expect(both.body.error.code).toBe('VALIDATION_ERROR');
    const draft = await open('tesorero', { type: 'extraordinary' });
    expect(
      (
        await post('/v1/adjustments', 'tesorero', {
          closingId: draft.body.closing.id,
          amount: 1,
          reason: 'x',
        })
      ).body.error.code,
    ).toBe('INVALID_STATE');
  });

  // --- Permissions ----------------------------------------------------------------------------

  it.each(['presidente', 'secretario', 'vocal', 'admin'])(
    '%s cannot open or count closings (403)',
    async (username) => {
      expect((await open(username, { type: 'extraordinary' })).body.error.code).toBe('FORBIDDEN');
      expect(
        (await call('POST', `/v1/closings/${october}/count`, username, { countedCash: 1 })).body
          .error.code,
      ).toBe('FORBIDDEN');
    },
  );

  it.each(['tesorero', 'secretario', 'jm.s1m01', 'admin'])(
    '%s cannot review or close closings (403)',
    async (username) => {
      for (const action of ['review', 'close']) {
        expect(
          (await call('POST', `/v1/closings/${october}/${action}`, username)).body.error.code,
        ).toBe('FORBIDDEN');
      }
    },
  );

  it('the superadmin does not read closings (403)', async () => {
    expect((await call('GET', '/v1/closings', 'admin')).body.error.code).toBe('FORBIDDEN');
  });
});
