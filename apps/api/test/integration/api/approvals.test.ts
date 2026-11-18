import { approvalListResponseSchema, approvalResponseSchema } from '@bella-vista/shared';
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { writeAudit } from '../../../src/db/audit.js';
import { approval, auditLog, userAccount } from '../../../src/db/schema/index.js';
import type { ApprovalHandler } from '../../../src/modules/approvals/approval-registry.js';
import { testDatabaseUrl } from '../db/helpers.js';
import { useApiTestApp } from './fixture.js';

// API step 3, approvals module: inbox and resolution by the president, with the outcome
// delegated to the handler each module registers for its type. These tests replace the
// handler of `opening_balance` with their own and remove the one of `plumber_salary`, to
// prove what happens with a type without handler.

const calls: { kind: 'approved' | 'rejected'; approvalId: number; reason: string | null }[] = [];
/** Approvals whose handler fails, to prove the resolution is rolled back with it. */
const failing = new Set<number>();

const testHandler: ApprovalHandler = {
  async onApproved({ tx, approvalId, actor, reason }) {
    if (failing.has(approvalId)) throw new Error('handler failed');
    calls.push({ kind: 'approved', approvalId, reason });
    await writeAudit(tx, actor, {
      action: 'test_handler',
      table: 'approval',
      recordId: approvalId,
    });
  },
  async onRejected({ approvalId, reason }) {
    calls.push({ kind: 'rejected', approvalId, reason });
  },
  async describe(_db, ids) {
    return new Map(
      ids.map((id) => [
        id,
        { description: `Saldo inicial de prueba #${id}`, subject: { type: 'cashbox', id: 1 } },
      ]),
    );
  },
};

describe.skipIf(!testDatabaseUrl)('/v1/approvals', () => {
  const ctx = useApiTestApp((app) => {
    app.approvalRegistry.replace('opening_balance', testHandler);
    app.approvalRegistry.replace('plumber_salary', null);
  });

  beforeAll(async () => {
    await ctx.owner
      .update(userAccount)
      .set({ mustChangePassword: false })
      .where(eq(userAccount.username, 'admin'));
  });

  /** A pending approval requested by `username`. */
  const request = async (
    username: string,
    type: 'opening_balance' | 'plumber_salary' = 'opening_balance',
  ) => {
    const requester = await ctx.accountId(username);
    const [row] = await ctx.owner
      .insert(approval)
      .values({
        type,
        reason: `Solicitud de ${username}`,
        requestedBy: requester,
        createdBy: requester,
      })
      .returning();
    if (!row) throw new Error('approval not inserted');
    return row.id;
  };
  const resolve = async (id: number, body: Record<string, unknown>, username = 'presidente') => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/v1/approvals/${id}/resolve`,
      headers: await ctx.authFor(username),
      payload: body,
    });
    return { status: res.statusCode, body: res.json() };
  };
  const inbox = async (username: string, status?: string) => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: `/v1/approvals${status ? `?status=${status}` : ''}`,
      headers: await ctx.authFor(username),
    });
    return { status: res.statusCode, body: res.json() };
  };
  const stored = async (id: number) => {
    const [row] = await ctx.owner.select().from(approval).where(eq(approval.id, id));
    return row;
  };

  it('shows the president every pending request and each requester only theirs', async () => {
    const fromTreasurer = await request('tesorero');
    const fromSecretary = await request('secretario');

    const president = await inbox('presidente');
    expect(president.status).toBe(200);
    expect(approvalListResponseSchema.safeParse(president.body).success).toBe(true);
    const ids = president.body.approvals.map((a: { id: number }) => a.id);
    expect(ids).toEqual(expect.arrayContaining([fromTreasurer, fromSecretary]));
    expect(
      president.body.approvals.find((a: { id: number }) => a.id === fromTreasurer),
    ).toMatchObject({
      type: 'opening_balance',
      status: 'pending',
      reason: 'Solicitud de tesorero',
      description: `Saldo inicial de prueba #${fromTreasurer}`,
      requestedBy: { username: 'tesorero', role: 'treasurer', fullName: 'Bruno Ochoa' },
      resolvedBy: null,
    });

    const treasurer = await inbox('tesorero');
    expect(treasurer.body.approvals.map((a: { id: number }) => a.id)).toEqual([fromTreasurer]);
    expect((await inbox('jm.s1m01')).body.approvals).toEqual([]);
  });

  it('approves: records the resolution, runs the handler in the transaction and audits it', async () => {
    const id = await request('tesorero');
    const res = await resolve(id, { result: 'approved' });
    expect(res.status).toBe(200);
    expect(res.body.approval).toMatchObject({
      id,
      status: 'approved',
      resolvedBy: { username: 'presidente', role: 'president' },
      resolutionReason: null,
    });
    expect(calls).toContainEqual({ kind: 'approved', approvalId: id, reason: null });

    const actions = await ctx.owner
      .select({ action: auditLog.action, role: auditLog.role })
      .from(auditLog)
      .where(and(eq(auditLog.tableName, 'approval'), eq(auditLog.recordId, id)));
    expect(actions).toEqual(
      expect.arrayContaining([
        { action: 'test_handler', role: 'president' },
        { action: 'approve', role: 'president' },
      ]),
    );

    // The requester follows it among the resolved ones.
    const mine = await inbox('tesorero', 'resolved');
    expect(mine.body.approvals.map((a: { id: number }) => a.id)).toContain(id);
  });

  it('requires a reason to reject', async () => {
    const id = await request('secretario');
    const missing = await resolve(id, { result: 'rejected', reason: '  ' });
    expect(missing.status).toBe(400);
    expect(missing.body.error.details.issues).toEqual([
      { path: 'body.reason', message: 'Escriba el motivo del rechazo.' },
    ]);
    expect((await stored(id))?.result).toBeNull();

    const res = await resolve(id, { result: 'rejected', reason: 'Falta el acta' });
    expect(res.body.approval).toMatchObject({
      status: 'rejected',
      resolutionReason: 'Falta el acta',
    });
    expect(calls).toContainEqual({ kind: 'rejected', approvalId: id, reason: 'Falta el acta' });
  });

  it('does not resolve twice (APPROVAL_ALREADY_RESOLVED)', async () => {
    const id = await request('tesorero');
    await resolve(id, { result: 'approved' });
    expect(await resolve(id, { result: 'rejected', reason: 'Cambio de opinión' })).toEqual({
      status: 409,
      body: {
        error: {
          code: 'APPROVAL_ALREADY_RESOLVED',
          message: 'Esta solicitud ya fue resuelta.',
          details: { result: 'approved' },
        },
      },
    });
  });

  it('lets only one of two simultaneous resolutions win', async () => {
    const id = await request('tesorero');
    const results = await Promise.all([
      resolve(id, { result: 'approved' }),
      resolve(id, { result: 'rejected', reason: 'Duplicada' }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const handlerRuns = calls.filter((call) => call.approvalId === id);
    expect(handlerRuns).toHaveLength(1);
  });

  it('rolls back the resolution when the handler fails', async () => {
    const id = await request('tesorero');
    failing.add(id);
    const res = await resolve(id, { result: 'approved' });
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    expect(await stored(id)).toMatchObject({ result: null, resolvedBy: null });
  });

  it('refuses a type whose module has not registered a handler, changing nothing', async () => {
    const id = await request('tesorero', 'plumber_salary');
    expect((await resolve(id, { result: 'approved' })).status).toBe(500);
    expect((await stored(id))?.result).toBeNull();
    // It still shows in the inbox, without description.
    const item = (await inbox('presidente')).body.approvals.find(
      (a: { id: number }) => a.id === id,
    );
    expect(item).toMatchObject({ type: 'plumber_salary', description: null });
  });

  it('gives one approval with its subject: the president any, the requester only theirs', async () => {
    const id = await request('tesorero');
    const get = async (username: string, approvalId = id) => {
      const res = await ctx.app.inject({
        method: 'GET',
        url: `/v1/approvals/${approvalId}`,
        headers: await ctx.authFor(username),
      });
      return { status: res.statusCode, body: res.json() };
    };
    const president = await get('presidente');
    expect(president.status).toBe(200);
    expect(approvalResponseSchema.safeParse(president.body).success).toBe(true);
    expect(president.body.approval).toMatchObject({
      id,
      type: 'opening_balance',
      description: `Saldo inicial de prueba #${id}`,
      subject: { type: 'cashbox', id: 1 },
    });
    expect((await get('tesorero')).body.approval.id).toBe(id);
    // Someone else's request does not exist for them; nor an unknown id.
    expect(await get('secretario')).toMatchObject({
      status: 404,
      body: { error: { code: 'NOT_FOUND' } },
    });
    expect((await get('presidente', 999_999)).status).toBe(404);
    expect((await get('admin')).status).toBe(403);
  });

  it('answers NOT_FOUND for an unknown approval', async () => {
    expect((await resolve(999_999, { result: 'approved' })).body.error.code).toBe('NOT_FOUND');
  });

  it.each(['admin', 'tesorero', 'secretario', 'vocal', 'jm.s1m01'])(
    'only the president resolves: %s gets 403',
    async (username) => {
      const id = await request('tesorero');
      const res = await resolve(id, { result: 'approved' }, username);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
      expect((await stored(id))?.result).toBeNull();
    },
  );

  it('keeps the superadmin out of the inbox (D-19)', async () => {
    expect((await inbox('admin')).body.error.code).toBe('FORBIDDEN');
  });
});
