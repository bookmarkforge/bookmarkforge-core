# ADR-034: Manual backup date freshness and storage quota warning

- **Status:** accepted (implemented; this record formalizes the existing decisions)
- **Date:** 2026-09-02 (retro-documented from the code and the anchor catalog)

## Context

Two storage UX defects were recorded in the F0-3 flow
(user feedback in Settings/StorageStatus):

1. **The last-backup date did not refresh after a manual export.**
   The status indicators (`StorageStatus`, dashboard banner) read the
   date from `forge_last_manual_backup_date` in localStorage, but the dataset
   was an old snapshot: after exporting, the age still followed the previous
   write until a reload — the user saw "backup from 30 days ago" right
   after exporting.
2. **There was no near-full quota warning.** With web storage at 85–95 %, the
   user had no signal to free space before writes started failing.

## Decision

1. **D1 — Manual export writes `LAST_MANUAL_BACKUP_DATE`.** The Settings export
   flow (`StorageSection` → `Export backup`) persists the
   `forge_last_manual_backup_date` marker with the current timestamp immediately after the
   export, so that `StorageStatus` and the dashboard banner can read the
   fresh age **without a reload** (anchor `manual-export-refreshes-backup-age` in
   `src/tests/components/settings/StorageSection.test.tsx`, F0-3 regression, which
   verifies a recent timestamp < 5 s and the write contract via `safeSet`).
2. **D5 — Quota warning with thresholds.** When `navigator.storage.estimate()`
   exceeds **85 %** (warning) or **95 %** (critical), the `StorageStatus`
   pill shows the "Free up space" button, which opens the
   `StorageCleanupDialog` with concrete actions ("Export backup first",
   "Clear AI models", "Compact Database"); below **70 %** the button does not
   appear (E2E spec `tests/e2e/storage-quota-warning.spec.ts`, annotated as
   F0-3 / ADR-034 D5). The `storage.estimate()` stub is installed with
   `addInitScript` so it survives the vault-setup reload.

## Consequences

- Backup age indicators reflect the device's truth after every
  export; the D1 test is a regression anchor (it fails `check:audit-drift` if
  the write disappears).
- The quota warning is proportional (85 % warning / 95 % critical), actionable and
  E2E-tested with simulated thresholds (the real browser in CI does not reach 95 %).
- The `manual-export-refreshes-backup-age` anchor is catalogued as
  `ADR-034 D1 / ADR-032` because it shares a domain with ADR-032's on-disk backup
  contract — each ADR formalizes its own half of the backup ecosystem.