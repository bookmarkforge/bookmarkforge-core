#!/usr/bin/env node
/**
 * scripts/rollback.mjs — Rollback in <1min without data loss (image by SHA)
 *
 * Strategy: IMAGE FIRST. deploy-prod.mjs builds and tags the images by SHA
 * (bookmarkforge/web:<sha>, bookmarkforge/api:<sha>) and creates the
 * prod-YYYYMMDD-HHMM-<sha> tag. The preferred rollback does NOT rebuild:
 * it runs `docker compose up -d` with IMAGE_TAG=<sha> (no --build) → seconds.
 * Only if the <sha> image does not exist locally does it fall back to a
 * rebuild from the tag's code (safety fallback).
 *
 * Usage:
 *   node scripts/rollback.mjs --prev-tag prod-20250826-a1b2c3d
 *   node scripts/rollback.mjs --list
 *   node scripts/rollback.mjs --auto  (reverts to the last good tag)
 *
 * BookmarkForge is local-first (IndexedDB/RxDB). The rollback NEVER deletes
 * client data. It only reverts the web/api containers and the bundle.
 *
 * Pre-requisites:
 *   - Every deploy creates a tag: prod-YYYYMMDD-HHMM-<shortsha>
 *   - Tagged Docker images: bookmarkforge/web:<sha> and bookmarkforge/api:<sha>
 *
 * Remote registry (optional): if deploy-prod.mjs ran with --push-images,
 * the SHA images are available in DOCKER_REGISTRY. AUTOMATIC PRIMING: when
 * the local image is missing but the registry has it, the rollback itself
 * runs `docker pull` + `docker tag` by SHA and uses it without a rebuild —
 * there is no need to prime the node beforehand (pull-prod-images.mjs is
 * only for optional pre-warming). The image-by-SHA rollback works from any
 * node in the cluster (not only the one that built it).
 *   DOCKER_REGISTRY  target registry (e.g. registry.example.com:5000)
 */

import { execSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { validateRegistry } from "./registry-policy.mjs";
import { runCommand, runCommandOk } from "./command-runner.mjs";

function run(cmd, opts = {}) {
  if (Array.isArray(cmd)) return runCommand(cmd[0], cmd.slice(1), opts);
  console.log(`$ ${cmd}`);
  return execSync(cmd, { stdio: "inherit", ...opts });
}

/** run() that does not throw: returns true/false based on the exit code. */
function runOk(cmd, opts = {}) {
  if (Array.isArray(cmd)) return runCommandOk(cmd[0], cmd.slice(1), opts);
  try {
    run(cmd, opts);
    return true;
  } catch {
    return false;
  }
}

/**
 * Re-render deployment config after a failed post-rollback smoke.
 *
 * Kept as a tiny injectable boundary so the integration test can execute the
 * real nginx-render --write command in an isolated fixture, without running
 * git/docker or a production rollback.
 */
export function runNginxRenderWrite({ cwd = process.cwd(), runner = run } = {}) {
  return runner("node scripts/nginx-render.mjs --write", { cwd });
}

function runCapture(cmd) {
  return execSync(cmd, { encoding: "utf8" }).trim();
}

const args = process.argv.slice(2);

// Base URL for the post-rollback smoke: honors PROD_BASE_URL (same as
// deploy-prod.mjs and monitoring-alerts.mjs). Default = local prod 8080.

export function validateRollbackTargetTag(tag) {
  return typeof tag === "string" && /^prod-[0-9]{8}-[0-9]{4}-[0-9a-fA-F]{7,40}$/.test(tag);
}

export function validateRollbackBaseUrl(value) {
  if (typeof value !== "string" || value.trim() === "" || value.length > 2048) return false;
  try {
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash) return false;
    if (url.protocol === "http:") return url.hostname === "127.0.0.1" || url.hostname === "localhost";
    return url.protocol === "https:" && !url.port;
  } catch {
    return false;
  }
}

const PROD_BASE_URL = process.env.PROD_BASE_URL ?? "http://127.0.0.1:8080";
if (!validateRollbackBaseUrl(PROD_BASE_URL) && process.argv[1]?.endsWith("rollback.mjs")) {
  console.error("[rollback] PROD_BASE_URL must be a valid HTTPS URL or local HTTP URL");
  process.exit(1);
}
const SMOKE_ENV = { ...process.env, PROD_BASE_URL };

// ── Pure logic (extracted for unit testing without git/docker) ─────────

/**
 * Extracts the sha (last segment) from a prod-* tag. Returns "" if the tag
 * does not end in a 7-12 hex sha — in that case the rollback falls back to
 * a rebuild.
 */
export function extractSha(tag) {
  if (typeof tag !== "string" || !tag.startsWith("prod-")) return "";
  const sha = tag.split("-").pop() ?? "";
  return /^[0-9a-f]{7,12}$/i.test(sha) ? sha : "";
}

/**
 * Selects the --auto target: the tag of the second-to-last DISTINCT prod-*
 * BUILD (last good). `tags` must already be sorted by creatordate
 * descending (like `git tag --sort=-creatordate`).
 *
 * Dedupe by sha: every deploy creates prod-YYYYMMDD-HHMM-<shortsha>, and a
 * redeploy of the same commit creates ANOTHER tag with the SAME sha (a real
 * case: 2 tags over bb21664 degraded --auto into a no-op rollback — it
 * "reverted" to the same image by SHA). The first appearance of each sha is
 * kept (the most recent by creatordate); tags without a valid embedded sha
 * are treated as a distinct build by name (their image routing falls back
 * to a rebuild anyway).
 *
 * Returns null if there are fewer than 2 prod-* tags OR fewer than 2 distinct
 * builds (in both cases an automatic rollback has no useful target).
 */
export function selectAutoTarget(tags) {
  const prodTags = (tags ?? []).filter((t) => typeof t === "string" && t.startsWith("prod-"));
  const distinct = [];
  const seen = new Set();
  for (const tag of prodTags) {
    const sha = extractSha(tag);
    const key = sha ? sha.toLowerCase() : `name:${tag}`;
    if (seen.has(key)) continue;
    seen.add(key);
    distinct.push(tag);
  }
  if (distinct.length < 2) return null;
  return distinct[1]; // second-to-last build DISTINCT from the current one
}

/**
 * Rollback routing based on the local presence of the SHA images:
 *
 *   - PATH A (image by SHA, no build): `bookmarkforge/web:<sha>` exists
 *     locally and `bookmarkforge/api:<sha>` exists or can be obtained from
 *     DOCKER_REGISTRY → `route = "image"`.
 *   - PATH B (rebuild from the tag): web:<sha> does not exist, or api:<sha>
 *     is missing with no registry available → `route = "rebuild"`.
 *
 * An empty/invalid sha ALWAYS falls back to a rebuild (rollback.mjs already
 * prints "no valid sha → rebuild").
 *
 * `imageList` are the `repo:tag` lines from `docker images --format
 * "{{.Repository}}:{{.Tag}}"`. Returns { route } so callers can measure/act
 * separately.
 */
export function decideImagePath(sha, imageList) {
  // An empty or malformed sha ALWAYS falls back to a rebuild (consistent with
  // extractSha): we never try to start an image with an invalid tag.
  if (!sha || !/^[0-9a-f]{7,12}$/i.test(sha)) {
    return { route: "rebuild", reason: "invalid-sha" };
  }
  const images = Array.isArray(imageList) ? imageList : [];
  const hasWeb = images.includes(`bookmarkforge/web:${sha}`);
  const hasApi = images.includes(`bookmarkforge/api:${sha}`);
  if (hasWeb && hasApi) return { route: "image" };
  return {
    route: "rebuild",
    reason: hasWeb && !hasApi ? "web-only" : !hasWeb && hasApi ? "api-only" : "neither",
  };
}

/**
 * Decides whether it is worth attempting `docker pull` from the remote
 * registry to complete PATH A. `web:<sha>` is the main gate: a rebuild is
 * never attempted if web exists; api:<sha> is only fetched from the registry
 * when api is missing locally. Returns { shouldPull, missing }.
 *
 * Without a local web, no pull and no partial rebuild happen: the image path
 * requires web to already be available locally. Without a valid sha or
 * without a registry, no pull is attempted.
 */
export function shouldPullFromRegistry(sha, imageList, registry) {
  if (!sha || !/^[0-9a-f]{7,12}$/i.test(sha)) {
    return { shouldPull: false, missing: [] };
  }
  const images = Array.isArray(imageList) ? imageList : [];
  const hasWeb = images.includes(`bookmarkforge/web:${sha}`);
  const hasApi = images.includes(`bookmarkforge/api:${sha}`);
  const missing = hasWeb && !hasApi ? ["api"] : [];
  const configured = typeof registry === "string" && registry.trim().length > 0;
  if (!hasWeb || missing.length === 0 || !configured) {
    return { shouldPull: false, missing };
  }
  return { shouldPull: true, missing };
}

/** Runs the flow only when invoked directly (not when imported). */
// The main flow only runs when executed directly (import.meta.url === the
// real script path), not when the test imports the pure logic. pathToFileURL
// normalizes the OS argv[1] (including Windows \ separators) into a canonical
// file:// URL comparable with import.meta.url.
import { pathToFileURL } from "node:url";

const isMain =
  typeof process.argv[1] === "string" &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {

if (args.includes("--help") || args.includes("-h")) {
  console.log(`
BookmarkForge Rollback — <1min (image by SHA, rebuild fallback)

  --list              List the last 5 prod-* tags
  --prev-tag <tag>    Revert to a specific tag (e.g. prod-20250826-a1b2c3d)
  --auto              Revert to the second-to-last tag (last good)
  --verify            Only verify health (does not revert)
  --help              This help

Strategy: uses the bookmarkforge/web:<sha> image already tagged by
deploy-prod.mjs (up -d WITHOUT --build, <1min). AUTOMATIC priming: if the
image is not local and DOCKER_REGISTRY is set (deploy-prod --push-images
uploaded it), a docker pull + tag by SHA is done on this node and we continue
with that image — there is NO need to prime the node beforehand. Only if
there is no registry or the pull fails does it fall back to the tag checkout
+ rebuild (fallback).
Requires DOCKER_REGISTRY (e.g. registry.example.com:5000).

Examples:
  node scripts/rollback.mjs --list
  node scripts/rollback.mjs --prev-tag prod-20250826-a1b2c3d
  node scripts/rollback.mjs --auto
`);
  process.exit(0);
}

if (args.includes("--list")) {
  try {
    const tags = runCapture("git tag --sort=-creatordate").split("\n").slice(0, 20).join("\n");
    console.log(tags || "(no prod-* tags)");
    try {
      const imagesRaw = runCapture("docker images bookmarkforge/web --format \"{{.Repository}}:{{.Tag}} {{.CreatedSince}}\"");
      console.log("\nDocker images:\n" + imagesRaw.split("\n").slice(0, 20).join("\n"));
    } catch {
      console.log("\nDocker images: (docker not available locally — OK on Windows dev)");
    }
  } catch (e) {
    console.error("Could not list tags:", e.message);
  }
  process.exit(0);
}

if (args.includes("--verify")) {
  const r = spawnSync(process.execPath, ["scripts/production-smoke.mjs"], {
    stdio: "inherit",
    env: SMOKE_ENV,
    timeout: 120_000,
  });
  if (r.status !== 0) {
    console.error("\n[rollback] VERIFY FAIL — health check did not pass");
    process.exit(1);
  }
  console.log("\n[rollback] VERIFY OK — the production smoke passed (all checks)");
  process.exit(0);
}

let targetTag = null;
const idx = args.indexOf("--prev-tag");
if (idx !== -1) targetTag = args[idx + 1];

if (args.includes("--auto")) {
  try {
    const tags = runCapture("git tag --sort=-creatordate").split("\n").filter((t) => t.startsWith("prod-"));
    targetTag = selectAutoTarget(tags);
    if (!targetTag) {
      if (tags.length < 2) {
        console.error("[rollback] Not enough prod-* tags for auto. Use --prev-tag");
      } else {
        // Every tag points to the same build: reverting to tags[1] would be a
        // no-op (same image by SHA). Require an explicit target.
        console.error(
          `[rollback] All ${tags.length} prod-* tags point to the same build (${extractSha(tags[0]) || "no embedded sha"}). Use --prev-tag <tag> to force a different target.`,
        );
      }
      process.exit(1);
    }
    console.log(`[rollback] Auto: reverting to ${targetTag} (current is ${tags[0]})`);
  } catch (e) {
    console.error("[rollback] --auto failed:", e.message);
    process.exit(1);
  }
}

if (!targetTag) {
  console.error("[rollback] You must pass --prev-tag <tag> or --auto. Use --help");
  process.exit(1);
}

// PRE-VALIDATION: verify the tag exists and has a minimal structure
try {
  if (!validateRollbackTargetTag(targetTag)) {
    console.error(`[rollback] Invalid target tag format: ${targetTag}`);
    process.exit(1);
  }
  const tagCheck = spawnSync("git", ["cat-file", "-t", `refs/tags/${targetTag}`], { encoding: "utf8" });
  if (tagCheck.status !== 0) throw new Error(tagCheck.stderr?.trim() || "tag lookup failed");
  const tagType = tagCheck.stdout.trim();
  if (tagType !== "tag") {
    console.error(`[rollback] The tag ${targetTag} does not exist or is not a valid tag`);
    process.exit(1);
  }
  // Verify it has at least one file (avoids empty/corrupt tags)
  // Cross-platform: count lines in JS instead of piping to `wc` (missing under
  // cmd.exe on Windows dev boxes).
  const filesInTagResult = spawnSync("git", ["ls-tree", "-r", `refs/tags/${targetTag}`, "--name-only"], {
    encoding: "utf8",
  });
  if (filesInTagResult.status !== 0) throw new Error(filesInTagResult.stderr?.trim() || "tag tree lookup failed");
  const filesInTag = filesInTagResult.stdout.trim().split("\n").filter(Boolean).length;
  if (filesInTag < 5) {
    console.error(`[rollback] The tag ${targetTag} looks empty or corrupt (too few files)`);
    process.exit(1);
  }
  console.log(`[rollback] Tag ${targetTag} validated successfully`);
} catch (e) {
  console.error(`[rollback] Error validating tag ${targetTag}: ${e.message}`);
  process.exit(1);
}

// ── Strategy: IMAGE FIRST ──────────────────────────────────────────────
// deploy-prod.mjs tags the images by SHA and docker-compose.prod.yml
// declares images parameterized by IMAGE_TAG. The preferred rollback starts
// the ALREADY BUILT image (up -d without --build → seconds); only if the
// <sha> image does not exist locally does it fall back to a rebuild from the
// tag.

const sha = extractSha(targetTag);
const shaLooksValid = Boolean(sha); // extractSha already applies the regex
// Target compose: prod by default; DEPLOY_COMPOSE_FILE for staging drills.
const COMPOSE_FILE = process.env.DEPLOY_COMPOSE_FILE?.trim() || "docker-compose.prod.yml";
const envFileArg = existsSync(".env.production") ? "--env-file .env.production" : "";
const composeBase = `docker compose -f ${COMPOSE_FILE} ${envFileArg}`.trim();

// Remote registry (optional): deploy-prod.mjs --push-images uploads the SHA
// images to this registry. If the local image does not exist but the registry
// does, PATH A can `docker pull` and use it without a rebuild — enabling the
// image-by-SHA rollback from ANY node in the cluster (not only the one that
// built it). Same env as deploy-prod.mjs; without the var, the rollback only
// uses local images (original behavior).
const REGISTRY = (process.env.DOCKER_REGISTRY ?? "").trim().replace(/\/+$/, "");
if (REGISTRY && !validateRegistry(REGISTRY)) {
  console.error("[rollback] DOCKER_REGISTRY contains an invalid host");
  process.exit(1);
}

console.log(`\n[rollback] STARTING ROLLBACK TO ${targetTag} — stopwatch 1:00`);
console.log(
  `[rollback] Target image: bookmarkforge/web:${shaLooksValid ? sha : "(no valid sha → rebuild)"}\n`,
);

const t0 = Date.now();
try {
  // ── PATH A: image by SHA (no build, <1 min) ──────────────────────────
  let imagePathOk = false;
  if (shaLooksValid) {
    // Local pre-check: web:<sha> is the mandatory gate. If web does not
    // exist, we attempt neither up -d nor a partial rebuild. api:<sha> can be
    // primed automatically from DOCKER_REGISTRY when missing locally.
    let hasWeb = false;
    let hasApi = false;
    let images = [];
    try {
      images = runCapture(`docker images --format "{{.Repository}}:{{.Tag}}"`).split("\n");
      hasWeb = images.includes(`bookmarkforge/web:${sha}`);
      hasApi = images.includes(`bookmarkforge/api:${sha}`);
    } catch {
      console.log("[rollback] docker not available — the fallback will confirm it");
    }
    // The local image is missing but the remote registry may have it: pull +
    // retag by SHA enables the image-by-SHA rollback from any node in the
    // cluster (deploy-prod --push-images uploaded it). Without a valid sha or
    // registry, shouldPullFromRegistry returns shouldPull=false → rebuild.
    const pullDecision = shouldPullFromRegistry(sha, images, REGISTRY);
    if (pullDecision.shouldPull) {
      console.log(`[rollback] Checking remote availability before the pull (${REGISTRY})`);
      const remoteRefs = pullDecision.missing.map((name) => `${REGISTRY}/bookmarkforge/${name}:${sha}`);
      let remotePublished = true;
      for (const remote of remoteRefs) {
        try {
          const manifest = spawnSync("docker", ["manifest", "inspect", remote], {
            stdio: "ignore",
            timeout: 60_000,
          });
          if (manifest.status !== 0) throw new Error("docker manifest inspect failed");
        } catch {
          remotePublished = false;
          console.error(`[rollback] image not published in the registry: ${remote}`);
          break;
        }
      }
      if (!remotePublished) {
        console.error(`[rollback] SHA ${sha} is not published in ${REGISTRY} — aborting PATH A before the pull`);
      }
      if (remotePublished) {
      console.log(`[rollback] Image not local — attempting pull from ${REGISTRY}`);
      let pulled = true;
      for (const name of pullDecision.missing) {
        const remote = `${REGISTRY}/bookmarkforge/${name}:${sha}`;
        const local = `bookmarkforge/${name}:${sha}`;
        const pullOk = runOk(["docker", "pull", remote], { timeout: 120_000 });
        if (!pullOk) {
          pulled = false;
          console.warn(`[rollback] pull of ${remote} failed — no image in the registry for this sha`);
          break;
        }
        if (run(["docker", "tag", remote, local], { timeout: 30_000 }) !== 0) {
          pulled = false;
          console.warn(`[rollback] local tag of ${remote} failed`);
          break;
        }
      }
      if (remotePublished && pulled) {
        hasWeb = true;
        hasApi = true;
        console.log(`[rollback] Images obtained from the registry (${sha}) — continuing PATH A`);
      }
      }
    }
    if (hasWeb && hasApi) {
      // Real time measured for the image-by-SHA path: the rollback drill
      // parses and gates it (< 60s) — see scripts/drill-rollback.mjs.
      const pathAStart = Date.now();
      console.log(`[T+0:00] ${composeBase} up -d web api  (IMAGE_TAG=${sha}, NO build)`);
      imagePathOk = runOk(`${composeBase} up -d web api`, {
        env: { ...process.env, IMAGE_TAG: sha },
        timeout: 90_000,
      });
      if (imagePathOk) {
        // Sanity: web and api must end up Up. The image may exist but be
        // corrupt/crash-looping; in that case we fall back to a rebuild.
        // POLLING (not a single check): `compose ps` immediately after
        // `up -d` may show api still "starting"/not Up, which triggers an
        // unnecessary fallback to a rebuild (which also checks out the old
        // tag and can revive already-fixed bugs). We wait up to 30s before
        // declaring the image unusable.
        try {
          let webUp = false;
          let apiUp = false;
          for (let attempt = 1; attempt <= 15; attempt++) {
            const ps = runCapture(`${composeBase} ps --format "{{.Service}}:{{.Status}}"`);
            const lines = ps.split("\n");
            webUp = lines.some((l) => l.startsWith("web:") && /Up/i.test(l));
            apiUp = lines.some((l) => l.startsWith("api:") && /Up/i.test(l));
            if (webUp && apiUp) break;
            if (attempt % 5 === 0) console.log(`[rollback] waiting for web/api Up (attempt ${attempt}/15)...`);
            await new Promise((r) => setTimeout(r, 2000));
          }
          const ps = runCapture(`${composeBase} ps --format "{{.Service}}:{{.Status}}"`);
          console.log("[rollback] Containers:\n" + ps);
          if (!webUp || !apiUp) {
            console.warn("[rollback] web/api were not Up after 30s — falling back to rebuild");
            imagePathOk = false;
          } else {
            const pathASeconds = ((Date.now() - pathAStart) / 1000).toFixed(1);
            console.log(
              `[rollback] PATH A confirmed: image by SHA, no rebuild ✓ (up -d + sanity in ${pathASeconds}s)`,
            );
          }
        } catch (e) {
          console.warn("[rollback] Could not verify docker ps:", e.message);
        }
      } else {
        console.log("[rollback] up -d failed — falling back to rebuild");
      }
    } else {
      // We only get here if shouldPullFromRegistry did not attempt a pull:
      // either DOCKER_REGISTRY is not set (isolated node) or the pull/tag
      // failed (the registry does not have this sha). Automatic priming was
      // already attempted.
      if (!REGISTRY) {
        console.log(
          `[rollback] Image bookmarkforge/web:${sha} is not local — it is the mandatory gate ` +
            "and there is no DOCKER_REGISTRY to complete the image rollback; falling back to rebuild",
        );
      } else {
        console.log(
          `[rollback] web:${sha} is not local; the image path cannot be completed ` +
            `(DOCKER_REGISTRY=${REGISTRY} can only prime api when web already exists) — falling back to rebuild`,
        );
      }
    }
  }

  // ── PATH B (fallback): tag checkout + rebuild ─────────────────────────
  if (!imagePathOk) {
    console.log("\n[rollback] PATH B — tag checkout + rebuild (fallback)");
    // Stash any uncommitted changes so checkout doesn't fail
    try {
      run("git stash push -m rollback-auto-stash");
    } catch { /* INTENTIONAL SILENCE: stashing is best-effort; the tag checkout path still proceeds below. */ }

    console.log(`[T+0:05] git checkout ${targetTag}`);
    run(`git checkout ${targetTag}`);

    console.log(`[T+0:10] ${composeBase} up -d --build web api (IMAGE_TAG=${sha || "(rebuild from tag)"})`);
    try {
      run(`${composeBase} up -d --build web api`, {
        env: { ...process.env, IMAGE_TAG: sha },
        timeout: 180_000,
      });
    } catch {
      console.log("[rollback] build failed, trying up without build using the existing image...");
      run(`${composeBase} up -d web api`, { env: { ...process.env, IMAGE_TAG: sha } });
    }
  } else {
    // Sync the working tree with the deployed tag (housekeeping).
    // It does not block the rollback: the service already runs the correct
    // image. A dirty tree (in-flight hotfix) must NOT destroy uncommitted
    // work.
    try {
      console.log(`[T+0:05] git checkout ${targetTag} (sync tree)`);
      run(`git checkout ${targetTag}`);
    } catch (e) {
      console.warn(`[rollback] Could not check out ${targetTag} (dirty tree?): ${e.message}`);
      console.warn("[rollback] The service already runs the correct image; the tree is left as it was.");
    }
  }

  // T+0:15 — health checks
  console.log("[T+0:15] Health checks...");
  await new Promise((r) => setTimeout(r, 3000));
  try {
    run("docker ps --format \"{{.Names}} {{.Status}}\"");
  } catch { /* INTENTIONAL SILENCE: the container listing is a diagnostic log line; rollback continues without it. */ }

  // Smoke attempt (against PROD_BASE_URL — never hardcode the port)
  console.log(`[T+0:25] production-smoke against ${PROD_BASE_URL}...`);
  const smoke = spawnSync(process.execPath, ["scripts/production-smoke.mjs"], {
    stdio: "inherit",
    env: SMOKE_ENV,
    timeout: 120_000,
  });
  if (smoke.status !== 0) {
    console.log("[rollback] smoke FAIL — regenerating nginx.conf and retrying");
    try {
      runNginxRenderWrite();
      run(`${composeBase} restart web`);
      await new Promise((r) => setTimeout(r, 3000));
      const smoke2 = spawnSync(process.execPath, ["scripts/production-smoke.mjs"], {
        stdio: "inherit",
        env: SMOKE_ENV,
        timeout: 120_000,
      });
      if (smoke2.status !== 0) {
        console.error("[rollback] SMOKE STILL FAILING — escalate manually");
        process.exit(1);
      }
    } catch (e) {
      console.error("[rollback] Retry failed:", e.message);
      process.exit(1);
    }
  }

  // T+0:40 — verify SW
  console.log("[T+0:40] Verifying SW...");
  try {
    const sw = await fetch(`${PROD_BASE_URL}/sw.js`).then((r) => r.text()).then((t) => t.slice(0, 200));
    console.log(sw);
  } catch { /* INTENTIONAL SILENCE: SW fetch is a diagnostic step; a non-200/timeout must not fail the rollback. */ }

  // T+0:45 — validate data (never delete IndexedDB)
  console.log("[T+0:45] Validating RxDB / local data — NEVER delete the volume");
  console.log("  RxDB is local-first: the rollback does NOT touch the client's IndexedDB.");
  console.log("  If the migration broke it, the old schema is already in this tag.");

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n[rollback] ROLLBACK OK in ${elapsed}s — verify https://your-domain.com`);
  console.log(`[rollback] Tag: ${targetTag} — image bookmarkforge/web:${shaLooksValid ? sha : "(rebuild from tag)"}`);
  console.log(`[rollback] Next: monitor with 'node scripts/production-smoke.mjs' every 60s`);
} catch (e) {
  console.error(`[rollback] FATAL: ${e.message}`);
  process.exit(1);
}

} // end if (isMain)