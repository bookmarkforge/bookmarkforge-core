# ADR-033: Restore surface — authentication errors never offer restore

- **Status:** accepted (implemented; this record formalizes the existing decision)
- **Date:** 2026-09-02 (retro-documented from the code and the anchor catalog)

## Context

`AppContent`'s database error screen offers a
"Restore from backup file" recovery path when storage is damaged
(`INACCESSIBLE`/`UNKNOWN` corruption — legacy F0-2: the DB error screen must
offer the recovery path, not just an endless Retry). But not all
DB errors mean corruption: authentication flows
(`WRONG_PASSWORD`, `VAULT_LOCKED`) mean the DB is **healthy** and only the
correct credential/unlock is missing. Offering a destructive restore there
would confuse the user and cause unnecessary data loss.

## Decision

1. **D3 — `WRONG_PASSWORD` and `VAULT_LOCKED` never show the restore
   action.** When `dbErrorClass` is `WRONG_PASSWORD` or `VAULT_LOCKED`, the
   DB error screen does not render: the "Restore from backup file" button, the
   corruption hint text ("Your database appears damaged…") **nor** the hidden file
   input (`restore-backup-input`). All three must be absent (anchor
   `wrong-password-no-restore` in `src/tests/app/AppContent.test.tsx`, which covers
   both classes separately).
2. **Explicit contrast with corruption.** Restore remains present
   only for error classes that indicate damaged storage
   (`INACCESSIBLE`/`UNKNOWN`, DB3), where backup recovery is the
   right route. The surface is decided by error class, not by the raw message
   — the classifier (`dbErrorClass`) is already normalized in the DB startup
   layer (ADR-019 / `database.ts`).

## Consequences

- A user with the wrong password or a locked vault sees only the
  authentication notice and retries; there is no risk of accidental deletion from the error
  screen.
- The corruption-vs-authentication distinction is anchored by a regression test:
  a refactor reintroducing restore for auth errors breaks
  `check:audit-drift` (anchor in the catalog as `ADR-033 D3`).
- The ADR-033 series' D1/D2 flows (classification and generic presentation of
  DB errors) are outside the anchor catalog and are not formalized here —
  only D3 has a regression anchor.