#!/usr/bin/env node
/**
 * scripts/check-github-health.mjs — detect errors on the GitHub side.
 *
 * The deployment probes (monitoring-alerts / health-dashboard) watch the
 * RUNNING app; this script watches the DELIVERY pipeline: GitHub Actions
 * workflow runs on the repository. A red workflow on main is an error the
 * app probes cannot see — the site can be healthy while every push is
 * silently failing CI.
 *
 * What it reports, per repository:
 *   - FAILED / CANCELLED / TIMED_OUT / ACTION_REQUIRED / STARTUP_FAILURE
 *     workflow runs inside the window (default: last 30 runs, max 14 days).
 *   - STUCK runs: status `queued`/`in_progress`/`waiting`/`requested`/`pending`
 *     older than --stuck-minutes (default 60) — a hung job never concludes.
 *   - Optional: `--deployments` also lists the latest deployment statuses.
 *
 * Auth: the private repo needs a token. Set GITHUB_TOKEN or GH_TOKEN (a
 * fine-grained PAT with `actions:read` on the repo is enough). Public repos
 * work unauthenticated at the mercy of the 60 req/h IP rate limit.
 *
 * Usage:
 *   node scripts/check-github-health.mjs                 # origin repo only
 *   node scripts/check-github-health.mjs --all           # origin + core (public)
 *   node scripts/check-github-health.mjs --repo owner/name
 *   node scripts/check-github-health.mjs --since=7d --limit=50
 *   node scripts/check-github-health.mjs --report-only   # always exit 0
 *   node scripts/check-github-health.mjs --json          # machine-readable
 *
 * Exit codes: 0 = no problems found (or --report-only), 1 = problems found,
 * 2 = could not query (auth/network/parse).
 */
import { execFileSync } from "node:child_process";
import process from "node:process";

const API = "https://api.github.com";
const BAD_CONCLUSIONS = new Set([
  "failure",
  "cancelled",
  "timed_out",
  "action_required",
  "startup_failure",
  "stale",
]);
const ACTIVE_STATUSES = new Set([
  "queued",
  "in_progress",
  "waiting",
  "requested",
  "pending",
]);

// ── args ──────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const opt = (name, fallback) => {
  const eq = args.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.split("=")[1];
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 && args[idx + 1] && !args[idx + 1].startsWith("--")
    ? args[idx + 1]
    : fallback;
};
const REPORT_ONLY = has("--report-only");
const AS_JSON = has("--json");
const CHECK_ALL = has("--all");
const CHECK_DEPLOYMENTS = has("--deployments");
const SINCE = opt("since", "14d");
const LIMIT = Math.min(100, Math.max(1, Number(opt("limit", "30")) || 30));
const STUCK_MINUTES = Math.max(5, Number(opt("stuck-minutes", "60")) || 60);
const REPO_OVERRIDE = opt("repo", null);

// ── repo detection ────────────────────────────────────────────────────
function parseRepoSlug(url) {
  // https://github.com/owner/repo(.git)?  |  git@github.com:owner/repo(.git)?
  const m = String(url).trim().match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/);
  return m ? `${m[1]}/${m[2]}` : null;
}

function remoteSlug(remote) {
  try {
    const url = execFileSync("git", ["remote", "get-url", remote], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return parseRepoSlug(url);
  } catch {
    return null;
  }
}

const repos = [];
if (REPO_OVERRIDE) {
  repos.push({ label: "custom", slug: REPO_OVERRIDE });
} else {
  const origin = remoteSlug("origin");
  if (origin) repos.push({ label: "origin", slug: origin });
  const core = remoteSlug("core");
  if (CHECK_ALL && core && core !== origin) repos.push({ label: "core", slug: core });
  if (CHECK_ALL && !core) {
    process.stderr.write(
      "[check-github-health] note: no 'core' remote — public repo not checked.\n",
    );
  }
}
if (repos.length === 0) {
  process.stderr.write(
    "[check-github-health] FAIL: no repository — pass --repo owner/name or run inside a git checkout with a github.com remote.\n",
  );
  process.exit(2);
}

// ── API ───────────────────────────────────────────────────────────────
const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";

async function api(path) {
  const res = await fetch(`${API}${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "bookmarkforge-check-github-health",
      ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const err = new Error(`GitHub API ${res.status} ${res.statusText}`);
    err.status = res.status;
    err.body = body.slice(0, 300);
    throw err;
  }
  return res.json();
}

function parseSince(spec) {
  const m = String(spec).match(/^(\d+)([hdw])?$/);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2] || "d";
  const hours = unit === "h" ? n : unit === "w" ? n * 168 : n * 24;
  return new Date(Date.now() - hours * 3600_000);
}

async function checkRepo({ label, slug }) {
  const sinceDate = parseSince(SINCE);
  const problems = [];
  const warnings = [];

  // 1) Recent workflow runs
  const runsUrl =
    `/repos/${slug}/actions/runs?per_page=${LIMIT}` +
    (sinceDate ? `&created=>=${sinceDate.toISOString().slice(0, 10)}` : "");
  let runsPayload;
  try {
    runsPayload = await api(runsUrl);
  } catch (error) {
    if (error.status === 404) {
      problems.push(
        `repository not found or Actions disabled (${slug})` +
          (TOKEN ? "" : " — private repos need GITHUB_TOKEN/GH_TOKEN with actions:read"),
      );
      return { label, slug, problems, warnings, runs: 0, failed: 0, stuck: 0, deployments: [] };
    }
    throw error;
  }
  const runs = runsPayload.workflow_runs ?? [];
  const now = Date.now();
  const failed = [];
  const stuck = [];
  for (const run of runs) {
    if (BAD_CONCLUSIONS.has(run.conclusion)) {
      failed.push(run);
    } else if (ACTIVE_STATUSES.has(run.status)) {
      const ageMin = (now - Date.parse(run.created_at ?? run.run_started_at ?? 0)) / 60_000;
      if (ageMin > STUCK_MINUTES) stuck.push({ run, ageMin });
    }
  }

  // 2) Latest deployment statuses (opt-in)
  let deployments = [];
  if (CHECK_DEPLOYMENTS) {
    try {
      const deps = await api(`/repos/${slug}/deployments?per_page=5`);
      for (const dep of deps.slice(0, 3)) {
        const statuses = await api(
          `/repos/${slug}/deployments/${dep.id}/statuses?per_page=1`,
        ).catch(() => []);
        deployments.push({
          environment: dep.environment,
          sha: String(dep.sha ?? "").slice(0, 7),
          state: statuses[0]?.state ?? "unknown",
          created_at: dep.created_at,
        });
      }
    } catch {
      // Deployments API may be unavailable/empty — not an error.
    }
  }

  for (const run of failed) {
    problems.push(
      `workflow "${run.name}" ${run.conclusion} — ${run.head_branch} @ ${String(run.head_sha ?? "").slice(0, 7)} — ${run.html_url}`,
    );
  }
  for (const { run, ageMin } of stuck) {
    warnings.push(
      `workflow "${run.name}" stuck ${run.status} for ~${Math.round(ageMin)}min (> ${STUCK_MINUTES}) — ${run.html_url}`,
    );
  }
  for (const dep of deployments.filter((d) => d.state === "failure" || d.state === "error")) {
    problems.push(
      `deployment ${dep.environment} @ ${dep.sha} ${dep.state} — ${dep.created_at}`,
    );
  }

  return { label, slug, problems, warnings, runs: runs.length, failed: failed.length, stuck: stuck.length, deployments };
}

// ── main ──────────────────────────────────────────────────────────────
let results;
try {
  results = [];
  for (const repo of repos) {
    results.push(await checkRepo(repo));
  }
} catch (error) {
  process.stderr.write(
    `[check-github-health] FAIL: could not query GitHub API — ${error.message}` +
      (error.body ? ` (${error.body})` : "") +
      `\n  hint: private repos need GITHUB_TOKEN/GH_TOKEN with actions:read.\n`,
  );
  process.exit(2);
}

const anyProblems = results.some((r) => r.problems.length > 0);
const anyWarnings = results.some((r) => r.warnings.length > 0);

if (AS_JSON) {
  process.stdout.write(`${JSON.stringify({ repos: results }, null, 2)}\n`);
} else {
  for (const r of results) {
    process.stdout.write(`\n[github:${r.label}] ${r.slug}\n`);
    if (r.runs === 0) {
      process.stdout.write("  no workflow runs in window\n");
    } else {
      process.stdout.write(
        `  ${r.runs} run(s) scanned — ${r.failed} failed, ${r.stuck} stuck\n`,
      );
    }
    for (const p of r.problems) process.stdout.write(`  ✗ ${p}\n`);
    for (const w of r.warnings) process.stdout.write(`  ! ${w}\n`);
    for (const d of r.deployments) {
      process.stdout.write(
        `  deploy ${d.environment} @ ${d.sha}: ${d.state} (${d.created_at})\n`,
      );
    }
  }
  process.stdout.write(
    anyProblems
      ? "\n[check-github-health] FAIL: GitHub-side errors detected.\n"
      : anyWarnings
        ? "\n[check-github-health] WARN: stuck runs detected (not failing).\n"
        : "\n[check-github-health] OK: no GitHub-side errors in window.\n",
  );
}

if (REPORT_ONLY) process.exit(0);
process.exit(anyProblems ? 1 : 0);
