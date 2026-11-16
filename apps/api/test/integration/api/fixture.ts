import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll } from 'vitest';
import { type App, buildApp } from '../../../src/app.js';
import { type Env, loadEnv } from '../../../src/config/env.js';
import type { Database } from '../../../src/db/client.js';
import * as schema from '../../../src/db/schema/index.js';
import { userAccount } from '../../../src/db/schema/index.js';
import { runBootstrap } from '../../../src/db/seed/bootstrap.js';
import { parseBootstrapFile } from '../../../src/db/seed/bootstrap-file.js';
import { runDevSeed } from '../../../src/db/seed/dev-data.js';
import { migrateDatabase, testDatabaseUrl } from '../db/helpers.js';

// API tests with app.inject() against a fresh database per test file: migrated, bootstrapped
// (superadmin `admin`, who must change the password) and loaded with the development data
// (accounts presidente, tesorero, secretario, jm.s1m01, jm.s1m02, jm.s2m01). The app connects
// as agua_api, like in production; `owner` is the database owner, for test setup only.

export const BOOTSTRAP_FILE = parseBootstrapFile({
  superadministrador: { nombres: 'Admin', apellidoPaterno: 'Sistema', usuario: 'admin' },
  acuerdo: { fechaJunta: '2024-11-30', tema: 'Elección del comité' },
  presidente: { nombres: 'Ana', apellidoPaterno: 'Salinas', fechaInicio: '2024-12-01' },
  tesorero: { nombres: 'Bruno', apellidoPaterno: 'Ochoa', fechaInicio: '2024-12-01' },
  secretario: { nombres: 'Celia', apellidoPaterno: 'Paredes', fechaInicio: '2024-12-01' },
});

const connect = (url: string, asApi: boolean) => {
  const client = postgres(url, {
    max: 4,
    connection: { TimeZone: 'UTC', ...(asApi && { options: '-c role=agua_api' }) },
    onnotice: () => {},
  });
  return { client, db: drizzle({ client, schema, casing: 'snake_case' }) as Database };
};

export function testEnv(databaseUrl: string): Env {
  return loadEnv({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: databaseUrl,
    JWT_ACCESS_SECRET: 'test-secret-with-at-least-32-characters!',
  });
}

export interface ApiTestContext {
  app: App;
  /** Connection as agua_api (the one the app uses). */
  db: Database;
  /** Connection as the owner, to change state the API user cannot (setup only). */
  owner: Database;
  url: string;
  accountId(username: string): Promise<number>;
}

/**
 * Prepares the database and the app for one `describe` block. `extend` registers extra
 * routes (test-only routes under /v1/test) before the app is ready.
 */
export function useApiTestApp(extend?: (app: App) => unknown): ApiTestContext {
  const ctx = {} as ApiTestContext;
  const dbName = `agua_test_api_${randomBytes(4).toString('hex')}`;
  const adminUrl = testDatabaseUrl ?? '';
  const url = new URL(adminUrl);
  url.pathname = `/${dbName}`;
  const pools: postgres.Sql[] = [];

  beforeAll(async () => {
    const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
    try {
      await admin.unsafe(`CREATE DATABASE ${dbName}`);
    } finally {
      await admin.end();
    }
    await migrateDatabase(url.toString());

    const api = connect(url.toString(), true);
    const owner = connect(url.toString(), false);
    pools.push(api.client, owner.client);

    await runBootstrap(api.db, BOOTSTRAP_FILE, {
      now: new Date('2024-12-01T18:00:00Z'),
      timeZone: 'America/Mexico_City',
      generatePassword: () => 'Temporal-1234',
    });
    await runDevSeed(api.db, { nodeEnv: 'test' });

    const app = await buildApp({ env: testEnv(url.toString()), db: api.db });
    await extend?.(app);
    await app.ready();

    const accountId = async (username: string) => {
      const [row] = await owner.db
        .select({ id: userAccount.id })
        .from(userAccount)
        .where(eq(userAccount.username, username));
      if (!row) throw new Error(`unknown account ${username}`);
      return row.id;
    };

    Object.assign(ctx, {
      app,
      db: api.db,
      owner: owner.db,
      url: url.toString(),
      accountId,
    } satisfies ApiTestContext);
  }, 60_000);

  afterAll(async () => {
    await ctx.app?.close();
    await Promise.all(pools.map((pool) => pool.end()));
    const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
    try {
      await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    } finally {
      await admin.end();
    }
  });

  return ctx;
}
