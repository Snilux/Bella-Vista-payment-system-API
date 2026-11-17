import { errorResponseSchema } from '@bella-vista/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildApp } from '../../../src/app.js';
import { createDb } from '../../../src/db/client.js';
import { AppError } from '../../../src/lib/errors.js';
import { testDatabaseUrl } from '../db/helpers.js';
import { testEnv, useApiTestApp } from './fixture.js';

// API step 1: single error format and /health.

const testRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    '/validate',
    {
      schema: {
        body: z.object({ amount: z.int().positive(), period: z.string().regex(/^\d{4}-\d{2}$/) }),
      },
    },
    async (request) => ({ ok: true, amount: request.body.amount }),
  );
  app.get('/boom', async () => {
    throw new Error('secret internal detail: password=hunter2');
  });
  app.get('/app-error', async () => {
    throw new AppError('PERIOD_ALREADY_PAID', 409, 'Junio 2026 ya está pagado.', {
      period: '2026-06',
    });
  });
  app.get(
    '/bad-response',
    { schema: { response: { 200: z.object({ n: z.number() }) } } },
    async () =>
      // Wrong on purpose: the response schema rejects it.
      ({ n: 'not a number' }) as unknown as { n: number },
  );
};

describe.skipIf(!testDatabaseUrl)('error format', () => {
  const ctx = useApiTestApp((app) => app.register(testRoutes, { prefix: '/v1/test' }));

  const expectErrorShape = (body: unknown) => {
    expect(errorResponseSchema.safeParse(body).success).toBe(true);
  };

  it('answers Zod validation errors with VALIDATION_ERROR and Spanish messages', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/v1/test/validate',
      headers: await ctx.authFor('tesorero'),
      payload: { amount: 'x', period: '2026' },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expectErrorShape(body);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toBe('Los datos enviados no son válidos.');
    expect(body.error.details.issues).toEqual([
      { path: 'body.amount', message: 'Entrada inválida: se esperaba número, recibido texto' },
      {
        path: 'body.period',
        message: expect.stringMatching(/^Cadena inválida: debe coincidir con el patrón/),
      },
    ]);
  });

  it('accepts valid data', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/v1/test/validate',
      headers: await ctx.authFor('tesorero'),
      payload: { amount: 5000, period: '2026-06' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, amount: 5000 });
  });

  it('answers malformed JSON with INVALID_REQUEST', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/v1/test/validate',
      headers: { ...(await ctx.authFor('tesorero')), 'content-type': 'application/json' },
      payload: '{"amount": ',
    });
    expect(res.statusCode).toBe(400);
    expectErrorShape(res.json());
    expect(res.json().error.code).toBe('INVALID_REQUEST');
  });

  it('passes AppError through with its status, code, message and details', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/v1/test/app-error',
      headers: await ctx.authFor('tesorero'),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({
      error: {
        code: 'PERIOD_ALREADY_PAID',
        message: 'Junio 2026 ya está pagado.',
        details: { period: '2026-06' },
      },
    });
  });

  it('hides unexpected errors behind INTERNAL_ERROR', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/v1/test/boom',
      headers: await ctx.authFor('tesorero'),
    });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Ocurrió un error inesperado. Intente de nuevo.',
        details: {},
      },
    });
    expect(res.body).not.toContain('hunter2');
  });

  it('treats a response that breaks its schema as INTERNAL_ERROR', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/v1/test/bad-response',
      headers: await ctx.authFor('tesorero'),
    });
    expect(res.statusCode).toBe(500);
    expect(res.json().error.code).toBe('INTERNAL_ERROR');
  });

  it.each(['/v1/does-not-exist', '/nope'])(
    'answers unknown route %s with NOT_FOUND',
    async (url) => {
      const res = await ctx.app.inject({ method: 'GET', url });
      expect(res.statusCode).toBe(404);
      expectErrorShape(res.json());
      expect(res.json().error.code).toBe('NOT_FOUND');
    },
  );

  it('sends security headers (helmet)', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/health' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});

describe.skipIf(!testDatabaseUrl)('GET /health', () => {
  const ctx = useApiTestApp();

  it('answers 200 when the database responds, without a session', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', database: 'ok' });
  });

  it('answers 503 DATABASE_UNAVAILABLE when the database does not respond', async () => {
    // Nothing listens on port 1: the connection is refused.
    const { db, sql } = createDb('postgres://nobody:nothing@127.0.0.1:1/none', { max: 1 });
    const app = await buildApp({ env: testEnv(ctx.url), db, healthTimeoutMs: 1_000 });
    try {
      const res = await app.inject({ method: 'GET', url: '/health' });
      expect(res.statusCode).toBe(503);
      expect(res.json()).toEqual({
        error: {
          code: 'DATABASE_UNAVAILABLE',
          message: 'La base de datos no responde. Intente más tarde.',
          details: {},
        },
      });
    } finally {
      await app.close();
      await sql.end({ timeout: 1 });
    }
  });
});
