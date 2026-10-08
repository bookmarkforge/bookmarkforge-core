# `main` branch protection

The exportable ruleset for `main` is [`.github/rulesets/main-protection.json`](rulesets/main-protection.json). This page is the operator reference for what it configures and how to install it.

## Status: installable only after the plan gate lifts (verified 2026-10-02)

The ruleset cannot be installed on this repository today, and the blocker is the GitHub plan, not a missing manual step. Verified with a repo-scoped token authenticated as a repository admin: both the repository-rulesets API (`GET /repos/ORG/REPO/rulesets`) and the classic branch-protection API (`GET /repos/ORG/REPO/branches/main/protection`) answer

```
403 Upgrade to GitHub Pro or make this repository public to enable this feature.
```

The repository is private and owned by a personal Free-plan account. Classic branch protection is gated identically, so there is no API-based fallback.

**Decision taken 2026-10-02:** stay on Free and rely on CI-only enforcement — the single-maintainer release control documented in [docs/launch-checklist.md](../docs/launch-checklist.md) and in [AGENTS.md](../AGENTS.md). The payload stays ready and is re-verified by `npm run check:launch-checklist`; import it after upgrading to GitHub Pro or moving the repository to a Team org. Making the repository public would also lift the gate, but it breaches the Open Core boundary (the public Core ships only as the curated export), so it is excluded.

## Configuration

| Rule | Value |
|---|---|
| Name | `Protect main` |
| Target | branch |
| Enforcement | `active` |
| Branches | `refs/heads/main` only |
| Bypass actors | none |
| Deletion | blocked |
| Force pushes | blocked (`non_fast_forward`) |
| Merge commits | blocked (`required_linear_history`) |
| Pull request | required |
| Required approving reviews | **0** — the repository has a single maintainer and does not depend on external approval |
| Conversation resolution | required |
| Stale approvals dismissed on push | no |
| Branches up to date | yes (`strict_required_status_checks_policy`) |

Zero required approvals is deliberate: this repository has one maintainer, so requiring an approval would deadlock every merge.

### Required status checks

These are **CI job names**, which is what GitHub matches against a check run:

| Context | Workflow job |
|---|---|
| `Typecheck, lint, tests and security gates` | `quality` ([ci.yml](workflows/ci.yml)) |
| `Playwright E2E` | `e2e` ([ci.yml](workflows/ci.yml)) |
| `Production build and repository checks` | `build` ([ci.yml](workflows/ci.yml)) |
| `Dependency review` | `dependency-review` ([ci.yml](workflows/ci.yml)) |
| `CodeQL analysis` | [sast.yml](workflows/sast.yml) |
| `Semgrep analysis` | [sast.yml](workflows/sast.yml) |

> **A required check must be a job name.** `Enforce mandatory security gates` is a *step* name inside the `quality` job; required as a check context it would never be reported by any run and would block every merge permanently. The same trap applies to `npm` script names such as `lint`, `test:fast` or `typecheck:prod` — they are commands, not checks. `npm run check:launch-checklist` pins this list.

## Installing the ruleset

In GitHub: **Settings → Rules → Rulesets → New branch ruleset → Import a ruleset**, selecting `.github/rulesets/main-protection.json`, then activate it.

Or with the GitHub CLI and repository admin permissions:

```bash
gh api --method POST \
  -H 'Accept: application/vnd.github+json' \
  /repos/ORG/REPO/rulesets \
  --input .github/rulesets/main-protection.json
```

Replace `ORG/REPO` with the real repository. The `integration_id` for the standard GitHub Actions checks is `15368`; use the repository's own integration id if a different CI app reports them.

> **Payload format:** `.github/rulesets/main-protection.json` is the **request body** for `POST /repos/{owner}/{repo}/rulesets`, not an export. It must not carry export-only fields — `id`, `source`, `source_type`, `node_id`, `_links`, `created_at`, `updated_at`. The documented creation body is `name`, `target`, `enforcement`, `bypass_actors`, `conditions` and `rules`. `npm run check:launch-checklist` fails if any export field appears.

After importing, open a test PR touching crypto or infrastructure and confirm it is blocked while the checks above fail. See [docs/GITHUB-RULESET-IMPORT-GUIDE.md](../docs/GITHUB-RULESET-IMPORT-GUIDE.md) for the full import and verification procedure.