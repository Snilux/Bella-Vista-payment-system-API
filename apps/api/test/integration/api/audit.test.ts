import { auditLogPageSchema } from '@bella-vista/shared';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { userAccount } from '../../../src/db/schema/index.js';
import { testDatabaseUrl } from '../db/helpers.js';
import { useApiTestApp } from './fixture.js';

// API step 8, audit log query (CU-25, RF-AUD-02): the president sees every entry, the
// superadmin only the technical ones. The development data writes entries of every kind.

describe.skipIf(!testDatabaseUrl)('audit log', () => {
  const ctx = useApiTestApp();

  beforeAll(async () => {
    await ctx.owner
      .update(userAccount)
      .set({ mustChangePassword: false })
      .where(eq(userAccount.username, 'admin'));
  });

  const get = async (url: string, username: string) => {
    const res = await ctx.app.inject({ method: 'GET', url, headers: await ctx.authFor(username) });
    return { status: res.statusCode, body: res.json() };
  };

  it('shows the president the full log, newest first and paged', async () => {
    // An operational (non technical) entry.
    await ctx.app.inject({
      method: 'POST',
      url: '/v1/people',
      headers: await ctx.authFor('secretario'),
      payload: { givenNames: 'Bitácora', paternalSurname: 'Prueba' },
    });
    const res = await get('/v1/audit-log?limit=50', 'presidente');
    expect(res.status).toBe(200);
    expect(auditLogPageSchema.safeParse(res.body).success).toBe(true);
    const entries = res.body.data;
    expect(entries.some((e: { isTechnical: boolean }) => !e.isTechnical)).toBe(true);
    const ids = entries.map((e: { id: number }) => e.id);
    expect(ids).toEqual([...ids].sort((a, b) => b - a));
    const next = await get(`/v1/audit-log?limit=50&cursor=${res.body.next}`, 'presidente');
    expect(next.body.data[0].id).toBeLessThan(ids.at(-1));
  });

  it('shows the superadmin only the technical entries', async () => {
    const res = await get('/v1/audit-log?limit=100', 'admin');
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.data.every((e: { isTechnical: boolean }) => e.isTechnical)).toBe(true);
  });

  it('filters by table, record, action, account and date', async () => {
    const payments = await get(
      '/v1/audit-log?tableName=payment&action=create&limit=100',
      'presidente',
    );
    expect(payments.body.data.length).toBeGreaterThan(0);
    expect(
      payments.body.data.every(
        (e: { tableName: string; action: string }) =>
          e.tableName === 'payment' && e.action === 'create',
      ),
    ).toBe(true);
    const first = payments.body.data[0];
    const one = await get(
      `/v1/audit-log?tableName=payment&recordId=${first.recordId}&userAccountId=${first.userAccountId}`,
      'presidente',
    );
    expect(one.body.data.map((e: { id: number }) => e.id)).toContain(first.id);
    expect(first.fullName).toMatch(/\S+ \S+/);
    // R-05 "Cargo": the role of the account when it acted.
    const leaders = await get('/v1/audit-log?role=block_leader&limit=100', 'presidente');
    expect(leaders.body.data.length).toBeGreaterThan(0);
    expect(leaders.body.data.every((e: { role: string }) => e.role === 'block_leader')).toBe(true);
    expect((await get('/v1/audit-log?role=nobody', 'presidente')).status).toBe(400);
    // `from` filters by business date (America/Mexico_City), not by the UTC day of createdAt:
    // between 00:00 and 06:00 UTC they differ.
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(
      new Date(first.createdAt),
    );
    expect(
      (await get(`/v1/audit-log?from=2000-01-01&to=2000-01-31`, 'presidente')).body.data,
    ).toEqual([]);
    expect((await get(`/v1/audit-log?from=${day}&limit=1`, 'presidente')).body.data).toHaveLength(
      1,
    );
  });

  it.each(['tesorero', 'secretario', 'vocal', 'jm.s1m01'])(
    '%s does not read the audit log (403)',
    async (username) => {
      expect((await get('/v1/audit-log', username)).body.error.code).toBe('FORBIDDEN');
    },
  );
});
