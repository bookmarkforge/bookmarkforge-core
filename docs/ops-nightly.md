# Nightly operation — BookmarkForge

> Workflow: `.github/workflows/nightly.yml` · Cron: `17 2 * * *` UTC daily (+ `17 3 1 * *` for monthly drill and `23 2 * * 1` —Monday— for weekly dependency CVE report) · Badge in `README.md` (section "Project status").
>
> Audit / anchors: `ADR-019` (WoW budget), `P92`/`H5` (HTTPS webhooks and secrets policy) — see `docs/audit.md`.

## 1. Suites and jobs

| Job | Suite | Shards | Timeout | Budget (repo var) |
|---|---|---|---|---|
| `human-like-sharded` | 161 spec files / 2050 tests (`src/tests/human-like/examples`) | 4 | 60 min | `NIGHTLY_HUMAN_LIKE_MAX_MINUTES` |
| `multiuser-sharded` | 63 spec files / ~134 tests (`tests/e2e`, workers=1) | 2 | 45 min | `NIGHTLY_MULTIUSER_MAX_MINUTES` |
| `performance` | `tests/e2e/perf-scale.nightly.spec.ts` | 1 ("single") | 45 min | `NIGHTLY_PERF_SCALE_MAX_MINUTES` |

The *Suite* column is a verified declaration, not a description: `npm run check:vacuous-tests` measures the tree and fails if the declared files or tests do not match (a figure marked with `~` is approximate —the suite parameterizes tests in loops— and is only reported). The same gate budgets the **vacuous assertions** of each suite: a test that passes when the function it names does not exist is not coverage. Current debt: 1589 of 2050 tests (77.5%) of `human-like-sharded` and 7 of 134 (5.2%) of `multiuser-sharded`, declared in `docs/PENDIENTES.md` and registered in `scripts/vacuous-tests-baseline.json`. The first remediation measure of the round was to remove the file `advanced-content-tests.spec.ts` (pilot, 2026-09-24): its 43 tests targeted a collaborative application that does not exist in BookmarkForge — all its `data-testid` are defined only in the spec and its assertions were in dead branches. The tree measures itself and rejects drift; the figure must be updated with the same tool, never manually.

Support jobs: `coverage`, `multiuser-report` / `human-like-report` (blob merge), `nightly-trends` (WoW trends CSV), `nightly-consistency` (alert-vs-trend report), `dependency-cve-report` (weekly declared tree CVE report, see §6), `launch-readiness`, `load-test`, `kpi-staging`, `drill-backup-restore` (monthly) and `webhook-smoke` (manual).

**Non-daily jobs:** `dependency-cve-report` (Monday) and `drill-backup-restore` (day 1) carry an `if` guard on their own `schedule` entry, plus `workflow_dispatch` to trigger them manually — the rest runs every night.

**Sizing note:** Increase number of shards by changing `matrix.shard` + `matrix.total` (blob merge is shard-diagnostic). Repo rule: increase `E2E_TIMEOUT_MULTIPLIER`, never delete waits.

## 2. Duration alert — `scripts/nightly-alert.mjs`

Each suite has its **variable family** `NIGHTLY_<LABEL>_*`, selected by `NIGHTLY_ALERT_JOB_LABEL` (LABEL = `HUMAN_LIKE` | `MULTIUSER` | `PERF_SCALE`). Three triggers:

1. **Job failure** — `NIGHTLY_<LABEL>_STATUS` = `failure`/`cancelled` (from `${{ job.status }}`)
2. **Over-budget** — `NIGHTLY_<LABEL>_MINUTES` > `NIGHTLY_<LABEL>_MAX_MINUTES`
3. **WoW regression** — duration ≥ `DEGRADE_RATIO` × median of previous weeks (default `1.25` = +25%)

Alert properties:

- **The WoW regression is informational** (exit 0, never fails the job). Failure and over-duration fire the `nightly_<label>_alert` payload.
- **Weekly slope in the payload**: every alert carries `deltaPctWoW` — % of the current run vs the median of the **immediately previous week** (same one-decimal statistic as the `deltaPctWoW` column of the trends summary, including the ISO 52/53→1 rollover). In Slack it shows as a `slope ±X% vs prev. week` line, so the suite's weekly slope is visible even when the multi-week baseline is flat.
- **HTTPS-only webhook** (`resolveWebhook`): `http://` is rejected fail-closed. Slack Incoming Webhooks receive the `{text, blocks}` shape; any other HTTPS endpoint receives the structured JSON payload.
- **Best-effort**: a dead webhook or a 5 s timeout is logged (`nightly_webhook_failed`), it never breaks the nightly.
- **History**: each run appends `{week, year, minutes, recordedAt}` (ISO-8601) to its suite's JSONL in `.nightly-history/`, persisted in the Actions cache (keys `nightly-<label>-history-v1-…`). The baseline uses the **median of previous weeks** (≥2 samples), never the current week.
- **Alert log**: every alert fired is appended to `.nightly-history/alerts/<suite>-shard-<N>.jsonl` (`NIGHTLY_<LABEL>_ALERT_LOG_FILE`) with `{event, suite, shard, week, year, status, degraded, deltaPct, deltaPctWoW, delivered, recordedAt}` — it is the source for the alert-vs-trend consistency report.
- **Smoke-test**: `webhook-smoke` (workflow_dispatch, inputs `test_alert` + `smoke_suite`) sends a synthetic alert tagged with the chosen suite; unlike the nightly, it **fails loudly** if the webhook does not respond.

### CLI

```bash
node scripts/nightly-alert.mjs            # evaluates with the job's env
node scripts/nightly-alert.mjs --dry-run  # prints the decision without posting
node scripts/nightly-alert.mjs --test     # synthetic alert (smoke)
```

## 3. Repo vars and secrets (GitHub → Settings → Secrets and variables → Actions)

| Config | Type | Use |
|---|---|---|
| `NIGHTLY_ALERT_WEBHOOK_URL` | **Secret** | Alert HTTPS webhook (Slack or generic). Without it nothing is sent. |
| `CODECOV_TOKEN` | **Secret** | Upload of `coverage/lcov.info` to Codecov (README coverage badge). Without it the step is skipped and the badge stays empty. |
| `NIGHTLY_HUMAN_LIKE_MAX_MINUTES` | Var | Budget per human-like shard (e.g. `60`). Empty/0 = failures only. |
| `NIGHTLY_MULTIUSER_MAX_MINUTES` | Var | Budget per multiuser shard (e.g. `30`). |
| `NIGHTLY_PERF_SCALE_MAX_MINUTES` | Var | Budget for the performance job (e.g. `45`). |
| `NIGHTLY_HUMAN_LIKE_DEGRADE_RATIO` | Var | WoW threshold for the human-like suite (multiplier vs previous median; default `1.25` = +25 %). The workflow reads it as `${{ vars.NIGHTLY_HUMAN_LIKE_DEGRADE_RATIO || '1.25' }}` — without the var it uses the default. |
| `NIGHTLY_MULTIUSER_DEGRADE_RATIO` | Var | Same for multiuser (default `1.25`). |
| `NIGHTLY_PERF_SCALE_DEGRADE_RATIO` | Var | Same for performance (default `1.25`). |
| `STAGING_URL`, `STAGING_ANALYTICS_ADMIN_TOKEN` | Var/Secret | `kpi-staging` job. |
| `KPI_MIN_*` | Var | Business thresholds (`kpi-staging`). |
| `DRILL_RTO_MS`, `DRILL_RTO_WARN_MS`, `DRILL_ALERT_WEBHOOK_URL` | Var/Var/Secret | Monthly DR drill. |
| `E2E_TIMEOUT_MULTIPLIER` | Var | E2E timeout multiplier on slow runners. |
| `TRENDS_MIN_CONSECUTIVE_DEGRADED` | Var | Consecutive weeks of WoW degradation that turn `nightly-trends` red (default `3`; `0` disables the gate). **Per suite**: `TRENDS_MIN_CONSECUTIVE_DEGRADED_HUMAN_LIKE` / `_MULTIUSER` / `_PERF_SCALE` (suite in UPPER_SNAKE_CASE) override the global for that suite only — each suite can have its own N (e.g. human-like 2, perf-scale 4); without a per-suite var it falls back to the global value. `0` disables the gate for that suite only. The Slack alert shows the per-suite threshold on the `budget` line of the block. |
| `CONSISTENCY_MIN_CONSECUTIVE_PHANTOM` | Var | Consecutive weeks of phantom-alerts in the same suite that turn `nightly-consistency` red (default `2`; `0` disables the gate). Repeated phantoms indicate a possible bug in the degradation criterion. |
| `CONSISTENCY_SVG_PUBLIC_URL` | Var | Public/signed https URL of the consistency SVG, to embed it as an image in the `nightly-consistency` job summary (GitHub sanitizes data URIs — same limitation as `TRENDS_SVG_PUBLIC_URL`). Empty = tables only, nothing leaves the repo. |
| `TRENDS_SVG_BUCKET` | Var | **Private** S3 bucket for the trends SVG embed without publishing the artifact. With the var set, `nightly-trends` runs in **two phases**: the first (`TRENDS_DEFER_SUMMARY=1`) writes the CSVs/SVG but omits the summary; the `Sign SVG URL` step uploads the SVG to the bucket with `--acl private` and generates a **presigned URL** (`TRENDS_SVG_PRESIGN_EXPIRES`, default `3600` s); the second (`TRENDS_SUMMARY_ONLY=1`) rewrites the job summary and `nightly-trends-summary.md` embedding that URL — without re-running the gate or the alerts, and always with exit 0. The sign step is best-effort (`continue-on-error`): a bad bucket configuration does not turn the job red, it only leaves the summary without the embed. The secrets `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` with at least `s3:PutObject` + `s3:GetObject` are required. Empty = single-step flow (the embed uses `TRENDS_SVG_PUBLIC_URL` if set). |
| `TRENDS_SVG_PRESIGN_EXPIRES` | Var | TTL in seconds of the presigned trends SVG URL (default `3600` = 1 h; the embed expires and stops rendering after that window, without affecting the artifact). |
| `CONSISTENCY_SVG_BUCKET` | Var | **Private** S3 bucket for the consistency bar-chart SVG embed, same two-phase pattern as `TRENDS_SVG_BUCKET` (phase 1 `CONSISTENCY_DEFER_SUMMARY=1` omits the summary; the `Sign SVG URL` step uploads `nightly-consistency.svg` with `--acl private` and presigns; phase 2 `CONSISTENCY_SUMMARY_ONLY=1` rewrites the summary with the URL, always exit 0). Best-effort (`continue-on-error`). Same AWS secrets as the trends one. Empty = single step (uses `CONSISTENCY_SVG_PUBLIC_URL` if set). |
| `CONSISTENCY_SVG_PRESIGN_EXPIRES` | Var | TTL in seconds of the presigned consistency SVG URL (default `3600`). |

Runtime values (webhooks, tokens) **never** go in `VITE_*` nor in the repo — secrets only. `vars.*` and `secrets.*` are referenced in `nightly.yml`; `.env.example` documents the rest.

## 4. Artifacts

| Artifact | Content | Retention |
|---|---|---|
| `nightly-coverage` | `coverage/` + `coverage-history.json` | 14 d |
| codecov badge | `coverage/lcov.info` uploaded to Codecov if `CODECOV_TOKEN` exists | — (external, badge in README) |
| `human-like-blob-<N>` / `multiuser-blob-<N>` | Blob reports per shard (merge input) | 7 d |
| `human-like-raw-blobs` / `multiuser-raw-blobs` | Consolidated copy of the raw blobs (triage evidence if the merge genuinely fails) | 14 d |
| `nightly-human-like-report` / `nightly-multiuser-report` | Unified HTML after `merge-reports` | 14 d |
| `<suite>-merge-status` | Merge decision JSON (skipped/merged, found/expected) | 14 d |
| `nightly-trends` | `nightly-trends.csv` (samples per shard) + `nightly-trends-summary.csv` (weekly median per suite, min/max/count, `deltaPctWoW` — % vs the previous week's median, adjacent weeks only —, `degradedWoW` = `DEGRADED` when the week exceeds the alert criterion, ≥ 1.25× the previous median, and `streak` — the length of each suite's current run of consecutive DEGRADED weeks; 0 if not degraded, reset by a gap; the trend is visible **before** the gate fails) + `nightly-trends.svg` (self-contained SVG line chart of the weekly median per suite, with DEGRADED points colored on a **streak ramp** — increasing shade from light red (streak 1) to dark red (`#b91c1c`) when the per-suite gate threshold is reached, so the streaks closest to turning the job red are the darkest; the legend shows the ramp `streak 1 … streak N → gate` — and **sustained streaks** — the ones that fire the fail-loud gate — highlighted with a red band, ringed points and a `sustained ×N` label; plus a **dotted reference line for the degradation threshold** per suite — `1.25×` the median of the immediately previous week, the same `DEGRADE_RATIO` as the criterion —, so the solid series crossing above its dotted threshold is directly visible in the chart, with a "threshold (1.25× prev. week)" legend swatch; the Y scale is adjusted so it does not clip the threshold line; **compact legend under the X axis** — a single row brings together the three point styles with their exact radii (normal = suite color, DEGRADED = streak ramp, sustained streak = dark ring) **and the full ramp** as a continuous gradient swatch `streak 1 → N → gate` (from light `#fca5a5` to dark `#b91c1c`, with N = the per-suite gate threshold), so the chart can be read without resorting to the CSV; and an **accessible title on every point** — `<title>` with suite, week, median, `deltaPctWoW` and `streak` —, for static inspection (tooltips in browsers, tree in SVG viewers, screen readers) without opening the CSV) + `nightly-trends-summary.md` (a copy of the same summary from the job summary as an artifact, to attach to an issue or keep outside Actions; it includes the run links when it runs in CI). **The job can turn red**: if a suite has ≥ `TRENDS_MIN_CONSECUTIVE_DEGRADED` (default 3) **consecutive** weeks marked DEGRADED, `nightly-trends.mjs` writes the CSVs, posts `nightly_trends_sustained` to the webhook (best-effort, carrying the slope of the streak's last week) and exits with code 1 (sustained trend = a real signal). The alert delivery is **isolated in its own try/catch**: even if the sender throws (webhook firmly down), the gate's exit code does not change and the CSVs already written stay intact — the failure is logged as `nightly_trends_alert_send_failed` and the job stays red because of the degradation, not the delivery. The alert payload also includes the **consistency findings** of the affected weeks (missed/phantom, the same `classifyConsistency` used by the `nightly-consistency` report — read from the same cached alert log, so Slack and the CSV can never disagree): in Slack they appear as an "Alert-vs-trend consistency" section with one block per finding (🟡 missed / 🔴 phantom). **Early warning (best-effort)**: when the gate does NOT fire but a suite has its streak at **N−1** (one week below its threshold), the job sends `nightly_trends_early_warning` the night before (in Slack: one block per suite with `streak N−1 of N` and the slope) — a day's margin before the failure; the exit code stays 0 (the run stays green) and the delivery is isolated in a try/catch like the gate's. Once the gate has fired there is no early warning (no margin left). In Slack the alert also carries an **interactive "Open run summary" button** (actions block) that opens the run's job summary and its artifacts in one click — the URL is built from the `GITHUB_SERVER_URL`/`GITHUB_REPOSITORY`/`GITHUB_RUN_ID` env vars that Actions injects, so the link points at the exact run that fired the alert. A gap in the history breaks the streak. It also publishes a GitHub **job summary** (table of DEGRADED weeks with the **`streak`** column — each suite's current streak, the same as the CSV, so you can see without downloading artifacts how many consecutive weeks each suite has been degraded and how far it is from the gate — + weeks with a negative slope as improvements + sustained streaks + links to the run and its artifacts, built from the `GITHUB_SERVER_URL`/`GITHUB_REPOSITORY`/`GITHUB_RUN_ID` env vars) via `GITHUB_STEP_SUMMARY` — visible without downloading artifacts, even when the job ends up red. **SVG embed**: GitHub sanitizes inline images (data URIs) in job summaries, so the chart is only embedded when there is a reachable https URL. Two paths: (1) the repo var `TRENDS_SVG_PUBLIC_URL` points at a signed/private URL; or (2) **automatic in CI** — with `TRENDS_SVG_BUCKET` set, the nightly uploads the SVG to a **private** S3 bucket and generates a **presigned** URL that it injects as `TRENDS_SVG_PUBLIC_URL` (two phases: `TRENDS_DEFER_SUMMARY=1` omits the summary in the first step, the `Sign SVG URL` step presigns, and `TRENDS_SUMMARY_ONLY=1` rewrites the summary with the URL — the artifact is never published, only the short-lived signed URL). With the URL present, the summary gains `### Trend chart` with `![Nightly WoW trends chart](<url>)`; without var and without bucket (default), the summary only has links — **nothing leaves the repo by default**, consistent with the local-first model. | 90 d |
| `nightly-consistency` | `nightly-consistency.csv` + `.json` + `nightly-consistency.svg` — alert-vs-trend report: per suite+week, `kind` = `consistent` / `missed-alert` (DEGRADED suite with no WoW alert from any shard — may be a median-aggregation artifact) / `phantom-alert` (shard WoW alert with no suite-level corroboration), and the `undeliveredAlerts` column (alerts of that suite+week whose webhook failed — `delivered=false`, webhook down). The **SVG** is a self-contained bar chart (860×480, no dependencies): one bar per suite+week colored by **`severity`** (dark red `#b91c1c` = high — missed-alert with `streak >= 2`, the most serious; amber = medium — streak-1 missed or phantom-alert; green = low — consistent; grey = NO-ROW), with height proportional to the number of alerts that week, a translucent stub for weeks without alerts, suite+week labels on the X axis, a top legend and — under the X axis — a **marker legend** explaining the four bar styles with their exact colors (`high (missed-alert, streak ≥ 2)`, `medium (streak-1 miss / phantom)`, `low (consistent)`, `NO-ROW`) — so the most serious findings (dark red) stand out next to the green majority. **Each bar is split into two stacked segments**: below, the `delivered` segment in the `severity` color; above, the `undelivered` segment (webhook down) with a self-contained diagonal hatch pattern (SVG `<pattern>`, no dependencies) — a bar with a hatched stripe in its upper part means part of that suite+week's alerts never reached the webhook, and the height of the hatched segment is proportional to `undeliveredAlerts`. The legend takes two rows (the 3 `severity` colors + NO-ROW + the hatched `undelivered (webhook down)` swatch), and each bar's `<title>` includes the counts (`3 alerts, 2 undelivered`). Every bar carries an accessible `<title>` with suite, week, `kind`, `severity`, alert count (pluralized), median, `deltaPctWoW` (or `no adjacent baseline`) and current streak — tooltip on hover, tree in viewers and text for screen readers, without opening the CSV. It also reconciles each alert payload's `deltaPctWoW` against the summary CSV row: `deltaMatch` = `match` (equal), `granularity` (they differ on a multi-shard suite — the CSV row is the median, the alerts are per shard: expected) or `mismatch` (they differ on a 1-shard suite — a real signal; counted in the JSON's `deltaMismatch`). **Streak weighting**: each row carries `severity` — `high` for missed-alerts with `streak >= 2` (the suite has been DEGRADED for consecutive weeks without alert corroboration: the most serious), `medium` for streak-1 missed or phantom-alerts, `low` for consistent. The high-streak missed detail includes `, streak N`, the JSON counts `highSeverity`, and the findings table in both the CSV and the job summary is sorted **high first** — what you must look at first ends up on top. **Separate block in the CSV**: after the suite+week table, a second table lists each undelivered alert (`# undelivered alerts (delivered=false — webhook down)` with `suite,week,year,shard,status,minutes,deltaPctWoW,recordedAt`), one row per alert — so a webhook outage is visible without opening the JSON. It also publishes a GitHub **job summary** (missed/phantom alert table + delta reconciliation + delivery failures table) via `GITHUB_STEP_SUMMARY`. **SVG embed**: with a reachable https URL, the summary gains the `### Consistency chart` section with `![Nightly alert-vs-trend consistency chart](<url>)`. Two paths: (1) the repo var `CONSISTENCY_SVG_PUBLIC_URL` (signed/private URL); or (2) **automatic in CI** — with `CONSISTENCY_SVG_BUCKET` set, the nightly uploads `nightly-consistency.svg` to a **private** S3 bucket, generates a **presigned** URL and rewrites the summary with it (two phases: `CONSISTENCY_DEFER_SUMMARY=1` omits the summary in the first step, the `Sign SVG URL` step presigns, and `CONSISTENCY_SUMMARY_ONLY=1` rewrites with the URL — always exit 0, without re-running the gate). Without var and without bucket (default), the summary only has tables — **nothing leaves the repo by default**, same as in `nightly-trends`. Advisory **except for one fail-loud gate**: if a suite accumulates ≥ `CONSISTENCY_MIN_CONSECUTIVE_PHANTOM` (default 2) **consecutive** weeks of phantom-alerts (WoW alerts with no suite-level corroboration), the script writes the CSVs/JSON/summary and exits with code 1, logging `nightly_consistency_sustained_phantom` — repeated phantoms in the same suite suggest a bug in the degradation criterion. A gap or a non-phantom week breaks the streak. | 90 d |
| `nightly-dependency-cve-report` | `dependency-cve-report-prod.md` + its sibling `.json` and `dependency-cve-report-dev.md` + its `.json` — the CVE report of the declared tree in both `npm audit` profiles (prod and dev), with the `own` / `inherited` table and the **minimal bump** per advisory; it publishes **every Monday even when the gate is green** (see §6). The same tables go into the run's job summary (`--step-summary`), so they are readable without downloading anything. `if-no-files-found: error`: the report IS the deliverable, its absence is a real failure. | 90 d |
| `nightly-performance` | `test-results/`, `playwright-report-*` | 14 d |
| `kpi-report-<run_id>`, `drill-backup-restore-<run_id>` | KPI / drill evidence | 30/90 d |

**Resilient merge** (`scripts/merge-nightly-blobs.mjs`): with 0 blobs or an incomplete set (shard cancelled before the run) the merge **skips with exit 0** and uploads the status JSON — the real failure is already reported by the shard. Only a genuine `merge-reports` failure (complete set) propagates exit 1.

## 5. Triaging a red nightly

### Step 1 — Identify the red job

1. Open **Actions → Nightly validation → latest run** (or the README's "failed runs" link, filtered by `conclusion=failure`).
2. In the *Summary* tab see which jobs failed: `human-like-sharded`, `multiuser-sharded`, `performance`, `coverage`, `kpi-staging`, `launch-readiness`, `drill-backup-restore`, `load-test`, or a merge/reports job.

### Step 2 — Classify by failure family

| Symptom | Probable cause | Action |
|---|---|---|
| E2E job red + the **same shard** failed on a test | Flaky test or functional regression | Re-run the job (`Re-run failed jobs`); if it persists, review the test and the unified HTML report |
| E2E job red due to **job timeout** (60/45 min) | The suite grew or slow hardware | Increase the number of shards, review `nightly-trends.csv`, adjust the budget |
| `*report` (merge) red **only because blobs are missing** | Shard cancelled before the run | **Not a real failure**: the merge skipped (see `*-merge-status.json`). The missing shard is already red on its own |
| `*report` red with a **complete** set of blobs | Corrupt merge (a bug) | Investigate `playwright merge-reports` — this case IS a real failure |
| Slack alert of **DEGRADED +X% WoW** | Duration growing week over week | Review `nightly-trends.csv`; look for tests that slowed down; decide whether it is noise (bump ratio) or signal (act) |
| `nightly-trends` red for **sustained degradation** | ≥ N **consecutive** DEGRADED weeks in a suite | **It is a real signal, not noise**: look at the summary CSV to see the streak (`degradedWoW`) and the job summary; the `nightly_trends_sustained` Slack alert includes the slope of the last week. Increase shards or budget only after confirming the slope |
| `nightly-consistency` report with **missed-alert** | Suite DEGRADED in the summary with no WoW alert from any shard | Check whether it is a median artifact (no shard crossed 1.25× but the median did) or an undelivered alert; review that suite's alert log. If `severity = high` (streak ≥ 2) it is a **priority**: the suite has been DEGRADED for consecutive weeks without corroboration — investigate the degradation criterion or the alert delivery before the gate fires |
| `nightly-consistency` report with **phantom-alert** | WoW alert from a shard with no DEGRADED row for the suite | Review the shard's row in the summary: it may be a shard that degraded while the suite did not; if it repeats, investigate the criterion |
| `nightly-consistency` job **red** (`nightly_consistency_sustained_phantom`) | ≥ `CONSISTENCY_MIN_CONSECUTIVE_PHANTOM` (default 2) consecutive weeks of phantom-alerts in the same suite | The degradation criterion is firing alerts without median corroboration: review the per-suite threshold (`NIGHTLY_*_DEGRADE_RATIO`) and the shard aggregation before silencing anything. The CSV/JSON are written before the exit 1, the evidence is in the artifact |
| Row in the CSV's `# undelivered alerts` block | Alert `delivered=false` — the webhook never got the payload (down, URL rejected or rate-limited) | The alert fired but never reached Slack: check the endpoint's status (`NIGHTLY_ALERT_WEBHOOK_URL`), the `nightly_webhook_failed` line in the job log and resend manually if the suite was DEGRADED. The trends report and the artifacts do not depend on delivery — the degradation signal stays in the CSV even if Slack received nothing |
| `nightly-consistency` report with **deltaMatch = mismatch** | The alert's `deltaPctWoW` ≠ the CSV row on a 1-shard suite | A real signal of payload-vs-CSV drift: check what value was sent to Slack vs the summary; a hint of a bug in the enrichment or in the history |
| Weekly `nightly-dependency-cve-report` with an **`own`** advisory, or an `inherited` one **without written acceptance** | The CI gate would have turned the job red; if the report is what shows it first, the gate did not run on that revision (or the advisory arrived after the last CI) | Open the `.md` of the affected profile: the **Arrives via** column names the direct dependency and **Minimal lever** states the cheapest change (`refresh-lockfile`, `bump-parent`, `bump-direct` or `override-pin`). An `own` advisory is never baselined — it is our manifest line |
| Weekly report with advisories **below the threshold** (low/moderate) | The gate only looks at `high` (default threshold); the report lists **everything** `npm audit` reports | No mandatory action: the report exists so you can decide with your eyes open. If the advisory affects something that runs in the user's browser, bumping early is cheaper than waiting for its severity to rise |
| Weekly report **empty** (`0 advisory(ies)` in both profiles) | Clean week: that is a correct report, not a broken job | Nothing. The artifact's value is in the weeks when it is not empty: the job publishes a **classification**, never a gate |
| `kpi-staging` / `launch-readiness` red | Business thresholds / checklist | Review on staging; adjust the `KPI_MIN_*` repo vars or clear the blocker |
| `drill-backup-restore` red | RTO gate of the monthly drill | Review the drill report (`DRILL_*`), it is not a daily nightly |

### Step 3 — Actions by severity

- **Known flaky** → re-run; if it repeats within the week, add it to the tracking (never delete waits or skip tests without reason — `no-unexplained-test-skip` blocks it).
- **Duration regression** → before raising the budget, look at the trends CSV (`nightly-trends`, 90 days) to confirm the slope is real; the summary's `deltaPctWoW` column gives the week-over-week change % (empty if there is no adjacent previous week or the previous median is 0). The budget is a **sensor**, not an escape valve.
- **Merge skip** → confirm with the `*-merge-status.json` and close without action (the nightly already reflects the shard's failure).
- **Webhook failure** → `NIGHTLY_ALERT_WEBHOOK_URL` misconfigured or down: validate with `webhook-smoke` (manual dispatch with `test_alert` + `smoke_suite`).

### Step 4 — Verify the alert

- The webhook is tested with the `webhook-smoke` job (Actions → *Run workflow* → `test_alert: true`, choose a suite).
- The README badge and the "failed runs" link give the status without opening Actions.

## 6. Weekly dependency CVE report — `dependency-cve-report`

The `check:direct-cve` gate (and its twin `check:override-cve`) only speaks when it **fails**: with a clean tree it prints one `ok` line and nothing else. The classification people need to read — which advisory is `own` (our manifest line), which is `inherited` (it arrives through something we declare), **why a direct dependency** arrives and **what the minimal bump** that closes it is — is precisely what stays invisible in a green week. This job publishes it:

- **Weekly cadence** — Monday 02:23 UTC (`cron: '23 2 * * 1'`), plus `workflow_dispatch`. The cadence is deliberate: the job publishes a **classification**, not a signal, and the advisory base does not move every night; a daily report would bury the only real difference of the week.
- **Both profiles.** `prod` (the same one that runs inside `npm run check`) and `dev` (CI's own step, where the toolchain lives). Each with its readable `.md` and its sibling `.json`.
- **Report mode never gates.** The job's exit code only means "the audit could run" — if not, it fails closed (exit 2). No week turns red for having advisories; CI already covers that.
- **No downloads.** `--step-summary` dumps the same tables into the run's job summary, with the profile in each heading (`## Dependency CVE report — prod (npm audit --omit=dev)`), so the classification is readable on the run page without downloading the artifact.
- **The baseline is visible too.** An inherited advisory accepted with `--accept … --reason` still appears in the `inherited` table and counts as `accepted`: "green" and "no accepted risk" are not the same, and the report makes that explicit.
- **Local:** `npm run cve:report` reproduces exactly the `dev` report.

The job **must not become a gate**. The only thing that can turn it red is the artifact not existing (`if-no-files-found: error`): the report *is* the deliverable. An npm registry failure does not break it — `fetchRegistryMetadata` is best-effort and degrades to `basis: offline`, saying so in the report instead of inventing a minimum version.

## 7. References

- `scripts/nightly-alert.mjs` + `scripts/__tests__/nightly-alert.test.mjs` — alert gate (tests: 49)
- `scripts/merge-nightly-blobs.mjs` + tests — resilient blob merge
- `scripts/nightly-trends.mjs` + tests — trends CSV
- `scripts/check-direct-cve.mjs` + `scripts/dependency-cve-core.mjs` + tests — declared tree CVE gate and report (`own` / `inherited` classification and minimal bump)
- `.github/workflows/nightly.yml` — job, var and secret definitions
- `docs/audit.md` — `ADR-019`, `P92`, `H5` anchors and the known-gap ledger

## 8. Known debts and pending improvements

These improvements are recorded here as operational reference. They do not
block the launch, but they are candidates for the first post-launch sprint.

- **Cleanup of the presigned S3 bucket.** The trends and consistency SVGs are
  uploaded to private S3 buckets with short-lived presigned URLs
  (`TRENDS_SVG_PRESIGN_EXPIRES`, default 3600 s). The objects expire by URL but
  are not deleted from the bucket; accumulating expired objects without a
  lifecycle policy is a growing storage debt. Decide: (a) a lifecycle rule that
  deletes objects older than 7 days, (b) explicit post-run deletion inside the
  script itself, or (c) accept the accumulation if the cost is negligible. Check
  the real cost with a bucket inventory before implementing.
- **Extract `Sign SVG URL` / `Rewrite summary` into a composite action.** The
  sign and rewrite steps are duplicated between `nightly-trends` and
  `nightly-consistency` (same two-phase pattern: DEFER_SUMMARY → Sign →
  SUMMARY_ONLY). Extracting them into a composite action reduces duplication and
  the risk that a change in one does not reach the other.
- **`streak 1→N→gate` ramp parity in the consistency SVG.** The trends SVG
  (`nightly-trends.svg`) shows the streak ramp as a continuous gradient in the
  legend. The consistency SVG (`nightly-consistency.svg`) uses per-severity
  colors (high/medium/low) but does not include the streak ramp; an observer
  looking only at the consistency SVG cannot see how far each suite is from the
  gate. Adding the streak ramp to the consistency SVG (or at least a numeric
  streak indicator per bar) would close that readability gap.