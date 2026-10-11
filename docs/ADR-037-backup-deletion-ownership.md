# ADR-037: Backup deletion ownership — never other people's files

- **Status:** accepted (implemented; this record formalizes the existing decision)
- **Date:** 2026-09-02 (retro-documented from the code and the anchor catalog)

## Context

`DiskBackupService` prunes old backups in the folder the user chose
(retention contract formalized in ADR-032 D1). The folder belongs to the
**user**, not to the service: it can contain anything (notes, documents,
other tools' backups). A filtering mistake while pruning — deleting *all* files in the
folder by age, or by the generic `.bmf` extension — would
destroy data BookmarkForge did not create and has no right to
delete. The `disk-backup-pruning-contract` anchor is catalogued as
`ADR-032 D1 / ADR-037`: D1 fixes retention, ADR-037 fixes **ownership** of the
deletion.

## Decision

1. **Only files with our own prefix are removed.** Pruning builds the
   candidate list filtered exclusively by `bookmarkforge-backup-`
   (`BACKUP_FILE_PREFIX`); any file not starting with that prefix is
   ignored even if it is old, large or named `other-backup.bmf` (test:
   62 own + `notes.md` + `other-backup.bmf` → only the 2
   oldest own ones are removed; foreign files never appear in the `removeEntry`
   calls — anchor `disk-backup-pruning-contract` in
   `src/tests/services/DiskBackupService.test.ts`).
2. **Fail-closed on selection, fail-open on individual deletion.**
   Name filtering is strict (fail-closed: an unknown name never
   enters the deletion list); if a `removeEntry` fails, the error is
   logged with `logger.warn` and pruning continues with the rest — a failed
   individual deletion does not block the cleanup of the excess.
3. **Stable surface contract.** The `bookmarkforge-backup-` prefix is a
   stable file-format contract: backups carry a date in their name
   (`bookmarkforge-backup-YYYY-MM-DD.bmf`) and age is sorted by
   name, not by filesystem metadata.

## Consequences

- Backup rotation can safely target a shared folder
  (e.g. the user's cloud root): the service never deletes anything it did not
  create with its own prefix.
- The prefix becomes reserved: no other user file with a name starting
  with `bookmarkforge-backup-` should live in the folder, or it could be
  pruned once it exceeds retention.
- A laxer variant of the rule (adding extensions, extra prefixes
  or blind age-based pruning) is an ADR-level change — the anchored test
  blocks it in CI via `check:audit-drift`, sharing an anchor with ADR-032 D1.