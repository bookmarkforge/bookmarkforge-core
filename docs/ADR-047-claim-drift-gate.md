# ADR-047: Factual claim drift gate (`check:claim-drift`)

- **Status:** Accepted (2026-09-15)
- **Date:** 2026-09-15
- **Related:** [ADR-028 — Gate drift detection](ADR-028-gate-drift-detection.md), [ADR-019 — Argon2id](ADR-019-argon2id-migration.md)

## Context

User-visible strings repeatedly drifted away from the code's real behavior, and every case was detected only through manual audit:

- copy promising a "**12-word** seed phrase" when `RecoveryService` generates **24-word** phrases (bip39, 256 bits);
- "minimum **8 characters**" when `SECURITY_CONFIG.MIN_PASSWORD_LENGTH` is **12**;
- PBKDF2 advertised in user copy while the vault uses **Argon2id V4** (ADR-019);
- a **14-day** refund guarantee in the support knowledge base when `PRICING_CONFIG.lifetimeVersioned.refundDays` is **30**.

That is exactly the class of failure ADR-028 defines as *gate drift*: the product
promises something the code does not deliver. The business risk is direct — a user
who loses data by following a false instruction asks for a refund and posts a
negative review.

The `npm run check:claim-drift` gate (`scripts/check-claim-drift.mjs`, integrated into the `check` chain after `check:i18n` and as its own CI step) extracts the truth from the code's real constants — `src/constants/config.ts`, `src/constants/pricing.ts`, `src/utils/argon2-kdf.ts` (desktop/mobile profiles), `src/services/BackupService.ts` (auto-backup interval), `src/components/StorageStatus.tsx` (expired backup age) — and scans the user-visible surface (30 locales, HTML landings, support knowledge base) for numbers that contradict it.

## Decision

An automated gate is implemented that:

1. **Fail-closed:** if a constant cannot be located (a refactor renamed it), the gate FAILS with an explicit message instead of passing silently.
2. **Per-tier verdicts:** a numeric claim is valid if it matches ANY tier in `pricing.ts`, so adding a tier does not break true claims.
3. **Multilingual by construction:** unit nouns in the 30 languages (word/word-count, devices, MiB, hours/hora/horas/Stunden…), with Unicode qualifiers (lookarounds, not `\b`, which does not work with "über/älter").
4. **Fail-closed truth channel:** extraction returns `null` when it cannot read a source; the tests freeze the real values (12, 24, 30, {0,3}, free=0, {1000}, {64,128}, 24 h, 48 h).
5. **Double anchor per sensitive claim (free-device-count, free-bookmark-cap):** the rules protecting Free's positioning use per-scalar verdicts (`freeDeviceCap` = `maxDevices` of the `free` tier, `freeBookmarkCap` = `maxBookmarks` of the `free` tier; not sets) with multilingual context ("free/gratis/gratuit/kostenlos/…", `app_freeTier*` keys) and anti-context ("pro/unlock/…"): a line naming Free BUT depending on the paid tiers is not treated as Free copy. `free-bookmark-cap` adds a multilingual "unlimited" branch: in Free copy, "unlimited bookmarks" is ALWAYS drift, with or without a number.

The gate meets both criteria of ADR-028's mechanism: the concrete failure is a divergence between promise and code, and the truth has a single versioned source.

## Consequences

- It covers factual numeric claims (passwords, recovery words, devices, bookmarks, MiB, hours, prices, refunds) and the forbidden mention of PBKDF2 in user copy. Device claims in Free copy additionally have a dedicated rule anchored to the free tier's scalar.
- It does not cover qualitative claims ("the safest"), nor copy describing non-constant behavior. Those remain the responsibility of manual review and support
  audit.
- Public export files run the same gate (the exporter runs it inside the exported
  tree and `ci.yml` carries it to the public repo), so the open-source tree is
  protected too.
- The freeze test (`scripts/__tests__/check-claim-drift.test.mjs`) fails if someone changes a constant without updating copy, or changes copy
  without updating constants.