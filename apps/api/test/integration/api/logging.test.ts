import { Writable } from 'node:stream';
import { sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { loggerOptions } from '../../../src/config/logger.js';
import { testDatabaseUrl } from '../db/helpers.js';
import { useApiTestApp } from './fixture.js';

// No secrets nor personal data in the logs (RNF-SEG-06): a forced 500 from a failing query
// with sensitive parameters, a careless log of the body and headers, and a search URL.

const SECRET = 'S3creto-Juan-Perez-5551234';
const PASSWORD = 'Contrasena-Muy-Secreta-1';

const lines: string[] = [];
const stream = new Writable({
  write(chunk, _encoding, done) {
    lines.push(chunk.toString());
    done();
  },
});

const testRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    '/failing-query',
    { schema: { body: z.object({ password: z.string() }) } },
    async (request) => {
      // A careless log a future change could add: redaction must hide the secrets.
      request.log.info({ body: request.body, headers: request.headers }, 'careless dump');
      // Fails with 22P02, whose message quotes the value; Drizzle adds the SQL and params.
      await request.server.db.execute(sql`SELECT ${SECRET}::int AS n`);
      return { ok: true };
    },
  );
};

describe.skipIf(!testDatabaseUrl)('logs without secrets or personal data', () => {
  const ctx = useApiTestApp((app) => app.register(testRoutes, { prefix: '/v1/test' }), {
    logger: { ...loggerOptions({ LOG_LEVEL: 'info', NODE_ENV: 'test' }), stream },
  });

  const logged = () => lines.map((line) => JSON.parse(line) as Record<string, unknown>);

  it('logs a forced 500 without the query, its values, the token or the password', async () => {
    lines.length = 0;
    const auth = await ctx.authFor('tesorero');
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/v1/test/failing-query?q=Juan%20Perez',
      headers: auth,
      payload: { password: PASSWORD },
    });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Ocurrió un error inesperado. Intente de nuevo.',
        details: {},
      },
    });

    const text = lines.join('');
    for (const leak of [SECRET, PASSWORD, auth.authorization.slice(7), 'SELECT', 'Juan']) {
      expect(text, `log contains ${leak}`).not.toContain(leak);
    }

    const failure = logged().find((entry) => entry.msg === 'request failed');
    // Still useful for diagnosis: the kind of failure and its SQLSTATE (from the cause).
    expect(failure?.err).toMatchObject({
      message:
        'Failed query (SQL and parameters omitted from the log): Data exception 22P02 (message omitted: it may contain the value)',
    });
    const dump = logged().find((entry) => entry.msg === 'careless dump');
    expect(dump).toMatchObject({
      body: { password: '[REDACTED]' },
      headers: { authorization: '[REDACTED]' },
    });
    const incoming = logged().find((entry) => entry.msg === 'incoming request');
    expect(incoming?.req).toMatchObject({ method: 'POST', url: '/v1/test/failing-query' });
  });
});
