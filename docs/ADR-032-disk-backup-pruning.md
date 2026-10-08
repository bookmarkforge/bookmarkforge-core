# ADR-032: On-disk backup pruning contract

- **Status:** accepted (implemented; this record formalizes the existing decision)
- **Date:** 2026-09-02 (retro-documented from the code and the anchor catalog)

## Context

`DiskBackupService` (encrypted vault backup to a user-chosen folder
via the File System Access API) writes backups with its own prefix
`bookmarkforge-backup-*.bmf` and dated. Without a limit, the folder would grow
without bound; with reckless pruning, the service could delete user files
that have nothing to do with BookmarkForge. Decision D1 fixes the retention
contract; the security follow-up (who may delete what, and why never
foreign files) is formalized in ADR-037, and the shared regression anchor
(`disk-backup-pruning-contract`) references both.

## Decision

1. **D1 — Retention bounded by `MAX_BACKUP_FILES`.** The service keeps only
   the **60** most recent backups of its own (`MAX_BACKUP_FILES = 60`): when writing
   a new backup, it prunes the oldest excess ones within its own prefix
   (test: 62 own → keeps 60 → removes the 2 oldest), and never touches
   foreign files (`notes.md`, `other-backup.bmf` in the same folder stay
   intact — anchor `disk-backup-pruning-contract` in
   `src/tests/services/DiskBackupService.test.ts`).
2. **D1 (detail) — Pruning of our own prefix only.** Pruning iterates the folder's
   names, filters exclusively `bookmarkforge-backup-*`, sorts by date and
   removes with `removeEntry` only the excess over `MAX_BACKUP_FILES`. A
   `removeEntry` failure is logged with `logger.warn` and does not abort the rest of the
   operation (fail-open on individual deletion, fail-closed on the contract: wrong
   names never enter the deletion list).

## Consequences

- Backup disk usage is bounded to ~60 rotations regardless of
  manual-export frequency.
- Pruning is "strict prefix": the contract never deletes files that are not
  the service's own, which makes it safe to point the backup at a folder that
  contains other things.
- The `disk-backup-pruning-contract` anchor is catalogued as
  `ADR-032 D1 / ADR-037` in `scripts/audit-anchors.mjs`: the regression test
  protects both halves of the contract (retention + prefix ownership).