import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { applyAuditContext, writeAudit } from '../../../src/db/audit.js';
import { idempotentTransaction } from '../../../src/db/idempotency.js';
import { auditLog, idempotencyKey, person } from '../../../src/db/schema/index.js';
import { requireActor } from '../../../src/plugins/audit-context.js';
import { requireIdempotency, sendIdempotent } from '../../../src/plugins/idempotency.js';
import { testDatabaseUrl } from '../db/helpers.js';
import { useApiTestApp } from './fixture.js';

// API step 1: Idempotency-Key on money-moving POSTs and the audit context. The test routes
// stand in for a money operation: each execution writes one audit entry, so the number of
// entries for a key is the number of times the operation ran.

const testRoutes: FastifyPluginAsyncZod = async (app) => {
  const charge = async (
    request: FastifyRequest,
    body: { amount: number; delayMs?: number | undefined },
  ) => {
    const idempotency = requireIdempotency(request);
    const actor = requireActor(request);
    return idempotentTransaction(app.db, idempotency, async (tx) => {
      if (body.delayMs) await tx.execute(sql`SELECT pg_sleep(${body.delayMs / 1000})`);
      await writeAudit(tx, actor, {
        action: 'test_charge',
        table: 'payment',
        recordId: body.amount,
        after: { key: idempotency.key, amount: body.amount },
      });
      return { status: 201, body: { amount: body.amount, executedAt: new Date().toISOString() } };
    });
  };
  const chargeBody = z.object({ amount: z.int().positive(), delayMs: z.int().optional() });

  for (const path of ['/charge', '/charge-other']) {
    app.post(
      path,
      { config: { permission: 'billing.collect', idempotent: true }, schema: { body: chargeBody } },
      async (request, reply) => sendIdempotent(reply, await charge(request, request.body)),
    );
  }

  app.post(
    '/contact/:personId',
    {
      schema: {
        params: z.object({ personId: z.coerce.number().int() }),
        body: z.object({ phone: z.string(), withContext: z.boolean() }),
      },
    },
    async (request) => {
      const actor = requireActor(request);
      await app.db.transaction(async (tx) => {
        if (request.body.withContext) await applyAuditContext(tx, actor, 'Corrección de teléfono');
        await tx
          .update(person)
          .set({ phone: request.body.phone })
          .where(eq(person.id, request.params.personId));
      });
      return { ok: true };
    },
  );

  app.post('/note', { config: { allowPendingPasswordChange: true } }, async (request) => {
    const actor = requireActor(request);
    await app.db.transaction((tx) =>
      writeAudit(tx, actor, {
        action: 'test_note',
        table: 'user_account',
        recordId: actor.userAccountId,
      }),
    );
    return { ok: true };
  });
};

describe.skipIf(!testDatabaseUrl)('Idempotency-Key', () => {
  const ctx = useApiTestApp((app) => app.register(testRoutes, { prefix: '/v1/test' }));

  const post = async (
    url: string,
    username: string,
    key: string | undefined,
    payload: Record<string, unknown> = { amount: 5000 },
  ) => {
    const headers: Record<string, string> = await ctx.authFor(username);
    if (key !== undefined) headers['idempotency-key'] = key;
    return ctx.app.inject({ method: 'POST', url, headers, payload });
  };
  const executions = async (key: string) => {
    const rows = await ctx.owner
      .select({ id: auditLog.id })
      .from(auditLog)
      .where(and(eq(auditLog.action, 'test_charge'), sql`${auditLog.after}->>'key' = ${key}`));
    return rows.length;
  };

  it.each([
    ['missing', undefined],
    ['not a UUID', 'abc-123'],
    ['blank', '   '],
  ])('rejects a %s key with IDEMPOTENCY_KEY_REQUIRED', async (_case, key) => {
    const res = await post('/v1/test/charge', 'tesorero', key);
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });

  it('replays the stored response of a repeated key without running the operation again', async () => {
    const key = randomUUID();
    const first = await post('/v1/test/charge', 'tesorero', key);
    expect(first.statusCode).toBe(201);
    expect(first.headers['idempotent-replayed']).toBeUndefined();

    // Same key, even with another body and in upper case: the stored response wins.
    const second = await post('/v1/test/charge', 'tesorero', key.toUpperCase(), { amount: 9999 });
    expect(second.statusCode).toBe(201);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(second.json()).toEqual(first.json());
    expect(await executions(key)).toBe(1);
  });

  it('runs the operation once when two requests with the same key arrive together', async () => {
    const key = randomUUID();
    const [a, b] = await Promise.all([
      post('/v1/test/charge', 'tesorero', key, { amount: 7000, delayMs: 300 }),
      post('/v1/test/charge', 'tesorero', key, { amount: 7000, delayMs: 300 }),
    ]);
    expect([a?.statusCode, b?.statusCode]).toEqual([201, 201]);
    expect(a?.json()).toEqual(b?.json());
    expect([a?.headers['idempotent-replayed'], b?.headers['idempotent-replayed']].sort()).toEqual([
      'true',
      undefined,
    ]);
    expect(await executions(key)).toBe(1);
  });

  it('rejects a key used by another account or on another route', async () => {
    const key = randomUUID();
    expect((await post('/v1/test/charge', 'tesorero', key)).statusCode).toBe(201);

    const otherAccount = await post('/v1/test/charge', 'jm.s1m01', key);
    expect(otherAccount.statusCode).toBe(409);
    expect(otherAccount.json().error.code).toBe('IDEMPOTENCY_KEY_REUSED');

    const otherRoute = await post('/v1/test/charge-other', 'tesorero', key);
    expect(otherRoute.statusCode).toBe(409);
    expect(otherRoute.json().error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(await executions(key)).toBe(1);
  });

  it('forgets keys older than 24 h: they are purged and the operation runs again', async () => {
    const key = randomUUID();
    await ctx.owner.insert(idempotencyKey).values({
      key,
      userAccountId: await ctx.accountId('tesorero'),
      route: 'POST /v1/test/charge',
      response: { status: 201, body: { stale: true } },
      createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
    });
    const res = await post('/v1/test/charge', 'tesorero', key);
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ amount: 5000 });
    expect(await executions(key)).toBe(1);

    const [stored] = await ctx.owner
      .select()
      .from(idempotencyKey)
      .where(eq(idempotencyKey.key, key));
    expect(stored?.response).toMatchObject({ status: 201, body: { amount: 5000 } });
    expect(stored?.createdAt.getTime()).toBeGreaterThan(Date.now() - 60_000);
  });

  it('checks the permission before the key', async () => {
    const res = await post('/v1/test/charge', 'secretario', randomUUID());
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('FORBIDDEN');
  });
});

describe.skipIf(!testDatabaseUrl)('audit context', () => {
  const ctx = useApiTestApp((app) => app.register(testRoutes, { prefix: '/v1/test' }));

  it('records entries with the account and role; superadmin entries are technical', async () => {
    for (const username of ['tesorero', 'admin']) {
      const res = await ctx.app.inject({
        method: 'POST',
        url: '/v1/test/note',
        headers: await ctx.authFor(username),
      });
      expect(res.statusCode).toBe(200);
    }
    const rows = await ctx.owner
      .select({
        userAccountId: auditLog.userAccountId,
        role: auditLog.role,
        isTechnical: auditLog.isTechnical,
      })
      .from(auditLog)
      .where(eq(auditLog.action, 'test_note'))
      .orderBy(auditLog.id);
    expect(rows).toEqual([
      { userAccountId: await ctx.accountId('tesorero'), role: 'treasurer', isTechnical: false },
      { userAccountId: await ctx.accountId('admin'), role: 'superadmin', isTechnical: true },
    ]);
  });

  it('lets the contact-change trigger audit an update made with the context', async () => {
    const [target] = await ctx.owner.select().from(person).where(eq(person.givenNames, 'Carmen'));
    if (!target) throw new Error('person not found');

    const res = await ctx.app.inject({
      method: 'POST',
      url: `/v1/test/contact/${target.id}`,
      headers: await ctx.authFor('secretario'),
      payload: { phone: '5559998877', withContext: true },
    });
    expect(res.statusCode).toBe(200);

    const [entry] = await ctx.owner
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, 'update_contact'), eq(auditLog.recordId, target.id)));
    expect(entry).toMatchObject({
      userAccountId: await ctx.accountId('secretario'),
      role: 'secretary',
      tableName: 'person',
      reason: 'Corrección de teléfono',
      after: { phone: '5559998877' },
      isTechnical: false,
    });
  });

  it('rejects a contact update without the context and changes nothing', async () => {
    const [target] = await ctx.owner.select().from(person).where(eq(person.givenNames, 'Ernesto'));
    if (!target) throw new Error('person not found');

    const res = await ctx.app.inject({
      method: 'POST',
      url: `/v1/test/contact/${target.id}`,
      headers: await ctx.authFor('secretario'),
      payload: { phone: '5550000000', withContext: false },
    });
    expect(res.statusCode).toBe(500);
    expect(res.json().error.code).toBe('INTERNAL_ERROR');
    const [after] = await ctx.owner.select().from(person).where(eq(person.id, target.id));
    expect(after?.phone).toBe(target.phone);
  });
});
