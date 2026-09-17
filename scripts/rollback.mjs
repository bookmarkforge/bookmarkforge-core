#!/usr/bin/env node
/**
 * scripts/rollback.mjs — Rollback <1min sin pérdida de datos (imagen por SHA)
 *
 * Estrategia: IMAGEN PRIMERO. deploy-prod.mjs construye y etiqueta las
 * imágenes por SHA (bookmarkforge/web:<sha>, bookmarkforge/api:<sha>) y crea
 * el tag prod-YYYYMMDD-HHMM-<sha>. El rollback preferente NO reconstruye:
 * hace `docker compose up -d` con IMAGE_TAG=<sha> (sin --build) → segundos.
 * Solo si la imagen <sha> no existe localmente cae al rebuild desde el
 * código del tag (fallback de seguridad).
 *
 * Uso:
 *   node scripts/rollback.mjs --prev-tag prod-20250826-a1b2c3d
 *   node scripts/rollback.mjs --list
 *   node scripts/rollback.mjs --auto  (revierte al último tag bueno)
 *
 * BookmarkForge es local-first (IndexedDB/RxDB). El rollback NUNCA borra
 * datos del cliente. Solo revierte contenedores web/api y bundle.
 *
 * Pre-requisitos:
 *   - Cada deploy crea tag: prod-YYYYMMDD-HHMM-<shortsha>
 *   - Imágenes Docker taggeadas: bookmarkforge/web:<sha> y bookmarkforge/api:<sha>
 *
 * Registro remoto (opcional): si deploy-prod.mjs corrió con --push-images,
 * las imágenes por SHA están disponibles en DOCKER_REGISTRY. PRIMING
 * AUTOMÁTICO: cuando la imagen local falta pero el registro la tiene, el
 * propio rollback hace `docker pull` + `docker tag` por SHA y la usa sin
 * rebuild — NO hay que primar el nodo previamente (pull-prod-images.mjs es
 * solo para pre-calentar opcionalmente). El rollback imagen-por-SHA funciona
 * desde cualquier nodo del clúster (no solo el que construyó).
 *   DOCKER_REGISTRY  registro destino (ej: registry.example.com:5000)
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

/** run() que no lanza: devuelve true/false según el exit code. */
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

// URL base para el smoke post-rollback: honra PROD_BASE_URL (igual que
// deploy-prod.mjs y monitoring-alerts.mjs). Default = prod local 8080.
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

// ── Lógica pura (extraída para test unitario sin git/docker) ──────────

/**
 * Extrae el sha (último segmento) de un tag prod-*. Devuelve "" si el tag
 * no termina en un sha de 7-12 hex — en ese caso el rollback cae a rebuild.
 */
export function extractSha(tag) {
  if (typeof tag !== "string" || !tag.startsWith("prod-")) return "";
  const sha = tag.split("-").pop() ?? "";
  return /^[0-9a-f]{7,12}$/i.test(sha) ? sha : "";
}

/**
 * Selecciona el objetivo de --auto: el tag del penúltimo BUILD prod-*
 * distinto (último bueno). `tags` ya debe venir ordenado por creatordate
 * desc (como `git tag --sort=-creatordate`).
 *
 * Dedupe por sha: cada deploy crea prod-YYYYMMDD-HHMM-<shortsha>, y un
 * re-despliegue del mismo commit crea OTRO tag con el MISMO sha (caso real:
 * 2 tags sobre bb21664 degradaban --auto a un rollback no-op — se "revertía"
 * a la misma imagen por SHA). Se conserva la primera aparición de cada sha
 * (la más reciente por creatordate); tags sin sha embebido válido se tratan
 * como build distinto por nombre (su ruteo de imagen cae a rebuild igual).
 *
 * Devuelve null si hay menos de 2 tags prod-* O menos de 2 builds distintos
 * (en ambos casos un rollback automático no tiene destino útil).
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
  return distinct[1]; // penúltimo build DISTINTO del actual
}

/**
 * Rutas del rollback por la presencia local de las imágenes por SHA:
 *
 *   - CAMINO A (imagen por SHA, sin build): `bookmarkforge/web:<sha>` existe
 *     localmente y `bookmarkforge/api:<sha>` existe o se puede obtener desde
 *     DOCKER_REGISTRY → `route = "image"`.
 *   - CAMINO B (rebuild desde el tag): no existe web:<sha>, o falta api:<sha>
 *     sin registro disponible → `route = "rebuild"`.
 *
 * Un sha vacío/inválido SIEMPRE cae a rebuild (rollback.mjs ya imprime
 * "sin sha válida → rebuild").
 *
 * `imageList` son las líneas `repo:tag` de `docker images --format
 * "{{.Repository}}:{{.Tag}}"`. Devuelve { route } para que los llamadores
 * puedan medir/actuar por separado.
 */
export function decideImagePath(sha, imageList) {
  // Un sha vacío o malformado SIEMPRE cae a rebuild (coherente con
  // extractSha): no se intenta arrancar una imagen con etiqueta inválida.
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
 * Decide si conviene intentar `docker pull` desde el registro remoto para
 * completar el CAMINO A. `web:<sha>` es el gate principal: nunca se intenta
 * reconstruir si web existe; solo se obtiene api:<sha> desde el registro cuando
 * api falta localmente. Devuelve { shouldPull, missing }.
 *
 * Sin web local, no se hace pull ni rebuild parcial: el camino imagen requiere
 * que web ya esté disponible localmente. Sin sha válido o sin registro no se
 * intenta pull.
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

/** Ejecuta el flujo solo cuando se invoca directo (no al ser importado). */
// El flujo principal solo corre cuando se ejecuta directamente (import.meta.url
// === script real), no cuando el test importa la lógica pura. pathToFileURL
// normaliza el argv[1] del SO (incl. separadores \ de Windows) a una file://
// URL canónica comparable con import.meta.url.
import { pathToFileURL } from "node:url";

const isMain =
  typeof process.argv[1] === "string" &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {

if (args.includes("--help") || args.includes("-h")) {
  console.log(`
Rollback BookmarkForge — <1min (imagen por SHA, fallback a rebuild)

  --list              Lista últimos 5 tags prod-*
  --prev-tag <tag>    Revierte a tag específico (ej: prod-20250826-a1b2c3d)
  --auto              Revierte al penúltimo tag (último bueno)
  --verify            Solo verifica health (no revierte)
  --help              Esta ayuda

Estrategia: usa la imagen bookmarkforge/web:<sha> ya taggeada por
deploy-prod.mjs (up -d SIN --build, <1min). Priming AUTOMÁTICO: si la
imagen no está local y DOCKER_REGISTRY está definido (deploy-prod
--push-images la subió), se hace docker pull + tag por SHA en este nodo y
se continúa con la imagen — NO hace falta primar el nodo antes. Solo si no
hay registro o el pull falla cae al checkout del tag + rebuild (fallback).
Requiere DOCKER_REGISTRY (ej: registry.example.com:5000).

Ejemplos:
  node scripts/rollback.mjs --list
  node scripts/rollback.mjs --prev-tag prod-20250826-a1b2c3d
  node scripts/rollback.mjs --auto
`);
  process.exit(0);
}

if (args.includes("--list")) {
  try {
    const tags = runCapture("git tag --sort=-creatordate").split("\n").slice(0, 20).join("\n");
    console.log(tags || "(sin tags prod-*)");
    try {
      const imagesRaw = runCapture("docker images bookmarkforge/web --format \"{{.Repository}}:{{.Tag}} {{.CreatedSince}}\"");
      console.log("\nDocker images:\n" + imagesRaw.split("\n").slice(0, 20).join("\n"));
    } catch {
      console.log("\nDocker images: (docker no disponible localmente — OK en dev Windows)");
    }
  } catch (e) {
    console.error("No se pudieron listar tags:", e.message);
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
    console.error("\n[rollback] VERIFY FAIL — health check no pasó");
    process.exit(1);
  }
  console.log("\n[rollback] VERIFY OK — el smoke de producción pasó (todos los checks)");
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
        console.error("[rollback] No hay suficientes tags prod-* para auto. Usa --prev-tag");
      } else {
        // Todos los tags apuntan al mismo build: revertir a tags[1] sería un
        // no-op (misma imagen por SHA). Exigir destino explícito.
        console.error(
          `[rollback] Los ${tags.length} tags prod-* apuntan todos al mismo build (${extractSha(tags[0]) || "sin sha embebido"}). Usa --prev-tag <tag> para forzar otro destino.`,
        );
      }
      process.exit(1);
    }
    console.log(`[rollback] Auto: revirtiendo a ${targetTag} (actual es ${tags[0]})`);
  } catch (e) {
    console.error("[rollback] --auto falló:", e.message);
    process.exit(1);
  }
}

if (!targetTag) {
  console.error("[rollback] Debes pasar --prev-tag <tag> o --auto. Usa --help");
  process.exit(1);
}

// VALIDACIÓN PREVIA: Verificar que el tag existe y tiene estructura mínima
try {
  if (!validateRollbackTargetTag(targetTag)) {
    console.error(`[rollback] Invalid target tag format: ${targetTag}`);
    process.exit(1);
  }
  const tagCheck = spawnSync("git", ["cat-file", "-t", `refs/tags/${targetTag}`], { encoding: "utf8" });
  if (tagCheck.status !== 0) throw new Error(tagCheck.stderr?.trim() || "tag lookup failed");
  const tagType = tagCheck.stdout.trim();
  if (tagType !== "tag") {
    console.error(`[rollback] El tag ${targetTag} no existe o no es un tag válido`);
    process.exit(1);
  }
  // Verificar que tiene al menos un archivo (evita tags vacíos/corruptos)
  // Cross-platform: count lines in JS instead of piping to `wc` (missing under
  // cmd.exe on Windows dev boxes).
  const filesInTagResult = spawnSync("git", ["ls-tree", "-r", `refs/tags/${targetTag}`, "--name-only"], {
    encoding: "utf8",
  });
  if (filesInTagResult.status !== 0) throw new Error(filesInTagResult.stderr?.trim() || "tag tree lookup failed");
  const filesInTag = filesInTagResult.stdout.trim().split("\n").filter(Boolean).length;
  if (filesInTag < 5) {
    console.error(`[rollback] El tag ${targetTag} parece vacío o corrupto (pocos archivos)`);
    process.exit(1);
  }
  console.log(`[rollback] Tag ${targetTag} validado exitosamente`);
} catch (e) {
  console.error(`[rollback] Error validando tag ${targetTag}: ${e.message}`);
  process.exit(1);
}

// ── Estrategia: IMAGEN PRIMERO ─────────────────────────────────────────
// deploy-prod.mjs etiqueta las imágenes por SHA y docker-compose.prod.yml
// declara imágenes parametrizadas por IMAGE_TAG. El rollback
// preferente arranca la imagen YA construida (up -d sin --build → segundos);
// solo si la imagen <sha> no existe localmente cae al rebuild desde el tag.

const sha = extractSha(targetTag);
const shaLooksValid = Boolean(sha); // extractSha ya aplica el regex
// Compose objetivo: prod por defecto; DEPLOY_COMPOSE_FILE para drills en staging.
const COMPOSE_FILE = process.env.DEPLOY_COMPOSE_FILE?.trim() || "docker-compose.prod.yml";
const envFileArg = existsSync(".env.production") ? "--env-file .env.production" : "";
const composeBase = `docker compose -f ${COMPOSE_FILE} ${envFileArg}`.trim();

// Registro remoto (opcional): deploy-prod.mjs --push-images sube las imágenes
// por SHA a este registro. Si la imagen local no existe pero el registro
// sí, CAMINO A puede hacer `docker pull` y usarla sin rebuild — permitiendo
// el rollback imagen-por-SHA desde CUALQUIER nodo del clúster (no solo el
// que construyó). Mismo env que deploy-prod.mjs; sin la var, el rollback
// solo usa imágenes locales (comportamiento original).
const REGISTRY = (process.env.DOCKER_REGISTRY ?? "").trim().replace(/\/+$/, "");
if (REGISTRY && !validateRegistry(REGISTRY)) {
  console.error("[rollback] DOCKER_REGISTRY contiene un host inválido");
  process.exit(1);
}

console.log(`\n[rollback] INICIANDO ROLLBACK A ${targetTag} — cronómetro 1:00`);
console.log(
  `[rollback] Imagen objetivo: bookmarkforge/web:${shaLooksValid ? sha : "(sin sha válida → rebuild)"}\n`,
);

const t0 = Date.now();
try {
  // ── CAMINO A: imagen por SHA (sin build, <1 min) ─────────────────────
  let imagePathOk = false;
  if (shaLooksValid) {
    // Pre-check local: web:<sha> es el gate obligatorio. Si web no existe,
    // no intentamos up -d ni hacemos rebuild parcial. api:<sha> puede primarse
    // automáticamente desde DOCKER_REGISTRY cuando falte localmente.
    let hasWeb = false;
    let hasApi = false;
    let images = [];
    try {
      images = runCapture(`docker images --format "{{.Repository}}:{{.Tag}}"`).split("\n");
      hasWeb = images.includes(`bookmarkforge/web:${sha}`);
      hasApi = images.includes(`bookmarkforge/api:${sha}`);
    } catch {
      console.log("[rollback] docker no disponible — el fallback lo confirmará");
    }
    // La imagen local falta pero el registro remoto puede tenerla: pull +
    // retag por SHA permite el rollback imagen-por-SHA desde cualquier nodo
    // del clúster (deploy-prod --push-images la subió). Sin sha válido o sin
    // registro, shouldPullFromRegistry devuelve shouldPull=false → rebuild.
    const pullDecision = shouldPullFromRegistry(sha, images, REGISTRY);
    if (pullDecision.shouldPull) {
      console.log(`[rollback] Verificando disponibilidad remota antes del pull (${REGISTRY})`);
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
          console.error(`[rollback] imagen no publicada en el registro: ${remote}`);
          break;
        }
      }
      if (!remotePublished) {
        console.error(`[rollback] SHA ${sha} no está publicado en ${REGISTRY} — abortando CAMINO A antes del pull`);
      }
      if (remotePublished) {
      console.log(`[rollback] Imagen no local — intentando pull de ${REGISTRY}`);
      let pulled = true;
      for (const name of pullDecision.missing) {
        const remote = `${REGISTRY}/bookmarkforge/${name}:${sha}`;
        const local = `bookmarkforge/${name}:${sha}`;
        const pullOk = runOk(["docker", "pull", remote], { timeout: 120_000 });
        if (!pullOk) {
          pulled = false;
          console.warn(`[rollback] pull de ${remote} falló — no hay imagen en el registro para este sha`);
          break;
        }
        if (run(["docker", "tag", remote, local], { timeout: 30_000 }) !== 0) {
          pulled = false;
          console.warn(`[rollback] tag local de ${remote} falló`);
          break;
        }
      }
      if (remotePublished && pulled) {
        hasWeb = true;
        hasApi = true;
        console.log(`[rollback] imágenes obtenidas del registro (${sha}) — continuando CAMINO A`);
      }
      }
    }
    if (hasWeb && hasApi) {
      // Tiempo real medido del camino imagen-por-SHA: el drill de rollback
      // lo parsea y lo gatea (< 60s) — ver scripts/drill-rollback.mjs.
      const caminoAStart = Date.now();
      console.log(`[T+0:00] ${composeBase} up -d web api  (IMAGE_TAG=${sha}, SIN build)`);
      imagePathOk = runOk(`${composeBase} up -d web api`, {
        env: { ...process.env, IMAGE_TAG: sha },
        timeout: 90_000,
      });
      if (imagePathOk) {
        // Sanity: web y api deben quedar Up. La imagen puede existir pero
        // estar corrupta/crash-looping; en ese caso caemos al rebuild.
        // POLLING (no check único): `compose ps` inmediatamente después de
        // `up -d` puede mostrar el api aún "starting"/no-Up, lo que dispara
        // un fallback innecesario al rebuild (que además hace checkout del
        // tag viejo y puede revivir bugs ya corregidos). Esperamos hasta
        // 30s antes de declarar que la imagen es inútil.
        try {
          let webUp = false;
          let apiUp = false;
          for (let attempt = 1; attempt <= 15; attempt++) {
            const ps = runCapture(`${composeBase} ps --format "{{.Service}}:{{.Status}}"`);
            const lines = ps.split("\n");
            webUp = lines.some((l) => l.startsWith("web:") && /Up/i.test(l));
            apiUp = lines.some((l) => l.startsWith("api:") && /Up/i.test(l));
            if (webUp && apiUp) break;
            if (attempt % 5 === 0) console.log(`[rollback] esperando web/api Up (intento ${attempt}/15)...`);
            await new Promise((r) => setTimeout(r, 2000));
          }
          const ps = runCapture(`${composeBase} ps --format "{{.Service}}:{{.Status}}"`);
          console.log("[rollback] Contenedores:\n" + ps);
          if (!webUp || !apiUp) {
            console.warn("[rollback] web/api no quedaron Up tras 30s — cayendo a rebuild");
            imagePathOk = false;
          } else {
            const caminoASeconds = ((Date.now() - caminoAStart) / 1000).toFixed(1);
            console.log(
              `[rollback] CAMINO A confirmado: imagen por SHA, sin rebuild ✓ (up -d + sanity en ${caminoASeconds}s)`,
            );
          }
        } catch (e) {
          console.warn("[rollback] No se pudo verificar docker ps:", e.message);
        }
      } else {
        console.log("[rollback] up -d falló — cayendo a rebuild");
      }
    } else {
      // Solo se llega aquí si shouldPullFromRegistry no intentó pull: o no hay
      // DOCKER_REGISTRY definido (nodo aislado) o el pull/tag fracasó (el
      // registro no tiene este sha). El priming automático ya se intentó.
      if (!REGISTRY) {
        console.log(
          `[rollback] Imagen bookmarkforge/web:${sha} no está local — es el gate obligatorio ` +
            "y no hay DOCKER_REGISTRY para completar el rollback por imagen; cayendo a rebuild",
        );
      } else {
        console.log(
          `[rollback] web:${sha} no está local; no se puede completar el camino imagen ` +
            `(DOCKER_REGISTRY=${REGISTRY} solo puede primar api cuando web ya existe) — cayendo a rebuild`,
        );
      }
    }
  }

  // ── CAMINO B (fallback): checkout del tag + rebuild ──────────────────
  if (!imagePathOk) {
    console.log("\n[rollback] CAMINO B — checkout del tag + rebuild (fallback)");
    // Stash any uncommitted changes so checkout doesn't fail
    try {
      run("git stash push -m rollback-auto-stash");
    } catch { /* INTENTIONAL SILENCE: stashing is best-effort; the tag checkout path still proceeds below. */ }

    console.log(`[T+0:05] git checkout ${targetTag}`);
    run(`git checkout ${targetTag}`);

    console.log(`[T+0:10] ${composeBase} up -d --build web api (IMAGE_TAG=${sha || "(rebuild desde tag)"})`);
    try {
      run(`${composeBase} up -d --build web api`, {
        env: { ...process.env, IMAGE_TAG: sha },
        timeout: 180_000,
      });
    } catch {
      console.log("[rollback] build falló, intentando up sin build con la imagen existente...");
      run(`${composeBase} up -d web api`, { env: { ...process.env, IMAGE_TAG: sha } });
    }
  } else {
    // Sincronizar el working tree con el tag desplegado (housekeeping).
    // No bloquea el rollback: el servicio ya corre la imagen correcta. Un
    // tree sucio (hotfix en curso) NO debe destruir trabajo no commiteado.
    try {
      console.log(`[T+0:05] git checkout ${targetTag} (sincronizar tree)`);
      run(`git checkout ${targetTag}`);
    } catch (e) {
      console.warn(`[rollback] No se pudo hacer checkout a ${targetTag} (¿tree sucio?): ${e.message}`);
      console.warn("[rollback] El servicio ya corre la imagen correcta; el tree queda como estaba.");
    }
  }

  // T+0:15 — health checks
  console.log("[T+0:15] Health checks...");
  await new Promise((r) => setTimeout(r, 3000));
  try {
    run("docker ps --format \"{{.Names}} {{.Status}}\"");
  } catch { /* INTENTIONAL SILENCE: the container listing is a diagnostic log line; rollback continues without it. */ }

  // Intento de smoke (contra PROD_BASE_URL — nunca hardcodear el puerto)
  console.log(`[T+0:25] production-smoke contra ${PROD_BASE_URL}...`);
  const smoke = spawnSync(process.execPath, ["scripts/production-smoke.mjs"], {
    stdio: "inherit",
    env: SMOKE_ENV,
    timeout: 120_000,
  });
  if (smoke.status !== 0) {
    console.log("[rollback] smoke FAIL — regenerando nginx.conf y reintentando");
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
        console.error("[rollback] SMOKE SIGUE FALLANDO — escalar manualmente");
        process.exit(1);
      }
    } catch (e) {
      console.error("[rollback] Reintento falló:", e.message);
      process.exit(1);
    }
  }

  // T+0:40 — verificar SW
  console.log("[T+0:40] Verificando SW...");
  try {
    const sw = await fetch(`${PROD_BASE_URL}/sw.js`).then((r) => r.text()).then((t) => t.slice(0, 200));
    console.log(sw);
  } catch { /* INTENTIONAL SILENCE: SW fetch is a diagnostic step; a non-200/timeout must not fail the rollback. */ }

  // T+0:45 — validar datos (no borrar IndexedDB jamás)
  console.log("[T+0:45] Validando RxDB / datos locales — NUNCA borrar volumen");
  console.log("  RxDB es local-first: el rollback NO toca IndexedDB del cliente.");
  console.log("  Si la migración rompió, el schema viejo ya está en este tag.");

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n[rollback] ROLLBACK OK en ${elapsed}s — verifica https://tu-dominio.com`);
  console.log(`[rollback] Tag: ${targetTag} — imagen bookmarkforge/web:${shaLooksValid ? sha : "(rebuild desde tag)"}`);
  console.log(`[rollback] Siguiente: monitoriza con 'node scripts/production-smoke.mjs' cada 60s`);
} catch (e) {
  console.error(`[rollback] FATAL: ${e.message}`);
  process.exit(1);
}

} // fin if (isMain)
