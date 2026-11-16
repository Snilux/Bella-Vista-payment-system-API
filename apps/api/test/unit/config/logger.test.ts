import { describe, expect, it } from 'vitest';
import { logSerializers, pathOnly, sanitizeError } from '../../../src/config/logger.js';

// Errors, requests and redaction of the logger (RNF-SEG-06).

/** Same shape as postgres.js PostgresError. */
function postgresError(fields: Record<string, unknown>): Error {
  return Object.assign(new Error(String(fields.message)), { severity: 'ERROR', ...fields });
}

/** Same shape as Drizzle's DrizzleQueryError. */
function drizzleError(query: string, params: unknown[], cause: Error): Error {
  const error = new Error(`Failed query: ${query}\nparams: ${params.join(',')}`, { cause });
  return Object.assign(error, { query, params });
}

describe('sanitizeError', () => {
  it('drops the SQL, the parameters and the detail of a unique violation', () => {
    const cause = postgresError({
      message: 'duplicate key value violates unique constraint "user_account_username_key"',
      code: '23505',
      constraint_name: 'user_account_username_key',
      table_name: 'user_account',
      detail: 'Key (username)=(ana.salinas) already exists.',
      query: 'insert into "user_account" ("username", "password_hash") values ($1, $2)',
      parameters: ['ana.salinas', '$argon2id$v=19$secret'],
    });
    const error = drizzleError(
      'insert into "user_account" ("username", "password_hash") values ($1, $2)',
      ['ana.salinas', '$argon2id$v=19$secret'],
      cause,
    );

    const serialized = JSON.stringify(logSerializers.err(error));
    for (const leak of ['ana.salinas', 'argon2id', 'insert into', 'Key (username)']) {
      expect(serialized).not.toContain(leak);
    }
    const safe = sanitizeError(error) as Error;
    expect(safe.message).toBe('Failed query (SQL and parameters omitted from the log)');
    expect(safe.cause).toMatchObject({
      message: 'duplicate key value violates unique constraint "user_account_username_key"',
      code: '23505',
      constraint_name: 'user_account_username_key',
      table_name: 'user_account',
    });
    expect(safe.cause).not.toHaveProperty('detail');
    expect(safe.cause).not.toHaveProperty('parameters');
  });

  it('omits the message of a data exception, which quotes the value', () => {
    const safe = sanitizeError(
      postgresError({ message: 'invalid input syntax for type integer: "5551234"', code: '22P02' }),
    ) as Error;
    expect(safe.message).toBe('Data exception 22P02 (message omitted: it may contain the value)');
    expect(safe.stack).not.toContain('5551234');
  });

  it('leaves other errors unchanged', () => {
    const error = new Error('unexpected');
    expect(sanitizeError(error)).toBe(error);
    expect(sanitizeError('text')).toBe('text');
  });
});

describe('request serializer', () => {
  it.each([
    ['/v1/search?q=Juan%20Perez', '/v1/search'],
    ['/v1/payments?unitId=4#x', '/v1/payments'],
    ['/v1/people/12', '/v1/people/12'],
  ])('logs %s as %s', (url, path) => {
    expect(pathOnly(url)).toBe(path);
    expect(logSerializers.req({ method: 'GET', url, ip: '10.0.0.1' })).toEqual({
      method: 'GET',
      url: path,
      host: undefined,
      remoteAddress: '10.0.0.1',
      remotePort: undefined,
    });
  });
});
