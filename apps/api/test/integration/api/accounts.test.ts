import { accountListResponseSchema } from '@bella-vista/shared';
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  approval,
  auditLog,
  person,
  roleAssignment,
  userAccount,
} from '../../../src/db/schema/index.js';
import { DEV_PASSWORD } from '../../../src/db/seed/dev-data.js';
import { testDatabaseUrl } from '../db/helpers.js';
import { useApiTestApp } from './fixture.js';

// API step 2, accounts module: only the superadmin manages accounts (CU-02, D-19, D-22,
// RF-AUT-03 to 05). Every change ends in the technical audit log.

const MANUAL_LOCK = '9999-12-31T00:00:00.000Z';

describe.skipIf(!testDatabaseUrl)('/v1/accounts', () => {
  const ctx = useApiTestApp();

  // The bootstrap superadmin must change the temporary password first; done here so the
  // tests exercise the accounts endpoints (the change itself is tested in auth.test.ts).
  beforeAll(async () => {
    await ctx.owner
      .update(userAccount)
      .set({ mustChangePassword: false })
      .where(eq(userAccount.username, 'admin'));
  });

  const call = async (
    method: 'GET' | 'POST',
    url: string,
    username = 'admin',
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
  const login = async (username: string, password: string) => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { username, password },
    });
    return { status: res.statusCode, body: res.json() };
  };
  const auditOf = (action: string, recordId: number) =>
    ctx.owner
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.action, action),
          eq(auditLog.tableName, 'user_account'),
          eq(auditLog.recordId, recordId),
        ),
      );

  /** A member assignment created as the owner, with the given approval state and dates. */
  const newAssignment = async (
    values: { result?: 'approved' | 'rejected' | null; endDate?: string; startDate?: string } = {},
  ) => {
    const sa = await ctx.accountId('admin');
    const [who] = await ctx.owner
      .insert(person)
      .values({
        givenNames: `Vocal ${Math.random().toString(36).slice(2, 8)}`,
        paternalSurname: 'Prueba',
        registeredOn: '2025-01-01',
        createdBy: sa,
      })
      .returning();
    const result = values.result === undefined ? 'approved' : values.result;
    const [request] = await ctx.owner
      .insert(approval)
      .values({
        type: 'role_assignment',
        reason: 'Vocal',
        requestedBy: sa,
        createdBy: sa,
        ...(result && {
          result,
          resolvedBy: sa,
          resolvedAt: new Date('2025-01-02T18:00:00Z'),
          resolutionReason: result === 'rejected' ? 'No procede' : null,
        }),
      })
      .returning();
    const [assignment] = await ctx.owner
      .insert(roleAssignment)
      .values({
        personId: who?.id ?? 0,
        role: 'member',
        startDate: values.startDate ?? '2025-01-01',
        endDate: values.endDate ?? null,
        approvalId: request?.id ?? 0,
        createdBy: sa,
      })
      .returning();
    return assignment?.id ?? 0;
  };

  it('lists the accounts and the current assignments without account', async () => {
    const res = await call('GET', '/v1/accounts');
    expect(res.status).toBe(200);
    expect(accountListResponseSchema.safeParse(res.body).success).toBe(true);

    const byUsername = Object.fromEntries(
      res.body.accounts.map((a: { username: string }) => [a.username, a]),
    );
    expect(Object.keys(byUsername).sort()).toEqual([
      'admin',
      'jm.s1m01',
      'jm.s1m02',
      'jm.s2m01',
      'presidente',
      'secretario',
      'tesorero',
      'vocal',
    ]);
    expect(byUsername.admin).toMatchObject({ role: 'superadmin', status: 'active' });
    expect(byUsername['jm.s1m01']).toMatchObject({
      role: 'block_leader',
      status: 'active',
      blockCode: 'S1-M01',
      person: { fullName: 'Laura Méndez Ruiz' },
    });
    expect(JSON.stringify(res.body)).not.toMatch(/argon2|passwordHash/);

    // Silvia Montes is an approved vocal without an account: the superadmin's inbox.
    expect(res.body.assignmentsWithoutAccount).toEqual([
      expect.objectContaining({
        role: 'member',
        blockCode: null,
        person: expect.objectContaining({ fullName: 'Silvia Montes' }),
      }),
    ]);
  });

  it('creates the account of an assignment and shows the temporary password once', async () => {
    const list = await call('GET', '/v1/accounts');
    const silvia = list.body.assignmentsWithoutAccount[0];

    const res = await call('POST', '/v1/accounts', 'admin', {
      roleAssignmentId: silvia.roleAssignmentId,
      username: '  Vocal.Silvia ',
    });
    expect(res.status).toBe(201);
    expect(res.body.temporaryPassword).toMatch(/^[a-zA-Z2-9]{12}$/);
    expect(res.body.account).toMatchObject({
      username: 'vocal.silvia',
      role: 'member',
      status: 'must_change_password',
      mustChangePassword: true,
      roleAssignmentId: silvia.roleAssignmentId,
    });

    // The temporary password works once and forces the change.
    const session = await login('vocal.silvia', res.body.temporaryPassword);
    expect(session.status).toBe(200);
    expect(session.body.account.mustChangePassword).toBe(true);

    // The assignment left the inbox.
    expect((await call('GET', '/v1/accounts')).body.assignmentsWithoutAccount).toEqual([]);

    const [entry] = await auditOf('create', res.body.account.id);
    expect(entry).toMatchObject({
      userAccountId: await ctx.accountId('admin'),
      role: 'superadmin',
      isTechnical: true,
      tableName: 'user_account',
    });
    expect(JSON.stringify(entry)).not.toContain(res.body.temporaryPassword);

    // ASSIGNMENT_HAS_ACCOUNT: a second account for the same assignment (D-22).
    expect(
      await call('POST', '/v1/accounts', 'admin', {
        roleAssignmentId: silvia.roleAssignmentId,
        username: 'otra.cuenta',
      }),
    ).toEqual({
      status: 409,
      body: {
        error: {
          code: 'ASSIGNMENT_HAS_ACCOUNT',
          message: 'Esa asignación de cargo ya tiene una cuenta.',
          details: {},
        },
      },
    });
  });

  it('rejects a username that already exists', async () => {
    const id = await newAssignment();
    const res = await call('POST', '/v1/accounts', 'admin', {
      roleAssignmentId: id,
      username: 'TESORERO',
    });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({
      code: 'USERNAME_TAKEN',
      details: { username: 'tesorero' },
    });
  });

  it.each([
    ['pending approval', { result: null }],
    ['rejected approval', { result: 'rejected' as const }],
    ['closed assignment', { endDate: '2025-06-30' }],
    ['assignment that has not started', { startDate: '2099-01-01' }],
  ])('rejects an account for a %s with ASSIGNMENT_NOT_ACTIVE', async (_case, values) => {
    const id = await newAssignment(values);
    const res = await call('POST', '/v1/accounts', 'admin', {
      roleAssignmentId: id,
      username: `cuenta.${id}`,
    });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('ASSIGNMENT_NOT_ACTIVE');
  });

  it('answers NOT_FOUND for an unknown assignment and VALIDATION_ERROR for a bad username', async () => {
    expect(
      (
        await call('POST', '/v1/accounts', 'admin', {
          roleAssignmentId: 999_999,
          username: 'nadie',
        })
      ).body.error.code,
    ).toBe('NOT_FOUND');
    const bad = await call('POST', '/v1/accounts', 'admin', {
      roleAssignmentId: 1,
      username: 'a b',
    });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('resets the password: new temporary password and every session closed', async () => {
    const id = await ctx.accountId('jm.s1m02');
    const before = await login('jm.s1m02', DEV_PASSWORD);

    const res = await call('POST', `/v1/accounts/${id}/reset-password`);
    expect(res.status).toBe(200);
    expect(res.body.account).toMatchObject({ status: 'must_change_password' });

    const refreshed = await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refreshToken: before.body.refreshToken },
    });
    expect(refreshed.statusCode).toBe(401);
    expect((await login('jm.s1m02', DEV_PASSWORD)).body.error.code).toBe('INVALID_CREDENTIALS');
    const after = await login('jm.s1m02', res.body.temporaryPassword);
    expect(after.body.account.mustChangePassword).toBe(true);

    const [entry] = await auditOf('reset_password', id);
    expect(entry).toMatchObject({ isTechnical: true, after: { mustChangePassword: true } });
    expect(JSON.stringify(entry)).not.toContain(res.body.temporaryPassword);
  });

  it('locks with a reason until unlocked, closing the sessions', async () => {
    const id = await ctx.accountId('tesorero');
    const session = await login('tesorero', DEV_PASSWORD);

    const missing = await call('POST', `/v1/accounts/${id}/lock`, 'admin', { reason: ' ' });
    expect(missing.body.error.details.issues).toEqual([
      { path: 'body.reason', message: 'Escribe el motivo.' },
    ]);

    const locked = await call('POST', `/v1/accounts/${id}/lock`, 'admin', {
      reason: 'Reporte de uso indebido',
    });
    expect(locked.status).toBe(200);
    expect(locked.body.account).toMatchObject({ status: 'locked', lockedUntil: MANUAL_LOCK });

    // The access token still in the phone stops working at once (checked on every request).
    const meRes = await ctx.app.inject({
      method: 'GET',
      url: '/v1/accounts',
      headers: { authorization: `Bearer ${session.body.accessToken}` },
    });
    expect(meRes.json().error.code).toBe('ACCOUNT_LOCKED');
    expect((await login('tesorero', DEV_PASSWORD)).body.error.code).toBe('ACCOUNT_LOCKED');

    const unlocked = await call('POST', `/v1/accounts/${id}/unlock`, 'admin', {
      reason: 'Aclarado en junta',
    });
    expect(unlocked.body.account).toMatchObject({ status: 'active', lockedUntil: null });
    expect((await login('tesorero', DEV_PASSWORD)).status).toBe(200);

    // The lock closed the session that existed before it.
    const refreshed = await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refreshToken: session.body.refreshToken },
    });
    expect(refreshed.statusCode).toBe(401);

    expect((await auditOf('lock', id))[0]).toMatchObject({
      reason: 'Reporte de uso indebido',
      isTechnical: true,
      after: { lockedUntil: MANUAL_LOCK },
    });
    expect((await auditOf('unlock', id))[0]).toMatchObject({
      reason: 'Aclarado en junta',
      after: { lockedUntil: null },
    });
  });

  it('deactivates with a reason', async () => {
    const id = await ctx.accountId('jm.s2m01');
    const res = await call('POST', `/v1/accounts/${id}/deactivate`, 'admin', {
      reason: 'Dejó el cargo',
    });
    expect(res.status).toBe(200);
    expect(res.body.account.status).toBe('disabled');
    expect((await login('jm.s2m01', DEV_PASSWORD)).body.error.code).toBe('ACCOUNT_DISABLED');
    expect((await auditOf('deactivate', id))[0]).toMatchObject({
      reason: 'Dejó el cargo',
      isTechnical: true,
    });
  });

  it('does not let the superadmin lock or deactivate their own account', async () => {
    const id = await ctx.accountId('admin');
    for (const action of ['lock', 'deactivate']) {
      const res = await call('POST', `/v1/accounts/${id}/${action}`, 'admin', { reason: 'x' });
      expect(res).toEqual({
        status: 403,
        body: {
          error: {
            code: 'FORBIDDEN',
            message: 'No puedes bloquear ni desactivar tu propia cuenta.',
            details: {},
          },
        },
      });
    }
  });

  it('answers NOT_FOUND for an unknown account', async () => {
    const res = await call('POST', '/v1/accounts/999999/unlock', 'admin', { reason: 'x' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  const endpoints: [string, 'GET' | 'POST', string, Record<string, unknown> | undefined][] = [
    ['list', 'GET', '/v1/accounts', undefined],
    ['create', 'POST', '/v1/accounts', { roleAssignmentId: 1, username: 'intruso' }],
    ['reset', 'POST', '/v1/accounts/1/reset-password', undefined],
    ['lock', 'POST', '/v1/accounts/1/lock', { reason: 'x' }],
    ['unlock', 'POST', '/v1/accounts/1/unlock', { reason: 'x' }],
    ['deactivate', 'POST', '/v1/accounts/1/deactivate', { reason: 'x' }],
  ];
  const roles = ['presidente', 'tesorero', 'secretario', 'vocal', 'jm.s1m01'];

  it.each(
    endpoints.flatMap(([name, method, url, payload]) =>
      roles.map((username) => [name, username, method, url, payload] as const),
    ),
  )(
    '%s is forbidden for %s (only the superadmin manages accounts)',
    async (_name, username, method, url, payload) => {
      const res = await call(method, url, username, payload);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    },
  );

  it('requires a session', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/v1/accounts' });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('UNAUTHENTICATED');
  });
});
