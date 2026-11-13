import { describe, expect, it } from 'vitest';
import { InvalidEnvError, loadEnv } from '../../../src/config/env.js';

const required = {
  DATABASE_URL: 'postgres://agua:agua@db:5432/agua',
  JWT_ACCESS_SECRET: 'x'.repeat(32),
};

describe('loadEnv', () => {
  it('applies defaults when only required variables are set', () => {
    expect(loadEnv(required)).toEqual({
      ...required,
      NODE_ENV: 'development',
      API_PORT: 3000,
      LOG_LEVEL: 'info',
      BUSINESS_TIMEZONE: 'America/Mexico_City',
      JWT_ACCESS_TTL: '15m',
      REFRESH_TOKEN_TTL_DAYS: 30,
      LOGIN_MAX_ATTEMPTS: 5,
      LOGIN_LOCKOUT_MINUTES: 15,
    });
  });

  it('coerces numeric variables from strings', () => {
    const env = loadEnv({ ...required, API_PORT: '8080', LOGIN_MAX_ATTEMPTS: '3' });
    expect(env.API_PORT).toBe(8080);
    expect(env.LOGIN_MAX_ATTEMPTS).toBe(3);
  });

  it('treats empty strings as missing', () => {
    expect(loadEnv({ ...required, LOG_LEVEL: '' }).LOG_LEVEL).toBe('info');
  });

  it.each([
    ['missing DATABASE_URL', { JWT_ACCESS_SECRET: required.JWT_ACCESS_SECRET }, 'DATABASE_URL'],
    ['non-postgres DATABASE_URL', { ...required, DATABASE_URL: 'mysql://x/y' }, 'DATABASE_URL'],
    ['short JWT secret', { ...required, JWT_ACCESS_SECRET: 'short' }, 'JWT_ACCESS_SECRET'],
    ['bad TTL', { ...required, JWT_ACCESS_TTL: '15 minutes' }, 'JWT_ACCESS_TTL'],
    ['bad NODE_ENV', { ...required, NODE_ENV: 'staging' }, 'NODE_ENV'],
    ['zero attempts', { ...required, LOGIN_MAX_ATTEMPTS: '0' }, 'LOGIN_MAX_ATTEMPTS'],
  ])('rejects %s', (_label, source, key) => {
    expect(() => loadEnv(source)).toThrow(InvalidEnvError);
    expect(() => loadEnv(source)).toThrow(key);
  });

  it('lists every invalid variable at once', () => {
    try {
      loadEnv({});
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidEnvError);
      const keys = (error as InvalidEnvError).issues.map((issue) => issue.split(':')[0]);
      expect(keys).toEqual(expect.arrayContaining(['DATABASE_URL', 'JWT_ACCESS_SECRET']));
    }
  });
});
