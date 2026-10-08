#!/usr/bin/env node
/**
 * scripts/test-push-images.mjs — CI test for --push-images against a local
 * Docker registry (registry:2).
 *
 * Validates the three things the hardening checklist requires about pushing
 * images by SHA, WITHOUT touching a real registry:
 *
 *   1. Fail-closed error message without DOCKER_REGISTRY — resolveRegistry
 *      with push + without dry-run must return { ok:false, reason:"missing" },
 *      and deploy-prod.mjs must abort with "requires DOCKER_REGISTRY".
 *   2. Real retag — `docker tag bookmarkforge/web:<sha> <reg>/...:<sha>`.
 *   3. Real push + verification — `docker push` the images to a disposable
 *      `registry:2` and `docker manifest inspect`/`pull` back to confirm the
 *      sha exists remotely and is reachable (what enables image-by-SHA
 *      rollback from any node in the cluster).
 *
 * Also verifies the --dry-run path: commands are printed but NOT executed
 * (run returns 0), covering the effect-free simulation.
 *
 * The SAME function (push-images-lib.mjs) runs in deploy-prod.mjs Phase G —
 * this test exercises it for real against registry:2.
 *
 * Usage:
 *   node scripts/test-push-images.mjs [--json] [--registry 127.0.0.1:5000] [--sha <7-12hex>]
 *
 * Exit: 0 = PASS, 1 = FAIL. --json prints a JSON summary at the end.
 */

import { execSync, spawnSync } from "node:child_process";
import {
  resolveRegistry,
  planPushTargets,
  pushImages,
} from "./push-images-lib.mjs";

// ── helpers ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const JSON_OUT = args.includes("--json");
const registryIdx = args.indexOf("--registry");
const REGISTRY = registryIdx !== -1 ? args[registryIdx + 1] : "127.0.0.1:5001";
const shaIdx = args.indexOf("--sha");
const SHA =
  shaIdx !== -1 ? args[shaIdx + 1] : `c0ffee${String(Date.now()).slice(-5)}`;

const checks = []; // { name, ok, detail }
function check(name, ok, detail = "") {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}
function fatal(msg) {
  const e = new Error(msg);
  e.isFatal = true;
  throw e;
}
function recordFatal(msg) {
  check("(fatal)", false, msg);
}

function runOk(cmd, opts = {}) {
  console.log(`$ ${cmd}`);
  try {
    execSync(cmd, { stdio: "inherit", ...opts });
    return true;
  } catch {
    return false;
  }
}
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── flow ──────────────────────────────────────────────────────────────────
async function main() {
  const started = Date.now();
  let containerName = null;

  try {
    console.log(`\n🧪 Push-images CI test — local registry ${REGISTRY}, sha ${SHA}\n`);

    // ── Check 1: fail-closed without DOCKER_REGISTRY ─────────────────────
    console.log("[1/5] Error message without DOCKER_REGISTRY (fail-closed)");
    const missing = resolveRegistry("", { push: true, dryRun: false });
    const bad = resolveRegistry("http://inválido", { push: true, dryRun: false });
    const dryRunSim = resolveRegistry("", { push: true, dryRun: true });
    check(
      "fail-closed without registry returns { ok:false, reason:'missing' }",
      missing.ok === false && missing.reason === "missing",
      JSON.stringify(missing),
    );
    check(
      "invalid format → reason:'invalid'",
      bad.ok === false && bad.reason === "invalid",
      JSON.stringify(bad),
    );
    check(
      "--dry-run without registry simulates registry.example.com (does not fail)",
      dryRunSim.ok === true && dryRunSim.simulated === true && dryRunSim.registry === "registry.example.com",
      JSON.stringify(dryRunSim),
    );

    // Integrated check: real spawn of deploy-prod demanding the message.
    console.log("\n   Spawning deploy-prod.mjs --push-images without DOCKER_REGISTRY (fail-closed)...");
    const p = spawnSync(process.execPath, [
      "scripts/deploy-prod.mjs",
      "--push-images",
      "--skip-checklist",
      "--no-tag",
      "--allow-dirty",
    ], { env: { ...process.env, DOCKER_REGISTRY: "" }, encoding: "utf8", timeout: 60_000 });
    const msg = (p.stderr || "") + "\n" + (p.stdout || "");
    check(
      "deploy-prod aborts (exit 1) demanding DOCKER_REGISTRY",
      p.status !== 0 && /DOCKER_REGISTRY/i.test(msg),
      `exit=${p.status} · msg=${/DOCKER_REGISTRY/i.test(msg) ? "contains 'DOCKER_REGISTRY'" : "does NOT contain it"}`,
    );

    // ── Check 2: retag+push plan for web/api ──────────────────────────────
    console.log("\n[2/5] Retag+push plan (web+api per sha)");
    const plan = planPushTargets(SHA, REGISTRY);
    check(
      "plan generates web and api with the right remote",
      plan.length === 2 &&
        plan[0].local === `bookmarkforge/web:${SHA}` &&
        plan[0].remote === `${REGISTRY}/bookmarkforge/web:${SHA}` &&
        plan[1].remote === `${REGISTRY}/bookmarkforge/api:${SHA}`,
      JSON.stringify(plan),
    );

    // ── Check 3: real retag+push against local registry:2 ────────────────
    console.log(`\n[3/5] REAL retag + push against registry:2 at ${REGISTRY}`);
    // Bring up the disposable local registry (pull registry:2; smaller size).
    if (!runOk(`docker pull registry:2`, { timeout: 180_000 })) {
      fatal("could not pull registry:2 (docker daemon down or no network?)");
      return;
    }
    containerName = `bmf-test-registry-${Date.now()}`;
    const hostPort = REGISTRY.split(":").pop();
    if (!/^[0-9]+$/.test(hostPort) || Number(hostPort) < 1 || Number(hostPort) > 65535) {
      fatal(`test registry must use a valid port: ${REGISTRY}`);
      return;
    }
    if (!runOk(`docker run -d --rm --name ${containerName} -p 127.0.0.1:${hostPort}:5000 registry:2`)) {
      fatal("could not start registry:2 (port 5000 in use or daemon down?)");
      return;
    }
    await sleep(1500);

    // Create real base images for the sha (from busybox, small).
    if (
      !runOk(`docker pull busybox:1.36`, { timeout: 180_000 }) ||
      !runOk(`docker tag busybox:1.36 bookmarkforge/web:${SHA}`) ||
      !runOk(`docker tag busybox:1.36 bookmarkforge/api:${SHA}`)
    ) {
      fatal("could not prepare the sha base images");
      return;
    }

    // Retag + push with the SAME function deploy-prod.mjs Phase G uses.
    const pushRes = pushImages({ sha: SHA, registry: REGISTRY, run: (cmd, o) => (runOk(cmd, o) ? 0 : 1) });
    check(
      "pushImages retags + pushes web and api (exit 0)",
      pushRes.ok === true && pushRes.pushed.length === 2,
      pushRes.ok ? `pushed: ${pushRes.pushed.join(", ")}` : `fail ${pushRes.step} at ${pushRes.remote}`,
    );

    // ── Check 4: verify the sha exists in the registry ────────────────────
    console.log("\n[4/5] Remote verification (manifest inspect + pull back)");
    const inspect = (name, tag) =>
      runOk(`docker pull ${REGISTRY}/bookmarkforge/${name}:${tag}`, {
        timeout: 60_000,
      });
    const webRemote = inspect("web", SHA);
    const apiRemote = inspect("api", SHA);
    check(
      "web:<sha> inspectable in the local registry",
      webRemote,
      webRemote ? `manifest_OK ${REGISTRY}/bookmarkforge/web:${SHA}` : "manifest NOT available",
    );
    check(
      "api:<sha> inspectable in the local registry",
      apiRemote,
      apiRemote ? `manifest_OK ${REGISTRY}/bookmarkforge/api:${SHA}` : "manifest NOT available",
    );

    // Pull back (to a test tag) to confirm the round-trip.
    const round = runOk(`docker pull ${REGISTRY}/bookmarkforge/web:${SHA}`, { timeout: 120_000 });
    check(
      "pulling back confirms the registry round-trip",
      round,
      round ? `docker pull ${REGISTRY}/bookmarkforge/web:${SHA} OK` : "pull failed",
    );

    // ── Check 5: not-visible gate with a nonexistent SHA ─────────────────
    console.log("\n[5/6] Visibility gate: nonexistent SHA (not-visible)");
    const missingSha = `${SHA.slice(0, 7)}dead`;
    const missingVisibility = pushImages({
      sha: missingSha,
      registry: REGISTRY,
      images: ["web"],
      run: () => 0,
      runVisible: (remote) => {
        // The local registry does not hold this reference: simulate exactly
        // the result of `docker manifest inspect` with a non-zero exit.
        return !remote.endsWith(`:${missingSha}`);
      },
    });
    check(
      "nonexistent SHA blocks the push as not-visible",
      missingVisibility.ok === false && missingVisibility.step === "not-visible" && missingVisibility.remote.endsWith(`:${missingSha}`),
      JSON.stringify(missingVisibility),
    );

    // ── Check 6: dry-run prints commands without executing ───────────────
    console.log("\n[6/6] --dry-run path (prints retag+push, no side effects)");
    let printed = 0;
    const dryRes = pushImages({
      sha: SHA,
      registry: REGISTRY,
      run: (cmd) => {
        console.log(`$ ${cmd}`); // prints
        printed++; // executes nothing real
        return 0;
      },
      runVisible: () => true, // dry-run: visibility is simulated (no side effects)
    });
    check(
      "pushImages with a dry run prints 4 commands and returns ok",
      dryRes.ok === true && printed === 4,
      `printed=${printed}`,
    );

    // ── Summary ───────────────────────────────────────────────────────────
    const ok = checks.every((c) => c.ok);
    const elapsed = ((Date.now() - started) / 1000).toFixed(1);
    if (JSON_OUT) {
      console.log(JSON.stringify({ ok, elapsed, checks, registry: REGISTRY, sha: SHA }, null, 2));
    }
    console.log(`\n${ok ? "✅" : "❌"} push-images test ${ok ? "PASS" : "FAIL"} in ${elapsed}s (${checks.filter((c) => c.ok).length}/${checks.length})`);
    process.exit(ok ? 0 : 1);
  } catch (e) {
    recordFatal(e.message);
    const ok = checks.every((c) => c.ok);
    console.log(
      `\n${ok ? "✅" : "❌"} push-images test ${ok ? "PASS" : "FAIL"} (${checks.filter((c) => c.ok).length}/${checks.length})`,
    );
    if (JSON_OUT) console.log(JSON.stringify({ ok, checks, error: e.message }, null, 2));
    process.exit(ok ? 0 : 1);
  } finally {
    if (containerName) {
      console.log(`\n[teardown] rm -f ${containerName}`);
      try {
        execSync(`docker rm -f ${containerName}`, { stdio: "ignore", timeout: 30_000 });
      } catch {
        // the container was already gone (--rm) or removed separately
      }
    }
  }
}

main();