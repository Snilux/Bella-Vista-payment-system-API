# Bella Vista water payment system

Mobile app and API for the Bella Vista community water committee: resident registry, monthly fee collection, cash boxes, expenses and closings. This repository holds the **API**, the **mobile app** (Expo / React Native, `apps/mobile`) and the **shared** package.

Read `docs/README.md` first. The business rules in `docs/decisiones.md` override any assumption.

**Before each block, review "3.1 Plan de implementación" in Notion (https://app.notion.com/p/417088c27ae0815b89bcf1c5577b1755); if it differs from `docs/`, Notion wins** and `docs/` is updated in a separate `docs` commit. The block order and status live in `docs/estructura.md` ("Plan de implementación").

For the mobile app, the plan is "3.2 Plan de implementación de la app móvil" in Notion (https://app.notion.com/p/41a088c27ae081e69d52fdb008c5746a): phases M1 to M9, screen routes and acceptance criteria. Where it names packages `@agua/*`, routes or error codes in Spanish, the code's names win (`@bella-vista/*`, `docs/glosario.md`).

The Figma captures are in `docs/diseno/` (not versioned). Use them to compare the look; the structure and the texts come from 2.5 and 2.6 in Notion.

## Language

- Code, comments, identifiers, commit messages and this file: **English**.
- **Contracts use the code's English identifiers**: routes, query parameters, JSON fields, enum values and error codes, the same in the code, in `docs/api.md` and in Notion 2.3 and 3.2. `apps/api/test/unit/routes-contract.test.ts` fails if the routes Fastify registers and the endpoint tables of `docs/api.md` differ. Screen routes of the app (`apps/mobile/app`) are in English too.
- Everything the end user sees (API messages, app texts, formatted amounts and dates) and the prose of `docs/`: **Spanish (es-MX)**, addressing the user as **usted**.
- The database stays documented in Spanish: `docs/modelo-datos.md` names tables, columns and enums in Spanish. Translate them with `docs/glosario.md`; when a term is missing, add it to the glossary in the same commit.

## Stack

- Node.js 24, strict TypeScript, ESM, pnpm workspaces.
- API: Fastify 5 + `fastify-type-provider-zod`, Zod 4, Drizzle ORM with the `postgres` driver, PostgreSQL 16, Argon2, `@fastify/jwt`, pino.
- Tests: Vitest. Lint and format: Biome.
- Docker Compose for the database and the API in development.

## Environment and commands

You normally work **inside the Dev Container** (`api` service of docker-compose): Node, pnpm and Git are there, the database answers on `db:5432` and the connections are already set: `DATABASE_URL` (the API, user `agua_api`) and `DATABASE_URL_MIGRATIONS` (`pnpm db:migrate`, the owner). There is no Docker inside the container: do not run `pnpm docker:*`.

| Command | What it does |
|---|---|
| `pnpm dev` | API with hot reload at http://localhost:3000 |
| `pnpm dev:mobile` | Expo (Metro on port 8081) for the mobile app; open it with Expo Go (README) |
| `pnpm check` | Lint + types + tests. Must pass before every commit |
| `pnpm db:generate` | Generates a migration from `apps/api/src/db/schema` |
| `pnpm db:migrate` | Applies pending migrations, then sets agua_api's password from `DATABASE_URL` |
| `pnpm install` | After changing dependencies |

## Structure

```
apps/api/src/
  server.ts            process entry: env, database pool, listen, graceful shutdown
  app.ts               buildApp({ env, db }): Fastify + Zod, plugins and routes (tests use inject())
  config/              environment variables validated with Zod; pino logger options (redaction)
  db/schema/           Drizzle tables;  db/migrations/  generated migrations
  db/audit.ts, db/idempotency.ts   audit log writes and Idempotency-Key storage (inside transactions)
  db/seed/             pnpm db:seed (bootstrap, D-27) and pnpm db:seed:dev
  plugins/             auth (/v1 secure by default), permissions, idempotency, audit context, errors
  routes/              routes outside the modules (/health)
  lib/                 domain-free utilities (money, dates, errors)
  modules/<module>/    one module per domain (see docs/estructura.md)
apps/api/test/         unit/ and integration/ (integration uses DATABASE_URL_TEST)
apps/mobile/
  app/                 Expo Router routes (dev/gallery: component gallery, development only)
  src/ui/              design-system components (2.4 and Figma), one file each; theme/ holds the tokens
  src/api/             client.ts (fetch, token refresh, errors), error-messages.ts, query hooks
  src/session/         tokens (access in memory, refresh in SecureStore); M2 adds the session context
  test/                Jest (jest-expo): api/ and ui/ (including the 140 % text checks)
packages/shared/src/   schemas/ (Zod), domain/ (pure rules), format/ (es-MX)
docs/                  business context, data model, API contract, glossary
```

## Packages

Workspace package names (use them as dependencies and imports, e.g. in `apps/mobile`):

| Package | Path | Notes |
|---|---|---|
| `@bella-vista/shared` | `packages/shared` | Zod schemas, pure domain rules, es-MX formats. Import from the package root: `import { loginRequestSchema, can } from '@bella-vista/shared'`. Exports `src/` under the `development` condition and `dist/` otherwise |
| `@bella-vista/api` | `apps/api` | The API; nothing imports it |
| `@bella-vista/mobile` | `apps/mobile` | The Expo app; nothing imports it. Metro and Jest resolve `@bella-vista/shared` to its sources |
| `bella-vista-payment-system-api` | repository root | Private workspace root (scripts only) |

## Coding rules

- Each module has `routes` → `service` → `repository`. Routes hold no business logic; the service decides and opens the transaction; the repository only queries.
- Pure business rules (periods, rates, surcharges, payment order) live in `packages/shared/src/domain`, without DB access, with table-driven tests.
- **Money in cents (`bigint` in the DB, integer `number` in TS)**; never decimals. Dates in UTC; periods are computed in `America/Mexico_City`.
- **Money is never edited or deleted**: corrections are new records (cancellation, refund, adjustment).
- Every operation that moves money: a single transaction, `Idempotency-Key`, `SELECT ... FOR UPDATE` lock and an `audit_log` write inside the same transaction.
- Permissions are checked on the server (account role + block + validity). A block leader never receives payment data from another block.
- No public sign-up: accounts are created only by the superadmin, one per role, and the role never changes (D-19, D-22).
- No scheduled jobs, queues or file uploads (D-25, D-26).
- Errors use the shape `{ error: { code, message, details } }`: `code` in English `UPPER_SNAKE_CASE`, `message` in Spanish (see `docs/api.md` and `docs/glosario.md`).
- Relative imports with the `.js` extension (NodeNext). No `any` and no `console.log` (use the Fastify logger).
- Mobile app: screens never call `fetch` (always a hook of `src/api`); no loose colors or sizes (tokens of `src/ui/theme`); every text through `AppText` (Inter, up to 1.4×, never cut); user texts in Spanish with "usted" and "familia" instead of "unidad"; every screen file carries its Figma/2.5 ID (e.g. `// F-02 · Elegir meses`) in a comment at the top.
- Constraints Drizzle cannot express (CHECK, triggers, partial indexes on expressions, grants) go in hand-written SQL migrations (`pnpm db:generate --custom`).

## Commits

Follow `CONTRIBUTING.md`: Conventional Commits in English, `type(scope): description`, one logical change per commit, `pnpm check` green, never `--no-verify`. Use `/commit` to create them.

## Don't

- Don't read or commit `.env`. Don't change `.env.example` without saying so.
- Don't edit migrations already committed to `main`.
- Don't add dependencies without explaining why; pin the exact version.
- Don't delete Docker volumes (`docker compose down -v`) unless the user asks.
