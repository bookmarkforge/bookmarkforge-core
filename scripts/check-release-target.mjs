#!/usr/bin/env node
/**
 * scripts/check-release-target.mjs — release-target confirmation gate.
 *
 * A release must not be prepared against a repository target that nobody has
 * confirmed. This repository shipped with the *provisional* slug
 * `bookmarkforge/core` written into three surfaces that would all have
 * published to the wrong place today:
 *
 *   1. `package.json` → `repository.url` (the declared target: what npm
 *      metadata, badges and the public export would advertise);
 *   2. the git remote(s) (the actual target: where `git push` would land);
 *   3. release-shipping artifacts (`README.md` badges, the public export's
 *      `RELEASE-NOTES-*.md`, which embed the clone URL a reader will copy).
 *
 * A silent mismatch is the dangerous case: a repository that *declares* one
 * target and *pushes* to another produces a release whose clone instructions
 * point somewhere the code will never be. So the gate enforces three
 * invariants over those surfaces:
 *
 *   - the declared target exists (a `repository.url` that resolves to
 *     `owner/repo`), and the git remote exists too — absence is unconfirmed,
 *     not "fine";
 *   - neither is a provisional/placeholder target: a slug listed in
 *     `PROVISIONAL_TARGETS` (empty since `bookmarkforge/core` was confirmed as
 *     the real destination on 2026-09-19 — see the amendment in
 *     docs/ADR-058-release-target-confirmation-gate.md) or a placeholder owner
 *     such as `tu_usuario` / `your-org`;
 *   - declared and actual agree, so a release cannot be published from a
 *     different place than the one it advertises.
 *   - the same agreement is enforced over the release-shipping artifacts
 *     (README, exported RELEASE-NOTES, the Help Center): a real-but-different
 *     repository in a shipped URL fails as `artifact-drift` — the 09-22 rename
 *     left `bookmarkforge/core` in those surfaces for three days with the gate
 *     green (ADR-058 amendment 8).
 *
 * Modes:
 *   - default: BLOCKING, and the only mode. Any finding makes the gate exit 1.
 *     The release path calls this module before doing any work —
 *     `scripts/export-public-repo.mjs` and `scripts/run-launch-smoke.mjs`, so a
 *     public export or a launch-day battery cannot run against an unconfirmed
 *     target — and `npm run check` runs this same gate, so an unconfirmed
 *     target cannot reach a commit either.
 *   - `--json`: emit the structured report on stdout (human lines move to
 *     stderr, as in the other gates).
 *   - `GITHUB_STEP_SUMMARY` (set on every GitHub Actions step): append a
 *     markdown summary, so the finding is visible in the run UI.
 *   - `BMF_RELEASE_TARGET_ROOT`: check another checkout (tests, fixtures).
 *
 * Exit codes: 0 = confirmed, 1 = unconfirmed target.
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import process from "node:process";

export const ROOT = fileURLToPath(new URL("..", import.meta.url));

/**
 * Slugs that are known placeholders: releasing to one is always a mistake.
 *
 * Empty since 2026-09-19. Its only entry, `bookmarkforge/core`, was confirmed
 * as the real destination by the repository owner, so the four surfaces that
 * name it — package.json → `repository.url`, the git remote, the README badges
 * and the export release notes — now agree on a target nobody has to guess.
 * Re-arming this list requires the mirror-image evidence: the slug must not
 * exist, or the confirmation must be retracted (ADR-058 amendment). The
 * mechanism stays live for the next unconfirmed target, and the placeholder
 * owner patterns below keep covering unedited template URLs.
 */
export const PROVISIONAL_TARGETS = [];

/**
 * Owner/repo segments that mark a clone URL as a template rather than a real
 * destination (`git@github.com:TU_USUARIO/bookmarkforge.git` in the runbook is
 * the canonical example).
 */
const PLACEHOLDER_SEGMENTS = [
  /^tu[_-]?usuario$/i,
  /^tu[_-]?(org|organizacion|organización)$/i,
  /^usuario$/i,
  /^your[_-]?(user|username|org|organization|name)$/i,
  /^owner$/i,
  /^example$/i,
  /^changeme$/i,
  /^placeholder$/i,
  /^<.+>$/,
  /^x{3,}$/i,
];

/**
 * Release-shipping surfaces: files whose URLs a reader of the release copies.
 * `package.json` and the git remotes are handled separately (declared/actual).
 */
export const RELEASE_ARTIFACTS = [
  "README.md",
  "scripts/public-export/RELEASE-NOTES-v1.0.0.md",
  "scripts/public-export/RELEASE-NOTES-v1.0.0.es.md",
  // The Help Center ships to readers too: its support table told Free users
  // to open discussions on github.com/OWNER/bookmarkforge — a placeholder that
  // this gate was blind to, because public/ was not scanned at all (found by
  // the ADR-062 landing smoke link probes).
  "public/help.html",
];

const HTTPS_GITHUB_RE = /https?:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)/gi;
const SSH_GITHUB_RE = /git@github\.com:([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)/gi;

/** `owner/repo` (lowercase, no `.git`, no query) from its two path segments. */
function toTarget(owner, repo) {
  const clean = (segment) =>
    String(segment ?? "")
      .replace(/\.git$/i, "")
      .replace(/[?#].*$/, "")
      .replace(/\/+$/, "");
  const ownerSegment = clean(owner);
  const repoSegment = clean(repo);
  if (!ownerSegment || !repoSegment) return null;
  return `${ownerSegment}/${repoSegment}`.toLowerCase();
}

/** `owner/repo` (lowercase, no `.git`, no protocol) or `null` if not a repo URL. */
export function normalizeTarget(raw) {
  if (typeof raw !== "string") return null;
  const value = raw.trim().replace(/^git\+/, "");
  if (!value) return null;
  const ssh = value.match(/^(?:ssh:\/\/)?git@github\.com[:/](.+)$/i);
  const https = value.match(/^https?:\/\/github\.com\/(.+)$/i);
  const path = ssh?.[1] ?? https?.[1];
  if (!path) return null;
  const parts = path.split("/").filter(Boolean);
  if (parts.length < 2) return null;
  return toTarget(parts[0], parts[1]);
}

/** Why this target is not releasable, or `null` when it looks confirmed. */
export function provisionalReason(target, provisionalTargets = PROVISIONAL_TARGETS) {
  if (!target) return null;
  if (provisionalTargets.includes(target)) {
    return `provisional slug "${target}" — the repository target is still undecided`;
  }
  for (const segment of target.split("/")) {
    if (PLACEHOLDER_SEGMENTS.some((re) => re.test(segment))) {
      return `placeholder target "${target}" — an unedited template URL`;
    }
  }
  return null;
}

/** Distinct `owner/repo` targets referenced by a text blob. */
export function githubTargets(text) {
  const targets = new Set();
  for (const re of [HTTPS_GITHUB_RE, SSH_GITHUB_RE]) {
    for (const match of text.matchAll(re)) {
      const target = toTarget(match[1], match[2]);
      if (target) targets.add(target);
    }
  }
  return [...targets];
}

function firstLineOf(lines, needle) {
  const index = lines.findIndex((line) => line.includes(needle));
  return index === -1 ? null : index + 1;
}

/** First line of the file that references this exact `owner/repo` target. */
function firstLineWithTarget(lines, target) {
  const index = lines.findIndex((line) => githubTargets(line).includes(target));
  return index === -1 ? null : index + 1;
}

/** The target `package.json` declares (`repository`/`bugs`/`homepage`). */
export function declaredTargets(root) {
  const path = join(root, "package.json");
  const raw = readFileSync(path, "utf8");
  const pkg = JSON.parse(raw);
  const lines = raw.split(/\r?\n/);
  const fields = [];
  if (typeof pkg.repository === "string") {
    fields.push(["repository", pkg.repository]);
  } else if (pkg.repository?.url) {
    fields.push(["repository.url", pkg.repository.url]);
  }
  if (pkg.bugs?.url) fields.push(["bugs.url", pkg.bugs.url]);
  if (typeof pkg.homepage === "string") fields.push(["homepage", pkg.homepage]);

  return fields.map(([field, value]) => ({
    file: "package.json",
    field,
    value,
    line: firstLineOf(lines, value),
    target: normalizeTarget(value),
  }));
}

/**
 * Every configured git remote, as reported by `git remote -v`.
 *
 * `safe.directory` is passed explicitly, as check-docs-markdown does when it
 * hashes a file: a checkout owned by another user (shared workstations, CI
 * containers, bind mounts) otherwise makes git refuse with "detected dubious
 * ownership" and the gate would report a confirmed remote as missing.
 */
export function readRemotes(root) {
  const result = spawnSync("git", ["-c", `safe.directory=${root}`, "remote", "-v"], {
    cwd: root,
    encoding: "utf8",
  });
  if (result.status !== 0 || !result.stdout || !result.stdout.trim()) {
    return {
      remotes: [],
      error: result.stderr?.trim() || result.error?.message || "no git remotes configured",
    };
  }
  const remotes = [];
  const seen = new Set();
  for (const line of result.stdout.split(/\r?\n/)) {
    const match = line.match(/^(\S+)\s+(\S+)\s+\((fetch|push)\)\s*$/);
    if (!match) continue;
    const [, name, url, kind] = match;
    // `git remote -v` prints fetch+push for the same URL: one destination, one
    // finding.
    const key = `${name}\u0000${url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    remotes.push({ name, url, kind, target: normalizeTarget(url) });
  }
  return { remotes, error: remotes.length ? null : "no git remotes configured" };
}

/** Provisional targets embedded in release-shipping artifacts. */
export function artifactTargets(root) {
  const found = [];
  for (const rel of RELEASE_ARTIFACTS) {
    const path = join(root, rel);
    if (!existsSync(path)) continue;
    const lines = readFileSync(path, "utf8").split(/\r?\n/);
    const targets = new Map();
    for (const target of githubTargets(lines.join("\n"))) {
      targets.set(target, firstLineWithTarget(lines, target));
    }
    if (targets.size === 0) continue;
    found.push({
      file: rel,
      targets: [...targets].map(([target, line]) => ({ target, line })),
    });
  }
  return found;
}

/**
 * Evaluate the release target. Pure over its inputs so tests can inject
 * remotes/artifacts instead of needing a real git checkout.
 */
export function checkReleaseTarget({
  root = ROOT,
  remotes,
  artifacts,
  provisionalTargets = PROVISIONAL_TARGETS,
} = {}) {
  const findings = [];
  const declared = declaredTargets(root);
  const githubDeclared = declared.filter((entry) => entry.target);
  const remoteList = remotes ?? readRemotes(root).remotes;
  const artifactsFound = artifacts ?? artifactTargets(root);
  const add = (kind, location, value, reason) => findings.push({ kind, location, value, reason });

  // 1. Declared target: present and not provisional.
  if (githubDeclared.length === 0) {
    add(
      "declared-missing",
      "package.json",
      null,
      "package.json declares no github repository target — the release destination is unconfirmed",
    );
  }
  for (const entry of githubDeclared) {
    const reason = provisionalReason(entry.target, provisionalTargets);
    if (reason) {
      add("declared-provisional", `${entry.file}:${entry.line ?? "?"}`, entry.field, reason);
    }
  }

  // 2. Actual target: the git remote(s) the release would push to.
  if (remoteList.length === 0) {
    add(
      "remote-missing",
      "git remote -v",
      null,
      "no git remote is configured — `git push` has no confirmed destination",
    );
  }
  for (const remote of remoteList) {
    const reason = provisionalReason(remote.target, provisionalTargets);
    if (reason) {
      add(
        "remote-provisional",
        `git remote ${remote.name} (${remote.kind})`,
        remote.url,
        reason,
      );
    }
  }

  // 3. Declared vs actual: a release must not advertise one place and push to
  //    another. Compared only when both sides resolve to a github target.
  const declaredTarget = githubDeclared[0]?.target ?? null;
  const origin = remoteList.find((remote) => remote.name === "origin") ?? remoteList[0] ?? null;
  if (declaredTarget && origin?.target && declaredTarget !== origin.target) {
    add(
      "declared-actual-drift",
      "package.json vs git remote",
      `${declaredTarget} ≠ ${origin.target}`,
      `package.json declares "${declaredTarget}" but remote "${origin.name}" is ` +
        `"${origin.target}" — the release would publish somewhere it does not advertise`,
    );
  }

  // 4. Release-shipping artifacts: URLs a reader of the release will copy.
  //    Two failure classes, not one:
  //      - a provisional/placeholder target (never releasable), and
  //      - a REAL repository that disagrees with the declared destination.
  //    The second class is the ADR-058 amendment-8 failure: the 2026-09-22
  //    rename to `bookmarkforge/bookmarkforge` left the README badges and the
  //    exported RELEASE-NOTES pointing at `bookmarkforge/core` for three days
  //    while this gate stayed green, because it only hunted placeholders. A
  //    reader of the release must never copy a URL the release does not
  //    publish.
  const declaredConfirmed =
    declaredTarget !== null && !provisionalReason(declaredTarget, provisionalTargets);
  for (const artifact of artifactsFound) {
    for (const { target, line } of artifact.targets) {
      const reason = provisionalReason(target, provisionalTargets);
      if (reason) {
        add("artifact-provisional", `${artifact.file}:${line ?? "?"}`, target, reason);
        continue;
      }
      if (declaredConfirmed && target !== declaredTarget) {
        add(
          "artifact-drift",
          `${artifact.file}:${line ?? "?"}`,
          target,
          `artifact names "${target}" but package.json declares "${declaredTarget}" — this URL ships to readers`,
        );
      }
    }
  }

  return {
    ok: findings.length === 0,
    findings,
    declaredTarget,
    remoteTargets: remoteList.map(({ name, kind, target }) => ({ name, kind, target })),
  };
}

const REMEDIES = {
  "declared-provisional":
    "point `package.json` → `repository.url` at the confirmed repository (remove the field only if the project is genuinely unhosted)",
  "remote-provisional": "retarget the remote: `git remote set-url origin <confirmed-url>`",
  "declared-actual-drift":
    "make `package.json` → `repository.url` and `git remote set-url origin <url>` name the same repository",
  "declared-missing": "add the confirmed repository to `package.json` → `repository.url`",
  "remote-missing": "add the confirmed remote: `git remote add origin <confirmed-url>`",
  "artifact-provisional":
    "update the release artifact to the confirmed URL (it ships to readers)",
  "artifact-drift":
    "update the release artifact to the declared destination (it ships to readers)",
};

/** One actionable remedy line per distinct finding kind. */
export function remediesFor(findings) {
  const order = [
    "declared-missing",
    "remote-missing",
    "declared-provisional",
    "remote-provisional",
    "declared-actual-drift",
    "artifact-provisional",
    "artifact-drift",
  ];
  const kinds = new Set(findings.map((finding) => finding.kind));
  return order
    .filter((kind) => kinds.has(kind))
    .map((kind) => REMEDIES[kind] ?? `fix the "${kind}" finding`);
}

function markdownSummary(report) {
  const lines = ["## 🎯 Release-target gate"];
  lines.push(`**Result:** ${report.status === "pass" ? "✅ PASS" : "❌ FAIL"} (${report.mode})`);
  if (report.declaredTarget) lines.push(`- **Declared:** \`${report.declaredTarget}\``);
  if (report.remoteTargets.length > 0) {
    lines.push(
      ...report.remoteTargets.map(
        (remote) => `- **Remote ${remote.name} (${remote.kind}):** \`${remote.target ?? "n/a"}\``,
      ),
    );
  }
  if (report.findings.length > 0) {
    lines.push("", "| Surface | Value | Why it blocks |", "| --- | --- | --- |");
    for (const finding of report.findings) {
      lines.push(
        `| \`${finding.location}\` | \`${finding.value ?? "—"}\` | ${finding.reason.replaceAll("|", "\\|")} |`,
      );
    }
    lines.push("", "**Remedy:**", ...report.remedies.map((remedy) => `- ${remedy}`));
  }
  lines.push("");
  return lines.join("\n");
}

function writeSummaryIfCi(report) {
  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryFile) return;
  try {
    appendFileSync(summaryFile, markdownSummary(report), "utf8");
  } catch {
    /* the step summary is a convenience, never the failure channel */
  }
}

/** Render a check result as the human/CI output shared by every entry point. */
export function reportResult(result, { json = false, stream = process } = {}) {
  const status = result.ok ? "pass" : "fail";
  const report = {
    tool: "check-release-target",
    status,
    mode: "blocking",
    declaredTarget: result.declaredTarget,
    remoteTargets: result.remoteTargets,
    findings: result.findings,
    remedies: result.ok ? [] : remediesFor(result.findings),
  };
  // In `--json` mode the human lines always go to stderr so stdout stays a
  // single machine-parseable document (same contract as the other gates).
  const emit = (line, error = false) =>
    (error || json ? stream.stderr : stream.stdout).write(`${line}\n`);

  if (result.ok) {
    emit(
      `[check-release-target] ok: release target confirmed (declared and remote agree) — ` +
        `${result.declaredTarget ?? "n/a"}`,
    );
  } else {
    const headline =
      `[check-release-target] FAIL: release target is not ` +
      `confirmed (${result.findings.length} finding${result.findings.length === 1 ? "" : "s"})`;
    emit(headline, true);
    for (const finding of result.findings) {
      emit(`[check-release-target]   - ${finding.location} → ${finding.value ?? "—"}: ${finding.reason}`);
    }
    for (const remedy of report.remedies) {
      emit(`[check-release-target] remedy: ${remedy}`);
    }
  }

  // Routed through the (injectable) stdout stream: the CLI only sets
  // process.exitCode, so Node flushes the pipe before exiting and the
  // synchronous fd-1 write the chunk gate needs is unnecessary here.
  if (json) stream.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  writeSummaryIfCi(report);
  return report;
}

function main() {
  const json = process.argv.includes("--json");
  const root = resolve(process.env.BMF_RELEASE_TARGET_ROOT ?? ROOT);
  const result = checkReleaseTarget({ root });
  reportResult(result, { json });
  process.exitCode = result.ok ? 0 : 1;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main();
}
