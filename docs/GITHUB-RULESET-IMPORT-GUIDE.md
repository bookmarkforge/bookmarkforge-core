# Importing the `main` ruleset

Step-by-step guide to install the repository ruleset that protects `main`.

**Status: blocked by the GitHub plan gate (verified 2026-10-02).** Follow the *Re-check the gate* step below before attempting anything; today the import fails with a 403 on this private Free-plan repository. The procedure itself is unchanged and stays valid after upgrading to GitHub Pro or moving the repository to a Team org.

## Objective

Install a ruleset that:

- protects the `main` branch,
- requires the repository's CI jobs to pass before a merge,
- blocks branch deletion and force pushes.

`release/v1.0.0` is deliberately **not** covered: it is a release pointer that advances by fast-forward, and protecting it would block its own release process.

## Prerequisites

- [ ] Repository admin access on `bookmarkforge/bookmarkforge`.
- [ ] A signed-in GitHub session.
- [ ] The payload present: `.github/rulesets/main-protection.json`.

## Step 0: Re-check the plan gate (do this first)

```bash
gh api repos/bookmarkforge/bookmarkforge/rulesets
```

- **200** with a JSON array — the feature is available, continue.
- **403 `Upgrade to GitHub Pro or make this repository public to enable this feature`** — the feature is unavailable on this plan. Stop here. Do not attempt the UI import: it is gated identically.

Both this API and the classic branch-protection API (`gh api repos/bookmarkforge/bookmarkforge/branches/main/protection`) return the same 403 on the current plan. Upgrade to GitHub Pro or move the repository to a Team org to lift it; making the repository public would also lift it but breaches the Open Core boundary, so it is excluded.

## Step 1: Open the repository settings

1. Go to `https://github.com/bookmarkforge/bookmarkforge`.
2. Sign in if needed and confirm **Settings** is visible — its absence means you lack admin access.
3. In the sidebar select **Rules** → **Rulesets**.

## Step 2: Import the ruleset

1. Select **New ruleset** → **Import a ruleset**.
2. Choose `.github/rulesets/main-protection.json`.
3. Review the imported name (`Protect main`), target (`main`) and enforcement (`active`).
4. Activate it.

Or, with admin permissions, from the CLI:

```bash
gh api --method POST \
  -H 'Accept: application/vnd.github+json' \
  /repos/bookmarkforge/bookmarkforge/rulesets \
  --input .github/rulesets/main-protection.json
```

## Step 3: Confirm what was installed

The imported ruleset must match the payload. The settings are documented in [`.github/branch-protection.md`](../.github/branch-protection.md); the ones that matter most:

- Branch pattern: `refs/heads/main` only.
- Required approving reviews: **0** (single maintainer).
- Six required status checks, all of them **CI job names**: `Typecheck, lint, tests and security gates`, `Playwright E2E`, `Production build and repository checks`, `Dependency review`, `CodeQL analysis`, `Semgrep analysis`.

If a required check is missing from the list, the import did not apply the payload: re-import it rather than adding the check by hand.

## Troubleshooting

### The "New ruleset" button is missing

Either you lack admin access, or the feature is plan-gated (the Free plan hides it on private repositories). Re-run Step 0 to tell the two apart: a 403 means the plan gate, not a permissions problem.

### Import fails with `422 Unprocessable Entity`

Usually a status-check context that never reports. A required check must be a **job name** from [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) and [`.github/workflows/sast.yml`](../.github/workflows/sast.yml). Two traps:

- `Enforce mandatory security gates` is a **step** inside the `quality` job. Required as a context it never reports, so every merge blocks forever.
- `npm` script names (`lint`, `test:fast`, `typecheck:prod`) are commands, not checks.

### A merge is blocked by a check that never ran

The same cause: a required context that no workflow emits. Compare the ruleset's check list against the six job names in Step 3.

### The ruleset does not apply to the branch

The branch pattern must be exactly `main`. `release/v1.0.0` is intentionally excluded.

## Post-import verification

### Test 1: direct push to `main` must be rejected

```bash
git checkout main
echo "test" > test.txt
git add test.txt
git commit -m "test direct push"
git push origin main
```

Expected: rejected — the branch requires a pull request.

### Test 2: a pull request must run the checks

```bash
git checkout -b test-branch
echo "test" > test.txt
git add test.txt
git commit -m "test pr"
git push origin test-branch
```

Expected: the branch is created, and `gh pr create` opens the PR.

### Test 3: verify the PR is gated

1. Open `https://github.com/bookmarkforge/bookmarkforge/pulls`.
2. Confirm the required checks are listed on the PR and are running.
3. Confirm the merge button stays disabled while any required check fails.

Remove the test branch afterwards:

```bash
git push origin --delete test-branch
```

## References

- [GitHub Rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets)
- [Protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)
- [Rulesets REST API](https://docs.github.com/en/rest/repos/rules)
- [`.github/branch-protection.md`](../.github/branch-protection.md) — the operator reference for the payload
- [docs/launch-checklist.md](launch-checklist.md) — blocking items 1 and 2 and the plan-gate decision
- [scripts/setup-github-ruleset.README.md](../scripts/setup-github-ruleset.README.md) — the scripted path and how its defaults differ from the payload