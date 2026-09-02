# GitHub Secrets + First Push Runbook — drill-quarterly & nightly KPI workflows

- **Date:** 2026-08-31
- **Purpose:** Get `drill-quarterly.yml` (quarterly DR drill + KPI collector check) and `nightly.yml` (KPI gate vs staging, monthly drill) running for the first time on GitHub.
- **Prerequisite:** The repo does not yet exist on GitHub (no `origin` remote is configured locally; `gh` CLI is not installed). Create the repo + set secrets in the GitHub web UI or with the `gh` CLI — both paths below.

---

## 0. What the workflows actually need

Verified against the workflow YAML:

| Workflow / job | Consumes | Required? |
|---|---|---|
| `nightly.yml` → `kpi-staging` | `secrets.STAGING_ANALYTICS_ADMIN_TOKEN` | **Required** — `kpi-report.mjs` fails closed without it |
| `nightly.yml` → `kpi-staging` | `vars.STAGING_URL` | **Required** — otherwise the job hits `127.0.0.1:8787` inside the runner and fails |
| `nightly.yml` → `kpi-staging` | `secrets.ANALYTICS_ALERT_WEBHOOK_URL` | Optional (Slack alerting only) |
| `nightly.yml` → `drill-backup-restore` | `secrets.DRILL_ALERT_WEBHOOK_URL` | Optional (RTO degradation alerting only) |
| `nightly.yml` → `kpi-staging` | `vars.KPI_MIN_DAU / WAU / MAU / D7_PCT / D30_PCT` | Optional (sensible defaults in the script) |
| `nightly.yml` → `drill-backup-restore` | `vars.DRILL_RTO_MS`, `vars.DRILL_RTO_WARN_MS` | Optional (defaults 120000 / 90% of gate) |
| `drill-quarterly.yml` | none | ✅ runs on push automatically (cron + workflow_dispatch) |

**Minimum for a meaningful nightly run:** 2 secrets + 1 var (`STAGING_ANALYTICS_ADMIN_TOKEN`, `ANALYTICS_ALERT_WEBHOOK_URL` optional, `STAGING_URL`).

---

## 1. Create the repo + push (web UI path)

1. Create an empty **private** repo on GitHub (no README / .gitignore / license).
2. From the repo root:

```bash
git remote add origin git@github.com:YOUR_ORG/bookmarkforge.git
git push -u origin main
```

`drill-quarterly.yml` will run on push. `nightly.yml` runs daily at 02:17/03:17 UTC (and monthly KPI gate at 03:17 on the 1st) — the KPI job needs §2 to pass.

---

## 2. Secrets + vars (GitHub → Settings → Secrets and variables → Actions)

| Name | Type | Value |
|---|---|---|
| `STAGING_ANALYTICS_ADMIN_TOKEN` | Secret | Same value as `ANALYTICS_ADMIN_TOKEN` in staging's `.env` (must match exactly — the KPI endpoint is fail-closed) |
| `STAGING_URL` | Variable | Staging base URL, e.g. `https://staging.bookmarkforge.com` |
| `ANALYTICS_ALERT_WEBHOOK_URL` | Secret | Slack incoming-webhook URL (https only) |
| `DRILL_ALERT_WEBHOOK_URL` | Secret | Slack incoming-webhook URL (https only) |
| `KPI_MIN_DAU` / `KPI_MIN_WAU` / `KPI_MIN_MAU` | Variables | e.g. `10` / `30` / `60` |
| `KPI_MIN_D7_PCT` / `KPI_MIN_D30_PCT` | Variables | e.g. `0.15` / `0.30` |
| `DRILL_RTO_MS` / `DRILL_RTO_WARN_MS` | Variables | Defaults `120000` / `108000` (90% of gate) |
| `STAGING_SMOKE_TOKEN` | Secret | Bearer token for the staging smoke endpoint checks (`staging-smoke.yml`) |
| `STAGING_SMOKE_ADMIN_TOKEN` | Secret | Admin token for the staging smoke endpoint checks (`staging-smoke.yml`); also used as gate in `staging-deploy.yml` |

> Generate a strong random token locally, set it as the secret **and** in staging's `.env` (`ANALYTICS_ADMIN_TOKEN`) so both sides match.

---

## 3. `gh` CLI path (alternative to web UI)

After `gh auth login`, from the repo root:

```bash
# Repo creation + push in one shot
gh repo create YOUR_ORG/bookmarkforge --private --source=. --remote=origin --push

# Secrets
gh secret set STAGING_ANALYTICS_ADMIN_TOKEN     # paste value when prompted
gh secret set ANALYTICS_ALERT_WEBHOOK_URL
gh secret set DRILL_ALERT_WEBHOOK_URL

# Variables
gh variable set STAGING_URL                     # e.g. https://staging.bookmarkforge.com
gh variable set KPI_MIN_DAU
gh variable set KPI_MIN_WAU
gh variable set KPI_MIN_MAU
gh variable set KPI_MIN_D7_PCT
gh variable set KPI_MIN_D30_PCT
gh variable set DRILL_RTO_MS
gh variable set DRILL_RTO_WARN_MS

# First manual runs (no need to wait for cron)
gh workflow run nightly.yml
gh workflow run drill-quarterly.yml
```

Watch: `gh run watch` or the Actions tab.

---

## 4. Verify first runs + close checklist items

- Actions tab → `drill-quarterly.yml` green (no secrets needed) and `nightly.yml` KPI job green (needs §2).
- Register the run links as evidence and mark:
  - `docs/launch-checklist.md` item **13** (drill first CI run — needs ≥ 2 tags `prod-*` on the remote too)
  - `docs/launch-checklist.md` item **19** (KPI gate external setup)
  - `docs/launch-checklist.md` item **8** (SAST first run — also satisfied by this push)

---

## Related external items (audit round 5)

- CODEOWNERS: `npm run codeowners:apply-org -- --org TU_ORG` + repo variable `CODEOWNERS_ORG`
- ROPA: remaining `⚠ DATO PERSONAL` fields (operator legal identity, signed DPAs)
- Sentry DSN + DPA (ROPA §7) before enabling error reporting
