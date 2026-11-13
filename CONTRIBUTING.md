# Contributing

## Language

- **Code, comments, identifiers, commit messages, `CONTRIBUTING.md` and `CLAUDE.md`: English.**
- **Business documentation (`docs/`) and every text the end user sees** (API error messages, receipts, formatted dates and amounts): **Spanish (es-MX)**. The committee members read them.
- Domain names in code come from [`docs/glosario.md`](docs/glosario.md) (Spanish → English). When a new term appears, add it there in the same commit.

## Commits

This project uses **Conventional Commits**. Git hooks check them automatically:

- `pre-commit`: formats and lints the staged files with Biome (lint-staged).
- `commit-msg`: validates the message with commitlint (`commitlint.config.mjs`).

If a hook fails, fix the problem and try again. **Never** use `--no-verify`.

### Format

```
type(scope): short description in english

Optional body: what changes and why (not how). Lines up to 100 characters.

Refs: HU-25, CU-14, D-03
```

First-line rules:

- **type** and **scope** in lowercase, from the lists below.
- **description** in English, imperative mood, starting lowercase: "add", "fix", "validate" (not "added" or "Adds").
- At most 72 characters, no trailing period.

### Types

| Type       | When                                                                |
| ---------- | ------------------------------------------------------------------- |
| `feat`     | New functionality: endpoint, business rule, table that enables something |
| `fix`      | Bug fix                                                             |
| `refactor` | Code change that does not alter behavior                            |
| `perf`     | Performance improvement                                             |
| `test`     | Tests only (add or fix)                                             |
| `docs`     | Documentation only (`docs/`, README, comments)                      |
| `build`    | Dependencies, Dockerfile, build                                     |
| `ci`       | GitHub Actions or other automation                                  |
| `chore`    | Maintenance that fits none of the above (configuration, cleanup)    |
| `revert`   | Reverts a previous commit                                           |

### Scopes

| Group          | Scopes                                                                                                                                         |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Infrastructure | `api`, `shared`, `db`, `docker`, `deps`, `config`                                                                                              |
| API modules    | `auth`, `accounts`, `organization`, `registry`, `connections`, `rates`, `billing`, `cashboxes`, `committee`, `closings`, `reports`, `approvals`, `audit` |

- Schema changes and migrations use the `db` scope.
- Pure rules in `packages/shared` use the `shared` scope, unless they clearly belong to a module (e.g. the account statement calculation is `billing`).

### Footer

- `Refs:` links the commit to user stories (HU-xx), use cases (CU-xx), requirements (RF-xxx) or decisions (D-xx) in `docs/`.
- `BREAKING CHANGE: ...` when the API contract or the schema changes incompatibly.

## Working rules

1. **One logical change per commit.** Code, its tests and its migration go together; different modules are not mixed.
2. **Every commit builds and passes the tests** (`pnpm check`).
3. **Migrations:** the change in `src/db/schema` and the generated migration go in the same commit. A migration already committed to `main` is never edited; create a new one.
4. **Never commit** `.env`, credentials, `dist/` or database dumps.
5. **Branches:** `main` always works. Work happens in short branches `type/scope-description` (e.g. `feat/billing-register-payment`) merged with _rebase and merge_ to keep the commit history.
6. Pushed history is not rewritten (`git push --force` only on your own branches).

## Examples

```
feat(db): add organization and access tables

Create section, block, person, user_account, refresh_token and
role_assignment with the partial unique indexes from D-09 and D-22.

Refs: D-09, D-22
```

```
feat(billing): compute the account statement with surcharges

Refs: RF-MEN-01, RF-MEN-05, CU-13
```

```
fix(cashboxes): prevent handing over more than the expected balance

Refs: RF-CAJ-04
```

```
test(shared): cover the end of the arrears cycle with partial payments
```

```
build(deps): update fastify to 5.13
```

## With Claude Code

The `/commit` command (`.claude/commands/commit.md`) reviews the changes, proposes a message in this format, runs `pnpm check` and commits. Claude Code also follows the rules in `CLAUDE.md`.
