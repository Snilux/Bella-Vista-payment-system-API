import { randomUUID } from 'node:crypto';
import { extraChargeListResponseSchema, extraChargeResponseSchema } from '@bella-vista/shared';
import { and, eq, sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  auditLog,
  connection,
  fee,
  feeAmount,
  person,
  unit,
  unitHolder,
  userAccount,
} from '../../../src/db/schema/index.js';
import { testDatabaseUrl } from '../db/helpers.js';
import { useApiTestApp } from './fixture.js';

// Extra charges (D-13, D-28): only the treasurer creates them (reconnection, repair, other) for
// a connection or a unit, with the amount of the fee in force on the charge date; the block
// leader sees them and collects them together with the months in a single payment; the
// treasurer cancels an unpaid one with its reason, in the audit log; nothing is deleted.

const NOW = new Date('2026-10-25T18:30:00Z');

describe.skipIf(!testDatabaseUrl)('extra charges', () => {
  const ctx = useApiTestApp();
  let unitId = 0;
  let connectionId = 0;
  let reconnectionId = 0;
  let repairId = 0;
  let openingId = 0;

  beforeAll(async () => {
    ctx.setNow(NOW);
    await ctx.owner
      .update(userAccount)
      .set({ mustChangePassword: false })
      .where(eq(userAccount.username, 'admin'));
    const fees = await ctx.owner.select({ id: fee.id, type: fee.type }).from(fee);
    reconnectionId = fees.find((f) => f.type === 'reconnection')?.id ?? 0;
    repairId = fees.find((f) => f.type === 'repair')?.id ?? 0;
    openingId = fees.find((f) => f.type === 'opening')?.id ?? 0;
    const treasurer = await ctx.accountId('tesorero');
    // $300.00 since January; $350.00 from November (a later amount does not change a charge).
    await ctx.owner.insert(feeAmount).values([
      { feeId: reconnectionId, effectiveFrom: '2026-01-01', amount: 30_000, createdBy: treasurer },
      { feeId: reconnectionId, effectiveFrom: '2026-11-01', amount: 35_000, createdBy: treasurer },
    ]);
    // A unit of S1-M01 billed from September: September overdue, October pending.
    const [conn] = await ctx.owner
      .select({ id: connection.id })
      .from(connection)
      .where(sql`${connection.address} LIKE ${'Av. Hidalgo%'}`);
    connectionId = conn?.id ?? 0;
    const [holder] = await ctx.owner.select({ id: person.id }).from(person).limit(1);
    const createdBy = await ctx.accountId('secretario');
    const [row] = await ctx.owner
      .insert(unit)
      .values({
        connectionId,
        reference: 'Cargos extraordinarios',
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
  const charge = (body: Record<string, unknown>, username = 'tesorero') =>
    call('POST', '/v1/extra-charges', username, body);
  const pending = (username = 'jm.s1m01') =>
    call('GET', `/v1/units/${unitId}/extra-charges`, username);

  let reconnection = 0;

  it('the treasurer charges a unit with the fee amount in force on the date (D-13)', async () => {
    const res = await charge({ feeId: reconnectionId, unitId, chargedOn: '2026-10-20' });
    expect(res.status).toBe(201);
    expect(extraChargeResponseSchema.safeParse(res.body).success).toBe(true);
    expect(res.body.charge).toMatchObject({
      fee: { id: reconnectionId, type: 'reconnection' },
      amount: 30_000,
      chargedOn: '2026-10-20',
      target: 'unit',
      unitId,
      status: 'pending',
      paymentId: null,
    });
    reconnection = res.body.charge.id;
    // Today by default.
    const today = await charge({ feeId: reconnectionId, connectionId });
    expect(today.body.charge).toMatchObject({ chargedOn: '2026-10-25', target: 'connection' });
    const [entry] = await ctx.owner
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.tableName, 'extra_charge'), eq(auditLog.recordId, reconnection)));
    expect(entry).toMatchObject({ action: 'create' });
  });

  it('refuses the opening, a fee without amount, a future date and a deactivated target', async () => {
    expect((await charge({ feeId: openingId, unitId })).body.error.details.issues[0].path).toBe(
      'body.feeId',
    );
    expect((await charge({ feeId: repairId, unitId })).body.error.code).toBe('FEE_WITHOUT_AMOUNT');
    expect((await charge({ feeId: reconnectionId, unitId, chargedOn: '2026-10-26' })).status).toBe(
      400,
    );
    expect((await charge({ feeId: reconnectionId })).status).toBe(400);
    expect((await charge({ feeId: reconnectionId, unitId, connectionId })).status).toBe(400);
    expect((await charge({ feeId: reconnectionId, unitId: 999_999 })).status).toBe(404);

    const [gone] = await ctx.owner
      .insert(unit)
      .values({
        connectionId,
        reference: 'Dada de baja',
        registeredOn: '2026-01-01',
        activatedOn: '2026-01-01',
        billingStartPeriod: '2026-01-01',
        deactivatedOn: '2026-03-01',
        createdBy: await ctx.accountId('secretario'),
      })
      .returning({ id: unit.id });
    expect((await charge({ feeId: reconnectionId, unitId: gone?.id })).body.error).toMatchObject({
      code: 'INVALID_STATE',
      details: { status: 'deactivated', action: 'charge' },
    });
  });

  it.each(['jm.s1m01', 'secretario', 'presidente', 'vocal', 'admin'])(
    'only the treasurer creates charges (D-28): %s gets FORBIDDEN',
    async (username) => {
      const res = await charge({ feeId: reconnectionId, unitId }, username);
      expect(res).toMatchObject({ status: 403, body: { error: { code: 'FORBIDDEN' } } });
    },
  );

  it('the leader of the block sees the pending charges of the unit and of its connection', async () => {
    const res = await pending();
    expect(res.status).toBe(200);
    expect(extraChargeListResponseSchema.safeParse(res.body).success).toBe(true);
    expect(res.body.charges.map((c: { target: string }) => c.target)).toEqual([
      'unit',
      'connection',
    ]);
    // Another block's leader does not.
    expect((await pending('jm.s2m01')).body.error.code).toBe('OUT_OF_SCOPE');
  });

  it('a charge is collected together with the months in a single payment', async () => {
    const body = { unitId, periods: ['2026-09', '2026-10'], extraChargeIds: [reconnection] };
    const preview = await call('POST', '/v1/payments/preview', 'jm.s1m01', body);
    expect(preview.body.preview.charges).toEqual([
      expect.objectContaining({ id: reconnection, feeType: 'reconnection', amount: 30_000 }),
    ]);
    const total = preview.body.preview.total;
    expect(total).toBe(5_000 + 5_000 + 30_000);
    const paid = await call(
      'POST',
      '/v1/payments',
      'jm.s1m01',
      { ...body, paperFolio: 'CARGO-1', expectedTotal: total },
      randomUUID(),
    );
    expect(paid.status).toBe(201);
    expect(paid.body.payment.months).toHaveLength(2);

    const all = await call('GET', `/v1/units/${unitId}/extra-charges?status=all`, 'tesorero');
    expect(all.body.charges.find((c: { id: number }) => c.id === reconnection)).toMatchObject({
      status: 'paid',
      paymentId: paid.body.payment.id,
    });
    expect((await pending()).body.charges.map((c: { id: number }) => c.id)).not.toContain(
      reconnection,
    );
  });

  it('the treasurer cancels an unpaid charge with its reason; a paid one is not cancelled', async () => {
    const paid = await call('POST', `/v1/extra-charges/${reconnection}/cancel`, 'tesorero', {
      reason: 'Error',
    });
    expect(paid.body.error).toMatchObject({ code: 'INVALID_STATE', details: { status: 'paid' } });

    const created = (await charge({ feeId: reconnectionId, unitId })).body.charge.id;
    expect(
      (await call('POST', `/v1/extra-charges/${created}/cancel`, 'tesorero', { reason: ' ' }))
        .status,
    ).toBe(400);
    expect(
      (await call('POST', `/v1/extra-charges/${created}/cancel`, 'jm.s1m01', { reason: 'X' }))
        .status,
    ).toBe(403);
    const res = await call('POST', `/v1/extra-charges/${created}/cancel`, 'tesorero', {
      reason: 'Se capturó en la familia equivocada',
    });
    expect(res.body.charge).toMatchObject({
      status: 'cancelled',
      cancelledOn: '2026-10-25',
      cancellationReason: 'Se capturó en la familia equivocada',
    });
    const [entry] = await ctx.owner
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.tableName, 'extra_charge'),
          eq(auditLog.recordId, created),
          eq(auditLog.action, 'cancel'),
        ),
      );
    expect(entry?.reason).toBe('Se capturó en la familia equivocada');
    // It stays (nothing is deleted), out of the pending ones.
    expect((await pending()).body.charges.map((c: { id: number }) => c.id)).not.toContain(created);
    const again = await call('POST', `/v1/extra-charges/${created}/cancel`, 'tesorero', {
      reason: 'Otra vez',
    });
    expect(again.body.error.details.status).toBe('cancelled');
  });
});
