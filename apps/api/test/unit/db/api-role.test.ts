import { describe, expect, it } from 'vitest';
import { ApiRoleError, apiLoginFromUrls } from '../../../src/db/api-role.js';

const owner = 'postgres://agua:owner-secret@db:5432/agua';

describe('apiLoginFromUrls', () => {
  it.each([
    {
      name: 'reads role and password',
      url: 'postgres://agua_api:s3cret@db:5432/agua',
      expected: { role: 'agua_api', password: 's3cret' },
    },
    {
      name: 'decodes percent-encoded characters',
      url: 'postgres://agua_api:p%40ss%3Aw%2Fd%27x@db:5432/agua',
      expected: { role: 'agua_api', password: "p@ss:w/d'x" },
    },
    {
      name: 'ignores the database (main or test)',
      url: 'postgresql://agua_api:s3cret@db:5432/agua_test',
      expected: { role: 'agua_api', password: 's3cret' },
    },
    { name: 'skips when it uses the migrations user', url: owner, expected: null },
  ])('$name', ({ url, expected }) => {
    expect(apiLoginFromUrls(url, owner)).toEqual(expected);
  });

  it.each([
    { name: 'another user', url: 'postgres://someone:x@db:5432/agua' },
    { name: 'no password', url: 'postgres://agua_api@db:5432/agua' },
  ])('rejects $name', ({ url }) => {
    expect(() => apiLoginFromUrls(url, owner)).toThrow(ApiRoleError);
  });
});
