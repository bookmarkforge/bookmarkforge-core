# SAST triage log

Record of the findings triaged from the independent SAST layer (CodeQL + Semgrep),
as required by [docs/sast-triage.md](sast-triage.md) §6 step 7. One section per
run: what the scanners reported, the verdict for each finding, and the threshold
or baseline decisions taken with it.

The gate itself is `scripts/check-sarif-severity.mjs`, run by
`.github/workflows/sast.yml` with `--min-severity high --baseline
.github/sast-baseline.json`.

## 2026-10-11 — Semgrep `p/security-audit` (local reproduction)

- **Scanner:** Semgrep OSS 1.174.0, the version pinned in `sast.yml`
  (`pipx install semgrep==1.174.0`), ruleset `p/security-audit`, `--metrics off`.
- **Command:** `semgrep scan --config p/security-audit --metrics off --sarif
  --output semgrep.sarif`, then `node scripts/check-sarif-severity.mjs
  --min-severity high --baseline .github/sast-baseline.json semgrep.sarif`.
- **Scope:** the Semgrep half of the layer, reproduced locally because the
  Security → Code scanning pages need an authenticated session (the alerts REST
  endpoint answers 401 anonymously, even for the public open-core repository).
  The CodeQL half (`security-extended`) has not been triaged yet — see Pending.
- **Result:** 79 findings before the triage → 11 after, with 0 blocking. 11
  findings fixed in code (each `execSync` command line converted to an argv
  spawn through `scripts/command-runner.mjs`), 10 reviewed as false positives and
  ignored by 6 baseline entries, and 1 medium warning left open and non-blocking.
  Gate after the change: exit 0, 0 blocking, 10 ignored by the baseline, 0 stale
  entries.
- **Gate defect found and fixed in the same run:** `check-sarif-severity.mjs`
  read the severity only from `runs[].results[].level`, but `semgrep scan
  --sarif` writes the level into `runs[].tool.driver.rules[].defaultConfiguration`
  and leaves every result without one (0 of 79 results carried a level). Every
  finding therefore classified as `unknown`, which the gate treats as blocking
  by policy, so the job failed on warnings too and no finding could be triaged.
  The gate now falls back to the rule's level, keeping the fail-closed rule for
  a finding that truly carries no severity anywhere.

### Findings (line numbers as reported at scan time)

| # | Rule (tool) | Location | Severity (gate) | Verdict | Action |
|---|---|---|---|---|---|
| 1 | `detect-child-process` (Semgrep) | `scripts/audit-all-external.mjs:36` | high | TP | Fixed: command line through the `command-runner.mjs` boundary (argv, no shell) |
| 2 | `detect-child-process` (Semgrep) | `scripts/audit-github-secrets.mjs:35` | high | TP | Fixed: same conversion, plus the `gh --version` probe |
| 3 | `detect-child-process` (Semgrep) | `scripts/audit-vercel-config.mjs:34` | high | TP | Fixed: same conversion, plus the `vercel --version` probe |
| 4 | `detect-child-process` (Semgrep) | `scripts/auto-audit-and-fix.mjs:35` | high | TP | Fixed: same conversion |
| 5 | `detect-child-process` (Semgrep) | `scripts/comprehensive-audit-and-fix.mjs:36` | high | TP | Fixed: same conversion |
| 6 | `detect-child-process` (Semgrep) | `scripts/deploy-prod.mjs:127` | high | TP | Fixed: `run()` now uses `runCommandLine` instead of `execSync` |
| 7 | `detect-child-process` (Semgrep) | `scripts/pull-prod-images.mjs:79` | high | TP | Fixed: `runOk()` through the boundary |
| 8 | `detect-child-process` (Semgrep) | `scripts/pull-prod-images.mjs:87` | high | TP | Fixed: `runCapture()` via `captureCommandLine` |
| 9 | `detect-child-process` (Semgrep) | `scripts/rollback.mjs:42` | high | TP | Fixed: string form of `run()` through the boundary (argv, throws on non-zero like `execSync`) |
| 10 | `detect-child-process` (Semgrep) | `scripts/rollback.mjs:68` | high | TP | Fixed: `runCapture()` via `captureCommandLine` |
| 11 | `detect-child-process` (Semgrep) | `scripts/test-push-images.mjs:63` | high | TP | Fixed: `runOk()` through the boundary, and the `docker rm -f` teardown is argv-based now |
| 12 | `detect-child-process` (Semgrep) | `scripts/check-audit-freshness.mjs:197` | high | FP | Baseline: runs the command lines quoted in `docs/audit.md` verbatim |
| 13 | `detect-child-process` (Semgrep) | `scripts/ci-local-parallel.mjs:191` | high | FP | Baseline: already argv-based; the shell flag is the documented Windows `npm.cmd` case |
| 14-17 | `detect-child-process` (Semgrep) | `scripts/command-runner.mjs:9, 23, 32, 85` (and `:91, 100` after the new capture helper) | high | FP | Baseline: the audited subprocess boundary itself — argv-first helpers, the deliberate `captureShell` escape hatch and the Windows `.cmd` shim fallback |
| 18 | `detect-child-process` (Semgrep) | `scripts/drill-rollback.mjs:141` | high | FP | Baseline: `spawn(command, args)`, argv array for the local drill stack |
| 19 | `detect-child-process` (Semgrep) | `scripts/local-smoke.mjs:47` | high | FP | Baseline: `spawn(command, args)`, argv array for the local smoke stack |
| 20 | `detect-child-process` (Semgrep) | `scripts/prod-blindeo-checklist.mjs:27` | high | FP | Baseline: `spawnSync(cmd, args)`, argv array |
| 21 | `unknown-value-with-script-tag` (Semgrep) | `scripts/__tests__/monitoring-alerts.test.mjs:80` | medium | — | Not blocking at the `high` threshold; queued for review |

### Earlier findings in the same run (fixed before the triage above)

58 `generic.nginx.security.insecure-redirect` findings in `public/nginx.conf`
(lines 288–358, the language-preference bounces). Real finding, not cosmetic:
`rewrite ^ /<lang>/ redirect` makes nginx build an **absolute** URL from
`$scheme`, so behind a TLS terminator the bounce was answered with a plaintext
`Location`. Fixed in the file's single owner (`scripts/nginx-render.mjs`):
`return 302 /<lang>/` plus `absolute_redirect off`, which was verified live
(`Location: /es/`, no scheme and no Host). The Semgrep count for this class is
now 0.

### Baseline additions (`.github/sast-baseline.json`)

| Date | Change | Reason | Approved by | Review date |
|---|---|---|---|---|
| 2026-10-11 | 6 entries (10 findings): `command-runner.mjs` (6 sites, one entry without `line`), `check-audit-freshness.mjs`, `ci-local-parallel.mjs`, `drill-rollback.mjs`, `local-smoke.mjs`, `prod-blindeo-checklist.mjs` | FPs verified by reading each call site: argv arrays or a repo-authored command line. Each entry carries its own justification in the file | maintainer | 2027-01-11 |

### Threshold decisions

| Date | Change | Reason | Approved by | Review date |
|---|---|---|---|---|
| 2026-10-11 | No change: `--min-severity high` for both tools | The 20 Semgrep findings were triaged to zero blocking ones; no reason to raise or lower the policy | maintainer | 2027-01-11 |

### Pending

- **CodeQL** (`security-extended`) has not run locally: it needs the CodeQL CLI
  plus a database build. Its findings will be triaged in the next run.
- **Code scanning alert list:** the pages and the REST endpoint require an
  authenticated session (`gh auth login`), so the alert list has not been
  cross-checked against this log yet. The local reproduction uses the same
  scanner version and ruleset as the workflow.
- `scripts/__tests__/monitoring-alerts.test.mjs:80` (medium) is reviewed but not
  fixed: the value is a fixture body in a test, and the rule cannot see through
  the helper that builds it.

### Cleanup (2026-10-13)

Removed external infrastructure configuration scripts (GitHub branch protection,
Namecheap DNS, Vercel domain, Whop config) and their associated audit scripts
as they are not needed for local development or core project functionality:
- `scripts/audit-all-external.mjs` (previously finding #1)
- `scripts/auto-audit-and-fix.mjs` (previously finding #4)
- `scripts/comprehensive-audit-and-fix.mjs` (previously finding #5)
- `scripts/audit-whop-config.mjs`
- `scripts/github-branch-protection.*`
- `scripts/namecheap-dns-config.*`
- `scripts/namecheap-dns-manual-guide.*`
- `scripts/vercel-domain-config.*`
- `scripts/whop-config.*`
