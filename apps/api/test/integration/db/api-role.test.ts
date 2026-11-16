import { randomBytes } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ApiRoleError, checkLogin, syncApiRole } from '../../../src/db/api-role.js';
import { testDatabaseUrl } from './helpers.js';

// `pnpm db:migrate` sets the API role's password from DATABASE_URL. Roles are shared by every
// database of the server (the dev database included), so this uses a temporary role instead
// of agua_api.

describe.skipIf(!testDatabaseUrl)('syncApiRole', () => {
  const role = `agua_api_tmp_${randomBytes(4).toString('hex')}`;
  let owner: postgres.Sql;

  const urlFor = (password: string) => {
    const url = new URL(testDatabaseUrl ?? '');
    url.username = role;
    url.password = encodeURIComponent(password);
    return url.toString();
  };

  beforeAll(async () => {
    owner = postgres(testDatabaseUrl ?? '', { max: 1, onnotice: () => {} });
    // Like migration 0015 on a volume created without the role: no LOGIN, no password.
    await owner.unsafe(`CREATE ROLE ${role} NOLOGIN`);
  });

  afterAll(async () => {
    await owner.unsafe(`DROP ROLE IF EXISTS ${role}`);
    await owner.end();
  });

  it('enables login with the password, again and again', async () => {
    const first = "first'pa$$ @:/";
    await syncApiRole(owner, { role, password: first });
    await syncApiRole(owner, { role, password: first });
    expect(await checkLogin(urlFor(first))).toBe(role);

    await syncApiRole(owner, { role, password: 'second' });
    expect(await checkLogin(urlFor('second'))).toBe(role);
    await expect(checkLogin(urlFor(first))).rejects.toMatchObject({ code: '28P01' });
  });

  it('fails when the role does not exist', async () => {
    await expect(
      syncApiRole(owner, { role: `${role}_missing`, password: 'x' }),
    ).rejects.toBeInstanceOf(ApiRoleError);
  });
});
