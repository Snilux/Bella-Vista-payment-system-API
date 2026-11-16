import { accountStatementResponseSchema } from '@bella-vista/shared';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { connection, person, unit, userAccount } from '../../../src/db/schema/index.js';
import { testDatabaseUrl } from '../db/helpers.js';
import { useApiTestApp } from './fixture.js';

// API step 5: GET /v1/units/{id}/account-statement and the debt summary in person and
// connection details and in the search. The clock is fixed on 2026-11-16 (Mexico City), so
// with the development data: rates $40.00 (2025) and $50.00 (2026), month in course 2026-11.

const NOW = new Date('2026-11-16T18:00:00Z');

describe.skipIf(!testDatabaseUrl)('account statement and debts', () => {
  const ctx = useApiTestApp();

  beforeAll(async () => {
    ctx.setNow(NOW);
    await ctx.owner
      .update(userAccount)
      .set({ mustChangePassword: false })
      .where(eq(userAccount.username, 'admin'));
  });

  const call = async (url: string, username: string) => {
    const res = await ctx.app.inject({ method: 'GET', url, headers: await ctx.authFor(username) });
    return { status: res.statusCode, body: res.json() };
  };
  /** Unit by its reference, or the first unit of the connection at `address`. */
  const unitId = async (reference: string | null, address?: string) => {
    const rows = await ctx.owner
      .select({ id: unit.id, reference: unit.reference, address: connection.address })
      .from(unit)
      .innerJoin(connection, eq(connection.id, unit.connectionId))
      .orderBy(unit.id);
    const row = reference
      ? rows.find((u) => u.reference === reference)
      : rows.find((u) => u.address.startsWith(address ?? ''));
    if (!row) throw new Error(`no unit ${reference ?? address}`);
    return row.id;
  };
  const statementOf = async (id: number, username = 'tesorero') => {
    const res = await call(`/v1/units/${id}/account-statement`, username);
    expect(res.status).toBe(200);
    expect(accountStatementResponseSchema.safeParse(res.body).success).toBe(true);
    return res.body.statement;
  };
  const line = (m: { period: string; status: string; baseAmount: number; surcharge: number }) =>
    `${m.period} ${m.status} ${m.baseAmount}+${m.surcharge}`;

  it('shows a unit up to date: every month paid and the current one pending', async () => {
    const st = await statementOf(await unitId('Casa del frente'));
    expect(st.currentPeriod).toBe('2026-11');
    expect(st.months).toHaveLength(23); // 2025-01 .. 2026-11
    expect(st.months.at(-1)).toMatchObject({ period: '2026-11', status: 'pending', total: 5_000 });
    expect(st.months.filter((m: { status: string }) => m.status === 'paid')).toHaveLength(22);
    expect(st.summary).toMatchObject({ overdueCount: 0, inDebtCycle: false, totalDue: 5_000 });
  });

  it('keeps the debt cycle open with surcharge on every overdue month (Planta alta)', async () => {
    // Paid 2025-01..06 on 2025-06-08; 2025-07..2026-10 overdue (16 months), 2026-11 pending.
    const st = await statementOf(await unitId('Planta alta'));
    const overdue = st.months.filter((m: { status: string }) => m.status === 'overdue');
    expect(overdue).toHaveLength(16);
    expect(overdue.slice(0, 2).map(line)).toEqual([
      '2025-07 overdue 4000+4000',
      '2025-08 overdue 4000+4000',
    ]);
    expect(overdue.at(-1) && line(overdue.at(-1))).toBe('2026-10 overdue 5000+5000');
    expect(st.summary).toEqual({
      overdueCount: 16,
      pendingCount: 1,
      inDebtCycle: true,
      overdueTotal: 6 * 8_000 + 10 * 10_000,
      pendingTotal: 5_000,
      surchargeTotal: 6 * 4_000 + 10 * 5_000,
      totalDue: 6 * 8_000 + 10 * 10_000 + 5_000,
      advanceCount: 0,
    });
  });

  it('D-02 with real data: a partial payment did not close the cycle (Privada Las Flores)', async () => {
    // Cycle open since 2025-10; on 2026-02-15 it paid 2025-06..12 with surcharge, leaving
    // 2026-01 overdue, so the cycle stayed open and 2026-01..10 carry surcharge.
    const st = await statementOf(await unitId(null, 'Privada Las Flores'));
    expect(st.months.slice(0, 7).map(line)).toEqual(
      ['06', '07', '08', '09', '10', '11', '12'].map((m) => `2025-${m} paid 4000+4000`),
    );
    expect(st.summary).toMatchObject({
      overdueCount: 10,
      inDebtCycle: true,
      totalDue: 10 * 10_000 + 5_000,
    });
  });

  it('shows paid advances with their frozen rate (Calle Morelos)', async () => {
    const st = await statementOf(await unitId(null, 'Calle Morelos'), 'jm.s1m01');
    expect(st.months.slice(-2).map(line)).toEqual([
      '2026-11 paid 5000+0',
      '2026-12 advance 5000+0',
    ]);
    expect(st.summary).toMatchObject({ totalDue: 0, advanceCount: 1, pendingCount: 0 });
  });

  it('has no months for a unit pending activation', async () => {
    const st = await statementOf(await unitId(null, 'Camino Real'));
    expect(st.months).toEqual([]);
    expect(st.summary.totalDue).toBe(0);
  });

  it('keeps the statement of another block from a block leader', async () => {
    const id = await unitId('Planta alta');
    expect((await call(`/v1/units/${id}/account-statement`, 'jm.s1m02')).body.error.code).toBe(
      'OUT_OF_SCOPE',
    );
    expect((await call(`/v1/units/${id}/account-statement`, 'jm.s1m01')).status).toBe(200);
    expect((await call('/v1/units/999999/account-statement', 'tesorero')).body.error.code).toBe(
      'NOT_FOUND',
    );
  });

  it.each(['admin'])('is forbidden for %s', async (username) => {
    const id = await unitId('Planta alta');
    expect((await call(`/v1/units/${id}/account-statement`, username)).body.error.code).toBe(
      'FORBIDDEN',
    );
  });

  // --- Debt in details and search -------------------------------------------------------------

  it('adds the debt to the units of the search', async () => {
    const res = await call('/v1/search?q=planta%20alta', 'secretario');
    expect(res.body.units).toEqual([
      expect.objectContaining({
        reference: 'Planta alta',
        debt: { totalDue: 153_000, overdueCount: 16, inDebtCycle: true },
      }),
    ]);
  });

  it('adds the debt to the connection detail and its total', async () => {
    const search = await call('/v1/search?q=av%20hidalgo', 'secretario');
    const connection = (await call(`/v1/connections/${search.body.connections[0].id}`, 'jm.s1m01'))
      .body.connection;
    const byRef = Object.fromEntries(
      connection.units.map((u: { reference: string; debt: { totalDue: number } }) => [
        u.reference,
        u.debt.totalDue,
      ]),
    );
    // Frente: November only; Planta alta: 153,000; Cuarto del fondo: never paid since 2025-01.
    expect(byRef).toEqual({
      'Casa del frente': 5_000,
      'Planta alta': 153_000,
      'Cuarto del fondo': 12 * 8_000 + 10 * 10_000 + 5_000,
    });
    expect(connection.totalDue).toBe(5_000 + 153_000 + 201_000);
  });

  it('adds the debt to the person detail, never with amounts of another block for a leader', async () => {
    // José Luis (Hijo) holds Morelos (S1-M01, up to date) and gets a unit in S1-M02 owing
    // from 2026-10.
    const [hijo] = await ctx.owner
      .select({ id: person.id })
      .from(person)
      .where(eq(person.distinguishingNote, 'Hijo, Calle Morelos'));
    const juarez = await call('/v1/search?q=juarez', 'secretario');
    const added = await ctx.app.inject({
      method: 'POST',
      url: '/v1/units',
      headers: await ctx.authFor('secretario'),
      payload: {
        connectionId: juarez.body.connections[0].id,
        holderPersonId: hijo?.id,
        reference: 'Casa D',
        registeredOn: '2026-10-01',
        billingStartPeriod: '2026-10',
      },
    });
    expect(added.statusCode).toBe(201);

    const committee = (await call(`/v1/people/${hijo?.id}`, 'tesorero')).body.person;
    expect(committee.totalDue).toBe(10_000); // 2026-10 overdue + 2026-11 pending
    const leader = (await call(`/v1/people/${hijo?.id}`, 'jm.s1m01')).body.person;
    expect(leader.units).toEqual([
      expect.objectContaining({
        scope: 'own',
        debt: { totalDue: 0, overdueCount: 0, inDebtCycle: false },
      }),
      { scope: 'other_block' },
    ]);
    expect(leader.totalDue).toBe(0);
  });
});
