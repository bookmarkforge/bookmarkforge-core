#!/usr/bin/env node
/**
 * scripts/push-images-lib.mjs — Logic for pushing images by SHA to a Docker
 * registry, extracted so it can be tested against a local registry.
 *
 * Why: deploy-prod.mjs --push-images retags + pushes
 * `bookmarkforge/{web,api}:<sha>` to the remote registry. That logic used to
 * live embedded in its Phase G. Here it is extracted into a reusable module:
 * the SAME function that runs in production can be exercised in CI against a
 * disposable `registry:2` (scripts/test-push-images.mjs) without depending on
 * the full deploy pipeline (gates, build, git tag).
 *
 * The module is parametric: it receives `runOrThrow` (a spawn/execSync wrapper
 * that honors --dry-run by returning 0 without executing) and `log`/`fail`,
 * so deploy-prod.mjs injects its real helpers and the test injects its own.
 * Behavior is identical wherever it runs.
 */

import { spawnSync } from "node:child_process";
import { validateRegistry } from "./registry-policy.mjs";

/**
 * Validates and normalizes the target registry for --push-images.
 * Fail-closed: only returns a non-empty registry with host/port syntax.
 *
 *   valid                        → { ok:true, registry }
 *   empty/null (no dry-run)      → { ok:false, reason:"missing" }
 *   empty/null (dry-run)         → { ok:true, registry:"registry.example.com" }
 *                                   (simulated: no real push in dry-run)
 *   invalid format               → { ok:false, reason:"invalid" }
 *
 * Host/port regex: first char alphanumeric, then [A-Za-z0-9._:/-]*.
 */
export function resolveRegistry(rawRegistry, { push: _push, dryRun }) {
  void _push; // the `push` flag is documented in the contract; only dryRun matters here

  const registry = (typeof rawRegistry === "string" ? rawRegistry : "")
    .trim()
    .replace(/\/+$/, "");
  if (!registry) {
    if (dryRun) {
      return { ok: true, registry: "registry.example.com", simulated: true };
    }
    return { ok: false, reason: "missing" };
  }
  if (!validateRegistry(registry)) {
    return { ok: false, reason: "invalid" };
  }
  return { ok: true, registry };
}

/**
 * Builds the retag + push plan for the web and api images of a given sha.
 * Returns [{ name, local, remote }]. Assumes `registry` is already normalized.
 */
export function planPushTargets(sha, registry) {
  if (!sha || !/^[0-9a-f]{7,12}$/i.test(sha)) return [];
  if (!registry) return [];
  return ["web", "api"].map((name) => ({
    name,
    local: `bookmarkforge/${name}:${sha}`,
    remote: `${registry}/bookmarkforge/${name}:${sha}`,
  }));
}

/**
 * Runs the retag + push of the SHA images to the registry, and VERIFIES the
 * image is visible in the registry before declaring success.
 *
 * `run` is `(cmd, opts?) => exitCode` and must honor --dry-run (0 without
 * executing). `runVisible` is `(remote, opts?) => boolean` and runs `docker
 * buildx imagetools inspect <remote>` (defaultInspectVisible) to confirm the
 * push propagated and is queryable in the registry.
 *
 * Returns { ok, pushed: [remotes…] } on success; on failure returns
 * { ok:false, step:"tag"|"push"|"not-visible", remote } (never throws).
 */
export function pushImages({
  sha,
  registry,
  images = ["web", "api"],
  run,
  runVisible = defaultInspectVisible,
}) {
  if (!sha || !/^[0-9a-f]{7,12}$/i.test(sha) || !validateRegistry(registry)) {
    return { ok: false, step: "config", remote: `<invalid configuration>` };
  }
  const pushed = [];
  for (const name of images) {
    const local = `bookmarkforge/${name}:${sha}`;
    const remote = `${registry}/bookmarkforge/${name}:${sha}`;
    if (run(["docker", "tag", local, remote]) !== 0) {
      return { ok: false, step: "tag", remote };
    }
    if (run(["docker", "push", remote], { timeout: 300_000 }) !== 0) {
      return { ok: false, step: "push", remote };
    }
    // Confirm real visibility: the push may report success while the image
    // is not yet queryable (registry quiesce, credentials, proxy caching).
    // Without this, the tag must NOT be printed as deployable.
    if (!runVisible(remote)) {
      return { ok: false, step: "not-visible", remote };
    }
    pushed.push(remote);
  }
  return { ok: true, pushed };
}

/**
 * True when the remote image is queryable in the registry via buildx
 * imagetools inspect. Injectable for tests (which pass a mock) and for hosts
 * without buildx. Does NOT honor dry-run: the visibility check is real even
 * when the rest of the push was simulated.
 */
export function defaultInspectVisible(remoteRef) {
  if (typeof remoteRef !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]*\/bookmarkforge\/(?:web|api):[0-9a-f]{7,12}$/i.test(remoteRef)) return false;
  const result = spawnSync("docker", ["buildx", "imagetools", "inspect", remoteRef], {
    stdio: "ignore",
    timeout: 60_000,
  });
  return result.status === 0;
}
