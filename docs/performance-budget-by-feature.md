# Performance budget by feature — baseline v1.0

## Objective

This document fixes an operational budget before making architecture changes. The rule is to optimize first the specific feature that violates its budget; moving cost to the initial bundle to improve a local metric is not allowed.

The measured values correspond to the local production build and Chromium in CI-like:

- static entry: **568 KiB**;
- precache: **7.28 MiB**;
- first interaction: **553 ms** (maximum of 3 samples);
- JS payload: **15.90 MB**;
- emitted JS/CSS assets: **346**.

## Budget by surface

| Surface | Measured | Hard budget | Rule |
|---|---:|---:|---|
| Bootstrap/pre-unlock | 568 KiB | 768 KiB | Do not import heavy UI, PDF, BlockNote, charts nor static AI vendors |
| Unlock (`SecurityManager` + confirmation) | 0.25 MiB | 1.00 MiB | Cryptography and recovery only |
| Shell post-unlock (`MainApp`) | 1.34 MiB | 3.00 MiB | Navigation and shell, features on demand |
| PWA precache | 7.28 MiB | 10.00 MiB | Do not add heavy models or vendors to precache without review |
| First interaction | 553 ms | 2,500 ms | future p95 target: <1,500 ms |
| Total JS/CSS emitted | 15.90 MB | 20.00 MB | Soft global cap; control by feature before reaching limit |
| Total JS/CSS chunks | 346 | 400 | Transient ceiling; does not replace size limits |

## Vendor and feature budget

| Feature/vendor | Approximate measured | Recommended budget | Optimization priority |
|---|---:|---:|---|
| Database/RxDB | 352 KiB | 400 KiB | P2; keep lazy and avoid duplicates |
| Bookmarks table | 376 KiB | 450 KiB | P2; review virtualization before splitting further |
| BlockNote/editor | 775 KiB | 887 KiB | P1; load only when entering editing |
| HTML-to-PDF | 936 KiB | 1.00 MiB | P1; do not preload |
| PDF runtime | 431 KiB + worker 1.27 MiB | 2.00 MiB combined | P1; load only in PDF export/import |
| Web transformers | 550 KiB | 650 KiB | P1; keep out of pre-unlock |
| ONNX Runtime WASM | 22.48 MiB | 25.00 MiB | P2; do not include in initial precache |
| Charts/Recharts | 293 KiB | 337 KiB | P2; load only in dashboards |
| WebLLM/MLC runtime (`lib-*`) | 6.03 MiB | 7.00 MiB | P0; keep lazy and do not precache |

## Coverage accompanying the budget

Current global coverage is:

```text
Statements 87.30 %
Branches   79.04 %
Functions  86.43 %
Lines      89.10 %
```

Areas that deserve priority by risk and coverage, without lowering current gates:

1. `src/services/security-vault`: `secrets.ts` 54.28 % statements and `rotation.ts` 81.52 %.
2. `src/services/ai`: `ProviderManager.ts` 63.43 % and `AutoProcessorService.ts` 75.29 %.
3. `src/services`: `SecurityVault.ts` 64.36 % and `pro-access.ts` 62.65 %.
4. `src/observability`: `ObservabilityHub.ts` 62.74 %.
5. `src/utils`: `download.ts` 65.71 % and `bundleIntegrity.ts` 72.88 %.

These figures do not justify an immediate restructuring: first the error and security paths that explain the low zones must be covered, and then measure if coverage improves without inflating the bundle.
