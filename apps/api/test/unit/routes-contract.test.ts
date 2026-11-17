import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { RouteOptions } from 'fastify';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadEnv } from '../../src/config/env.js';
import type { Database } from '../../src/db/client.js';

// The endpoint tables of docs/api.md (one method and one route per row) must list exactly the
// routes Fastify registers, so the contract the app and Notion 2.3 rely on cannot drift.

const API_DOC = fileURLToPath(new URL('../../../../docs/api.md', import.meta.url));

/** "/v1/units/{id}/account-statement?x=" → "/v1/units/:id/account-statement". */
const normalize = (path: string) => {
  const withoutQuery = path.split('?')[0] ?? path;
  const withParams = withoutQuery.replace(/\{(\w+)\}/g, ':$1');
  return withParams.length > 1 ? withParams.replace(/\/+$/, '') : withParams;
};

function documentedRoutes(markdown: string): string[] {
  const start = markdown.indexOf('\n## Endpoints');
  const end = markdown.indexOf('\n## ', start + 1);
  const section = markdown.slice(start, end === -1 ? undefined : end);
  const routes: string[] = [];
  for (const line of section.split('\n')) {
    const match = /^\|\s*(GET|POST|PATCH|PUT|DELETE)\s*\|\s*(\S+)\s*\|/.exec(line);
    if (match) routes.push(`${match[1]} ${normalize(match[2] ?? '')}`);
  }
  return routes;
}

async function registeredRoutes(): Promise<string[]> {
  const routes = new Set<string>();
  const app = await buildApp({
    env: loadEnv({
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      DATABASE_URL: 'postgres://unused@localhost:5432/unused',
      JWT_ACCESS_SECRET: 'test-secret-with-at-least-32-characters!',
    }),
    // Registering routes never queries the database.
    db: {} as unknown as Database,
    onRoute: (route: RouteOptions) => {
      const methods = Array.isArray(route.method) ? route.method : [route.method];
      for (const method of methods) {
        // HEAD is added by Fastify for every GET.
        if (method !== 'HEAD') routes.add(`${method} ${normalize(route.url)}`);
      }
    },
  });
  await app.close();
  return [...routes];
}

describe('docs/api.md', () => {
  it('lists exactly the routes the API registers', async () => {
    const documented = documentedRoutes(readFileSync(API_DOC, 'utf8'));
    const registered = await registeredRoutes();

    expect(documented.length).toBeGreaterThan(0);
    expect(new Set(documented).size, 'a route is documented twice').toBe(documented.length);
    expect({
      missingInDocs: registered.filter((route) => !documented.includes(route)).sort(),
      notRegistered: documented.filter((route) => !registered.includes(route)).sort(),
    }).toEqual({ missingInDocs: [], notRegistered: [] });
  });
});
