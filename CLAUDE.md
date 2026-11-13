# Bella Vista water payment system

Mobile app and API for the Bella Vista community water committee: resident registry, monthly fee collection, cash boxes, expenses and closings. This repository currently holds the **API** and the **shared** package; the app (Expo / React Native) will be added later in `apps/mobile`.

Read `docs/README.md` first. The business rules in `docs/decisiones.md` override any assumption.

**Before each block, review "3.1 Plan de implementación" in Notion (https://app.notion.com/p/417088c27ae0815b89bcf1c5577b1755); if it differs from `docs/`, Notion wins** and `docs/` is updated in a separate `docs` commit. The block order and status live in `docs/estructura.md` ("Plan de implementación").

## Language

- Code, comments, identifiers, commit messages and this file: **English**.
- `docs/` and every text the end user sees (API error messages, formatted amounts and dates): **Spanish (es-MX)**.
- `docs/` describes tables, columns, endpoints and error codes in Spanish. Translate them with `docs/glosario.md`; when a term is missing, add it to the glossary in the same commit.

## Stack

- Node.js 24, strict TypeScript, ESM, pnpm workspaces.
- API: Fastify 5 + `fastify-type-provider-zod`, Zod 4, Drizzle ORM with the `postgres` driver, PostgreSQL 16, Argon2, `@fastify/jwt`, pino.
- Tests: Vitest. Lint and format: Biome.
- Docker Compose for the database and the API in development.

## Environment and commands

You normally work **inside the Dev Container** (`api` service of docker-compose): Node, pnpm and Git are there, the database answers on `db:5432` and `DATABASE_URL` is already set. There is no Docker inside the container: do not run `pnpm docker:*`.

| Command | What it does |
|---|---|
| `pnpm dev` | API with hot reload at http://localhost:3000 |
| `pnpm check` | Lint + types + tests. Must pass before every commit |
| `pnpm db:generate` | Generates a migration from `apps/api/src/db/schema` |
| `pnpm db:migrate` | Applies pending migrations |
| `pnpm install` | After changing dependencies |

## Structure

```
apps/api/src/
  server.ts            bootstrap (only /health for now)
  app.ts               Fastify construction (pending)
  config/              environment variables validated with Zod
  db/schema/           Drizzle tables;  db/migrations/  generated migrations
  plugins/             auth, error handling, idempotency, audit log
  lib/                 domain-free utilities (money, dates, errors)
  modules/<module>/    one module per domain (see docs/estructura.md)
apps/api/test/         unit/ and integration/ (integration uses DATABASE_URL_TEST)
packages/shared/src/   schemas/ (Zod), domain/ (pure rules), format/ (es-MX)
docs/                  business context, data model, API contract, glossary
```

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
- Constraints Drizzle cannot express (CHECK, triggers, partial indexes on expressions, grants) go in hand-written SQL migrations (`pnpm db:generate --custom`).

## Commits

Follow `CONTRIBUTING.md`: Conventional Commits in English, `type(scope): description`, one logical change per commit, `pnpm check` green, never `--no-verify`. Use `/commit` to create them.

## Don't

- Don't read or commit `.env`. Don't change `.env.example` without saying so.
- Don't edit migrations already committed to `main`.
- Don't add dependencies without explaining why; pin the exact version.
- Don't delete Docker volumes (`docker compose down -v`) unless the user asks.
