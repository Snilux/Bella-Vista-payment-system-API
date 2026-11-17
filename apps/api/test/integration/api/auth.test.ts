import { createHash } from 'node:crypto';
import { sessionResponseSchema } from '@bella-vista/shared';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { DEFAULT_LOGIN_RATE_LIMIT } from '../../../src/app.js';
import {
  auditLog,
  refreshToken,
  roleAssignment,
  userAccount,
} from '../../../src/db/schema/index.js';
import { DEV_PASSWORD } from '../../../src/db/seed/dev-data.js';
import { businessDate } from '../../../src/lib/dates.js';
import { AUTO_LOCK_REASON } from '../../../src/modules/auth/auth.service.js';
import { testDatabaseUrl } from '../db/helpers.js';
import { type ApiTestContext, useApiTestApp } from './fixture.js';

// API step 2, auth module: login with lockout, rotating refresh with reuse detection,
// mandatory password change and logout (CU-01, RF-AUT-01/05/06/07, RNF-SEG-02/03/07).

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const MINUTE = 60_000;

function client(ctx: ApiTestContext) {
  const post = async (url: string, payload: unknown, headers: Record<string, string> = {}) => {
    const res = await ctx.app.inject({ method: 'POST', url, payload: payload as object, headers });
    return { status: res.statusCode, body: res.body ? res.json() : null };
  };
  return {
    login: (username: string, password: string) => post('/v1/auth/login', { username, password }),
    /** Login with an X-Forwarded-For header, as a proxy (or a client faking one) sends it. */
    loginFrom: (forwardedFor: string, username: string, password: string) =>
      post('/v1/auth/login', { username, password }, { 'x-forwarded-for': forwardedFor }),
    refresh: (token: string) => post('/v1/auth/refresh', { refreshToken: token }),
    changePassword: (accessToken: string, currentPassword: string, newPassword: string) =>
      post(
        '/v1/auth/change-password',
        { currentPassword, newPassword },
        { authorization: `Bearer ${accessToken}` },
      ),
    logout: (accessToken: string, token: string) =>
      post('/v1/auth/logout', { refreshToken: token }, { authorization: `Bearer ${accessToken}` }),
    get: async (url: string, accessToken: string) => {
      const res = await ctx.app.inject({
        method: 'GET',
        url,
        headers: { authorization: `Bearer ${accessToken}` },
      });
      return { status: res.statusCode, body: res.json() };
    },
  };
}

async function accountRow(ctx: ApiTestContext, username: string) {
  const [row] = await ctx.owner
    .select()
    .from(userAccount)
    .where(eq(userAccount.username, username));
  if (!row) throw new Error(`no account ${username}`);
  return row;
}

describe.skipIf(!testDatabaseUrl)('POST /v1/auth/login', () => {
  const ctx = useApiTestApp();
  const api = client(ctx);

  it('returns an access token with username, role and block, and a refresh token stored as a hash', async () => {
    const res = await api.login('jm.s1m01', DEV_PASSWORD);
    expect(res.status).toBe(200);
    expect(sessionResponseSchema.safeParse(res.body).success).toBe(true);
    const leader = await accountRow(ctx, 'jm.s1m01');
    expect(res.body.account).toEqual({
      username: 'jm.s1m01',
      role: 'block_leader',
      blockId: expect.any(Number),
      mustChangePassword: false,
    });
    expect(res.body.accessTokenExpiresIn).toBe(15 * 60);

    const claims = ctx.app.jwt.verify<{
      sub: string;
      username: string;
      role: string;
      blockId: number;
      exp: number;
      iat: number;
    }>(res.body.accessToken);
    expect(claims).toMatchObject({
      sub: String(leader.id),
      username: 'jm.s1m01',
      role: 'block_leader',
      blockId: res.body.account.blockId,
    });
    expect(claims.exp - claims.iat).toBe(15 * 60);

    const stored = await ctx.owner
      .select()
      .from(refreshToken)
      .where(eq(refreshToken.tokenHash, sha256(res.body.refreshToken)));
    expect(stored).toHaveLength(1);
    expect(stored[0]?.tokenHash).not.toBe(res.body.refreshToken);
    const days = ((stored[0]?.expiresAt.getTime() ?? 0) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThanOrEqual(30);

    // The username is case-insensitive.
    expect((await api.login('  JM.S1M01 ', DEV_PASSWORD)).status).toBe(200);
  });

  it('answers the same INVALID_CREDENTIALS for an unknown user and a wrong password', async () => {
    const unknown = await api.login('no.existe', DEV_PASSWORD);
    const wrong = await api.login('tesorero', 'incorrecta');
    expect(unknown).toEqual(wrong);
    expect(unknown).toEqual({
      status: 401,
      body: {
        error: {
          code: 'INVALID_CREDENTIALS',
          message: 'Usuario o contraseña incorrectos.',
          details: {},
        },
      },
    });
  });

  it('locks the account for 15 minutes on the fifth consecutive failure', async () => {
    const start = new Date();
    ctx.setNow(start);
    try {
      for (let attempt = 1; attempt <= 4; attempt++) {
        expect((await api.login('jm.s2m01', 'incorrecta')).body.error.code).toBe(
          'INVALID_CREDENTIALS',
        );
      }
      expect((await accountRow(ctx, 'jm.s2m01')).failedAttempts).toBe(4);

      const fifth = await api.login('jm.s2m01', 'incorrecta');
      const lockedUntil = new Date(start.getTime() + 15 * MINUTE).toISOString();
      expect(fifth).toEqual({
        status: 401,
        body: {
          error: {
            code: 'ACCOUNT_LOCKED',
            message: 'Su cuenta está bloqueada temporalmente.',
            details: { lockedUntil },
          },
        },
      });

      // While locked, even the right password is refused.
      ctx.setNow(new Date(start.getTime() + 14 * MINUTE));
      expect((await api.login('jm.s2m01', DEV_PASSWORD)).body.error.code).toBe('ACCOUNT_LOCKED');

      const [entry] = await ctx.owner
        .select()
        .from(auditLog)
        .where(
          and(
            eq(auditLog.action, 'lock_after_failed_attempts'),
            eq(auditLog.recordId, (await accountRow(ctx, 'jm.s2m01')).id),
          ),
        );
      expect(entry).toMatchObject({
        role: 'block_leader',
        isTechnical: true,
        reason: AUTO_LOCK_REASON,
        after: { lockedUntil },
      });

      // After the lock expires the right password works and the counters are cleared.
      ctx.setNow(new Date(start.getTime() + 16 * MINUTE));
      expect((await api.login('jm.s2m01', DEV_PASSWORD)).status).toBe(200);
      expect(await accountRow(ctx, 'jm.s2m01')).toMatchObject({
        failedAttempts: 0,
        lockedUntil: null,
      });
    } finally {
      ctx.setNow(null);
    }
  });

  it('clears the failure counter on a successful login', async () => {
    await api.login('secretario', 'incorrecta');
    await api.login('secretario', 'incorrecta');
    expect((await accountRow(ctx, 'secretario')).failedAttempts).toBe(2);
    expect((await api.login('secretario', DEV_PASSWORD)).status).toBe(200);
    expect((await accountRow(ctx, 'secretario')).failedAttempts).toBe(0);
  });

  it('does not let in an account whose role assignment is closed', async () => {
    const account = await accountRow(ctx, 'jm.s1m02');
    const yesterday = businessDate(new Date(Date.now() - 86_400_000), 'America/Mexico_City');
    await ctx.owner
      .update(roleAssignment)
      .set({ endDate: yesterday })
      .where(eq(roleAssignment.id, account.roleAssignmentId));
    try {
      expect(await api.login('jm.s1m02', DEV_PASSWORD)).toMatchObject({
        status: 403,
        body: { error: { code: 'ROLE_NOT_ACTIVE' } },
      });
      // Without the right password nothing about the account is revealed.
      expect((await api.login('jm.s1m02', 'incorrecta')).body.error.code).toBe(
        'INVALID_CREDENTIALS',
      );
    } finally {
      await ctx.owner
        .update(roleAssignment)
        .set({ endDate: null })
        .where(eq(roleAssignment.id, account.roleAssignmentId));
    }
  });

  it('does not let in a deactivated account', async () => {
    await ctx.owner
      .update(userAccount)
      .set({ deactivatedAt: new Date(Date.now() - 1000) })
      .where(eq(userAccount.username, 'presidente'));
    try {
      expect(await api.login('presidente', DEV_PASSWORD)).toMatchObject({
        status: 401,
        body: { error: { code: 'ACCOUNT_DISABLED' } },
      });
    } finally {
      await ctx.owner
        .update(userAccount)
        .set({ deactivatedAt: null })
        .where(eq(userAccount.username, 'presidente'));
    }
  });

  it('validates the body', async () => {
    const res = await api.login('', '');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe.skipIf(!testDatabaseUrl)('temporary password of the bootstrap superadmin', () => {
  // A protected route that is not exempt from the password change.
  const ctx = useApiTestApp((app) => app.get('/v1/test/protected', async () => ({ ok: true })));
  const api = client(ctx);

  it('logs in, can only change the password or log out, then works normally', async () => {
    // Replaces the it.todo of the bootstrap tests: the temporary password printed by
    // pnpm db:seed lets the superadmin log in (fixture: 'Temporal-1234').
    const first = await api.login('admin', 'Temporal-1234');
    expect(first.status).toBe(200);
    expect(first.body.account).toMatchObject({ role: 'superadmin', mustChangePassword: true });
    const { accessToken, refreshToken: firstRefresh } = first.body;

    expect(await api.get('/v1/test/protected', accessToken)).toMatchObject({
      status: 403,
      body: { error: { code: 'PASSWORD_CHANGE_REQUIRED' } },
    });

    expect(
      (await api.changePassword(accessToken, 'incorrecta', 'NuevaClave-2026')).body.error,
    ).toMatchObject({
      code: 'INVALID_CREDENTIALS',
      message: 'La contraseña actual no es correcta.',
    });
    const same = await api.changePassword(accessToken, 'Temporal-1234', 'Temporal-1234');
    expect(same.status).toBe(400);
    expect(same.body.error.details.issues).toEqual([
      { path: 'body.newPassword', message: 'La contraseña nueva debe ser distinta de la actual.' },
    ]);
    const short = await api.changePassword(accessToken, 'Temporal-1234', 'corta');
    expect(short.body.error.details.issues).toEqual([
      { path: 'body.newPassword', message: 'La contraseña debe tener al menos 8 caracteres.' },
    ]);

    // A second session (another phone) that the change must close.
    const other = await api.login('admin', 'Temporal-1234');

    const changed = await api.changePassword(accessToken, 'Temporal-1234', 'NuevaClave-2026');
    expect(changed.status).toBe(200);
    expect(changed.body.account.mustChangePassword).toBe(false);
    expect((await api.get('/v1/test/protected', changed.body.accessToken)).status).toBe(200);

    // Every previous session is closed; the new one keeps working.
    expect((await api.refresh(firstRefresh)).status).toBe(401);
    expect((await api.refresh(other.body.refreshToken)).status).toBe(401);
    expect((await api.refresh(changed.body.refreshToken)).status).toBe(200);

    expect((await api.login('admin', 'Temporal-1234')).body.error.code).toBe('INVALID_CREDENTIALS');
    expect((await api.login('admin', 'NuevaClave-2026')).status).toBe(200);
    expect(await accountRow(ctx, 'admin')).toMatchObject({ mustChangePassword: false });

    const [entry] = await ctx.owner
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, 'change_password'));
    expect(entry).toMatchObject({ role: 'superadmin', isTechnical: true });
    expect(JSON.stringify(entry)).not.toContain('NuevaClave-2026');
  });

  it('lets an account with a pending change log out', async () => {
    await ctx.owner
      .update(userAccount)
      .set({ mustChangePassword: true })
      .where(eq(userAccount.username, 'tesorero'));
    const session = await api.login('tesorero', DEV_PASSWORD);
    expect(session.body.account.mustChangePassword).toBe(true);
    expect((await api.logout(session.body.accessToken, session.body.refreshToken)).status).toBe(
      204,
    );
  });
});

describe.skipIf(!testDatabaseUrl)('POST /v1/auth/refresh and /logout', () => {
  const ctx = useApiTestApp();
  const api = client(ctx);

  it('rotates the refresh token', async () => {
    const session = await api.login('tesorero', DEV_PASSWORD);
    const second = await api.refresh(session.body.refreshToken);
    expect(second.status).toBe(200);
    expect(second.body.refreshToken).not.toBe(session.body.refreshToken);
    expect(second.body.account).toMatchObject({ username: 'tesorero', role: 'treasurer' });
    const third = await api.refresh(second.body.refreshToken);
    expect(third.status).toBe(200);

    const [rotated] = await ctx.owner
      .select()
      .from(refreshToken)
      .where(eq(refreshToken.tokenHash, sha256(session.body.refreshToken)));
    expect(rotated?.revokedAt).not.toBeNull();
    expect(rotated?.replacedById).not.toBeNull();
  });

  it('revokes the whole chain when a rotated token is reused (theft detection)', async () => {
    const session = await api.login('secretario', DEV_PASSWORD);
    const stolen = session.body.refreshToken;
    const second = await api.refresh(stolen);
    const third = await api.refresh(second.body.refreshToken);
    expect(third.status).toBe(200);

    // The old token comes back: it was rotated, so someone else has the chain.
    expect(await api.refresh(stolen)).toEqual({
      status: 401,
      body: {
        error: {
          code: 'UNAUTHENTICATED',
          message: 'Su sesión ya no es válida. Inicie sesión de nuevo.',
          details: {},
        },
      },
    });
    // Even the newest token of the chain is dead now.
    expect((await api.refresh(third.body.refreshToken)).status).toBe(401);

    const chain = await ctx.owner
      .select({ revokedAt: refreshToken.revokedAt })
      .from(refreshToken)
      .where(eq(refreshToken.userAccountId, (await accountRow(ctx, 'secretario')).id));
    expect(chain.length).toBe(3);
    expect(chain.every((row) => row.revokedAt !== null)).toBe(true);
  });

  it('keeps other sessions of the account alive when one chain is revoked', async () => {
    const phoneA = await api.login('vocal', DEV_PASSWORD);
    const phoneB = await api.login('vocal', DEV_PASSWORD);
    await api.refresh(phoneA.body.refreshToken);
    await api.refresh(phoneA.body.refreshToken); // reuse → chain A revoked
    expect((await api.refresh(phoneB.body.refreshToken)).status).toBe(200);
  });

  it('rejects an unknown or expired refresh token', async () => {
    expect((await api.refresh('no-es-un-token')).status).toBe(401);
    const session = await api.login('jm.s1m01', DEV_PASSWORD);
    ctx.setNow(new Date(Date.now() + 31 * 86_400_000));
    try {
      expect((await api.refresh(session.body.refreshToken)).body.error.code).toBe(
        'UNAUTHENTICATED',
      );
    } finally {
      ctx.setNow(null);
    }
  });

  it('refuses to refresh for a deactivated account', async () => {
    const session = await api.login('jm.s2m01', DEV_PASSWORD);
    await ctx.owner
      .update(userAccount)
      .set({ deactivatedAt: new Date(Date.now() - 1000) })
      .where(eq(userAccount.username, 'jm.s2m01'));
    try {
      expect((await api.refresh(session.body.refreshToken)).body.error.code).toBe(
        'ACCOUNT_DISABLED',
      );
    } finally {
      await ctx.owner
        .update(userAccount)
        .set({ deactivatedAt: null })
        .where(eq(userAccount.username, 'jm.s2m01'));
    }
  });

  it('logs out by revoking the refresh token', async () => {
    const session = await api.login('presidente', DEV_PASSWORD);
    expect(await api.logout(session.body.accessToken, session.body.refreshToken)).toEqual({
      status: 204,
      body: null,
    });
    expect((await api.refresh(session.body.refreshToken)).status).toBe(401);
  });

  it('cannot log out a token of another account', async () => {
    const victim = await api.login('jm.s1m02', DEV_PASSWORD);
    const attacker = await api.login('jm.s1m01', DEV_PASSWORD);
    await api.logout(attacker.body.accessToken, victim.body.refreshToken);
    expect((await api.refresh(victim.body.refreshToken)).status).toBe(200);
  });

  it('requires an access token to log out', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/logout',
      payload: { refreshToken: 'x' },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe.skipIf(!testDatabaseUrl)('login rate limit', () => {
  const ctx = useApiTestApp(undefined, { loginRateLimit: { max: 3, timeWindow: '1 minute' } });
  const api = client(ctx);

  it('answers TOO_MANY_REQUESTS after the limit (RNF-SEG-07)', async () => {
    for (let i = 0; i < 3; i++) {
      expect((await api.login('no.existe', 'x')).status).toBe(401);
    }
    expect(await api.login('tesorero', DEV_PASSWORD)).toEqual({
      status: 429,
      body: {
        error: {
          code: 'TOO_MANY_REQUESTS',
          message: 'Demasiadas solicitudes. Espere un momento.',
          details: {},
        },
      },
    });
  });
});

describe.skipIf(!testDatabaseUrl)('login rate limit without TRUST_PROXY (default)', () => {
  const ctx = useApiTestApp(undefined, { loginRateLimit: { max: 3, timeWindow: '1 minute' } });
  const api = client(ctx);

  it('ignores X-Forwarded-For: a client cannot pick a new IP per attempt', async () => {
    const statuses: number[] = [];
    for (let i = 1; i <= 4; i++) {
      statuses.push((await api.loginFrom(`10.0.0.${i}`, `no.existe${i}`, 'x')).status);
    }
    expect(statuses).toEqual([401, 401, 401, 429]);
  });
});

describe.skipIf(!testDatabaseUrl)('login rate limit per username behind a proxy', () => {
  // Default limit (10 per minute) and one trusted proxy: each X-Forwarded-For is a distinct
  // client IP, so only the per-username limit can stop the attempts.
  const ctx = useApiTestApp(undefined, {
    loginRateLimit: DEFAULT_LOGIN_RATE_LIMIT,
    env: { TRUST_PROXY: '1' },
  });
  const api = client(ctx);

  it('stops 15 attempts from distinct IPs against one username with 429', async () => {
    const codes: string[] = [];
    for (let i = 1; i <= 15; i++) {
      const res = await api.loginFrom(`203.0.113.${i}`, ' Tesorero ', 'incorrecta');
      codes.push(res.body.error.code);
    }
    expect(codes).toEqual([
      ...Array(4).fill('INVALID_CREDENTIALS'),
      // The fifth failure locks the account (RF-AUT-06); the login messages do not change.
      ...Array(6).fill('ACCOUNT_LOCKED'),
      ...Array(5).fill('TOO_MANY_REQUESTS'),
    ]);

    // Every lock leaves a technical audit entry.
    const locks = await ctx.owner
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.action, 'lock_after_failed_attempts'),
          eq(auditLog.recordId, (await accountRow(ctx, 'tesorero')).id),
        ),
      );
    expect(locks).toEqual([expect.objectContaining({ isTechnical: true })]);

    // Another username from one of those IPs is not affected.
    expect((await api.loginFrom('203.0.113.1', 'secretario', DEV_PASSWORD)).status).toBe(200);
  });
});
