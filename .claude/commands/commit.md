---
description: Review the changes and create one or more commits in the project format
argument-hint: "[optional note about the change]"
---

Create commits for the current changes following `CONTRIBUTING.md`.

1. Check the state with `git status` and `git diff` (including `git diff --staged`).
2. If the changes cover different topics (for example, a module and a dependency), split them into several commits; each one must build on its own.
3. Make sure `.env`, credentials, `dist/` and files unrelated to the change are not included. If they are, stop and tell me.
4. Run `pnpm check` (lint, types and tests). If it fails, fix it or explain the failure before committing.
5. Write each message as `type(scope): description` in English, imperative mood, starting lowercase, at most 72 characters, no trailing period. Add a short body if the why is not obvious and a `Refs:` footer with the related HU, CU, RF or D from `docs/`.
6. Stage files explicitly (no blind `git add -A`) and commit. Never use `--no-verify` or `--amend` on pushed commits.
7. At the end, show me the list of created commits (`git log --oneline` of the new ones).

User note: $ARGUMENTS
