#!/usr/bin/env node
/**
 * scripts/deploy-prod.mjs — Deploy a producción automatizado.
 *
 * Garantiza los requisitos del checklist de blindeo:
 *   1. Corre los gates (check-blindeo + prod-blindeo-checklist).
 *   2. Construye imágenes Docker etiquetadas por SHA:
 *        bookmarkforge/web:<sha>  y  bookmarkforge/api:<sha>
 *      (también actualiza :latest para ops manuales).
 *   3. Crea el tag git anotado  prod-YYYYMMDD-HHMM-<sha>  que
 *      scripts/rollback.mjs exige para revertir en <1min (imagen por SHA).
 *
 * Local-first: el rollback NUNCA toca IndexedDB del cliente; este
 * script tampoco toca datos, solo contenedores y bundle + tag git.
 *
 * Uso:
 *   node scripts/deploy-prod.mjs                  # gates + build + tag git
 *   node scripts/deploy-prod.mjs --deploy          # + docker compose up -d
 *   node scripts/deploy-prod.mjs --verify          # + production-smoke 12/12
 *   node scripts/deploy-prod.mjs --deploy --verify  # pipeline completo
 *   node scripts/deploy-prod.mjs --dry-run         # muestra sin ejecutar
 *   node scripts/deploy-prod.mjs --push-images     # docker push al registro remoto (requiere DOCKER_REGISTRY)
 *   node scripts/deploy-prod.mjs --push-tag        # git push origin <tag>
 *   node scripts/deploy-prod.mjs --allow-dirty     # permite working tree sucio
 *   node scripts/deploy-prod.mjs --skip-checklist  # omite el gate largo (build:ci+tests)
 *   node scripts/deploy-prod.mjs --no-docker        # solo tag git (sin imágenes)
 *   node scripts/deploy-prod.mjs --no-tag           # omite crear tag (CI/manual)
 *
 * Variables de entorno:
 *   PROD_BASE_URL   base URL para --verify (default http://127.0.0.1:8080)
 *   IMAGE_TAG       override del SHA (default: git rev-parse --short HEAD)
 *   DOCKER_REGISTRY registro destino para --push-images (ej: registry.example.com:5000).
 *                   Requerido: push al registro se hace de forma explícita y fail-closed.
 *   DEPLOY_COMPOSE_FILE compose a usar (default docker-compose.prod.yml).
 *                   Útil para drills en staging: DEPLOY_COMPOSE_FILE=docker-compose.staging.yml
 *
 * Salida:
 *   Imprime el tag creado y el comando exacto de rollback al final.
 */

import { execSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolveRegistry, pushImages, defaultInspectVisible } from "./push-images-lib.mjs";

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
  console.log(`deploy-prod — Deploy a producción con tag + imágenes por SHA

  --deploy          docker compose up -d (usa las imágenes recién construidas)
  --verify          production-smoke 12/12 al final
  --dry-run         muestra todos los comandos sin ejecutarlos
  --push-images     docker push <registro>/bookmarkforge/{web,api}:<sha>
                    (requiere DOCKER_REGISTRY; se ejecuta DESPUÉS de --verify)
  --push-tag        git push origin <tag> (NUNCA por defecto)
  --allow-dirty     permite working tree sucio (peligroso: tag != código)
  --skip-checklist  omite prod-blindeo-checklist (build:ci + test:fast)
  --no-docker       omite build/etiquetado de imágenes (solo tag git)
  --no-tag          omite la creación del tag git (CI/manual: el tag ya existe)
  --help            esta ayuda

Env:
  DOCKER_REGISTRY   registro para --push-images (ej: registry.example.com:5000)

Pipeline por defecto: gates → build imágenes → tag git.
Recomendado para go-live: --deploy --verify --push-images --push-tag`);
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

if (isMain && DRY_RUN) console.log("⚠️  --dry-run: no se ejecuta nada, solo se imprime.\n");

// ── helpers ────────────────────────────────────────────────────────────────
function capture(cmd) {
  if (DRY_RUN) {
    console.log(`$ ${cmd}`);
    return null; // dry-run: nada real; el caller debe proveer un fallback.
  }
  try {
    return execSync(cmd, { encoding: "utf8" }).trim();
  } catch (e) {
    throw new Error(`comando falló: ${cmd}\n${e.stderr || e.message}`);
  }
}

function run(cmd, opts = {}) {
  console.log(`$ ${cmd}`);
  if (DRY_RUN) return 0;
  try {
    execSync(cmd, { stdio: "inherit", ...opts });
    return 0;
  } catch (e) {
    return e.status ?? 1;
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

// Registro remoto para --push-images. Validación TEMPRANA (antes de correr
// los gates pesados): un error de configuración no debe hacer esperar
// build:ci + tests completos para fallar. Fail-closed: la bandera sin
// DOCKER_REGISTRY válido detiene el deploy. La semántica vive en
// push-images-lib.mjs (resolveRegistry) para poder probarla en CI contra un
// registrar local sin levantar todo el pipeline.
let REGISTRY = (process.env.DOCKER_REGISTRY ?? "").trim().replace(/\/+$/, "");
if (PUSH_IMAGES) {
  if (NO_DOCKER) fail("--push-images requiere imágenes locales; incompatible con --no-docker.");
  const r = resolveRegistry(REGISTRY, { push: true, dryRun: DRY_RUN });
  if (!r.ok) {
    fail(`--push-images requiere DOCKER_REGISTRY válido (ej: registry.example.com:5000).`);
  }
  REGISTRY = r.registry;
  if (r.simulated) log("--dry-run: DOCKER_REGISTRY no seteado — simulando con registry.example.com");
  log(`registro destino: ${REGISTRY}`);
}

// ── Fase A: Gates de blindeo ───────────────────────────────────────────────
console.log("\n🔒 FASE A — Gates de blindeo\n");

const stamp = localStamp();
log(`inicio deploy — timestamp local ${stamp}`);

if (runNode("scripts/check-blindeo.mjs") !== 0) {
  fail("check-blindeo.mjs FAIL — bloqueado (corrige antes de deploy).");
}
log("check-blindeo.mjs PASS (8 puntos estáticos)");

if (!SKIP_CHECKLIST) {
  log("corriendo prod-blindeo-checklist.mjs (build:ci + tests + gates completos)…");
  if (runNode("scripts/prod-blindeo-checklist.mjs", { timeout: 600_000 }) !== 0) {
    fail("prod-blindeo-checklist.mjs FAIL — usa --skip-checklist solo si ya pasaste hoy.");
  }
  log("prod-blindeo-checklist.mjs PASS");
} else {
  log("--skip-checklist: omitiendo gate largo (asumido verde hoy).");
}

// ── Fase B: Preflight (working tree, sha, docker, env) ─────────────────────
console.log("\n🔍 FASE B — Preflight\n");

// Working tree limpio: el tag debe apuntar al código exacto desplegado.
if (!ALLOW_DIRTY) {
  const dirty = capture("git status --porcelain");
  if (dirty === null) {
    log("--dry-run: working tree no verificado (simulado limpio)");
  } else if (dirty) {
    fail(`working tree sucio — el tag NO reflejaría el código desplegado.\n  ${dirty.split("\n").slice(0, 5).join("\n  ")}\n  Comitea o usa --allow-dirty (bajo tu responsabilidad).`);
  } else {
    log("working tree limpio ✓");
  }
} else {
  log("⚠️  --allow-dirty: el tag puede no coincidir con el código desplegado.");
}

// SHA corto (7 chars, mismo formato que los tags existentes: 84c7fe5).
let sha;
try {
  const resolved = process.env.IMAGE_TAG || capture("git rev-parse --short HEAD");
  sha = calculateImageTag({ imageTag: process.env.IMAGE_TAG, gitSha: resolved, dryRun: DRY_RUN });
  if (sha === "deadbeef") log("--dry-run: usando SHA simulado deadbeef");
} catch (e) {
  fail(`no se pudo obtener el SHA: ${e.message}`);
}
if (!sha) {
  fail(`SHA inválido: "${sha}". Esperaba 7-12 hex chars (o setea IMAGE_TAG).`);
}
log(`SHA del deploy: ${sha}`);

const tagName = `prod-${stamp}-${sha}`;
log(`tag git objetivo: ${tagName}`);

// Colisión de tag: mismo minuto + mismo SHA = ya desplegado.
try {
  execSync(`git cat-file -t ${tagName}`, { stdio: "ignore" });
  fail(`el tag ${tagName} ya existe — ya desplegaste este commit. ¿Quieres --deploy --verify sin re-tag?`);
} catch {
  // tag no existe: bien
}

// Docker disponible (no requerido con --no-docker).
let dockerOk = false;
if (!NO_DOCKER) {
  dockerOk = run(`docker version --format "{{.Server.Version}}"`) === 0 || DRY_RUN;
  if (!dockerOk) {
    fail("docker no disponible. Usa --no-docker para solo crear el tag git, o instala Docker.");
  }
  log("docker disponible ✓");
} else {
  log("--no-docker: se omite build/etiquetado de imágenes (solo tag git).");
}

// Compose objetivo: prod por defecto; sobreescribible para drills en staging.
const COMPOSE_FILE = process.env.DEPLOY_COMPOSE_FILE?.trim() || "docker-compose.prod.yml";
if (!existsSync(COMPOSE_FILE)) fail(`compose file no encontrado: ${COMPOSE_FILE}`);
log(`compose objetivo: ${COMPOSE_FILE}`);

// .env.production: compose lo necesita para los build args (VITE_*) y runtime.
const envFileArg = existsSync(".env.production") ? "--env-file .env.production" : "";
if (envFileArg) {
  log(".env.production presente ✓");
} else {
  log("⚠️  no .env.production — las vars VITE_*/GEMINI_* deben venir del entorno o .env");
}
const composeBase = `docker compose -f ${COMPOSE_FILE} ${envFileArg}`.trim();

// ── Fase C: Build de imágenes etiquetadas por SHA ──────────────────────────
if (!NO_DOCKER) {
  console.log("\n📦 FASE C — Build de imágenes Docker (tag <sha> + latest)\n");

  // compose build lee los build args de .env.production y etiqueta con IMAGE_TAG.
  const buildEnv = { ...process.env, IMAGE_TAG: sha };
  const rc = run(`${composeBase} build web api`, { env: buildEnv, timeout: 600_000 });
  if (rc !== 0) fail("docker compose build falló — revisa los build args / .env.production");

  // latest apunta al SHA recién construido (ops manuales y fallback).
  run(`docker tag bookmarkforge/web:${sha} bookmarkforge/web:latest`);
  run(`docker tag bookmarkforge/api:${sha} bookmarkforge/api:latest`);
  log(`imágenes: bookmarkforge/web:${sha}  +  bookmarkforge/api:${sha}  (+ :latest)`);
}

// ── Fase D: Tag git anotado ────────────────────────────────────────────────
console.log("\n🏷️  FASE D — Tag git anotado\n");

if (NO_TAG) {
  log("--no-tag: saltando creación del tag (el tag ya existe; CI/manual).");
} else {
  // Tag anotado: scripts/rollback.mjs valida `git cat-file -t <tag>` === "tag".
  const tagMsg = `Deploy prod ${stamp} — ${sha}`;
  run(`git tag -a ${tagName} -m "${tagMsg}"`);
  let tagType = "";
  try {
    tagType = capture(`git cat-file -t ${tagName}`) ?? "";
  } catch (e) {
    fail(`no se pudo verificar el tag recién creado ${tagName}: ${e.message}`);
  }
  if (!isAnnotatedTagType(tagType)) {
    fail(`tag ${tagName} no es anotado (git cat-file -t devolvió "${tagType || "(vacío)"}"). Rollback --auto bloqueado.`);
  }
  log(`tag creado y verificado como anotado ✓ (${tagName})`);
}

// ── Fase E (solo --deploy): docker compose up -d ───────────────────────────
if (DO_DEPLOY) {
  if (NO_DOCKER) fail("--deploy requiere imágenes; no se puede usar con --no-docker.");
  console.log("\n🚀 FASE E — Deploy (docker compose up -d)\n");

  // up -d sin --build: usa exactamente las imágenes recién etiquetadas con <sha>.
  // Determinista: lo que se construyó es lo que corre.
  const rc = run(`${composeBase} up -d web api`, { env: { ...process.env, IMAGE_TAG: sha }, timeout: 180_000 });
  if (rc !== 0) {
    log(`⚠️  up -d falló — no hice rollback automático. Revisa con: docker compose -f ${COMPOSE_FILE} ps`);
    fail("deploy falló en up -d.");
  }
  log("contenedores web + api arriba ✓");
} else {
  log("--deploy no seteado: imágenes construidas y tag creado, sin levantar contenedores.");
}

// ── Fase F (solo --verify): production-smoke 12/12 ──────────────────────────
if (DO_VERIFY) {
  if (NO_DOCKER) fail("--verify requiere contenedores corriendo; no se puede con --no-docker.");
  console.log("\n✅ FASE F — Verify (production-smoke 12/12)\n");

  const baseUrl = process.env.PROD_BASE_URL ?? "http://127.0.0.1:8080";
  log(`production-smoke contra ${baseUrl}…`);
  const rc = runNode("scripts/production-smoke.mjs", { env: { ...process.env, PROD_BASE_URL: baseUrl } });
  if (rc !== 0) {
    console.error("\n[deploy] ✗ VERIFY FAIL — production-smoke no pasó.");
    console.error("[deploy] Revierte YA:");
    console.error("  node scripts/rollback.mjs --auto");
    fail("verify falló — ejecuta rollback.");
  }
  log("production-smoke 12/12 PASS ✓");
}

// ── Fase G (solo --push-images): docker push al registro remoto ────────────
if (PUSH_IMAGES) {
  if (NO_DOCKER) fail("--push-images requiere imágenes locales; incompatible con --no-docker.");
  console.log("\n📤 FASE G — Push de imágenes al registro remoto\n");

  // Retag con prefijo del registro + push. Corre DESPUÉS de --verify: solo
  // sube al registro lo que pasó el smoke 12/12. Los refs remotos son
  // inmutables (<sha>), por lo que el rollback desde cualquier nodo del
  // clúster puede apuntar a esta imagen exacta. La mecánica (retag+push+
  // manifest-inspect) vive en push-images-lib.mjs (pushImages) — la misma
  // que prueba el test de CI contra un registry:2 local. Si el push no es
  // visible en el registro, FAIL antes de imprimir el tag: la imagen debe
  // estar consultable para que el rollback por imagen pueda usarla.
  // `runVisible` confirma que el push es consultable en el registro. En
  // --dry-run NO se ejecuta el manifest inspect real (escaparía al sandbox):
  // se simula visible, igual que `run` simula los comandos.
  const runVisible = (remote) => {
    if (DRY_RUN) {
      console.log(`$ docker buildx imagetools inspect ${remote} (simulado en dry-run)`);
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
      fail(`docker tag de ${res.remote} falló.`);
    } else if (res.step === "push") {
      fail(`docker push ${res.remote} falló — revisa credenciales/red del registro.`);
    } else if (res.step === "not-visible") {
      fail(
        `docker manifest inspect de ${res.remote} falló tras el push — la imagen NO es ` +
          "consultable en el registro. No se imprime el tag como desplegable.",
      );
    } else {
      fail(res.remote || "sha inválido para --push-images.");
    }
  }
  for (const remote of res.pushed) log(`${remote} pusheada ✓ (visible en el registro)`);
  log(`imágenes disponibles para el clúster (SHA inmutables, verificadas): ${REGISTRY}/bookmarkforge/web:${sha}`);
} else {
  log("--push-images no seteado: las imágenes quedan solo en esta máquina.");
}

// ── Fase H (solo --push-tag): git push origin <tag> ────────────────────────
if (PUSH_TAG) {
  if (NO_TAG) fail("--push-tag requiere que el tag se cree; incompatible con --no-tag.");
  console.log("\n⬆️  FASE H — Push tag al remoto\n");
  const rc = run(`git push origin ${tagName}`);
  if (rc !== 0) fail(`git push origin ${tagName} falló — el tag existe localmente pero no en el remoto.`);
  log(`tag ${tagName} pusheado ✓`);
} else {
  log("--push-tag no seteado: el tag es local. Para que el rollback funcione desde otra máquina, ejecuta: git push origin " + tagName);
}

// ── Resumen ────────────────────────────────────────────────────────────────
const elapsed = ((Date.now() - T0) / 1000).toFixed(1);
console.log("\n" + "=".repeat(60));
console.log(`✅ DEPLOY COMPLETO en ${elapsed}s`);
console.log(`   Tag:      ${tagName}`);
console.log(`   SHA:      ${sha}`);
if (!NO_DOCKER) {
  console.log(`   Imágenes: bookmarkforge/web:${sha}  bookmarkforge/api:${sha}`);
}
if (PUSH_IMAGES) {
  console.log(`   Registro: ${REGISTRY}/bookmarkforge/web:${sha}  ${REGISTRY}/bookmarkforge/api:${sha}`);
}
console.log("=".repeat(60));
console.log("\nComandos de seguimiento:");
console.log(`  Verificar ahora:  PROD_BASE_URL=${process.env.PROD_BASE_URL ?? "http://127.0.0.1:8080"} node scripts/production-smoke.mjs`);
console.log(`  Monitorear:       node scripts/monitoring-alerts.mjs --json`);
console.log(`  Rollback (<1min):  node scripts/rollback.mjs --auto`);
console.log(`  Listar tags:      node scripts/rollback.mjs --list`);
if (PUSH_IMAGES) {
  console.log("\nPreparar un nodo del clúster para rollback por imagen:");
  console.log(`  docker pull ${REGISTRY}/bookmarkforge/web:${sha} && docker tag ${REGISTRY}/bookmarkforge/web:${sha} bookmarkforge/web:${sha}`);
  console.log(`  docker pull ${REGISTRY}/bookmarkforge/api:${sha} && docker tag ${REGISTRY}/bookmarkforge/api:${sha} bookmarkforge/api:${sha}`);
  console.log("  (tras esto, rollback.mjs --auto usa la imagen local en <1min, sin rebuild)");
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
} // fin else (isMain) — cierre del bloque CLI
