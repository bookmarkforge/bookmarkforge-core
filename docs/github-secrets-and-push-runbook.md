# GitHub Secrets + First Push Runbook — drill-quarterly & nightly KPI workflows

- **Date:** 2026-08-31
- **Purpose:** Get `drill-quarterly.yml` (quarterly DR drill + KPI collector check) and `nightly.yml` (KPI gate vs staging, monthly drill) running for the first time on GitHub.
- **Prerequisite:** Nothing here has been exercised against a real remote yet: the checkout has no remote branches and no verified workflow runs, its `origin` and every release surface name the confirmed target `bookmarkforge/core`, and `gh` is installed but not authenticated. **Run §1 first** — it confirms the destination, the credentials and that the workflows actually start. Create the repo + set secrets in the GitHub web UI or with the `gh` CLI — both paths below.

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
| `drill-quarterly.yml` | none | ❌ does **not** run on push: cron `0 6 1 1,4,7,10 *` + `workflow_dispatch` — start it with `gh workflow run drill-quarterly.yml` |

**Minimum for a meaningful nightly run:** 2 secrets + 1 var (`STAGING_ANALYTICS_ADMIN_TOKEN`, `ANALYTICS_ALERT_WEBHOOK_URL` optional, `STAGING_URL`).

---

## 1. Pre-push verification: destination, credentials, workflows

The first `push` is also the first time any of this is exercised, so each check
below is worth its minute. They fail in ways that look like something else: a
wrong repository, an interactive credential prompt, or a workflow that silently
never appears while the runbook claims it started.

### 1.1 Confirm the real remote URL

```bash
git remote -v
git remote get-url origin
```

Expected: `origin` naming the repository you just created. Two failure modes to
rule out *before* pushing:

- **Confirmed target.** `bookmarkforge/core` is the real repository, confirmed by
  the project owner on 2026-09-19, and every release surface names it identically,
  so `npm run check:release-target` exits 0 and the release path runs. If you ever
  retarget the release somewhere else, re-run the gate: it exits 1 while the
  declared target (`package.json` → `repository.url`) and the remote disagree, and
  the release path refuses to run — see
  `docs/ADR-058-release-target-confirmation-gate.md`.
- **Transport vs. credentials.** An `https://` remote goes through the git
  credential helper (Git Credential Manager on Windows, which opens an
  interactive dialog); an `git@github.com:` remote needs an SSH key registered on
  the account. Make the remote match the credential you actually have:
  `git remote set-url origin git@github.com:<owner>/<repo>.git`.

Rehearse the push. This is the check that catches missing credentials without
pushing anything:

```bash
git ls-remote origin
```

Expected: it lists the remote's refs (an empty repository prints nothing) and
exits 0. A `128` with these two lines means the credential helper has nothing
stored — authenticate first (§1.2):

```text
fatal: User cancelled dialog.
fatal: could not read Username for 'https://github.com': terminal prompts disabled
```

The first line comes from Git Credential Manager: with prompts disabled it cannot
ask, so it reports a cancelled dialog. In a normal terminal it opens the dialog
instead, and a push started here would block on it. Mind the blast radius too:
the first push publishes the **entire local history**, not one commit.

### 1.2 Authenticate to GitHub

```bash
gh auth status
```

Expected: the account that owns the repository. If it reports that you are not
logged into any GitHub hosts:

```bash
gh auth login            # browser or token, interactive
gh auth setup-git        # let git use gh's credential helper for https remotes
```

Then confirm that account can actually see the destination, because a remote you
cannot push to fails with a 403 *after* the credential dialog:

```bash
gh api user --jq .login
gh repo view <owner>/<repo> --json nameWithOwner,visibility
```

### 1.3 Confirm the local gates, then that the workflows start

Local, before the push:

```bash
npm run check                        # full gate chain (release target blocks the run)
npm run check:secrets-in-commit
npm run check:workflow-pipeline
npm run check:repository-hygiene
```

After `git push -u origin main`:

```bash
gh workflow list                 # workflows present on the default branch
gh run list --limit 10           # runs triggered by the push
gh run watch <run-id>            # follow one to completion
```

Expected: the workflows whose `on:` includes `push` appear, for a push to `main`
that is `ci.yml`, `sast.yml` and `open-core-export.yml` (all three on
`push: branches: [main, master, develop]`). `nightly.yml` and
`drill-quarterly.yml` do **not** run on push — both are cron plus
`workflow_dispatch`, so start them by hand: `gh workflow run nightly.yml` (§3
lists the variables it needs) and `gh workflow run drill-quarterly.yml`.

`open-core-export.yml` deserves one warning: it materializes the public export on
every push, and that export now refuses to run while the release target is
unconfirmed (ADR-058). Expect it to be **red** after the first push until
`package.json` → `repository.url`, the README badges and the two
`scripts/public-export/RELEASE-NOTES-*` files name the confirmed repository. That
red is the gate working, not a broken workflow; `ci.yml` and `sast.yml` are
unaffected by it.

A workflow that never appears is a silent no-op, not a pass. Check, in order:
the file is on the pushed branch (`git ls-tree origin/main .github/workflows`),
its `on:` includes `push`, and Actions is enabled for the repository.

**Done when:** `git remote get-url origin` names the confirmed repository,
`npm run check:release-target` exits 0, `gh auth status` shows the owning
account, `git ls-remote origin` exits 0 without prompting, and `gh run list`
shows `ci.yml` running against `main`.

---

## 2. Create the repo + push (web UI path)

1. Create an empty **private** repo on GitHub (no README / .gitignore / license).
2. From the repo root:

```bash
git remote add origin git@github.com:TU_USUARIO/bookmarkforge.git
git push -u origin main
```

> **Destino confirmado (2026-09-19).** `bookmarkforge/core` es el repositorio
> real y las cuatro superficies lo nombran igual: `package.json` →
> `repository.url`, el remoto, los badges del README y las `RELEASE-NOTES` del
> export. `npm run check:release-target` sale 0 y la ruta de release (export
> público y `npm run launch:smoke`) puede prepararse. Lo que falta para publicar
> no es un destino: son las credenciales y la primera ejecución real de los
> workflows. Reintroducir un slug provisional, un propietario plantilla o una
> discrepancia declarado/real vuelve a bloquear la ruta. Ver ADR-058.

The push itself starts `ci.yml`, `sast.yml` and `open-core-export.yml` (the only workflows with a `push:` trigger). `nightly.yml` runs daily at 02:17/03:17 UTC (and monthly KPI gate at 03:17 on the 1st) — the KPI job needs §3 to pass — and `drill-quarterly.yml` only starts on its quarterly cron or by hand.

---

## 3. Secrets + vars (GitHub → Settings → Secrets and variables → Actions)

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

## 4. `gh` CLI path (alternative to web UI)

After `gh auth login` (§1.2), from the repo root:

```bash
# Repo creation + push in one shot
gh repo create TU_USUARIO/bookmarkforge --private --source=. --remote=origin --push

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

## 5. Verify first runs + close checklist items

- Actions tab → `drill-quarterly.yml` green once dispatched (no secrets needed) and `nightly.yml` KPI job green (needs §3).
- Register the run links as evidence and mark:
  - `docs/launch-checklist.md` item **13** (drill first CI run — needs ≥ 2 tags `prod-*` on the remote too)
  - `docs/launch-checklist.md` item **19** (KPI gate external setup)
  - `docs/launch-checklist.md` item **8** (SAST first run — also satisfied by this push)

---

## Related external items (audit round 5)

- Gobernanza de `main`: activar el ruleset sin aprobación externa; los checks automatizados siguen siendo obligatorios.
- ROPA: remaining `⚠ DATO PERSONAL` fields (operator legal identity, signed DPAs)
- Sentry DSN + DPA (ROPA §7) before enabling error reporting
