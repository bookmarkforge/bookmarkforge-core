# `setup-github-ruleset.mjs` — scripted ruleset install

**Script:** `scripts/setup-github-ruleset.mjs`

Creates a `main` branch-protection ruleset through the GitHub API instead of clicking through the UI.

## Status: cannot succeed on the current plan (verified 2026-10-02)

The script's very first API call — listing existing rulesets — is plan-gated and returns `403 Upgrade to GitHub Pro or make this repository public to enable this feature.` on this private Free-plan repository, with a repository-admin token. Classic branch protection is gated identically, so there is no fallback path, and the script fails closed at the list step before it can create anything.

This is a plan gate, not a permissions problem and not a bug in the script. The decision taken on 2026-10-02 is to stay on Free and rely on CI-only enforcement (see [docs/launch-checklist.md](../docs/launch-checklist.md)); the script stays ready for a re-run after upgrading to GitHub Pro or moving the repository to a Team org. Nothing on GitHub was changed while establishing this.

## The payload is the source of truth, and the script reads it

`.github/rulesets/main-protection.json` is the canonical ruleset — `npm run check:launch-checklist` fails if its mandatory checks or payload shape are wrong.

The script keeps **no copy of its own**: it loads that payload and POSTs it verbatim, so the two cannot diverge. `--dry-run` prints the exact body without touching the API, and needs no token:

```bash
node scripts/setup-github-ruleset.mjs --dry-run
```

That divergence was not hypothetical. The script previously carried a second, hand-written copy that had drifted from the payload in ways that only surface after installation:

| Setting | Payload (canonical) | Old script copy |
|---|---|---|
| Name | `Protect main` | `main-branch-protection` |
| Branches | `refs/heads/main` | `main` **and** `release/v1.0.0` |
| Required approving reviews | `0` | `1` |
| Stale approvals dismissed on push | `false` | `true` |
| Conversation resolution | required | not set |
| Linear history | required | not set |
| Required status checks | six CI job names | **none — the script sends no `required_status_checks` rule** |

The last row is the important one: the old copy installed a ruleset that gates nothing on CI, so a merge was decided by review alone. Its single required approval also deadlocks a single-maintainer repository — nobody can approve their own PR — and protecting `release/v1.0.0` blocks the release fast-forward. The script now inherits every rule from the payload instead.

The payload protects `main` only, on purpose: `release/v1.0.0` is a release pointer that advances by fast-forward, so requiring PRs there would block its own release process.

## Requirements

### Token

A GitHub token with `repo` scope (full control of private repositories) and repository admin. Generate one at <https://github.com/settings/tokens>.

### Environment

```bash
GITHUB_TOKEN=xxx        # required (not needed for --dry-run)
GITHUB_OWNER=bookmarkforge  # optional, defaults to bookmarkforge
GITHUB_REPO=bookmarkforge   # optional, defaults to bookmarkforge
```

## Usage

```bash
# inspect the body first — no token, no API call
node scripts/setup-github-ruleset.mjs --dry-run

# then install it
GITHUB_TOKEN=ghp_xxxxxxxxxxxx node scripts/setup-github-ruleset.mjs
```

A real run lists the existing rulesets, deletes one already carrying the payload's name, creates the ruleset and verifies it by listing again. On success it prints the ruleset id, name and enforcement, then the next steps.

## Verifying afterwards

1. Open `https://github.com/bookmarkforge/bookmarkforge/settings/rules` and confirm the ruleset exists and is active.
2. Confirm the settings match the payload: branch pattern `refs/heads/main`, zero required approvals, and the six required job-name checks.
3. Confirm a direct push to `main` is rejected:

```bash
git checkout main
echo "test" > test.txt
git add test.txt
git commit -m "test direct push"
git push origin main
```

## Troubleshooting

### `GITHUB_TOKEN is not set`

The environment variable is missing. Export it and re-run:

```bash
GITHUB_TOKEN=xxx node scripts/setup-github-ruleset.mjs
```

Or use `--dry-run`, which needs no token at all.

### `403 Upgrade to GitHub Pro or make this repository public to enable this feature`

The plan gate described at the top of this file — expected on the current plan, and it is what the script hits first. No amount of token scope changes this outcome; the repository's plan decides it.

### `401 Unauthorized`

The token is invalid or expired. Generate a new one and confirm it has `repo` scope.

### `404 Not Found`

The repository name is wrong, or the token cannot see it.

### `422 Unprocessable Entity`

The ruleset configuration was rejected. Usual cause: a required status check that does not exist. A check context must be a **job name** from [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) or [`.github/workflows/sast.yml`](../.github/workflows/sast.yml) — not a step name (`Enforce mandatory security gates` is a step inside `quality`) and not an `npm` script name (`lint`, `test:fast`).

## Related documentation

- [`.github/branch-protection.md`](../.github/branch-protection.md) — operator reference for the canonical payload
- [docs/GITHUB-RULESET-IMPORT-GUIDE.md](../docs/GITHUB-RULESET-IMPORT-GUIDE.md) — the recommended UI import path
- [docs/launch-checklist.md](../docs/launch-checklist.md) — blocking items 1 and 2, and the plan-gate decision
- [GitHub Rulesets API](https://docs.github.com/en/rest/repos/rules)