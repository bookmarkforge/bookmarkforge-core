# Changelog

Changes by version, from most recent to oldest. Each entry cites the commits that compose it, so it can be audited against the history.

## [1.0.0] — 2026-09-19 · branch `release/v1.0.0`

**Unpublished:** the first push to `origin` is still pending, so this version does not yet exist on the remote.

Branch base: `121d13f` (parent) → `bd259ea` (tip). These are 10 commits covering three fronts: vault leak and race closure, verifiable remote backup integrity, and document governance guarded by CI gates.

### Security and vault

- **Key leak on unlock** (`c9f5804`): if verification token creation fails during unlock, the device key is zeroized and the vault becomes locked. The regression covers the failure of `crypto.subtle.sign`.
- **KDF salt race between tabs** (`c9f5804`): adoptions are serialized, so a slow stale read can no longer reinstall a retired salt after a newer adoption lands; lifecycle generation discards pending work on stop or restart.
- **In-flight derivation vs. lifecycle** (`c9f5804`): wrapper persistence is aborted when the device key changed during an in-flight Argon2id derivation (lock or close mid-rewrap).
- **Lock contract in UI** (`c9f5804`): when a sibling rotation forces fail-closed lock, the React shell locks via `useSecurityStore.lock()`. Cryptographic lock alone left a dead vault behind a live interface (ADR-046).

### Defensive decoding

- **Shared decoder** (`239e922`): `decodeDataUrlToBytes` joins `decodeDefensiveBase64(Async)` in the defensive Base64 module. Strict charset and padding validation and decoded size quota are applied before any memory reservation; decoding writes in blocks to a single pre-sized buffer and malformed input returns `null` instead of throwing an exception in the caller's happy path.
- **Inherited hardenings** (`239e922`): pending adjustments in `utils/` (RxDB storage, resilience, safe error and JSON serialization, downloads, E2E diagnostics, audit and knowledge scans, legacy compatibility matrix, audio format).
- **Duplicates removed** (`6d4e73a`): the three repeated `dataUrlToBytes` parsers (document attachments, `FolderSyncService`, `exporter.formatters`) and the cached TTS decoder now delegate to the shared decoder, with size quotas per context. Percent-encoded payloads maintain a bounded `decodeURIComponent` path that previously had no limit.
- **Backup passwords** (`6d4e73a`): export and import normalize the password (trim) the same way. Before they differed, so a password composed only of spaces could produce a clear `.json` that still declared the encrypted `.bmf` extension.

### Backups and remote sync

- **Configurable remote retention** (`e6ff2c0`): `remoteRetentionCount` (default 10, bounded between 1 and 100) with selector in settings. Retention prunes payload and sidecar as a single unit via best-effort deletion in WebDAV, S3, and the five token-based providers.
- **Per-version sidecar HMAC** (`e6ff2c0`): each upload publishes a sidecar that links an HMAC-SHA256 tag (derived from the master password via HKDF with dedicated label) to the exact payload bytes and remote name. Restoration verifies the raw download before any Base64 decoding, Argon2id work, or database access: missing sidecar means legacy path, and a present but invalid tag aborts restoration.
- **Hostile restoration** (`e6ff2c0`): regressions for truncated ciphertext, excessively large backup, disallowed collection, and altered ciphertext. Remote restoration validates strictly via the shared defensive decoder (charset, padding, and 100 MB quota) before reserving the temporary file.

### Documentation and governance

- **Canonical inventory** (`f03ca1a`): the document index is derived from files that exist on disk, so document retirement becomes explicit instead of permanent drift in CI. The 61-document gap collapses into a living inventory plus retirement ADRs.
- **Documentation policy and gates** (`f03ca1a`): ADR-026 (documented retirement), ADR-040 (Markdown gate fusion), minimal operational documentation (operations, security, ROPA, API, onboarding emails), the extension privacy page that demands rollback proof, and the audit drift baseline.
- **Mass retirement reversal** (`384bdea`): the block deletion (over 30 ADRs, GDPR breach notification legal templates, and runbooks) had bypassed the ADR-026 consent mechanism and left protected material without equivalent replacement. The 79 files are restored and the retirement policy ADR is renumbered to ADR-059 to free the colliding number.
- **Release status** (`f03ca1a`): the status report records the complete regression matrix, session remediations, and remaining external blocks.
- **Regenerated baselines** (`fb35bc0`): the document index lists 103 documents and the Markdown baseline covers 102 files and 32 ADRs with no findings.

### Internal quality and E2E

- **Services and composition hardening** (`59644c6`): pending changes in database, hooks, memory, observability, telemetry, analytics, AI services, sync validation, and security vault import unification. The dynamic import of `auth.ts` becomes static: it lived in a module already present in the static chain and only produced ineffective dynamic import warnings.
- **Missing i18n strings** (`24ba20c`): the vault change in another tab warning key that `AppInitializer` referenced without existing in the English catalog, plus the restoration and integrity strings and remote retention strings. The 29 locale catalogs are complete.
- **Pro entitlements in E2E** (`bd259ea`): the companion's Whop adapter pointed to a dead port, so all Pro activation failed and backup and restore specs hit the Pro wall. The license mock becomes a Playwright server, the license route is routed to the signing server ahead of the generic proxy rule, and `seedProEntitlement` executes real activation within the page (no client-side forgery; signing is done by the signing server with the development key ignored by git, and without it it fails noisily instead of silently granting Pro).
