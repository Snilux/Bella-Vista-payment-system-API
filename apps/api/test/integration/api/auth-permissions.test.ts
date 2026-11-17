import { eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { approval, person, roleAssignment, userAccount } from '../../../src/db/schema/index.js';
import { businessDate } from '../../../src/lib/dates.js';
import { requireAccount } from '../../../src/plugins/auth.js';
import { assertInScope, blockScope } from '../../../src/plugins/permissions.js';
import { testDatabaseUrl } from '../db/helpers.js';
import { useApiTestApp } from './fixture.js';

// API step 1: authentication (token + account checked in the database on every request) and
// permissions (role of the account + block + validity).

const testRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/me', async (request) => requireAccount(request));
  app.get('/public', { config: { public: true } }, async (request) => ({
    ok: true,
    account: request.account,
  }));
  app.post('/exempt', { config: { allowPendingPasswordChange: true } }, async () => ({ ok: true }));
  app.get('/collect', { config: { permission: 'billing.collect' } }, async () => ({ ok: true }));
  app.get('/accounts', { config: { permission: 'accounts.manage' } }, async () => ({ ok: true }));
  app.get(
    '/blocks/:blockId',
    {
      config: { permission: 'registry.view' },
      schema: { params: z.object({ blockId: z.coerce.number().int() }) },
    },
    async (request) => {
      const account = requireAccount(request);
      assertInScope(account, request.params.blockId);
      return { scope: blockScope(account) };
    },
  );
};

const today = () => businessDate(new Date(), 'America/Mexico_City');
const daysFromToday = (days: number) =>
  businessDate(new Date(Date.now() + days * 86_400_000), 'America/Mexico_City');

describe.skipIf(!testDatabaseUrl)('authentication', () => {
  const ctx = useApiTestApp((app) => app.register(testRoutes, { prefix: '/v1/test' }));

  const get = async (url: string, headers: Record<string, string> = {}) => {
    const res = await ctx.app.inject({ method: 'GET', url, headers });
    return { status: res.statusCode, body: res.json() };
  };
  const errorOf = async (url: string, headers: Record<string, string> = {}) => {
    const res = await get(url, headers);
    return { status: res.status, code: res.body.error?.code };
  };

  /** Changes account columns as the owner for one test and restores them afterwards. */
  const withAccount = async (
    username: string,
    values: Partial<typeof userAccount.$inferInsert>,
    fn: () => Promise<void>,
  ) => {
    const id = await ctx.accountId(username);
    const [before] = await ctx.owner.select().from(userAccount).where(eq(userAccount.id, id));
    await ctx.owner.update(userAccount).set(values).where(eq(userAccount.id, id));
    try {
      await fn();
    } finally {
      await ctx.owner
        .update(userAccount)
        .set({
          deactivatedAt: before?.deactivatedAt ?? null,
          lockedUntil: before?.lockedUntil ?? null,
        })
        .where(eq(userAccount.id, id));
    }
  };

  const withAssignment = async (
    username: string,
    values: { startDate?: string; endDate?: string | null },
    fn: () => Promise<void>,
  ) => {
    const [row] = await ctx.owner
      .select({
        id: roleAssignment.id,
        startDate: roleAssignment.startDate,
        endDate: roleAssignment.endDate,
      })
      .from(userAccount)
      .innerJoin(roleAssignment, eq(roleAssignment.id, userAccount.roleAssignmentId))
      .where(eq(userAccount.username, username));
    if (!row) throw new Error('assignment not found');
    await ctx.owner.update(roleAssignment).set(values).where(eq(roleAssignment.id, row.id));
    try {
      await fn();
    } finally {
      await ctx.owner
        .update(roleAssignment)
        .set({ startDate: row.startDate, endDate: row.endDate })
        .where(eq(roleAssignment.id, row.id));
    }
  };

  it('loads the account of a valid token', async () => {
    const res = await get('/v1/test/me', await ctx.authFor('jm.s1m01'));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      username: 'jm.s1m01',
      role: 'block_leader',
      mustChangePassword: false,
      blockId: expect.any(Number),
    });
  });

  it.each([
    ['no Authorization header', {}],
    ['a malformed token', { authorization: 'Bearer not-a-jwt' }],
    ['a non-Bearer scheme', { authorization: 'Basic YWRtaW46eA==' }],
  ])('rejects %s with UNAUTHENTICATED', async (_case, headers) => {
    expect(await errorOf('/v1/test/me', headers)).toEqual({ status: 401, code: 'UNAUTHENTICATED' });
  });

  it('rejects a token signed with another secret', async () => {
    const forged =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIiwicm9sZSI6InN1cGVyYWRtaW4ifQ.' +
      'c2lnbmF0dXJlLWZyb20tYW5vdGhlci1zZWNyZXQ';
    expect(await errorOf('/v1/test/me', { authorization: `Bearer ${forged}` })).toEqual({
      status: 401,
      code: 'UNAUTHENTICATED',
    });
  });

  it('rejects an expired token with TOKEN_EXPIRED so the app refreshes it', async () => {
    const id = await ctx.accountId('tesorero');
    const expired = ctx.app.jwt.sign(
      { sub: String(id), username: 'tesorero', role: 'treasurer', blockId: null },
      { clockTimestamp: Date.now() - 60 * 60 * 1000 },
    );
    expect(await errorOf('/v1/test/me', { authorization: `Bearer ${expired}` })).toEqual({
      status: 401,
      code: 'TOKEN_EXPIRED',
    });
  });

  it('rejects a token of an unknown account or with a role it does not have', async () => {
    const unknown = ctx.app.jwt.sign({
      sub: '999999',
      username: 'nadie',
      role: 'treasurer',
      blockId: null,
    });
    expect(await errorOf('/v1/test/me', { authorization: `Bearer ${unknown}` })).toEqual({
      status: 401,
      code: 'UNAUTHENTICATED',
    });
    const id = await ctx.accountId('tesorero');
    const wrongRole = ctx.app.jwt.sign({
      sub: String(id),
      username: 'tesorero',
      role: 'president',
      blockId: null,
    });
    expect(await errorOf('/v1/test/me', { authorization: `Bearer ${wrongRole}` })).toEqual({
      status: 401,
      code: 'UNAUTHENTICATED',
    });
  });

  it('rejects a deactivated account immediately, even with a valid token', async () => {
    const headers = await ctx.authFor('tesorero');
    await withAccount('tesorero', { deactivatedAt: new Date(Date.now() - 1000) }, async () => {
      expect(await errorOf('/v1/test/me', headers)).toEqual({
        status: 401,
        code: 'ACCOUNT_DISABLED',
      });
    });
    expect((await get('/v1/test/me', headers)).status).toBe(200);
  });

  it('rejects a locked account until the lock expires', async () => {
    const headers = await ctx.authFor('tesorero');
    const until = new Date(Date.now() + 10 * 60 * 1000);
    await withAccount('tesorero', { lockedUntil: until }, async () => {
      const res = await get('/v1/test/me', headers);
      expect(res.status).toBe(401);
      expect(res.body.error).toMatchObject({
        code: 'ACCOUNT_LOCKED',
        details: { lockedUntil: until.toISOString() },
      });
    });
    await withAccount('tesorero', { lockedUntil: new Date(Date.now() - 1000) }, async () => {
      expect((await get('/v1/test/me', headers)).status).toBe(200);
    });
  });

  it('accepts an assignment that ends today and rejects one that ended yesterday', async () => {
    const headers = await ctx.authFor('jm.s1m02');
    await withAssignment('jm.s1m02', { endDate: today() }, async () => {
      expect((await get('/v1/test/me', headers)).status).toBe(200);
    });
    await withAssignment('jm.s1m02', { endDate: daysFromToday(-1) }, async () => {
      expect(await errorOf('/v1/test/me', headers)).toEqual({
        status: 403,
        code: 'ROLE_NOT_ACTIVE',
      });
    });
  });

  it('rejects an assignment that has not started yet', async () => {
    const headers = await ctx.authFor('jm.s1m02');
    await withAssignment('jm.s1m02', { startDate: daysFromToday(1) }, async () => {
      expect(await errorOf('/v1/test/me', headers)).toEqual({
        status: 403,
        code: 'ROLE_NOT_ACTIVE',
      });
    });
  });

  it('rejects an account whose assignment is still pending approval', async () => {
    const sa = await ctx.accountId('admin');
    const [member] = await ctx.owner
      .insert(person)
      .values({
        givenNames: 'Vocal',
        paternalSurname: 'Pendiente',
        registeredOn: '2025-01-01',
        createdBy: sa,
      })
      .returning();
    const [pending] = await ctx.owner
      .insert(approval)
      .values({ type: 'role_assignment', reason: 'Vocal', requestedBy: sa, createdBy: sa })
      .returning();
    const [assignment] = await ctx.owner
      .insert(roleAssignment)
      .values({
        personId: member?.id ?? 0,
        role: 'member',
        startDate: '2025-01-01',
        approvalId: pending?.id ?? 0,
        createdBy: sa,
      })
      .returning();
    const [account] = await ctx.owner
      .insert(userAccount)
      .values({
        roleAssignmentId: assignment?.id ?? 0,
        username: 'vocal.pendiente',
        passwordHash: 'x',
        mustChangePassword: false,
        createdBy: sa,
      })
      .returning();
    const token = ctx.app.jwt.sign({
      sub: String(account?.id),
      username: 'vocal.pendiente',
      role: 'member',
      blockId: null,
    });
    expect(await errorOf('/v1/test/me', { authorization: `Bearer ${token}` })).toEqual({
      status: 403,
      code: 'ROLE_NOT_ACTIVE',
    });
  });

  it('requires the password change before anything else, except the exempt routes', async () => {
    // The bootstrap superadmin still has the temporary password.
    const headers = await ctx.authFor('admin');
    expect(await errorOf('/v1/test/me', headers)).toEqual({
      status: 403,
      code: 'PASSWORD_CHANGE_REQUIRED',
    });
    const exempt = await ctx.app.inject({ method: 'POST', url: '/v1/test/exempt', headers });
    expect(exempt.statusCode).toBe(200);
  });

  it('lets public routes through without a token and without loading an account', async () => {
    const res = await get('/v1/test/public', { authorization: 'Bearer garbage' });
    expect(res).toEqual({ status: 200, body: { ok: true, account: null } });
  });
});

describe.skipIf(!testDatabaseUrl)('permissions', () => {
  const ctx = useApiTestApp((app) => app.register(testRoutes, { prefix: '/v1/test' }));

  const call = async (url: string, username: string) => {
    const res = await ctx.app.inject({ method: 'GET', url, headers: await ctx.authFor(username) });
    return { status: res.statusCode, body: res.json() };
  };

  it.each([
    ['tesorero', 200],
    ['jm.s1m01', 200],
    ['presidente', 200],
    ['secretario', 403],
  ])('billing.collect for %s → %i', async (username, status) => {
    const res = await call('/v1/test/collect', username);
    expect(res.status).toBe(status);
    if (status === 403) expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('keeps account management for the superadmin only (D-19)', async () => {
    const res = await call('/v1/test/accounts', 'presidente');
    expect(res.status).toBe(403);
    expect(res.body.error).toMatchObject({
      code: 'FORBIDDEN',
      message: 'Su cargo no tiene permiso para esta operación.',
    });
  });

  it('limits a block leader to their own block', async () => {
    const own = await call('/v1/test/me', 'jm.s1m01');
    const ownBlock = own.body.blockId as number;
    const other = await call('/v1/test/me', 'jm.s1m02');
    const otherBlock = other.body.blockId as number;

    expect(await call(`/v1/test/blocks/${ownBlock}`, 'jm.s1m01')).toEqual({
      status: 200,
      body: { scope: ownBlock },
    });
    const denied = await call(`/v1/test/blocks/${otherBlock}`, 'jm.s1m01');
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('OUT_OF_SCOPE');
  });

  it('lets the committee see every block', async () => {
    const other = await call('/v1/test/me', 'jm.s2m01');
    expect(await call(`/v1/test/blocks/${other.body.blockId}`, 'secretario')).toEqual({
      status: 200,
      body: { scope: null },
    });
  });
});
