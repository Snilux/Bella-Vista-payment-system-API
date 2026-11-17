import { randomUUID } from 'node:crypto';
import { leaderSubstitutionResponseSchema } from '@bella-vista/shared';
import { eq, sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  connection,
  person,
  unit,
  unitHolder,
  userAccount,
  vBlock,
} from '../../../src/db/schema/index.js';
import { testDatabaseUrl } from '../db/helpers.js';
import { useApiTestApp } from './fixture.js';

// API step 8, block leader substitution (D-08, pending since API step 3): the counted
// extraordinary closing of the block cashbox is the handover record; the outgoing leader's
// assignment ends and their account is deactivated, and the new leader is registered pending
// the president's approval. The clock starts on 2026-11-16 (Mexico City). Cases run in order.

const DAY_1 = new Date('2026-11-16T18:00:00Z');
const DAY_2 = new Date('2026-11-17T18:00:00Z');

describe.skipIf(!testDatabaseUrl)('block leader substitution', () => {
  const ctx = useApiTestApp();

  beforeAll(async () => {
    ctx.setNow(DAY_1);
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
  const blockId = async (code: string) => {
    const [row] = await ctx.owner
      .select({ id: vBlock.id })
      .from(vBlock)
      .where(eq(vBlock.code, code));
    return row?.id ?? 0;
  };
  let newLeader: number;
  const substitute = async (body: Record<string, unknown>, username = 'secretario') =>
    call('POST', `/v1/blocks/${await blockId('S1-M02')}/leader-substitution`, username, {
      personId: newLeader,
      contactPhone: '5551234567',
      startDate: '2026-11-17',
      reason: 'El jefe se mudó de la colonia',
      ...body,
    });
  const countedClosing = async () => {
    const opened = await call('POST', '/v1/closings', 'jm.s1m02', { type: 'extraordinary' });
    const id = opened.body.closing.id as number;
    await call('POST', `/v1/closings/${id}/count`, 'jm.s1m02', {
      countedCash: opened.body.closing.figures.expectedBalance,
    });
    return { id, expected: opened.body.closing.figures.expectedBalance as number };
  };

  it('requires an extraordinary closing of the block cashbox, counted', async () => {
    newLeader = (
      await call('POST', '/v1/people', 'secretario', {
        givenNames: 'Mariana',
        paternalSurname: 'Relevo',
      })
    ).body.person.id;

    // Day 1: the new leader would start today.
    const today = { startDate: '2026-11-16' };
    expect((await substitute({ closingId: 999_999, ...today })).body.error.code).toBe('NOT_FOUND');
    const monthly = await call('POST', '/v1/closings', 'jm.s1m02', {
      type: 'monthly',
      period: '2026-10',
    });
    expect(
      (await substitute({ closingId: monthly.body.closing.id, ...today })).body.error,
    ).toMatchObject({
      code: 'INVALID_STATE',
      message: 'El acta de entrega debe ser un corte extraordinario de la caja de esta manzana.',
    });
    const other = await call('POST', '/v1/closings', 'jm.s1m01', { type: 'extraordinary' });
    expect((await substitute({ closingId: other.body.closing.id, ...today })).body.error.code).toBe(
      'INVALID_STATE',
    );
    const draft = await call('POST', '/v1/closings', 'jm.s1m02', { type: 'extraordinary' });
    expect(
      (await substitute({ closingId: draft.body.closing.id, ...today })).body.error.message,
    ).toBe('El corte extraordinario aún no tiene el conteo del efectivo.');
  });

  it('refuses a closing with cash movements after it', async () => {
    const stale = await countedClosing();
    // Next day the leader collects: the counted closing no longer reflects the cash.
    ctx.setNow(DAY_2);
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
        reference: 'Relevo',
        registeredOn: '2026-11-01',
        activatedOn: '2026-11-01',
        billingStartPeriod: '2026-11-01',
        createdBy,
      })
      .returning();
    await ctx.owner.insert(unitHolder).values({
      unitId: target?.id ?? 0,
      personId: holder?.id ?? 0,
      validFrom: '2026-11-01',
      createdBy,
    });
    const paid = await call(
      'POST',
      '/v1/payments',
      'jm.s1m02',
      { unitId: target?.id, periods: ['2026-11'], paperFolio: 'REL-1', expectedTotal: 5_000 },
      randomUUID(),
    );
    expect(paid.status).toBe(201);
    expect((await substitute({ closingId: stale.id })).body.error.message).toBe(
      'La caja tuvo movimientos después del corte; haga un corte extraordinario nuevo.',
    );
  });

  let substitution: { outgoing: { id: number }; incoming: { id: number }; expected: number };

  it('validates the new leader and the start date', async () => {
    const record = await countedClosing();
    const [leader] = await ctx.owner
      .select({ personId: vBlock.leaderPersonId })
      .from(vBlock)
      .where(eq(vBlock.code, 'S1-M02'));
    expect(
      (await substitute({ closingId: record.id, personId: leader?.personId })).body.error.details
        .issues[0].message,
    ).toBe('El nuevo jefe debe ser otra persona.');
    expect(
      (await substitute({ closingId: record.id, startDate: '2026-11-16' })).body.error.details
        .issues[0].message,
    ).toBe('El nuevo jefe no puede empezar antes de la fecha del acta de entrega.');
    expect((await substitute({ closingId: record.id, startDate: '2026-11-18' })).status).toBe(400);
  });

  it('ends the outgoing leader and registers the new one pending approval (D-08)', async () => {
    const record = await countedClosing();
    const res = await substitute({ closingId: record.id });
    expect(res.status).toBe(200);
    expect(leaderSubstitutionResponseSchema.safeParse(res.body).success).toBe(true);
    expect(res.body.outgoing).toMatchObject({ role: 'block_leader', endDate: '2026-11-17' });
    expect(res.body.incoming).toMatchObject({
      role: 'block_leader',
      person: { id: newLeader },
      startDate: '2026-11-17',
      status: 'pending',
    });
    substitution = { ...res.body, expected: record.expected };

    // The outgoing account is deactivated at once.
    const outgoing = await call('GET', '/v1/cashboxes/mine', 'jm.s1m02');
    expect(outgoing).toMatchObject({ status: 401, body: { error: { code: 'ACCOUNT_DISABLED' } } });
    // A second substitution finds no current leader.
    expect((await substitute({ closingId: record.id })).body.error.code).toBe('INVALID_STATE');
  });

  it('once approved, the new leader receives the cashbox with the counted balance', async () => {
    const inbox = await call('GET', '/v1/approvals?status=pending', 'presidente');
    const approval = inbox.body.approvals.find(
      (a: { type: string; description: string | null }) =>
        a.type === 'role_assignment' && a.description?.includes('Relevo'),
    );
    expect(
      (
        await call('POST', `/v1/approvals/${approval.id}/resolve`, 'presidente', {
          result: 'approved',
        })
      ).status,
    ).toBe(200);
    const account = await call('POST', '/v1/accounts', 'admin', {
      roleAssignmentId: substitution.incoming.id,
      username: 'jm.s1m02.nueva',
    });
    expect(account.status).toBe(201);
    await ctx.owner
      .update(userAccount)
      .set({ mustChangePassword: false })
      .where(eq(userAccount.username, 'jm.s1m02.nueva'));
    const mine = await call('GET', '/v1/cashboxes/mine', 'jm.s1m02.nueva');
    expect(mine.body.cashbox).toMatchObject({
      cashbox: { label: 'S1-M02' },
      balance: substitution.expected,
    });
  });

  it.each(['presidente', 'tesorero', 'vocal', 'jm.s1m01', 'admin'])(
    'only the secretary substitutes a leader (%s gets 403)',
    async (username) => {
      expect((await substitute({ closingId: 1 }, username)).body.error.code).toBe('FORBIDDEN');
    },
  );
});
