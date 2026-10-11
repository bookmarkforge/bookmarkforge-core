#!/usr/bin/env node
/**
 * scripts/deploy-prod.mjs — Automated production deploy.
 *
 * Guarantees the hardening-checklist requirements:
 *   1. Runs the gates (check-blindeo + prod-blindeo-checklist).
 *   2. Builds SHA-tagged Docker images:
 *        bookmarkforge/web:<sha>  and  bookmarkforge/api:<sha>
 *      (also updates :latest for manual ops).
 *   3. Creates the annotated git tag  prod-YYYYMMDD-HHMM-<sha>  that
 *      scripts/rollback.mjs requires to revert in <1min (image by SHA).
 *
 * Local-first: rollback NEVER touches the client's IndexedDB; this script
 * does not touch data either — only containers and bundle + git tag.
 *
 * Usage:
 *   node scripts/deploy-prod.mjs                  # gates + build + git tag
 *   node scripts/deploy-prod.mjs --deploy          # + docker compose up -d
 *   node scripts/deploy-prod.mjs --verify          # + production-smoke (all checks)
 *   node scripts/deploy-prod.mjs --deploy --verify  # full pipeline
 *   node scripts/deploy-prod.mjs --dry-run         # print without executing
 *   node scripts/deploy-prod.mjs --push-images     # docker push to remote registry (requires DOCKER_REGISTRY)
 *   node scripts/deploy-prod.mjs --push-tag        # git push origin <tag>
 *   node scripts/deploy-prod.mjs --allow-dirty     # allow dirty working tree
 *   node scripts/deploy-prod.mjs --skip-checklist  # skip the long gate (build:ci+tests)
 *   node scripts/deploy-prod.mjs --no-docker        # git tag only (no images)
 *   node scripts/deploy-prod.mjs --no-tag           # skip tag creation (CI/manual)
 *
 * Environment variables:
 *   PROD_BASE_URL   base URL for --verify (default http://127.0.0.1:8080)
 *   IMAGE_TAG       override the SHA (default: git rev-parse --short HEAD)
 *   DOCKER_REGISTRY destination registry for --push-images (e.g. registry.example.com:5000).
 *                   Required: pushing to a registry is explicit and fail-closed.
 *   DEPLOY_COMPOSE_FILE compose file to use (default docker-compose.prod.yml).
 *                   Useful for staging drills: DEPLOY_COMPOSE_FILE=docker-compose.staging.yml
 *
 * Output:
 *   Prints the created tag and the exact rollback command at the end.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolveRegistry, pushImages, defaultInspectVisible } from "./push-images-lib.mjs";
import {
  runCommand,
  runCommandLine,
  formatCommand,
  captureShell,
  captureCommand,
} from "./command-runner.mjs";

const T0 = Date.now();

/** Select the production tag from a newest-first tag list. */
export function selectProductionTag(tags) {
  return (Array.isArray(tags) ? tags : [])
    .filter((tag) => typeof tag === "string" && tag.startsWith("prod-"))[0] ?? null;
}

/** Resolve the image tag, preferring an explicit override over the git SHA. */
export function calculateImageTag({ imageTag, gitSha, dryRun = false } = {}) {
  const candidate = imageTag || gitSha || (dryRun ? "deadbeef" : "");
  return /^[0-9a-f]{7,12}$/i.test(candidate) ? candidate : "";
}

/** Decide whether the Docker build phase should run. */
export function shouldBuildImages({ noDocker = false, dryRun = false, imageTag = "" } = {}) {
  return { build: !noDocker, simulated: Boolean(dryRun && !noDocker), imageTag };
}

/** Return true only when git reports an annotated tag object. */
export function isAnnotatedTagType(type) {
  return type === "tag";
}

// ── args ──────────────────────────────────────────────────────────────────
import { pathToFileURL } from "node:url";

const isMain = typeof process.argv[1] === "string" && import.meta.url === pathToFileURL(process.argv[1]).href;
const argSet = new Set(process.argv.slice(2));
if (isMain && (argSet.has("--help") || argSet.has("-h"))) {
  console.log(`deploy-prod — production deploy with tag + images per SHA

  --deploy          docker compose up -d (uses the freshly built images)
  --verify          production-smoke (all checks) at the end
  --dry-run         print every command without executing it
  --push-images     docker push <registry>/bookmarkforge/{web,api}:<sha>
                    (requires DOCKER_REGISTRY; runs AFTER --verify)
  --push-tag        git push origin <tag> (NEVER by default)
  --allow-dirty     allow a dirty working tree (dangerous: tag != code)
  --skip-checklist  skip prod-blindeo-checklist (build:ci + test:fast)
  --no-docker       skip image build/tagging (git tag only)
  --no-tag          skip git tag creation (CI/manual: the tag already exists)
  --help            this help

Env:
  DOCKER_REGISTRY   registry for --push-images (e.g. registry.example.com:5000)

Default pipeline: gates → image build → git tag.
Recommended for go-live: --deploy --verify --push-images --push-tag`);
  process.exit(0);
}

const DRY_RUN = argSet.has("--dry-run");
const DO_DEPLOY = argSet.has("--deploy");
const DO_VERIFY = argSet.has("--verify");
const PUSH_IMAGES = argSet.has("--push-images");
const PUSH_TAG = argSet.has("--push-tag");
const ALLOW_DIRTY = argSet.has("--allow-dirty");
const SKIP_CHECKLIST = argSet.has("--skip-checklist");
const NO_DOCKER = argSet.has("--no-docker");
const NO_TAG = argSet.has("--no-tag");

if (isMain && DRY_RUN) console.log("⚠️  --dry-run: nothing is executed, only printed.\n");

// ── helpers ────────────────────────────────────────────────────────────────
function capture(cmd, opts = {}) {
  if (DRY_RUN) {
    console.log(`$ ${cmd}`);
    return null; // dry-run: nothing real; the caller must provide a fallback.
  }
  try {
    return captureShell(cmd, opts);
  } catch (e) {
    throw new Error(`command failed: ${cmd}\n${e.stderr || e.message}`);
  }
}

function run(cmd, opts = {}) {
  console.log(`$ ${cmd}`);
  if (DRY_RUN) return 0;
  // Boundary: the line is split into argv and spawned without a shell (see
  // command-runner.mjs) — execSync re-parsed it through /bin/sh.
  const result = runCommandLine(cmd, { stdio: "inherit", ...opts });
  if (result.error) return 1;
  return result.status ?? 1;
}

/** run() with separate arguments: no shell, no interpolation. */
function runArgs(argv, opts = {}) {
  console.log(`$ ${formatCommand(argv[0], argv.slice(1))}`);
  if (DRY_RUN) return 0;
  return runCommand(argv[0], argv.slice(1), opts);
}

/** capture() with separate arguments; returns null on --dry-run. */
function captureArgs(argv, opts = {}) {
  if (DRY_RUN) {
    console.log(`$ ${formatCommand(argv[0], argv.slice(1))}`);
    return null;
  }
  try {
    return captureCommand(argv[0], argv.slice(1), opts);
  } catch (e) {
    throw new Error(`command failed: ${formatCommand(argv[0], argv.slice(1))}\n${e.message}`);
  }
}

function runNode(file, opts = {}) {
  console.log(`$ node ${file}`);
  if (DRY_RUN) return 0;
  const r = spawnSync(process.execPath, [file], { stdio: "inherit", ...opts });
  return r.status ?? 1;
}

function log(msg) { console.log(`[deploy] ${msg}`); }
function fail(msg) { console.error(`\n[deploy] ✗ FATAL: ${msg}`); process.exit(1); }

if (!isMain) {
  // Pure helpers above are safe to import in tests; the CLI below must never
  // perform gates, Docker, Git, or process exits during module import.
} else {

// Remote registry for --push-images. EARLY validation (before running the
// heavy gates): a configuration error must not wait for build:ci + full tests
// to fail. Fail-closed: the flag without a valid DOCKER_REGISTRY stops the
// deploy. The semantics live in push-images-lib.mjs (resolveRegistry) so they
// can be tested in CI against a local registry without bringing up the whole
// pipeline.
let REGISTRY = (process.env.DOCKER_REGISTRY ?? "").trim().replace(/\/+$/, "");
if (PUSH_IMAGES) {
  if (NO_DOCKER) fail("--push-images requires local images; incompatible with --no-docker.");
  const r = resolveRegistry(REGISTRY, { push: true, dryRun: DRY_RUN });
  if (!r.ok) {
    fail(`--push-images requires a valid DOCKER_REGISTRY (e.g. registry.example.com:5000).`);
  }
  REGISTRY = r.registry;
  if (r.simulated) log("--dry-run: DOCKER_REGISTRY not set — simulating with registry.example.com");
  log(`target registry: ${REGISTRY}`);
}

// ── Phase A: Hardening gates ───────────────────────────────────────────────
console.log("\n🔒 PHASE A — Hardening gates\n");

const stamp = localStamp();
log(`deploy start — local timestamp ${stamp}`);

if (runNode("scripts/check-blindeo.mjs") !== 0) {
  fail("check-blindeo.mjs FAIL — blocked (fix before deploy).");
}    log("check-blindeo.mjs PASS (10 static checkpoints)");

if (!SKIP_CHECKLIST) {
  log("running prod-blindeo-checklist.mjs (build:ci + tests + full gates)…");
  if (runNode("scripts/prod-blindeo-checklist.mjs", { timeout: 600_000 }) !== 0) {
    fail("prod-blindeo-checklist.mjs FAIL — use --skip-checklist only if it already passed today.");
  }
  log("prod-blindeo-checklist.mjs PASS");
} else {
  log("--skip-checklist: skipping the long gate (assumed green today).");
}

// ── Phase B: Preflight (working tree, sha, docker, env) ─────────────────────
console.log("\n🔍 PHASE B — Preflight\n");

// Clean working tree: the tag must point at the exact deployed code.
if (!ALLOW_DIRTY) {
  const dirty = capture("git status --porcelain");
  if (dirty === null) {
    log("--dry-run: working tree not verified (simulated clean)");
  } else if (dirty) {
    fail(`dirty working tree — the tag would NOT reflect the deployed code.\n  ${dirty.split("\n").slice(0, 5).join("\n  ")}\n  Commit or use --allow-dirty (at your own risk).`);
  } else {
    log("clean working tree ✓");
  }
} else {
  log("⚠️  --allow-dirty: the tag may not match the deployed code.");
}

// Short SHA (7 chars, same format as existing tags: 84c7fe5).
let sha;
try {
  const resolved = process.env.IMAGE_TAG || capture("git rev-parse --short HEAD");
  sha = calculateImageTag({ imageTag: process.env.IMAGE_TAG, gitSha: resolved, dryRun: DRY_RUN });
  if (sha === "deadbeef") log("--dry-run: using simulated SHA deadbeef");
} catch (e) {
  fail(`could not obtain the SHA: ${e.message}`);
}
if (!sha) {
  fail(`invalid SHA: "${sha}". Expected 7-12 hex chars (or set IMAGE_TAG).`);
}
log(`deploy SHA: ${sha}`);

const tagName = `prod-${stamp}-${sha}`;
log(`target git tag: ${tagName}`);

// Tag collision: same minute + same SHA = already deployed.
try {
  execFileSync("git", ["cat-file", "-t", tagName], { stdio: "ignore" });
  fail(`tag ${tagName} already exists — you already deployed this commit. Want --deploy --verify without re-tagging?`);
} catch {
  // tag does not exist: good
}

// Docker available (not required with --no-docker).
let dockerOk = false;
if (!NO_DOCKER) {
  dockerOk = run(`docker version --format "{{.Server.Version}}"`) === 0 || DRY_RUN;
  if (!dockerOk) {
    fail("docker not available. Use --no-docker to only create the git tag, or install Docker.");
  }
  log("docker available ✓");
} else {
  log("--no-docker: skipping image build/tagging (git tag only).");
}

// Target compose: prod by default; overridable for staging drills.
const COMPOSE_FILE = process.env.DEPLOY_COMPOSE_FILE?.trim() || "docker-compose.prod.yml";
if (!existsSync(COMPOSE_FILE)) fail(`compose file not found: ${COMPOSE_FILE}`);
log(`target compose: ${COMPOSE_FILE}`);

// .env.production: compose needs it for the build args (VITE_*) and runtime.
const envFileArg = existsSync(".env.production") ? "--env-file .env.production" : "";
if (envFileArg) {
  log(".env.production present ✓");
} else {
log("⚠️ no .env.production — the VITE_* vars must come from the environment or .env");
}
const composeBase = `docker compose -f ${COMPOSE_FILE} ${envFileArg}`.trim();

// ── Phase C: Build SHA-tagged images ──────────────────────────────────
if (!NO_DOCKER) {
  console.log("\n📦 PHASE C — Docker image build (tag <sha> + latest)\n");

  // compose build reads the build args from .env.production and tags with IMAGE_TAG.
  const buildEnv = { ...process.env, IMAGE_TAG: sha };
  const rc = run(`${composeBase} build web api`, { env: buildEnv, timeout: 600_000 });
  if (rc !== 0) fail("docker compose build failed — check the build args / .env.production");

  // latest points at the freshly built SHA (manual ops and fallback).
  runArgs(["docker", "tag", `bookmarkforge/web:${sha}`, "bookmarkforge/web:latest"]);
  runArgs(["docker", "tag", `bookmarkforge/api:${sha}`, "bookmarkforge/api:latest"]);
  log(`images: bookmarkforge/web:${sha}  +  bookmarkforge/api:${sha}  (+ :latest)`);
}

// ── Phase D: Annotated git tag ────────────────────────────────────────────────
console.log("\n🏷️  PHASE D — Annotated git tag\n");

if (NO_TAG) {
  log("--no-tag: skipping tag creation (the tag already exists; CI/manual).");
} else {
  // Annotated tag: scripts/rollback.mjs validates `git cat-file -t <tag>` === "tag".
  const tagMsg = `Deploy prod ${stamp} — ${sha}`;
  runArgs(["git", "tag", "-a", tagName, "-m", tagMsg]);
  let tagType = "";
  try {
    tagType = captureArgs(["git", "cat-file", "-t", tagName]) ?? "";
  } catch (e) {
    fail(`could not verify the freshly created tag ${tagName}: ${e.message}`);
  }
  if (!isAnnotatedTagType(tagType)) {
    fail(`tag ${tagName} is not annotated (git cat-file -t returned "${tagType || "(empty)"}"). Rollback --auto blocked.`);
  }
  log(`tag created and verified as annotated ✓ (${tagName})`);
}

// ── Phase E (only --deploy): docker compose up -d ───────────────────────────
if (DO_DEPLOY) {
  if (NO_DOCKER) fail("--deploy requires images; cannot be used with --no-docker.");
  console.log("\n🚀 PHASE E — Deploy (docker compose up -d)\n");

  // up -d without --build: uses exactly the freshly tagged <sha> images.
  // Deterministic: what was built is what runs.
  const rc = run(`${composeBase} up -d web api`, { env: { ...process.env, IMAGE_TAG: sha }, timeout: 180_000 });
  if (rc !== 0) {
    log(`⚠️  up -d failed — no automatic rollback performed. Check with: docker compose -f ${COMPOSE_FILE} ps`);
    fail("deploy failed at up -d.");
  }
  log("web + api containers up ✓");
} else {
  log("--deploy not set: images built and tag created, no containers started.");
}

// ── Phase F (only --verify): production-smoke ────────────────────────────────
if (DO_VERIFY) {
  if (NO_DOCKER) fail("--verify requires running containers; cannot be used with --no-docker.");
  console.log("\n✅ PHASE F — Verify (production-smoke)\n");

  const baseUrl = process.env.PROD_BASE_URL ?? "http://127.0.0.1:8080";
  log(`production-smoke against ${baseUrl}…`);
  const rc = runNode("scripts/production-smoke.mjs", { env: { ...process.env, PROD_BASE_URL: baseUrl } });
  if (rc !== 0) {
    console.error("\n[deploy] ✗ VERIFY FAIL — production-smoke did not pass.");
    console.error("[deploy] Roll back NOW:");
    console.error("  node scripts/rollback.mjs --auto");
    fail("verify failed — run rollback.");
  }
  log("production-smoke PASS ✓");
}

// ── Phase G (only --push-images): docker push to the remote registry ────────
if (PUSH_IMAGES) {
  if (NO_DOCKER) fail("--push-images requires local images; incompatible with --no-docker.");
  console.log("\n📤 PHASE G — Push images to the remote registry\n");

  // Retag with the registry prefix + push. Runs AFTER --verify: only what
  // passed the smoke test is uploaded to the registry. Remote refs are
  // immutable (<sha>), so rollback from any node in the cluster can point at
  // this exact image. The mechanics (retag+push+manifest-inspect) live in
  // push-images-lib.mjs (pushImages) — the same one the CI test exercises
  // against a local registry:2. If the push is not visible in the registry,
  // FAIL before printing the tag: the image must be queryable for image-based
  // rollback to use it.
  // `runVisible` confirms the push is queryable in the registry. In --dry-run
  // the real manifest inspect is NOT executed (it would escape the sandbox):
  // it is simulated as visible, just like `run` simulates the commands.
  const runVisible = (remote) => {
    if (DRY_RUN) {
      console.log(`$ docker buildx imagetools inspect ${remote} (simulated in dry-run)`);
      return true;
    }
    return defaultInspectVisible(remote);
  };
  const res = pushImages({
    sha,
    registry: REGISTRY,
    run,
    runVisible,
  });
  if (!res.ok) {
    if (res.step === "tag") {
      fail(`docker tag of ${res.remote} failed.`);
    } else if (res.step === "push") {
      fail(`docker push ${res.remote} failed — check registry credentials/network.`);
    } else if (res.step === "not-visible") {
      fail(
        `docker manifest inspect of ${res.remote} failed after the push — the image is NOT ` +
          "queryable in the registry. The tag is not printed as deployable.",
      );
    } else {
      fail(res.remote || "invalid SHA for --push-images.");
    }
  }
  for (const remote of res.pushed) log(`${remote} pushed ✓ (visible in the registry)`);
  log(`images available to the cluster (immutable SHAs, verified): ${REGISTRY}/bookmarkforge/web:${sha}`);
} else {
  log("--push-images not set: the images stay on this machine only.");
}

// ── Phase H (only --push-tag): git push origin <tag> ────────────────────────
if (PUSH_TAG) {
  if (NO_TAG) fail("--push-tag requires the tag to be created; incompatible with --no-tag.");
  console.log("\n⬆️  PHASE H — Push tag to the remote\n");
  const rc = runArgs(["git", "push", "origin", tagName]);
  if (rc !== 0) fail(`git push origin ${tagName} failed — the tag exists locally but not on the remote.`);
  log(`tag ${tagName} pushed ✓`);
} else {
  log("--push-tag not set: the tag is local. For rollback to work from another machine, run: git push origin " + tagName);
}

// ── Summary ────────────────────────────────────────────────────────────────
const elapsed = ((Date.now() - T0) / 1000).toFixed(1);
console.log("\n" + "=".repeat(60));
console.log(`✅ DEPLOY COMPLETE in ${elapsed}s`);
console.log(`   Tag:      ${tagName}`);
console.log(`   SHA:      ${sha}`);
if (!NO_DOCKER) {
  console.log(`   Images: bookmarkforge/web:${sha}  bookmarkforge/api:${sha}`);
}
if (PUSH_IMAGES) {
  console.log(`   Registry: ${REGISTRY}/bookmarkforge/web:${sha}  ${REGISTRY}/bookmarkforge/api:${sha}`);
}
console.log("=".repeat(60));
console.log("\nFollow-up commands:");
console.log(`  Verify now:  PROD_BASE_URL=${process.env.PROD_BASE_URL ?? "http://127.0.0.1:8080"} node scripts/production-smoke.mjs`);
console.log(`  Monitor:     node scripts/monitoring-alerts.mjs --json`);
console.log(`  Rollback (<1min):  node scripts/rollback.mjs --auto`);
console.log(`  List tags:   node scripts/rollback.mjs --list`);
if (PUSH_IMAGES) {
  console.log("\nPrepare a cluster node for image-based rollback:");
  console.log(`  docker pull ${REGISTRY}/bookmarkforge/web:${sha} && docker tag ${REGISTRY}/bookmarkforge/web:${sha} bookmarkforge/web:${sha}`);
  console.log(`  docker pull ${REGISTRY}/bookmarkforge/api:${sha} && docker tag ${REGISTRY}/bookmarkforge/api:${sha} bookmarkforge/api:${sha}`);
  console.log("  (after this, rollback.mjs --auto uses the local image in <1min, no rebuild)");
}
// ── util ───────────────────────────────────────────────────────────────────
function localStamp(now = new Date()) {
  const p = (n, l = 2) => String(n).padStart(l, "0");
  const yyyy = now.getFullYear();
  const mm = p(now.getMonth() + 1);
  const dd = p(now.getDate());
  const hh = p(now.getHours());
  const min = p(now.getMinutes());
  return `${yyyy}${mm}${dd}-${hh}${min}`;
}

process.exit(0);
} // end else (isMain) — CLI block close
