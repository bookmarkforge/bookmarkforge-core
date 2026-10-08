# Triage guide — First CodeQL and Semgrep run (SAST)

- **Last review:** 2026-08-30
- **Scope:** first run of `.github/workflows/sast.yml` (jobs "CodeQL analysis" and "Semgrep analysis") and the gate `scripts/check-sarif-severity.mjs`.
- **Related documents:** [launch-checklist.md](launch-checklist.md) point 8, [security.md](security.md) → "External validation required", [internal-security-checklist.md](internal-security-checklist.md).
- **Maintenance:** single repository maintainer; the gate and this guide are validated via CI.

---

## 1. How the gate works (quick read)

| Scanner | Rules | Output | Default threshold |
|---|---|---|---|
| CodeQL | `security-extended`, `build-mode: none` | SARIF in `../codeql-results/` (directory) | `--min-severity high` |
| Semgrep | `p/security-audit` (open mode, `--metrics off`) | `semgrep.sarif` (file) | `--min-severity high` |

The threshold can be tuned **per tool** (`--min-severity-for <tool>=<severity>`) and already **approved** findings can be ignored with `--baseline <file>` (see §4). The summary can be emitted in table format with `--format table`.

Classification applied by the gate (`check-sarif-severity.mjs`):

1. If the result brings `properties["security-severity"]` and its value is a known range (`critical|high|medium|low|none`), that range is used.
2. If not, map `level`: `error` → **high**, `warning` → **medium**, `note` → **low**.
3. Without any severity information → **`unknown` → BLOCKS** (fail-closed: a scanner that does not classify cannot pass silently).

Block = severity with range ≤ range of `--min-severity`. With `high` (default) **critical + high + unknown** block; `medium` and `low` report but do not break CI.

> **CodeQL practical detail:** its SARIFs bring `security-severity` as **numeric score** (e.g. `"7.5"`), which the gate does not interpret as range; therefore, in practice CodeQL findings are classified by `level` (`error` → high → blocks). Result: almost every `security-extended` finding blocks merge. This is deliberate design (fail-closed); if noise becomes a problem, fix not by raising global threshold but with justified exclusions (§4) — or lowering it only after a clean baseline (§5).

Gate output (the "contract" you read in CI):

```
[check-sarif-severity] 3 finding(s) across 2 SARIF file(s):
  - [high] js/command-line-injection (CodeQL) server/src/example-legacy.ts:42 — Unsafe use of child_process exec.
  - [medium] javascript.lang.security.audit.detect-eval-with-expression (Semgrep) src/utils/helpers.ts:10 — Found expression in eval.
[check-sarif-severity] FAIL: 2 finding(s) at or above 'high'
```

Format of each line: `[severity] rule-id (tool) file:line — message`.

## 2. How to read a finding

1. **Rule:** look up the official rule reference:
   - Semgrep: `https://semgrep.dev/r/<rule-id>` (description, pattern, known false positives).
   - CodeQL: the query description in the `github/codeql` repository (`javascript/ql/src/...`) or the alert card in GitHub **Security → Code scanning**.
2. **Location:** `file:line` is the *sink* (the point where damage occurs). The *source* (data origin) is usually higher in the flow; in code scanning you can see the complete data flow.
3. **Message:** explains the detected pattern, not the real severity in your context. Severity is decided by you after triage.
4. **Tool:** CodeQL uses data flow analysis (fewer false positives, more reading effort); Semgrep uses patterns (more coverage, more noise).

## 3. Triage classification

Each finding ends in one of these four verdicts:

| Verdict | When | Action |
|---|---|---|
| **TP — true positive** | The flow is reachable and data is controllable by an untrusted actor | Fix in a follow-up PR; add a test that exercises the case |
| **FP — false positive** | The flow is not reachable, data is internal or previous mitigation exists | Exclude with justification (§4) |
| **Accepted risk** | It is real but cost/benefit of fixing now does not compensate (e.g. self-XSS in local content) | Document with owner and review date in triage log |
| **Pending** | You cannot decide without more context | Do not touch anything; leave blocking until resolved |

**Checklist to distinguish false positives (in this project):**

- [ ] Is the *source* really controllable by a third party? In BookmarkForge:
  - The vault, notes and bookmarks **never leave the device**; an XSS finding on local content is usually *self-XSS* (user attacks themselves) → low risk, not necessarily FP.
  - What does reach the server: P2P signaling (HMAC mandatory in production), license and entitlement validation (restricted origin + rate-limited), opt-in telemetry without content and aggregated analytics. AI provider calls **do not** pass through the server: they leave the browser with the user's key, so a finding on that flow is evaluated on the client.
- [ ] Is the *sink* already protected by an existing mitigation? Review controls in `docs/security.md` ("Active controls"): centralized DOMPurify, SSRF/IP validation, rate limits, strict CSP.
- [ ] Is the code reachable? Local mocks (`license-mock`, `mock-openai-server`), dead branches and build-only code do not run in production.
- [ ] Is the finding in tests or fixtures? Tests can trigger patterns (e.g. `eval` to evaluate test expressions) without real risk; exclude by path (§4) instead of by rule.
- [ ] Does Semgrep flag something the message contradicts? Pattern rules sometimes hit the pattern but not the context; read them with the code in front.

**Golden rule:** when in doubt, **do not exclude**. A doubtful finding that blocks forces looking at it; an excluded finding nobody sees again.

## 4. Suppression with justification

Exclusion is a security decision, not a convenience. Every exclusion needs: the specific rule, a comment with why and explicit review by the single maintainer.

### Semgrep — `nosemgrep` (inline, in code)

```ts
// nosemgrep: javascript.lang.security.audit.detect-eval-with-expression
// Justification: input is an internal build literal, never user data.
const value = eval(code);
```

- Always with the **rule id** and a justification comment. A bare `# nosemgrep` (without id) silences all rules on that line: prohibited.
- The finding is removed **at scan time**, so it does not even reach SARIF or the gate. It is the fast and auditable path.

### CodeQL — exclusion by path (config-file)

CodeQL has no inline equivalent. The mechanism supported by the action is a configuration file with `paths-ignore`:

```yaml
# .github/codeql/codeql-config.yml
paths-ignore:
  - "**/*.test.*"
  - "**/__tests__/**"
  - "tests/**"
  - "scripts/**/mocks/**"
```

Reference it in `sast.yml` (CodeQL init): `config-file: .github/codeql/codeql-config.yml`.

- Serves for **paths** (tests, mocks, generated), not for **individual rules**: exclusion by query is not cleanly supported by the action. If a specific rule generates real noise, the correct path is to fix the code or reduce the query set, not filter by rule.
- Dismiss in code scanning UI cleans the alert list but **does not affect the CI gate**, which reads a new SARIF on each execution.

### Baseline: known and approved findings (`--baseline`)

The `--baseline` mode ignores findings that were already **triaged and explicitly approved** — documented FPs or accepted risks with review date. It is complementary to `nosemgrep`: inline silences in code; baseline centralizes approval and leaves code intact.

Format (`.github/sast-baseline.json`):

```json
[
  {
    "ruleId": "js/command-line-injection",
    "file": "server/src/example-legacy.ts",
    "tool": "CodeQL",
    "line": 42,
    "approved": true,
    "justification": "FP: input limited to authenticated origins; ticket #123"
  }
]
```

- **Matching:** `tool` (optional, case-insensitive), `ruleId`, `file` (normalized: separators and `./`) and `line` (optional; if omitted, matches any line of that file+rule).
- **Fail-closed:** every entry requires `approved: true` and non-empty `justification`; if missing, the gate fails. A finding never approved is never ignored.
- **Stale:** if an entry no longer matches any finding (code was fixed), the gate warns to clean the baseline.
- **When to use baseline instead of `nosemgrep`:** FPs with external reference (ticket, decision), accepted risks with review date, or silencing paths/rules CodeQL does not allow to exclude inline. Prefer `nosemgrep` for trivial and obvious FPs in the code itself.
- The file lives in `.github/sast-baseline.json`; each addition to the baseline is a reviewable security change in the PR and must be justified.

### Golden rules of exclusion

1. Exclusion ≠ fix: first try to fix the code.
2. Mandatory justification in the artifact itself (comment or `paths-ignore` with explanation in the PR).
3. Review by the single maintainer and validation of PR checks.
4. Never exclude entire classes ("everything rule X flags") without justifying each occurrence.
5. Review the exclusion list in each quarterly review: code changes and yesterday's FP may be today's TP.

## 5. When to raise or lower the threshold

The threshold lives in the two "Enforce severity policy (block High/Critical)" steps of `sast.yml` (`--min-severity`). Changing it requires touching both and explicit review by the single maintainer.

| Change | Effect | When |
|---|---|---|
| Raise to `critical` | Only critical (and unknown) block | **Only after:** (1) a triaged baseline without uncorrected high TPs, (2) documented accepted risks with owner and date, (3) fixed re-review date. Risk: **new** high findings also stop blocking |
| Lower to `medium` | Block critical + high + medium | Subsequent hardening, when baseline is clean and medium triage is sustainable |
| Tune per tool (`--min-severity-for semgrep=medium`) | Only that tool changes threshold | Preferable to touching global threshold: isolates noise of one scanner without weakening the other |
| Keep `high` | Current default | Correct for first run and while noise is manageable |

**Never:**
- Touch fail-closed behavior (`unknown` → blocks). Removing that disables the gate's own safety net.
- Relax threshold to "pass CI" with untreated findings.
- Change threshold without entry in triage log (who, when, why, review date).

Remember: the `main` ruleset requires both jobs as mandatory checks. If the gate fails, merge is blocked by design — no shortcut.

## 6. First run procedure

1. **Launch** the workflow: Actions → *SAST security analysis* → Run workflow (branch `main` or a dedicated branch `chore/sast-first-run`).
2. **Wait** for both jobs; read the "Enforce severity policy" steps. The job fails if there are blocking findings — this is the expected behavior of the first run.
3. **Collect findings:** gate output in logs + alerts in **Security → Code scanning** (filter by `category: codeql` and `category: semgrep`).
4. **Reproduce locally** to iterate quickly (commands in appendix).
5. **Triage each finding** with the table from §7: verdict + action.
6. **Fix the TPs** in follow-up PRs (with tests). **Exclude the FPs** with justification (§4) and security review.
7. **Register** the result in `docs/sast-triage-log.md` (create the file with the filled table): date, number of findings per tool, verdicts and threshold decisions.
8. **Document accepted risks** with owner and review date; review them in the next quarterly iteration.

## 7. Triage log template

**Run findings** (one row per finding):

| # | Rule (tool) | Location | Severity (gate) | Verdict | Justification / action | Responsible |
|---|---|---|---|---|---|---|
| 1 | `js/command-line-injection` (CodeQL) | `server/src/example-legacy.ts:42` | high | TP | Fix: validate input before `exec`; PR #… | @… |
| 2 | `…detect-eval-with-expression` (Semgrep) | `src/utils/helpers.ts:10` | medium | FP | Internal build input; `nosemgrep` + justification in code | @… |

**Threshold decisions** (one row per change; also for `--min-severity-for`, format changes and baseline additions/cleanups):

| Date | Change | Reason | Approved by | Review date |
|---|---|---|---|---|
| — | `--min-severity high` (default) | Initial baseline | — | — |

---

## Appendix: local reproduction

```bash
# Semgrep (same version and rules as CI)
pipx run semgrep==1.174.0 scan --config p/security-audit --metrics off \
  --sarif --output semgrep.sarif
node scripts/check-sarif-severity.mjs --min-severity high semgrep.sarif

# Gate over a SARIF directory (CodeQL case)
node scripts/check-sarif-severity.mjs --min-severity high ../codeql-results

# Threshold per tool (e.g. only Semgrep to medium)
node scripts/check-sarif-severity.mjs --min-severity high \
  --min-severity-for semgrep=medium semgrep.sarif

# Summary in table format
node scripts/check-sarif-severity.mjs --format table ../codeql-results

# Ignore approved findings (baseline) and report in table
node scripts/check-sarif-severity.mjs --baseline .github/sast-baseline.json \
  --format table ../codeql-results

# View Semgrep rule list without scanning
pipx run semgrep==1.174.0 --validate-config --config p/security-audit
```

CodeQL local requires the CodeQL CLI (`codeql database create` + `codeql database analyze`); the main path for triage is CI + code scanning, not local reproduction.
