import { randomUUID } from 'node:crypto';
import {
  cashboxListResponseSchema,
  cashboxMovementPageSchema,
  handoverResponseSchema,
  myCashboxResponseSchema,
} from '@bella-vista/shared';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  cashbox,
  closing,
  userAccount,
  vBlock,
  vCashboxBalance,
} from '../../../src/db/schema/index.js';
import { testDatabaseUrl } from '../db/helpers.js';
import { useApiTestApp } from './fixture.js';

// API step 7, cashboxes module: the custodian's cashbox and its movements, opening balances
// approved by the president (D-18), handovers to the committee cashbox (D-16) and adjustments
// of their differences. The clock is fixed on 2026-11-16 (Mexico City); the block cashboxes of
// the development data hold the payments of the seed. Cases run in order.

const NOW = new Date('2026-11-16T18:00:00Z');

describe.skipIf(!testDatabaseUrl)('cashboxes', () => {
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
      ...(result === 'rejected' && { reason: 'No cuadra con el acta' }),
    });
  const mine = async (username: string) =>
    (await call('GET', '/v1/cashboxes/mine', username)).body.cashbox;
  const blockBox = async (code: string) => {
    const [row] = await ctx.owner
      .select({ id: cashbox.id })
      .from(cashbox)
      .innerJoin(vBlock, eq(vBlock.id, cashbox.blockId))
      .where(eq(vBlock.code, code));
    if (!row) throw new Error(`no cashbox for ${code}`);
    return row.id;
  };
  const committeeBox = async () => {
    const [row] = await ctx.owner
      .select({ id: cashbox.id })
      .from(cashbox)
      .where(eq(cashbox.type, 'committee'));
    return row?.id ?? 0;
  };
  const balanceOf = async (id: number) => {
    const [row] = await ctx.owner
      .select({ balance: vCashboxBalance.balance })
      .from(vCashboxBalance)
      .where(eq(vCashboxBalance.cashboxId, id));
    return row?.balance ?? 0;
  };

  // --- My cashbox and movements ---------------------------------------------------------------

  it('shows each custodian their cashbox with its summary (RF-CAJ-07)', async () => {
    const leader = await call('GET', '/v1/cashboxes/mine', 'jm.s1m01');
    expect(leader.status).toBe(200);
    expect(myCashboxResponseSchema.safeParse(leader.body).success).toBe(true);
    const box = leader.body.cashbox;
    expect(box.cashbox).toEqual({ id: await blockBox('S1-M01'), type: 'block', label: 'S1-M01' });
    expect(box.balance).toBeGreaterThan(0);
    expect(box).toMatchObject({
      collected: box.balance,
      handedOver: 0,
      pendingHandover: 0,
      available: box.balance,
      openingBalance: null,
    });

    expect(await mine('tesorero')).toMatchObject({
      cashbox: { id: await committeeBox(), type: 'committee', label: 'Comité' },
      balance: 0,
    });
    expect(await mine('presidente')).toMatchObject({
      cashbox: { id: null, type: 'support', label: 'Apoyo · Ana Salinas' },
      balance: 0,
    });
  });

  it.each(['secretario', 'vocal'])('%s holds no cash: /mine is forbidden', async (username) => {
    expect((await call('GET', '/v1/cashboxes/mine', username)).body.error.code).toBe('FORBIDDEN');
  });

  it('lists the movements of a cashbox by scope, newest first and paged', async () => {
    const own = await blockBox('S1-M01');
    const res = await call('GET', `/v1/cashboxes/${own}/movements?limit=2`, 'jm.s1m01');
    expect(res.status).toBe(200);
    expect(cashboxMovementPageSchema.safeParse(res.body).success).toBe(true);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0]).toMatchObject({ kind: 'payment', tableName: 'payment' });
    // Read-only aggregates of G-09: the folio and the family of each payment.
    expect(res.body.data[0].folio).toMatch(/^PG-/);
    expect(res.body.data[0].detail).toEqual(expect.stringMatching(/\S/));
    expect(res.body.next).toBe('2');
    const second = await call('GET', `/v1/cashboxes/${own}/movements?limit=2&cursor=2`, 'jm.s1m01');
    expect(second.body.data[0]).not.toEqual(res.body.data[0]);

    expect((await call('GET', `/v1/cashboxes/${own}/movements`, 'jm.s1m02')).body.error.code).toBe(
      'OUT_OF_SCOPE',
    );
    expect(
      (await call('GET', `/v1/cashboxes/${await committeeBox()}/movements`, 'jm.s1m01')).body.error
        .code,
    ).toBe('OUT_OF_SCOPE');
    expect((await call('GET', `/v1/cashboxes/${own}/movements`, 'vocal')).status).toBe(200);
    expect((await call('GET', '/v1/cashboxes/999999/movements', 'tesorero')).body.error.code).toBe(
      'NOT_FOUND',
    );
  });

  it('lists every cashbox with its balance to the committee only', async () => {
    const res = await call('GET', '/v1/cashboxes', 'secretario');
    expect(res.body.cashboxes).toContainEqual(
      expect.objectContaining({ type: 'committee', label: 'Comité', balance: 0 }),
    );
    expect((await call('GET', '/v1/cashboxes', 'jm.s1m01')).body.error.code).toBe('FORBIDDEN');
    // T-12: no cashbox has an opening balance yet.
    expect(cashboxListResponseSchema.safeParse(res.body).success).toBe(true);
    expect(
      res.body.cashboxes.every((c: { openingBalance: unknown }) => c.openingBalance === null),
    ).toBe(true);
  });

  it('a block created through the API has its cashbox from the start', async () => {
    const [section] = await ctx.owner.select({ sectionId: vBlock.sectionId }).from(vBlock).limit(1);
    const res = await call('POST', '/v1/blocks', 'secretario', {
      sectionId: section?.sectionId,
      code: 'M77',
    });
    expect(res.status).toBe(201);
    const boxes = await ctx.owner
      .select()
      .from(cashbox)
      .where(eq(cashbox.blockId, res.body.block.id));
    expect(boxes).toHaveLength(1);
  });

  // --- Opening balance (D-18) -----------------------------------------------------------------

  it('registers an opening balance pending approval; one open per cashbox', async () => {
    const box = await committeeBox();
    const res = await post(`/v1/cashboxes/${box}/opening-balance`, 'tesorero', {
      amount: 400_000,
      date: '2026-11-01',
      reason: 'Conteo de la caja del comité al arrancar',
    });
    expect(res).toMatchObject({
      status: 201,
      body: { openingBalance: { cashboxId: box, amount: 400_000, status: 'pending' } },
    });
    const inbox = await call('GET', '/v1/approvals?status=pending', 'presidente');
    expect(inbox.body.approvals).toContainEqual(
      expect.objectContaining({
        id: res.body.openingBalance.approvalId,
        description: 'Saldo inicial de $4,000.00 en Comité',
        subject: { type: 'cashbox', id: box },
      }),
    );
    const second = await post(`/v1/cashboxes/${box}/opening-balance`, 'tesorero', {
      amount: 300_000,
      date: '2026-11-01',
      reason: 'Otra vez',
    });
    expect(second).toMatchObject({ status: 409, body: { error: { code: 'INVALID_STATE' } } });

    // Rejected: the cashbox is free for a new request.
    await resolve(res.body.openingBalance.approvalId, 'rejected');
    expect(await balanceOf(box)).toBe(0);
    const again = await post(`/v1/cashboxes/${box}/opening-balance`, 'tesorero', {
      amount: 350_000,
      date: '2026-11-01',
      reason: 'Conteo corregido',
    });
    expect(again.status).toBe(201);
    await resolve(again.body.openingBalance.approvalId, 'approved');
    expect(await mine('tesorero')).toMatchObject({
      balance: 350_000,
      openingBalance: { amount: 350_000, status: 'approved' },
    });
  });

  it('lists each cashbox with its current opening balance (T-12)', async () => {
    const block = await blockBox('S1-M02');
    const pending = await post(`/v1/cashboxes/${block}/opening-balance`, 'tesorero', {
      amount: 50_000,
      date: '2026-11-01',
      reason: 'Conteo de la manzana',
    });
    expect(pending.status).toBe(201);
    const list = (await call('GET', '/v1/cashboxes', 'tesorero')).body.cashboxes;
    const of = (id: number) => list.find((c: { id: number }) => c.id === id)?.openingBalance;
    // The approved one wins over the rejected one of the committee.
    expect(of(await committeeBox())).toMatchObject({ amount: 350_000, status: 'approved' });
    expect(of(block)).toMatchObject({ amount: 50_000, status: 'pending' });
    expect(of(await blockBox('S2-M01'))).toBeNull();
    await resolve(pending.body.openingBalance.approvalId, 'rejected');
  });

  it('validates the opening balance', async () => {
    const box = await blockBox('S2-M02');
    const future = await post(`/v1/cashboxes/${box}/opening-balance`, 'tesorero', {
      amount: 1_000,
      date: '2026-11-17',
      reason: 'x',
    });
    expect(future.body.error.code).toBe('VALIDATION_ERROR');
    const missing = await post('/v1/cashboxes/999999/opening-balance', 'tesorero', {
      amount: 1_000,
      date: '2026-11-01',
      reason: 'x',
    });
    expect(missing.body.error.code).toBe('NOT_FOUND');
  });

  // --- Handovers (D-16) -----------------------------------------------------------------------

  let shortfall: { id: number };

  it('prepares a handover up to what is available; pending ones count (RF-CAJ-04)', async () => {
    const available = (await mine('jm.s1m01')).available;
    const tooMuch = await post('/v1/handovers', 'jm.s1m01', { declaredAmount: available + 1 });
    expect(tooMuch).toMatchObject({
      status: 422,
      body: { error: { code: 'INSUFFICIENT_BALANCE', details: { available } } },
    });

    const key = randomUUID();
    const first = await post('/v1/handovers', 'jm.s1m01', { declaredAmount: 10_000 }, key);
    expect(first.status).toBe(201);
    expect(handoverResponseSchema.safeParse(first.body).success).toBe(true);
    expect(first.body.handover).toMatchObject({
      folio: expect.stringMatching(/^EN-\d{6}-\d{6}$/),
      cashbox: { label: 'S1-M01' },
      declaredAmount: 10_000,
      status: 'pending',
      preparedBy: { username: 'jm.s1m01' },
    });
    const replay = await post('/v1/handovers', 'jm.s1m01', { declaredAmount: 10_000 }, key);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect(replay.body.handover.id).toBe(first.body.handover.id);

    expect(await mine('jm.s1m01')).toMatchObject({
      pendingHandover: 10_000,
      available: available - 10_000,
    });
    const overPending = await post('/v1/handovers', 'jm.s1m01', {
      declaredAmount: available - 10_000 + 1,
    });
    expect(overPending.body.error.code).toBe('INSUFFICIENT_BALANCE');

    // Only who prepared it withdraws it, and only while pending.
    const id = first.body.handover.id;
    expect((await call('POST', `/v1/handovers/${id}/withdraw`, 'jm.s1m02')).body.error.code).toBe(
      'OUT_OF_SCOPE',
    );
    const withdrawn = await call('POST', `/v1/handovers/${id}/withdraw`, 'jm.s1m01');
    expect(withdrawn.body.handover.status).toBe('withdrawn');
    expect((await call('POST', `/v1/handovers/${id}/withdraw`, 'jm.s1m01')).body.error.code).toBe(
      'INVALID_STATE',
    );
    expect(
      (await post(`/v1/handovers/${id}/confirm`, 'tesorero', { receivedAmount: 10_000 })).body.error
        .code,
    ).toBe('INVALID_STATE');
    expect((await mine('jm.s1m01')).pendingHandover).toBe(0);
  });

  it('confirms with the amount received; the shortfall stays in the block cashbox', async () => {
    const source = await blockBox('S1-M01');
    const committee = await committeeBox();
    const [sourceBefore, committeeBefore] = [await balanceOf(source), await balanceOf(committee)];
    const prepared = await post('/v1/handovers', 'jm.s1m01', {
      declaredAmount: 20_000,
      notes: 'Cobros de octubre',
    });
    const id = prepared.body.handover.id;

    const over = await post(`/v1/handovers/${id}/confirm`, 'tesorero', { receivedAmount: 20_001 });
    expect(over.body.error.code).toBe('VALIDATION_ERROR');
    const confirmed = await post(`/v1/handovers/${id}/confirm`, 'tesorero', {
      receivedAmount: 15_000,
    });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.handover).toMatchObject({
      status: 'with_difference',
      receivedAmount: 15_000,
      difference: 5_000,
      confirmedBy: { username: 'tesorero' },
    });
    // T-02: who prepared it, by name.
    expect(confirmed.body.handover.preparedBy).toMatchObject({
      username: 'jm.s1m01',
      fullName: expect.stringMatching(/\S+ \S+/),
    });
    // G-09 of the committee: the handover with its folio and the source block.
    const moves = await call('GET', `/v1/cashboxes/${committee}/movements`, 'tesorero');
    expect(moves.body.data).toContainEqual(
      expect.objectContaining({
        kind: 'handover_in',
        amount: 15_000,
        folio: prepared.body.handover.folio,
        detail: 'S1-M01',
      }),
    );
    expect(await balanceOf(source)).toBe(sourceBefore - 15_000);
    expect(await balanceOf(committee)).toBe(committeeBefore + 15_000);
    expect((await mine('jm.s1m01')).handedOver).toBe(15_000);
    expect(
      (await post(`/v1/handovers/${id}/confirm`, 'tesorero', { receivedAmount: 20_000 })).body.error
        .code,
    ).toBe('INVALID_STATE');
    shortfall = { id };
  });

  it('shows handovers by scope', async () => {
    const own = await call('GET', '/v1/handovers', 'jm.s1m01');
    expect(own.body.data.length).toBeGreaterThanOrEqual(2);
    expect((await call('GET', '/v1/handovers', 'jm.s1m02')).body.data).toEqual([]);
    expect((await call('GET', `/v1/handovers/${shortfall.id}`, 'jm.s1m02')).body.error.code).toBe(
      'OUT_OF_SCOPE',
    );
    // The president sees another cashbox's handover only once an adjustment is requested.
    expect((await call('GET', `/v1/handovers/${shortfall.id}`, 'presidente')).status).toBe(404);
    const all = await call('GET', '/v1/handovers?status=with_difference', 'vocal');
    expect(all.body.data.map((h: { id: number }) => h.id)).toEqual([shortfall.id]);
    expect((await call('GET', '/v1/handovers', 'secretario')).body.error.code).toBe('FORBIDDEN');
  });

  it('a block leader never receives names, folios or balances of another block', async () => {
    const own = await blockBox('S1-M01');
    const other = await blockBox('S1-M02');
    // Handovers: only those of its own cashbox.
    const handovers = (await call('GET', '/v1/handovers', 'jm.s1m01')).body.data;
    expect(handovers.every((h: { cashbox: { id: number } }) => h.cashbox.id === own)).toBe(true);
    // Movements (with their folios and families): only its own cashbox.
    const otherMoves = await call('GET', `/v1/cashboxes/${other}/movements`, 'jm.s1m01');
    expect(otherMoves.body.error.code).toBe('OUT_OF_SCOPE');
    // The list of every cashbox, with balances and opening balances: committee only.
    expect((await call('GET', '/v1/cashboxes', 'jm.s1m01')).status).toBe(403);
  });

  // --- Adjustments ----------------------------------------------------------------------------

  it('an approved adjustment settles the shortfall of a handover (RF-CAJ-06)', async () => {
    const source = await blockBox('S1-M01');
    const before = await balanceOf(source);
    const res = await post('/v1/adjustments', 'tesorero', {
      handoverId: shortfall.id,
      amount: -5_000,
      reason: 'Billete falso detectado en el conteo',
    });
    expect(res).toMatchObject({
      status: 201,
      body: { adjustment: { handoverId: shortfall.id, amount: -5_000, status: 'pending' } },
    });
    const again = await post('/v1/adjustments', 'tesorero', {
      handoverId: shortfall.id,
      amount: -5_000,
      reason: 'Otra',
    });
    expect(again.body.error.code).toBe('INVALID_STATE');
    const inbox = await call('GET', '/v1/approvals?status=pending', 'presidente');
    expect(
      inbox.body.approvals.find((a: { id: number }) => a.id === res.body.adjustment.approvalId)
        ?.description,
    ).toMatch(/^Aclaración de -\$50\.00 en la entrega EN-\d{6}-\d{6}$/);
    // R-03: the president opens the handover the adjustment is about (not of their cashbox).
    const seen = await call('GET', `/v1/handovers/${shortfall.id}`, 'presidente');
    expect(seen.body.handover).toMatchObject({ id: shortfall.id, difference: 5_000 });

    await resolve(res.body.adjustment.approvalId, 'approved');
    expect(await balanceOf(source)).toBe(before - 5_000);
    const handover = await call('GET', `/v1/handovers/${shortfall.id}`, 'tesorero');
    expect(handover.body.handover).toMatchObject({ status: 'adjusted', adjustedAmount: -5_000 });
  });

  it('refuses an adjustment of a handover without difference', async () => {
    const prepared = await post('/v1/handovers', 'jm.s1m02', { declaredAmount: 1_000 });
    const id = prepared.body.handover.id;
    await post(`/v1/handovers/${id}/confirm`, 'tesorero', { receivedAmount: 1_000 });
    const res = await post('/v1/adjustments', 'tesorero', {
      handoverId: id,
      amount: 100,
      reason: 'x',
    });
    expect(res).toMatchObject({
      status: 409,
      body: {
        error: {
          code: 'INVALID_STATE',
          message: 'La entrega se confirmó sin diferencia; no hay nada que aclarar.',
        },
      },
    });
  });

  // --- Permissions ----------------------------------------------------------------------------

  it.each(['presidente', 'secretario', 'vocal', 'jm.s1m01', 'admin'])(
    'only the treasurer captures opening balances, confirms and proposes adjustments (%s gets 403)',
    async (username) => {
      const box = await committeeBox();
      for (const [url, body] of [
        [`/v1/cashboxes/${box}/opening-balance`, { amount: 1, date: '2026-11-01', reason: 'x' }],
        [`/v1/handovers/${shortfall.id}/confirm`, { receivedAmount: 1 }],
        ['/v1/adjustments', { handoverId: shortfall.id, amount: 1, reason: 'x' }],
      ] as const) {
        expect((await post(url, username, body)).body.error.code).toBe('FORBIDDEN');
      }
    },
  );

  it.each(['tesorero', 'secretario', 'vocal', 'admin'])(
    '%s cannot prepare or withdraw handovers (403)',
    async (username) => {
      expect((await post('/v1/handovers', username, { declaredAmount: 1 })).body.error.code).toBe(
        'FORBIDDEN',
      );
      expect(
        (await call('POST', `/v1/handovers/${shortfall.id}/withdraw`, username)).body.error.code,
      ).toBe('FORBIDDEN');
    },
  );

  it('the superadmin sees no cashbox (403)', async () => {
    expect((await call('GET', '/v1/cashboxes/mine', 'admin')).body.error.code).toBe('FORBIDDEN');
    expect((await call('GET', '/v1/handovers', 'admin')).body.error.code).toBe('FORBIDDEN');
  });

  // --- Closed period (D-14) -------------------------------------------------------------------

  it('refuses to confirm a handover in a month with a closed closing (PERIOD_CLOSED)', async () => {
    const prepared = await post('/v1/handovers', 'jm.s1m02', { declaredAmount: 1_000 });
    const president = await ctx.accountId('presidente');
    await ctx.owner.insert(closing).values({
      cashboxId: await committeeBox(),
      type: 'monthly',
      dateFrom: '2026-11-01',
      dateTo: '2026-11-30',
      countedCash: 0,
      reviewedBy: president,
      reviewedAt: NOW,
      closedBy: president,
      closedAt: NOW,
      createdBy: await ctx.accountId('tesorero'),
    });
    const res = await post(`/v1/handovers/${prepared.body.handover.id}/confirm`, 'tesorero', {
      receivedAmount: 1_000,
    });
    expect(res).toMatchObject({ status: 409, body: { error: { code: 'PERIOD_CLOSED' } } });
  });
});
