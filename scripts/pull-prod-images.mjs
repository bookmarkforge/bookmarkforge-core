#!/usr/bin/env node
/**
 * scripts/pull-prod-images.mjs — Node priming for <1min rollback
 *
 * Strategy: image-by-SHA rollback (PATH A in rollback.mjs) only starts in
 * seconds when the image `bookmarkforge/{web,api}:<sha>` is ALREADY local.
 * This priming script runs on ANY node of the cluster (not just the one that
 * built) and readies the node: it `docker pull`s the SHA images of a prod-*
 * tag from DOCKER_REGISTRY and re-tags them to the local name, preparing a
 * rollback that completes in ~seconds.
 *
 * Uso:
 *   node scripts/pull-prod-images.mjs --tag prod-20250826-a1b2c3d
 *   node scripts/pull-prod-images.mjs --latest        # second-newest prod-* tag
 *   node scripts/pull-prod-images.mjs --list          # tags + local state of each sha
 *   node scripts/pull-prod-images.mjs --check         # check priming without pulling
 *
 * Env:
 *   DOCKER_REGISTRY  registro remoto (requerido; ej: registry.example.com:5000);
 *                    if undefined → exit 1 fail-closed (nothing to pull).
 *   PROD_BASE_URL    not used here (rollback runs the smoke); read-only.
 *
 * Fail-closed: without a valid tag, without a registry, or if the pull/tag of
 * any image fails → exit 1 with a clear message. It NEVER leaves a
 * half-primed state that looks ready: if something fails, it reports which
 * image is missing and fails the script.
 */

import { execSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { extractSha } from "./rollback.mjs";
import { validateRegistry } from "./registry-policy.mjs";
import { runCommandOk } from "./command-runner.mjs";
export { validateRegistry };

// ── Pure logic (extracted for unit testing without docker or git) ────────

/**
 * Builds the list of remote and local references to pull+tag for a sha.
 * Returns [{ name, remote, local }] for web and api, or [] when the sha is
 * not a valid hash (7-12 hex). `registry` already normalized without a
 * trailing `/`.
 */
export function planPullTargets(sha, registry) {
  if (!sha || !/^[0-9a-f]{7,12}$/i.test(sha)) return [];
  const reg =
    typeof registry === "string" ? registry.trim().replace(/\/+$/, "") : "";
  if (!validateRegistry(reg)) return [];
  return ["web", "api"].map((name) => ({
    name,
    remote: `${reg}/bookmarkforge/${name}:${sha}`,
    local: `bookmarkforge/${name}:${sha}`,
  }));
}

/**
 * Decides whether a node is already primed for the sha: both local images
 * bookmarkforge/{web,api}:<sha> exist. `imageList` holds the repo:tag lines
 * of `docker images --format "{{.Repository}}:{{.Tag}}"` (returns [] when the
 * listing failed → not primed, there is work to do).
 */
export function isPrimed(sha, imageList) {
  if (!sha || !/^[0-9a-f]{7,12}$/i.test(sha)) return false;
  const images = Array.isArray(imageList) ? imageList : [];
  return (
    images.includes(`bookmarkforge/web:${sha}`) &&
    images.includes(`bookmarkforge/api:${sha}`)
  );
}

// ── Main flow ─────────────────────────────────────────────────

const args = process.argv.slice(2);

function runOk(cmd) {
  if (Array.isArray(cmd)) return runCommandOk(cmd[0], cmd.slice(1), { stdio: "inherit" });
  console.log(`$ ${cmd}`);
  try {
    execSync(cmd, { stdio: "inherit" });
    return true;
  } catch {
    return false;
  }
}

function runCapture(cmd) {
  return execSync(cmd, { encoding: "utf8" }).trim();
}

const isMain =
  typeof process.argv[1] === "string" &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const REGISTRY = (process.env.DOCKER_REGISTRY ?? "").trim().replace(/\/+$/, "");

  const help = `\nNode priming for <1min rollback (image by SHA)\n\n` +
    `  --tag <prod-*>    Prime the node with the given tag's images\n` +
    `  --latest          Prime the node with the second-newest prod-* tag (last known good)\n` +
    `  --list            List the last 5 prod-* tags + local state of their sha\n` +
    `  --check           Check the node's priming state (no pull)\n` +
    `  --help            This help\n\n` +
    `Requires DOCKER_REGISTRY (the registry deploy-prod --push-images uploads to).\n` +
    `Leaves the node with bookmarkforge/{web,api}:<sha> local → rollback in seconds.\n`;

  if (args.includes("--help") || args.includes("-h")) {
    console.log(help);
    process.exit(0);
  }

  if (REGISTRY && !validateRegistry(REGISTRY)) {
    console.error("[pull-prod-images] DOCKER_REGISTRY contains an invalid host. Exit 1.");
    process.exit(1);
  }

  if (!REGISTRY) {
    console.error(
      "[pull-prod-images] DOCKER_REGISTRY not set. " +
        "You need the registry deploy-prod.mjs --push-images uploaded the " +
        "images to (e.g. DOCKER_REGISTRY=registry.example.com:5000). Exit 1 (fail-closed).",
    );
    process.exit(1);
  }

  // ----------------------------------------------------------------------
  // --list: tags + estado de priming
  // ----------------------------------------------------------------------
  if (args.includes("--list")) {
    try {
      const tags = runCapture("git tag --sort=-creatordate")
        .split("\n")
        .filter((t) => t.startsWith("prod-"))
        .slice(0, 5);
      if (tags.length === 0) console.log("(no prod-* tags)");
      let images = [];
      try {
        images = runCapture(`docker images --format "{{.Repository}}:{{.Tag}}"`).split("\n");
      } catch {
        console.log("(docker no disponible localmente)");
      }
      for (const tag of tags) {
        const sha = extractSha(tag);
        const primed = isPrimed(sha, images) ? "PRIMED" : "missing";
        console.log(`  ${tag}  → ${sha ? `web/api:${sha} ${primed}` : "(no valid sha)"}`);
      }
    } catch (e) {
      console.error("[pull-prod-images] Could not list tags:", e.message);
      process.exit(1);
    }
    process.exit(0);
  }

  // ----------------------------------------------------------------------
  // Resolver el tag objetivo
  // ----------------------------------------------------------------------
  let targetTag = null;
  const tagIdx = args.indexOf("--tag");
  if (tagIdx !== -1) targetTag = args[tagIdx + 1];
  if (targetTag == null && args.includes("--latest")) {
    try {
      const tags = runCapture("git tag --sort=-creatordate")
        .split("\n")
        .filter((t) => t.startsWith("prod-"));
      if (tags.length < 2) {
        console.error("[pull-prod-images] Not enough prod-* tags for --latest. Use --tag.");
        process.exit(1);
      }
      targetTag = tags[1]; // second-newest (last known good, same as rollback --auto)
      console.log(`[pull-prod-images] --latest: target ${targetTag} (current ${tags[0]})`);
    } catch (e) {
      console.error("[pull-prod-images] --latest failed:", e.message);
      process.exit(1);
    }
  }

  if (!targetTag) {
    console.error("[pull-prod-images] You must pass --tag <prod-*> or --latest. Use --help");
    process.exit(1);
  }

  const sha = extractSha(targetTag);
  if (!sha) {
    console.error(
      `[pull-prod-images] Tag ${targetTag} does not end in a valid sha (7-12 hex).` +
        " No SHA image to prime. Exit 1 (fail-closed).",
    );
    process.exit(1);
  }

  // ----------------------------------------------------------------------
  // --check: priming state without touching the registry
  // ----------------------------------------------------------------------
  if (args.includes("--check")) {
    let images = [];
    try {
      images = runCapture(`docker images --format "{{.Repository}}:{{.Tag}}"`).split("\n");
    } catch {
      console.error("[pull-prod-images] docker unavailable — cannot confirm priming. Exit 1.");
      process.exit(1);
    }
    const primed = isPrimed(sha, images);
    const missing = ["web", "api"].filter((n) => !images.includes(`bookmarkforge/${n}:${sha}`));
    if (primed) {
      console.log(`[pull-prod-images] Node PRIMED for ${targetTag} (web/api:${sha}) ✓`);
      process.exit(0);
    }
    console.error(
      `[pull-prod-images] Node NOT primed for ${targetTag}: missing ${missing.join(", ")}.` +
        " Run this script without --check (it pulls). Exit 1.",
    );
    process.exit(1);
  }

  // ----------------------------------------------------------------------
  // Priming: pull + tag the SHA images of the tag
  // ----------------------------------------------------------------------
  const targets = planPullTargets(sha, REGISTRY);
  console.log(
    `\n[pull-prod-images] PRIMING node for ${targetTag} (sha ${sha}) from ${REGISTRY}`,
  );

  let dockerImages = [];
  try {
    dockerImages = runCapture(`docker images --format "{{.Repository}}:{{.Tag}}"`).split("\n");
  } catch {
    // docker unavailable → assume nothing is primed; the pull will confirm
  }

  const need = targets.filter((t) => !dockerImages.includes(t.local));
  if (need.length === 0) {
    console.log("[pull-prod-images] Ya primado — ambas imágenes locales (nada que hacer) ✓");
    process.exit(0);
  }

  let primed = true;
  for (const t of need) {
    if (!runOk(["docker", "pull", t.remote], { timeout: 180_000 })) {
      console.warn(`[pull-prod-images] pull of ${t.remote} failed (does it exist in the registry?)`);
      primed = false;
      break;
    }
    if (!runOk(["docker", "tag", t.remote, t.local])) {
      console.warn(`[pull-prod-images] local tag of ${t.remote} failed`);
      primed = false;
      break;
    }
  }

  if (!primed) {
    console.error(
      `[pull-prod-images] FAIL — the node is NOT primed for ${sha}.` +
        " Do not attempt a rollback with this sha or it will fall back to rebuild. Exit 1.",
    );
    process.exit(1);
  }

  console.log(
    `[pull-prod-images] NODO PRIMADO ✓ — bookmarkforge/{web,api}:${sha} local.` +
      " rollback.mjs --prev-tag <tag> will take PATH A (image, <1min).",
  );
  process.exit(0);
}