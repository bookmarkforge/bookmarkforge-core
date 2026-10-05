#!/usr/bin/env node
/**
 * scripts/test-push-images.mjs — Prueba de CI de --push-images contra un
 * registro Docker local (registry:2).
 *
 * Valida las tres cosas que pide el checklist de blindeo sobre el push de
 * imágenes por SHA, SIN tocar un registro real:
 *
 *   1. Mensaje de error fail-closed sin DOCKER_REGISTRY — resolveRegistry
 *      con push + sin dry-run debe dar { ok:false, reason:"missing" }, y
 *      deploy-prod.mjs debe abortar con "requiere DOCKER_REGISTRY".
 *   2. Retag real — `docker tag bookmarkforge/web:<sha> <reg>/...:<sha>`.
 *   3. Push real + verificación — `docker push` las imágenes a un `registry:2`
 *      desechable y `docker manifest inspect`/`pull` de vuelta para confirmar
 *      que el sha existe remoto y es alcanzable (lo que habilita el rollback
 *      imagen-por-SHA desde cualquier nodo del clúster).
 *
 * También verifica la ruta --dry-run: los comandos se imprimen pero NO se
 * ejecutan (run devuelve 0), cubriendo la simulación sin efectos.
 *
 * La MISMA función (push-images-lib.mjs) es la que corre en deploy-prod.mjs
 * Fase G — este test la ejercita de verdad contra registry:2.
 *
 * Uso:
 *   node scripts/test-push-images.mjs [--json] [--registry 127.0.0.1:5000] [--sha <7-12hex>]
 *
 * Exit: 0 = PASS, 1 = FAIL. --json imprime resumen JSON al final.
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

// ── flujo ──────────────────────────────────────────────────────────────────
async function main() {
  const started = Date.now();
  let containerName = null;

  try {
    console.log(`\n🧪 Push-images CI test — registro local ${REGISTRY}, sha ${SHA}\n`);

    // ── Check 1: fail-closed sin DOCKER_REGISTRY ─────────────────────────
    console.log("[1/5] Mensaje de error sin DOCKER_REGISTRY (fail-closed)");
    const missing = resolveRegistry("", { push: true, dryRun: false });
    const bad = resolveRegistry("http://inválido", { push: true, dryRun: false });
    const dryRunSim = resolveRegistry("", { push: true, dryRun: true });
    check(
      "fail-closed sin registro devuelve { ok:false, reason:'missing' }",
      missing.ok === false && missing.reason === "missing",
      JSON.stringify(missing),
    );
    check(
      "formato inválido → reason:'invalid'",
      bad.ok === false && bad.reason === "invalid",
      JSON.stringify(bad),
    );
    check(
      "--dry-run sin registro simula registry.example.com (no falla)",
      dryRunSim.ok === true && dryRunSim.simulated === true && dryRunSim.registry === "registry.example.com",
      JSON.stringify(dryRunSim),
    );

    // Verificación integrada: spawn real de deploy-prod exigiendo el mensaje.
    console.log("\n   Spawning deploy-prod.mjs --push-images sin DOCKER_REGISTRY (fail-closed)...");
    const p = spawnSync(process.execPath, [
      "scripts/deploy-prod.mjs",
      "--push-images",
      "--skip-checklist",
      "--no-tag",
      "--allow-dirty",
    ], { env: { ...process.env, DOCKER_REGISTRY: "" }, encoding: "utf8", timeout: 60_000 });
    const msg = (p.stderr || "") + "\n" + (p.stdout || "");
    check(
      "deploy-prod aborta (exit 1) exigiendo DOCKER_REGISTRY",
      p.status !== 0 && /DOCKER_REGISTRY/i.test(msg),
      `exit=${p.status} · msg=${/DOCKER_REGISTRY/i.test(msg) ? "contiene 'DOCKER_REGISTRY'" : "NO contiene"}`,
    );

    // ── Check 2: plan de retag+push para web/api ──────────────────────────
    console.log("\n[2/5] Plan de retag+push (web+api por sha)");
    const plan = planPushTargets(SHA, REGISTRY);
    check(
      "plan genera web y api con remote correcto",
      plan.length === 2 &&
        plan[0].local === `bookmarkforge/web:${SHA}` &&
        plan[0].remote === `${REGISTRY}/bookmarkforge/web:${SHA}` &&
        plan[1].remote === `${REGISTRY}/bookmarkforge/api:${SHA}`,
      JSON.stringify(plan),
    );

    // ── Check 3: real retag+push contra registry:2 local ─────────────────
    console.log(`\n[3/5] Retag + push REAL contra registry:2 en ${REGISTRY}`);
    // Levanta el registry local desechable (pull de registry:2; menor tamaño).
    if (!runOk(`docker pull registry:2`, { timeout: 180_000 })) {
      fatal("no se pudo descargar registry:2 (¿daemon docker abajo o sin red?)");
      return;
    }
    containerName = `bmf-test-registry-${Date.now()}`;
    const hostPort = REGISTRY.split(":").pop();
    if (!/^[0-9]+$/.test(hostPort) || Number(hostPort) < 1 || Number(hostPort) > 65535) {
      fatal(`registro de prueba debe usar un puerto válido: ${REGISTRY}`);
      return;
    }
    if (!runOk(`docker run -d --rm --name ${containerName} -p 127.0.0.1:${hostPort}:5000 registry:2`)) {
      fatal("no se pudo levantar registry:2 (¿puerto 5000 en uso o daemon abajo?)");
      return;
    }
    await sleep(1500);

    // Crea imágenes base reales del sha (a partir de busybox, pequeñas).
    if (
      !runOk(`docker pull busybox:1.36`, { timeout: 180_000 }) ||
      !runOk(`docker tag busybox:1.36 bookmarkforge/web:${SHA}`) ||
      !runOk(`docker tag busybox:1.36 bookmarkforge/api:${SHA}`)
    ) {
      fatal("no se pudieron preparar las imágenes base del sha");
      return;
    }

    // Retag + push con la MISMA función que usa deploy-prod.mjs Fase G.
    const pushRes = pushImages({ sha: SHA, registry: REGISTRY, run: (cmd, o) => (runOk(cmd, o) ? 0 : 1) });
    check(
      "pushImages hace retag + push de web y api (exit 0)",
      pushRes.ok === true && pushRes.pushed.length === 2,
      pushRes.ok ? `pusheadas: ${pushRes.pushed.join(", ")}` : `fail ${pushRes.step} en ${pushRes.remote}`,
    );

    // ── Check 4: verificación de que el sha existe en el registro ─────────
    console.log("\n[4/5] Verificación remota (manifest inspect + pull de vuelta)");
    const inspect = (name, tag) =>
      runOk(`docker pull ${REGISTRY}/bookmarkforge/${name}:${tag}`, {
        timeout: 60_000,
      });
    const webRemote = inspect("web", SHA);
    const apiRemote = inspect("api", SHA);
    check(
      "web:<sha> inspeccionable en el registro local",
      webRemote,
      webRemote ? `manifest_OK ${REGISTRY}/bookmarkforge/web:${SHA}` : "manifest NO disponible",
    );
    check(
      "api:<sha> inspeccionable en el registro local",
      apiRemote,
      apiRemote ? `manifest_OK ${REGISTRY}/bookmarkforge/api:${SHA}` : "manifest NO disponible",
    );

    // Pull de vuelta (a un tag de prueba) para confirmar el round-trip.
    const round = runOk(`docker pull ${REGISTRY}/bookmarkforge/web:${SHA}`, { timeout: 120_000 });
    check(
      "pull de vuelta confirma round-trip del registro",
      round,
      round ? `docker pull ${REGISTRY}/bookmarkforge/web:${SHA} OK` : "pull falló",
    );

    // ── Check 5: gate not-visible con SHA inexistente ────────────────────
    console.log("\n[5/6] Gate de visibilidad: SHA inexistente (not-visible)");
    const missingSha = `${SHA.slice(0, 7)}dead`;
    const missingVisibility = pushImages({
      sha: missingSha,
      registry: REGISTRY,
      images: ["web"],
      run: () => 0,
      runVisible: (remote) => {
        // El registro local no contiene esta referencia: simula exactamente
        // el resultado de `docker manifest inspect` con exit no-cero.
        return !remote.endsWith(`:${missingSha}`);
      },
    });
    check(
      "SHA inexistente bloquea el push como not-visible",
      missingVisibility.ok === false && missingVisibility.step === "not-visible" && missingVisibility.remote.endsWith(`:${missingSha}`),
      JSON.stringify(missingVisibility),
    );

    // ── Check 6: dry-run imprime comandos sin ejecutar ───────────────────
    console.log("\n[6/6] Ruta --dry-run (imprime retag+push, sin efectos)");
    let printed = 0;
    const dryRes = pushImages({
      sha: SHA,
      registry: REGISTRY,
      run: (cmd) => {
        console.log(`$ ${cmd}`); // imprime
        printed++; // no ejecuta nada real
        return 0;
      },
      runVisible: () => true, // dry-run: la visibilidad se simula (sin side effects)
    });
    check(
      "pushImages con run dry imprime 4 comandos y devuelve ok",
      dryRes.ok === true && printed === 4,
      `imprimidos=${printed}`,
    );

    // ── Resumen ───────────────────────────────────────────────────────────
    const ok = checks.every((c) => c.ok);
    const elapsed = ((Date.now() - started) / 1000).toFixed(1);
    if (JSON_OUT) {
      console.log(JSON.stringify({ ok, elapsed, checks, registry: REGISTRY, sha: SHA }, null, 2));
    }
    console.log(`\n${ok ? "✅" : "❌"} push-images test ${ok ? "PASS" : "FAIL"} en ${elapsed}s (${checks.filter((c) => c.ok).length}/${checks.length})`);
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
        // el container ya no existía (--rm) o se eliminó aparte
      }
    }
  }
}

main();