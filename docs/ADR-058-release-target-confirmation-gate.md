# ADR-058: Release target confirmation gate

- **Estado:** accepted (implemented in `scripts/check-release-target.mjs`)
- **Fecha:** 2026-09-18

## Contexto

The repository is distributed with the **provisional** slug `bookmarkforge/core`
still written in published surfaces:

- `package.json` → `repository.url` (the *declared* destination: what metadata,
  badges and public export announce);
- the git remote (the *real* destination: where `git push` would land);
- artifacts sent to the reader: `README.md` and the public export's
  `RELEASE-NOTES-*.md`, which embed the `git clone` URL someone will copy.

None of these surfaces fail on their own: Markdown renders, JSON is valid and
`push` works. Failure is silent and appears *after* publishing: a release whose
clone instructions point to a repository nobody confirmed, or worse, that
declares one destination and publishes in another. Repository audits already
listed "unconfirmed destination" as external blocking, but nothing prevented it
mechanically. On 2026-09-19 the repository maintainer confirmed
`bookmarkforge/core` as the real destination: the amendment is in the Decision
(point 6) and Consequences.

## Decisión

1. Add `check:release-target` (`scripts/check-release-target.mjs`) with three
   invariants over the previous surfaces:
   - the declared destination **exists** and the remote **exists** (absence is
     "unconfirmed", not "correct");
   - none is provisional: `bookmarkforge/core` or a template owner
     (`tu_usuario`, `your-org`, `example`…), the form the runbook itself uses
     as marker;
   - declared and real **coincide**, so a release is not published from a
     different place than it announces.
2. Fail in **fail-closed by default**: any finding produces exit 1. The message
   names `file:line`, the value and the concrete remedy
   (`git remote set-url origin <url>`, `repository.url`, affected artifact).
3. A single mode, **blocking**. The `npm run check` chain executes
   `check:release-target` and any finding topples the run. An "advisory" mode
   (same findings, exit 0) existed while the destination remained undecided and
   was removed upon confirmation: see point 7 amendment.
4. Guard the **release path** in hard, where failure has cost:
   - `scripts/export-public-repo.mjs` calls the gate before dry-run, so a trial
     cannot report success either;
   - `scripts/run-launch-smoke.mjs` calls the gate as first check of launch day
     battery: a green battery cannot certify a release against an unconfirmed
     destination.
5. Register the gate in inspector freeze as category `meta` (not documentary
   format) and keep this ADR as scope contract.
6. **Amendment 2026-09-19 — destination confirmed.** `bookmarkforge/core` is the
   real repository, confirmed by the project maintainer, so it leaves
   `PROVISIONAL_TARGETS` (which becomes empty) and the gate passes green. The
   mechanism is not retired: existence of declared destination and remote,
   coincidence between both and template owner detector
   (`tu_usuario`, `your-org`, `example`…) remain valid against any regression.
   Re-arming the provisional list requires inverse evidence: that the slug does
   not exist or that confirmation is withdrawn. In the same revision, the gate
   started invoking git with `safe.directory`, because a checkout owned by
   another user reported a confirmed remote as absent.

7. **Amendment 2026-09-20 — advisory mode removal.** With destination confirmed
   (point 6), the `npm run check` chain starts executing the blocking gate and
   the `--advisory` mode disappears: no `check:release-target:advisory` script
   remains, no flag clamping output to 0, no inspector freeze registration. The
   rationale that justified it —"a permanent red would break CI without preventing
   any release, because the chain publishes nothing"— expired with confirmation,
   and standing was a contradiction with the Decision itself: point 2 fails in
   fail-closed by default and Consequences boast that "there is no exception list
   or escape flag that silences the finding". The advisory mode *was* that flag.
   A destination that becomes doubted again does not reopen the mode: re-arm
   `PROVISIONAL_TARGETS` with its inverse evidence, and the chain turns red as
   appropriate.

8. **Amendment 2026-09-22 — confirmed destination rename.** The real repository
   moved from `bookmarkforge/core` to `bookmarkforge/bookmarkforge` (commit
   `2bf26b0`: `repository.url` + remote), but the rename did not reach all
   surfaces: README badges, export RELEASE-NOTES, amendment 6 of this ADR and
   several runbooks kept naming `core` for three days without any gate turning
   red. Two closures:

   - surfaces a release reader copies re-synced with the current destination
     (README, RELEASE-NOTES, runbooks); this ADR keeps `core` only where it
     narrates history;
   - the gate surface grows an entry: `public/help.html` enters
     `RELEASE_ARTIFACTS`. The Help Center asked to open discussions in
     `github.com/OWNER/bookmarkforge` — a placeholder this gate did not see
     because it did not scan `public/`—, detected by landing link probes
     (ADR-062). The template owner detector (`/^owner$/i` already in the list)
     does the rest.
   - closure of the gap that made drift possible: the artifact rule only caught
     provisional slugs. A **real but different** slug from the declared one passed
     green — exactly the form the rename took: README and RELEASE-NOTES pointing
     to `bookmarkforge/core` while `package.json` declared
     `bookmarkforge/bookmarkforge`. Rule 4 now evaluates two failure classes:
     `artifact-provisional` (placeholder, never publishable) and
     `artifact-drift` (real repository that does not match `repository.url`,
     with finding by file:line). External verification of destination
     (`git ls-remote origin`) confirmed that the remote responds with checkout
     credentials; the repo is private for anonymous view.

## Consecuencias

- Preparing the public release or launch smoke with the provisional slug fails
  before writing anything, with the exact file and line.
- The finding travels in every `npm run check` and blocks: an unconfirmed
  destination does not reach a commit, nor an export dry-run, nor the launch
  smoke.
- Confirming the destination (fixing `repository.url`, retargeting `origin`,
  updating README and RELEASE-NOTES) turns off the gate completely: there is no
  exception list or escape flag that silences the finding.
- When the confirmed destination turns out to be the slug that already traveled,
  confirmation resolves by amending this ADR (emptying `PROVISIONAL_TARGETS`)
  instead of renaming surfaces: the four already named the correct destination
  and there was nothing to correct. Verification that the block lifted is the
  release path itself: `node scripts/export-public-repo.mjs --dry-run` plans
  the export and reports the confirmed destination.
- The gate is deliberately syntactic: it checks that the destination is
  confirmed and coherent, not that the repository is accessible, that the owner
  exists or that the release is ready. That remains covered by the push runbook,
  workflows and launch checklist.
