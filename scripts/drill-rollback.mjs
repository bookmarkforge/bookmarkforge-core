#!/usr/bin/env node
/**
 * scripts/drill-rollback.mjs — repeatable rollback drill in CI.
 *
 * Automates the full chain detect → rollback → restore. Two modes:
 *
 *   WITHOUT Docker (default, local-smoke.mjs topology):
 *     1. BASELINE   — starts license-mock + companion server and runs the
 *                     production checks (runApiSurfaceChecks).
 *     2. KILL       — kills ONLY the api process (induced failure).
 *     3. DETECT     — monitoring-alerts.mjs: APP_CAIDA must fail and
 *                     BUNDLE_CORRUPTO must be exercised (Docker-free SRI probe).
 *     4. ROLLBACK   — rollback.mjs --auto (requires >= 2 prod-* tags).
 *     5. RE-VERIFY  — restarts the local server and re-runs the checks.
 *
 *   WITH Docker (DRILL_DOCKER=1, docker-compose.staging.yml topology):
 *     0. PREP       — builds the REAL images by SHA of the previous prod-*
 *                     tag (the rollback's target) from THAT TAG'S TREE
 *                     (git worktree), so PATH A is image == tag code.
 *                     staging-smoke leaves the HEAD ones built in CI
 *                     (or BASELINE builds them if they are missing).
 *     1. BASELINE   — brings up the staging stack with IMAGE_TAG=<HEAD sha>
 *                     (--build only if the images do not exist locally).
 *     2. KILL       — docker compose stop api (induced failure); the web
 *                     health drops in ~5s (proxy_connect_timeout 5s).
 *     3. DETECT     — same, against the web (PROD_BASE_URL=http://127.0.0.1:18080).
 *     4. ROLLBACK   — rollback.mjs --auto with DEPLOY_COMPOSE_FILE=staging and
 *                     the drill GATE: it must restore BY IMAGE (PATH A,
 *                     no rebuild) and the measured path time (up -d +
 *                     sanity, the 'PATH A confirmed … in X.Xs' line from
 *                     rollback.mjs) must be < 60s; a fallback to PATH B or
 *                     a time >= 60s makes the drill FAIL.
 *     5. RE-VERIFY  — health + smoke against the restored web.
 *
 * Reports a per-phase table with PASS/FAIL and timings, and exits 0/1 (CI-ready).
 *
 * ⚠️  Git effects: phase 4 runs rollback.mjs --auto, which checks out
 * the previous prod-* tag (git stash first if the tree is dirty). Run the
 * drill in CI or in an isolated worktree — your working tree will end up on
 * the restored tag.
 *
 * Usage:
 *   node scripts/drill-rollback.mjs
 *   node scripts/drill-rollback.mjs --json
 *   node scripts/drill-rollback.mjs --no-rollback   # debug: without mutating git
 *   DRILL_DOCKER=1 node scripts/drill-rollback.mjs  # Docker mode (staging)
 *
 * Env (optional):
 *   API_PORT / LICENSE_MOCK_PORT                 (default 8787 / 8082)
 *   DRILL_ROLLBACK_TIMEOUT_MS                    (default 180000)
 *   LICENSE_SIGNING_PRIVATE_KEY_FILE             (license checks)
 *   DRILL_DOCKER=1                               (modo Docker staging)
 *   DRILL_COMPOSE_FILE                           (default docker-compose.staging.yml)
 *   HTTP_PORT                                    (puerto web staging, default 18080)
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, writeFileSync, unlinkSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { runApiSurfaceChecks } from "./production-smoke.mjs";
import { findProxyPassWithoutPort } from "./check-blindeo.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const isJson = process.argv.includes("--json");
const NO_ROLLBACK = process.argv.includes("--no-rollback");

const SERVER_PORT = Number(process.env.API_PORT ?? 8787);
const LICENSE_MOCK_PORT = Number(process.env.LICENSE_MOCK_PORT ?? 8082);
const LICENSE_MOCK_KEY = process.env.LICENSE_MOCK_KEY ?? "license-mock-key";
const ROLLBACK_TIMEOUT_MS = Number(process.env.DRILL_ROLLBACK_TIMEOUT_MS ?? 180_000);

// Docker mode: the drill runs against docker-compose.staging.yml (the web
// publishes 18080 and proxies to the api, which exposes no host port).
const DOCKER = process.env.DRILL_DOCKER === "1";
const COMPOSE_FILE = process.env.DRILL_COMPOSE_FILE?.trim() || "docker-compose.staging.yml";
const DRILL_ENV_FILE = process.env.DRILL_ENV_FILE?.trim() || "";
const PRODUCTION_COMPOSE = COMPOSE_FILE === "docker-compose.prod.yml";
const COMPOSE_ENV_ARGS = DRILL_ENV_FILE ? ["--env-file", DRILL_ENV_FILE] : [];
/**
 * Compose services that must stay up while the API is down. Production has no
 * mock services at all; staging keeps the Whop license mock. The AI upstream
 * mock and Redis are not part of the current companion topology.
 */
const COMPANION_SERVICES = PRODUCTION_COMPOSE ? [] : ["license-mock"];
const WEB_PORT = Number(process.env.HTTP_PORT ?? (PRODUCTION_COMPOSE ? 18082 : 18080));
const BASE_URL = DOCKER
  ? `http://127.0.0.1:${WEB_PORT}`
  : `http://127.0.0.1:${SERVER_PORT}`;

const signingKeyFile =
  process.env.LICENSE_SIGNING_PRIVATE_KEY_FILE ??
  join(ROOT, "server", ".license-signing-key.pkcs8");
const signingConfigured = existsSync(signingKeyFile);

function composeProject() {
  return process.env.COMPOSE_PROJECT_NAME ?? (PRODUCTION_COMPOSE ? "bookmarkforge-prod-drill" : "bookmarkforge-staging");
}

// ── Topology backup/restore (Docker mode) ───────────────────────────
// The rollback's housekeeping checkout can DELETE topology files that the
// previous prod-* tag does not contain yet (e.g. a staging compose committed
// after the tag). The drill backs those files up before the rollback and
// restores them before RE-VERIFY/teardown: recovery must not depend on the
// old tag's content (mirrors what PREP already does for the build worktree).
const topologyBackup = new Map();
function backupTopology() {
  if (!DOCKER || topologyBackup.size > 0) return;
  for (const rel of [COMPOSE_FILE, "public/nginx.conf", join("server", ".license-signing-key.pkcs8")]) {
    const abs = join(ROOT, rel);
    if (existsSync(abs)) topologyBackup.set(rel, abs);
  }
}
function ensureTopology() {
  if (!DOCKER) return;
  for (const [rel, src] of topologyBackup) {
    const dst = join(ROOT, rel);
    if (!existsSync(dst)) {
      try {
        copyFileSync(src, dst);
        console.log(`[DRILL] topology restored after the tag checkout: ${rel}`);
      } catch {
        // no copy: RE-VERIFY will report the real failure
      }
    }
  }
}

// ── Phases ────────────────────────────────────────────────────────────
const phases = [];
function recordPhase(name, ok, detail, ms) {
  phases.push({ name, ok, detail, ms: Math.round(ms) });
  const icon = ok === true ? "PASS" : ok === false ? "FAIL" : "SKIP";
  console.log(`[DRILL] ${name.padEnd(10)} ${icon.padEnd(5)} ${(ms / 1000).toFixed(1)}s — ${detail}`);
}

// ── Local stack (mocks + server) ─────────────────────────────────────
const children = [];

function spawnChild(command, args, env, label) {
  const child = spawn(command, args, {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push({ child, label });
  child.stdout.on("data", (chunk) => process.stdout.write(`[${label}] ${chunk}`));
  child.stderr.on("data", (chunk) => process.stderr.write(`[${label}] ${chunk}`));
  return child;
}

async function waitForReady(url, attempts = 60, intervalMs = 250) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return false;
}

async function waitForDown(url, attempts = 60, intervalMs = 250) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      await fetch(url);
    } catch {
      return true; // connection refused → down
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return false;
}

/** In Docker mode the web stays alive and nginx answers 502/504 — "down" means !ok. */
async function waitForNotOk(url, attempts = 60, intervalMs = 250) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetch(url);
      if (!res.ok) return true;
    } catch {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return false;
}

// ── Docker helpers (DRILL_DOCKER mode) ────────────────────────────────
function dockerOk(args, env = {}, cwd = ROOT) {
  return spawnSync("docker", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...env },
    timeout: 600_000,
  });
}

function dockerPs() {
  const r = dockerOk(["compose", "-p", process.env.COMPOSE_PROJECT_NAME ?? (PRODUCTION_COMPOSE ? "bookmarkforge-prod-drill" : "bookmarkforge-staging"), ...COMPOSE_ENV_ARGS, "-f", COMPOSE_FILE, "ps", "--format", "{{.Service}}:{{.Status}}"]);
  return (r.stdout ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
}

function dockerImageExists(name, tag) {
  const r = dockerOk(["images", "--format", "{{.Repository}}:{{.Tag}}"]);
  return (r.stdout ?? "").split("\n").includes(`${name}:${tag}`);
}

function killChild(entry) {
  const { child } = entry;
  if (child.exitCode === null) {
    try {
      child.kill();
    } catch {
      /* already gone */
    }
  }
}

function teardown() {
  if (DOCKER) {
    ensureTopology();
    dockerOk(["compose", "-p", composeProject(), ...COMPOSE_ENV_ARGS, "-f", COMPOSE_FILE, "down", "--remove-orphans", "--volumes"]);
    return;
  }
  for (const entry of children) killChild(entry);
}

function serverEnv() {
  return {
    NODE_ENV: "staging",
    PORT: String(SERVER_PORT),
    HOST: "127.0.0.1",
    TRUST_PROXY: "0",
    WHOP_LICENSE_API_URL: `http://127.0.0.1:${LICENSE_MOCK_PORT}/license`,
    WHOP_API_KEY: LICENSE_MOCK_KEY,
    LICENSE_PROVIDER_ALLOW_HTTP: "1",
    ...(signingConfigured ? { LICENSE_SIGNING_PRIVATE_KEY_FILE: signingKeyFile } : {}),
  };
}

async function startStack() {
  if (DOCKER) {
    const sha = gitHead();
    const hasWeb = dockerImageExists("bookmarkforge/web", sha);
    const hasApi = dockerImageExists("bookmarkforge/api", sha);
    const buildArgs = hasWeb && hasApi ? [] : ["--build"];
    const composeProject = process.env.COMPOSE_PROJECT_NAME ?? (PRODUCTION_COMPOSE ? "bookmarkforge-prod-drill" : "bookmarkforge-staging");
    const up = dockerOk(
      ["compose", "-p", composeProject, ...COMPOSE_ENV_ARGS, "-f", COMPOSE_FILE, "up", "-d", ...buildArgs, "web", "api", ...COMPANION_SERVICES],
      { IMAGE_TAG: sha, HTTP_PORT: String(WEB_PORT), AI_SESSION_ORIGINS: `http://127.0.0.1:${WEB_PORT},http://localhost:${WEB_PORT}` },
    );
    if (up.status !== 0) {
      return `docker compose up failed (exit ${up.status})${buildArgs.length ? " — check the build" : ""}`;
    }
    if (!(await waitForReady(`${BASE_URL}/health`, 120, 500))) {
      return `the web did not respond at ${BASE_URL}/health after up`;
    }
    return null;
  }
  spawnChild(
    process.execPath,
    [join(ROOT, "scripts", "license-mock.mjs")],
    { LICENSE_MOCK_PORT: String(LICENSE_MOCK_PORT), LICENSE_MOCK_KEY },
    "license-mock",
  );
  spawnChild(
    process.execPath,
    ["--import", "tsx", join(ROOT, "server", "src", "index.ts")],
    serverEnv(),
    "api",
  );
  const targets = [
    { label: "license-mock", url: `http://127.0.0.1:${LICENSE_MOCK_PORT}/health` },
    { label: "api", url: `${BASE_URL}/health` },
  ];
  for (const target of targets) {
    if (!(await waitForReady(target.url))) {
      return `${target.label} did not start (${target.url}) — port busy?`;
    }
  }
  return null;
}

function gitRevParse(rev) {
  const r = spawnSync("git", ["rev-parse", rev], { cwd: ROOT, encoding: "utf8" });
  return r.status === 0 ? (r.stdout ?? "").trim() : "";
}

/** prod-* tags sorted by creatordate desc, deduplicated by SHA.
 * Same logic as selectAutoTarget in rollback.mjs: duplicate tags over the
 * same commit collapse to avoid no-op rollbacks. */
function prodTags() {
  const r = spawnSync("git", ["tag", "--sort=-creatordate"], { cwd: ROOT, encoding: "utf8" });
  const all = (r.stdout ?? "").split("\n").filter((t) => t.trim().startsWith("prod-"));
  const distinct = [];
  const seen = new Set();
  for (const tag of all) {
    const sha = (tag.split("-").pop() ?? "");
    const isSha = /^[0-9a-f]{7,12}$/i.test(sha);
    const key = isSha ? sha.toLowerCase() : `name:${tag}`;
    if (seen.has(key)) continue;
    seen.add(key);
    distinct.push(tag);
  }
  return distinct;
}

function gitHead() {
  return gitRevParse("HEAD").slice(0, 7) || "?";
}

// ── Drill ────────────────────────────────────────────────────────────
const t0 = Date.now();

console.log("=".repeat(64));
console.log(
  `ROLLBACK DRILL — ${BASE_URL} — HEAD ${gitHead()}${DOCKER ? ` — Docker mode (${COMPOSE_FILE})` : " — local process mode"}`,
);
console.log("=".repeat(64));
if (!signingConfigured) {
  console.log(`[DRILL] WARN no license key (${signingKeyFile}) — license checks are skipped`);
}
if (NO_ROLLBACK) {
  console.log("[DRILL] --no-rollback: the ROLLBACK phase will be skipped (no git mutation)");
} else {
  console.log("[DRILL] ⚠️  the ROLLBACK phase will git checkout the previous prod-* tag");
}
console.log("");

let overallOk = true;

// ── Phase 0: PREP (Docker only) — real images by SHA ─────────────────
// Builds the images of the previous prod-* tag (the rollback target)
// FROM THAT TAG'S TREE (git worktree) so PATH A is real:
// image == tag code. staging-smoke (CI) builds the HEAD ones, or BASELINE
// does if they are missing. Without >= 2 tags, PREP is skipped and
// ROLLBACK fails with its clear message. The drill topology may include
// untracked files (docker-compose.staging.yml, license key) — they are
// synced into the worktree so the build is reproducible.
if (overallOk && DOCKER) {
  const s = Date.now();
  const tags = prodTags();
  if (tags.length < 2) {
    recordPhase("PREP", true, `>= 2 prod-* tags required (found ${tags.length}) — image build skipped`, Date.now() - s);
  } else {
    const prevTag = tags[1];
    const prevSha = gitRevParse(`${prevTag}^{commit}`).slice(0, 7);
    const hasPrevImages =
      dockerImageExists("bookmarkforge/web", prevSha) &&
      dockerImageExists("bookmarkforge/api", prevSha);
    if (hasPrevImages) {
      recordPhase("PREP", true, `images for the previous tag already exist (web/api:${prevSha}) — no build`, Date.now() - s);
    } else {
      const wt = join(tmpdir(), `bmf-prev-build-${process.pid}`);
      const add = spawnSync("git", ["worktree", "add", "--detach", wt, prevSha], {
        cwd: ROOT,
        encoding: "utf8",
      });
      if (add.status !== 0) {
        recordPhase(
          "PREP",
          false,
          `could not create a worktree for ${prevSha} (git worktree add exit ${add.status}) — PATH A impossible`,
          Date.now() - s,
        );
        overallOk = false;
      } else {
        try {
          // Syncs the drill topology into the tag's tree (untracked/gitignored
          // files that the compose and the build need). HEAD's Dockerfile
          // is copied too so the tag's build uses the fixed deps stage
          // (--ignore-scripts): an old one, broken by `prepare: husky` +
          // `--omit=dev`, made rebuilding the previous tag's image (PATH A)
          // impossible.
          for (const rel of ["Dockerfile", "docker-compose.staging.yml", "public/nginx.conf"]) {
            const src = join(ROOT, rel);
            if (existsSync(src)) copyFileSync(src, join(wt, rel));
          }
          const keySrc = signingKeyFile;
          if (existsSync(keySrc)) {
            const relKey = join("server", ".license-signing-key.pkcs8");
            copyFileSync(keySrc, join(wt, relKey));
          }
          const build = dockerOk(
            ["compose", "-f", "docker-compose.staging.yml", "build", "web", "api"],
            { IMAGE_TAG: prevSha },
            wt,
          );
          if (build.status !== 0) {
            recordPhase(
              "PREP",
              false,
              `build of ${prevSha} failed (exit ${build.status}) — PATH A impossible. Tail:\n${(build.stderr ?? "").split("\n").slice(-4).join("\n")}`,
              Date.now() - s,
            );
            overallOk = false;
          } else {
            recordPhase(
              "PREP",
              true,
              `images built from the tree of tag ${prevTag} (web/api:${prevSha})`,
              Date.now() - s,
            );
          }
        } finally {
          spawnSync("git", ["worktree", "remove", "--force", wt], { cwd: ROOT, encoding: "utf8" });
        }
      }
    }
  }
}

// ── Phase 1: BASELINE ────────────────────────────────────────────────
{
  const s = Date.now();
  const err = await startStack();
  if (err) {
    recordPhase("BASELINE", false, err, Date.now() - s);
    overallOk = false;
  } else {
    const result = await runApiSurfaceChecks({
      baseUrl: BASE_URL,
      skipLicense: !signingConfigured,
    });
    recordPhase(
      "BASELINE",
      result.ok,
      result.ok ? `${result.checks.length}/${result.checks.length} checks PASS` : "smoke FAIL",
      Date.now() - s,
    );
    if (!result.ok) overallOk = false;
  }
}

// ── Phase 2: KILL (induced failure) ──────────────────────────────────
if (overallOk) {
  const s = Date.now();
  let down = false;
  let mocksAlive = false;
  if (DOCKER) {
    const stop = dockerOk(["compose", "-p", composeProject(), ...COMPOSE_ENV_ARGS, "-f", COMPOSE_FILE, "stop", "api"]);
    down = stop.status === 0 && (await waitForNotOk(`${BASE_URL}/health`, 30, 300));
    // The AI upstream mock and the shared Redis instance were removed with the
    // current companion topology; the only companion service left is the license mock.
    const ps = dockerPs();
    mocksAlive =
      COMPANION_SERVICES.length > 0 &&
      COMPANION_SERVICES.every((service) =>
        ps.some((l) => l.startsWith(service) && l.includes("Up")),
      );
  } else {
    const apiEntry = children.find((e) => e.label === "api");
    killChild(apiEntry);
    down = await waitForDown(`${BASE_URL}/health`);
    mocksAlive = await waitForReady(`http://127.0.0.1:${LICENSE_MOCK_PORT}/health`, 5, 100);
  }
  recordPhase(
    "KILL",
    down && mocksAlive,
    down
      ? mocksAlive
        ? "api down, mocks alive ✓"
        : "api down but a mock died ✗"
      : "the api kept responding — failure not induced",
    Date.now() - s,
  );
  if (!down || !mocksAlive) overallOk = false;
}

// ── Phase 3: DETECT (monitoring-alerts) ──────────────────────────────
if (overallOk) {
  const s = Date.now();
  // Neutralizes CLIENT_CRITICAL: this drill generates no client events;
  // an empty log avoids the compose unreadable-log fail-closed path.
  const tmpLog = join(tmpdir(), `bmf-drill-events-${process.pid}.log`);
  writeFileSync(tmpLog, "");
  const r = spawnSync(
    process.execPath,
    [join(ROOT, "scripts", "monitoring-alerts.mjs"), "--json"],
    {
      cwd: ROOT,
      encoding: "utf8",
      timeout: 120_000,
      env: { ...process.env, PROD_BASE_URL: BASE_URL, CLIENT_EVENTS_LOG_FILE: tmpLog, DEPLOY_COMPOSE_FILE: COMPOSE_FILE },
    },
  );
  unlinkSync(tmpLog);
  let appDown = false;
  let bundleOk = false;
  let bundleDetail = "";
  let parsed = null;
  try {
    parsed = JSON.parse((r.stdout ?? "").trim());
    const app = (parsed.results ?? []).find((x) => x.name === "APP_CAIDA");
    appDown = Boolean(app && app.ok === false);
    // Alert 2 (BUNDLE_CORRUPTO): the Docker-free SRI probe must be exercised
    // and detect the violation → this covers alert 2 in the drill.
    const bundle = (parsed.results ?? []).find((x) => x.name === "BUNDLE_CORRUPTO");
    bundleOk = Boolean(bundle && bundle.ok === true);
    bundleDetail = bundle?.detail ?? "";
  } catch {
    // fallthrough: parse failed → not detected
  }
  const detail = parsed
    ? `APP_CAIDA detected ✓ · BUNDLE_CORRUPTO ${bundleOk ? "probe OK" : "NOT exercised"}${bundleDetail ? ` (${bundleDetail})` : ""} (monitoring exit ${r.status})`
    : `could not parse monitoring-alerts (exit ${r.status})`;
  recordPhase("DETECT", appDown && bundleOk, detail, Date.now() - s);
  if (!appDown || !bundleOk) overallOk = false;
}

// ── Phase 4: ROLLBACK (rollback.mjs --auto) ──────────────────────────
if (overallOk && !NO_ROLLBACK) {
  const s = Date.now();
  const tags = prodTags();
  if (tags.length < 2) {
    recordPhase(
      "ROLLBACK",
      false,
      `>= 2 prod-* tags required (found ${tags.length}) — create tags with deploy-prod.mjs`,
      Date.now() - s,
    );
    overallOk = false;
  } else {
    // The restore criterion compares HEAD's SHA against the second-to-last
    // tag's SHA (the same selection as rollback --auto). Comparing by
    // SHA is robust even if two tags point at the same commit.
    const expectedTag = tags[1];
    const expectedSha = gitRevParse(`${expectedTag}^{commit}`);
    const beforeSha = gitRevParse("HEAD");

    // ── Gate: validates rollback target's web is healthy ────────────
    // Before executing the rollback, verify the target tag's nginx.conf
    // has all proxy_pass directives with explicit ports. A rollback to a
    // tag with broken web (proxy_pass without :port) would leave the
    // service in permanent 502 — this gate catches it BEFORE the damage.
    let targetWebOk = true;
    let targetWebDetail = "";
    try {
      const nginxConf = spawnSync(
        "git", ["show", `${expectedTag}:public/nginx.conf`],
        { cwd: ROOT, encoding: "utf8" },
      );
      if (nginxConf.status !== 0) {
        targetWebOk = false;
        targetWebDetail = `could not read nginx.conf from tag ${expectedTag} (git show exit ${nginxConf.status})`;
      } else {
        const violations = findProxyPassWithoutPort(nginxConf.stdout ?? "");
        if (violations.length > 0) {
          targetWebOk = false;
          targetWebDetail = `${expectedTag} has ${violations.length} proxy_pass without an explicit port — the restored web would serve 502`;
        }
      }
    } catch (e) {
      targetWebOk = false;
      targetWebDetail = `error validating nginx.conf from tag ${expectedTag}: ${e.message}`;
    }
    if (!targetWebOk) {
      recordPhase("ROLLBACK", false, `GATE: rollback target with a broken web — ${targetWebDetail}`, Date.now() - s);
      overallOk = false;
    }
    if (targetWebOk) {
    // Back up the topology BEFORE the rollback: the tag checkout can
    // delete it if the tag predates its commit.
    backupTopology();
    const r2 = spawnSync(
      process.execPath,
      [join(ROOT, "scripts", "rollback.mjs"), "--auto"],
      {
        cwd: ROOT,
        encoding: "utf8",
        timeout: ROLLBACK_TIMEOUT_MS,
        env: {
          ...process.env,
          PROD_BASE_URL: BASE_URL,
          ...(DOCKER
            ? {
                DEPLOY_COMPOSE_FILE: COMPOSE_FILE,
                HTTP_PORT: String(WEB_PORT),
                // rollback.mjs runs compose WITHOUT -p: without this variable the
                // project would be the directory basename and would create a
                // stack PARALLEL to the drill's (web port collision).
                COMPOSE_PROJECT_NAME: composeProject(),
              }
            : {}),
        },
      },
    );
    const out = r2.stdout ?? "";
    const path = out.includes("PATH A")
      ? "PATH A (image by SHA)"
      : out.includes("PATH B")
        ? "PATH B (rebuild)"
        : "unidentified path";
    // Real time measured by rollback.mjs for the up -d + sanity step of the
    // image-by-SHA path (the 'PATH A confirmed … in X.Xs' line).
    const pathMatch = out.match(/PATH A confirmed[^\n]*?in ([\d.]+)s/);
    const pathASeconds = pathMatch ? Number(pathMatch[1]) : null;
    const afterSha = gitRevParse("HEAD");
    const restoreOk = Boolean(afterSha && afterSha === expectedSha);
    // The drill's GATE: the rollback must restore BY IMAGE (PATH A) and the
    // measured path time must be < 60s. A fallback to a rebuild (PATH
    // B) or a time >= 60s makes the drill FAIL — the goal is to exercise the
    // image-by-SHA path, not the rebuild.
    const pathGateOk = path === "PATH A (image by SHA)" && pathASeconds !== null && pathASeconds < 60;
    const tail = out.split("\n").slice(-6).join("\n").trim();
    recordPhase(
      "ROLLBACK",
      restoreOk && pathGateOk,
      restoreOk
        ? pathGateOk
          ? `HEAD=${afterSha.slice(0, 7)} = ${expectedTag} — ${path} measured ${pathASeconds}s (< 60s GATE) (rollback exit ${r2.status})`
          : `restored but ${path}${pathASeconds === null ? " — path time not measurable" : ` — PATH A took ${pathASeconds}s >= 60s (GATE)`}. Tail:\n${tail}`
        : `did not restore ${expectedTag} — before ${beforeSha.slice(0, 7)} / after ${afterSha.slice(0, 7)} — exit ${r2.status}. Tail:\n${tail}`,
      Date.now() - s,
    );
    if (!restoreOk || !pathGateOk) overallOk = false;
    } // end if (targetWebOk)
  }
} else if (overallOk) {
  recordPhase("ROLLBACK", null, "skipped (--no-rollback)", 0);
}

// ── Phase 5: RE-VERIFY ───────────────────────────────────────────────
if (overallOk) {
  const s = Date.now();
  // If the Docker rollback brought the api up, use it; otherwise restart it
  // (in Docker: compose start api; locally: spawn from the restored tree).
  let ready = await waitForReady(`${BASE_URL}/health`, 20, 250);
  if (!ready) {
    ensureTopology();
    if (DOCKER) {
      // up -d recreates the container from the (restored) compose file;
      // 'start' only restarts the existing container with stale code.
      dockerOk(["compose", "-p", composeProject(), ...COMPOSE_ENV_ARGS, "-f", COMPOSE_FILE, "up", "-d", "api"]);
    } else {
      spawnChild(
        process.execPath,
        ["--import", "tsx", join(ROOT, "server", "src", "index.ts")],
        serverEnv(),
        "api",
      );
    }
    ready = await waitForReady(`${BASE_URL}/health`);
  }
  if (!ready) {
    recordPhase("RE-VERIFY", false, "the server did not come back up after the rollback", Date.now() - s);
    overallOk = false;
  } else {
    const result = await runApiSurfaceChecks({
      baseUrl: BASE_URL,
      skipLicense: !signingConfigured,
    });
    recordPhase(
      "RE-VERIFY",
      result.ok,
      result.ok ? `${result.checks.length}/${result.checks.length} checks PASS post-rollback` : "smoke FAIL post-rollback",
      Date.now() - s,
    );
    if (!result.ok) overallOk = false;
  }
}

// ── Report ───────────────────────────────────────────────────────────
teardown();
const totalMs = Date.now() - t0;
console.log("");
console.log("-".repeat(64));
console.log(`DRILL ${overallOk ? "PASS ✅" : "FAIL ❌"} — ${phases.length} phases in ${(totalMs / 1000).toFixed(1)}s`);
console.log("-".repeat(64));

if (isJson) {
  console.log(
    JSON.stringify(
      {
        ok: overallOk,
        at: new Date().toISOString(),
        baseUrl: BASE_URL,
        head: gitHead(),
        totalSeconds: Math.round(totalMs / 100) / 10,
        phases,
      },
      null,
      2,
    ),
  );
}

process.exit(overallOk ? 0 : 1);
