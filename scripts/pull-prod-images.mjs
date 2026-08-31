#!/usr/bin/env node
/**
 * scripts/pull-prod-images.mjs — Priming de nodo para rollback <1min
 *
 * Estrategia: el rollback imagen-por-SHA (CAMINO A de rollback.mjs) solo
 * arranca en segundos si la imagen `bookmarkforge/{web,api}:<sha>` YA está
 * local. Este script de priming corre en CUALQUIER nodo del clúster (no solo
 * el que construyó) y deja el nodo listo: hace `docker pull` desde
 * DOCKER_REGISTRY de las imágenes por SHA de un tag prod-* y las re-taggea
 * al nombre local, preparando un rollback que cae en ~segundos.
 *
 * Uso:
 *   node scripts/pull-prod-images.mjs --tag prod-20250826-a1b2c3d
 *   node scripts/pull-prod-images.mjs --latest        # penúltimo tag prod-*
 *   node scripts/pull-prod-images.mjs --list          # tags + estado local de cada sha
 *   node scripts/pull-prod-images.mjs --check         # verifica priming sin pull
 *
 * Env:
 *   DOCKER_REGISTRY  registro remoto (requerido; ej: registry.example.com:5000);
 *                    si no se define → exit 1 fail-closed (nada que pullear).
 *   PROD_BASE_URL    no se usa aquí (el rollback hace el smoke); solo lectura.
 *
 * Fail-closed: sin tag válido, sin registro, o si el pull/tag de alguna imagen
 * falla → exit 1 con mensaje claro. NUNCA deja un estado semi-primado que
 * parezca listo: si algo falla, reporta qué imagen falta y falla el script.
 */

import { execSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { extractSha } from "./rollback.mjs";
import { validateRegistry } from "./registry-policy.mjs";
import { runCommandOk } from "./command-runner.mjs";
export { validateRegistry };

// ── Lógica pura (extraída para test unitario sin docker ni git) ────────

/**
 * Compone la lista de referencias remotas y locales a pull+tagear para un sha.
 * Devuelve [{ name, remote, local }] para web y api, o [] si el sha no es un
 * hash válido (7-12 hex). `registry` ya normalizado sin `/` final.
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
 * Decide si un nodo ya está primado para el sha: ambas imágenes locales
 * bookmarkforge/{web,api}:<sha> existen. `imageList` son las líneas repo:tag
 * de `docker images --format "{{.Repository}}:{{.Tag}}"` (devuelve [] si el
 * listado falló → no primado, algo hay que hacer).
 */
export function isPrimed(sha, imageList) {
  if (!sha || !/^[0-9a-f]{7,12}$/i.test(sha)) return false;
  const images = Array.isArray(imageList) ? imageList : [];
  return (
    images.includes(`bookmarkforge/web:${sha}`) &&
    images.includes(`bookmarkforge/api:${sha}`)
  );
}

// ── Ocurrencia principal ─────────────────────────────────────────────────

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

  const help = `\nPriming de nodo para rollback <1min (imagen por SHA)\n\n` +
    `  --tag <prod-*>    Prim el nodo con las imágenes del tag dado\n` +
    `  --latest          Prim el nodo con el penúltimo tag prod-* (último bueno)\n` +
    `  --list            Lista últimos 5 tags prod-* + estado local de su sha\n` +
    `  --check           Verifica el estado de priming del nodo (sin pull)\n` +
    `  --help            Esta ayuda\n\n` +
    `Requiere DOCKER_REGISTRY (el registro al que deploy-prod --push-images sube).\n` +
    `Deja el nodo con bookmarkforge/{web,api}:<sha> local → rollback en segundos.\n`;

  if (args.includes("--help") || args.includes("-h")) {
    console.log(help);
    process.exit(0);
  }

  if (REGISTRY && !validateRegistry(REGISTRY)) {
    console.error("[pull-prod-images] DOCKER_REGISTRY contiene un host inválido. Exit 1.");
    process.exit(1);
  }

  if (!REGISTRY) {
    console.error(
      "[pull-prod-images] DOCKER_REGISTRY no definido. " +
        "Necesitas el registro al que deploy-prod.mjs --push-images subió las " +
        "imágenes (ej: DOCKER_REGISTRY=registry.example.com:5000). Exit 1 (fail-closed).",
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
      if (tags.length === 0) console.log("(sin tags prod-*)");
      let images = [];
      try {
        images = runCapture(`docker images --format "{{.Repository}}:{{.Tag}}"`).split("\n");
      } catch {
        console.log("(docker no disponible localmente)");
      }
      for (const tag of tags) {
        const sha = extractSha(tag);
        const primed = isPrimed(sha, images) ? "PRIMADO" : "faltante";
        console.log(`  ${tag}  → ${sha ? `web/api:${sha} ${primed}` : "(sin sha válida)"}`);
      }
    } catch (e) {
      console.error("[pull-prod-images] No se pudieron listar tags:", e.message);
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
        console.error("[pull-prod-images] No hay suficientes tags prod-* para --latest. Usa --tag.");
        process.exit(1);
      }
      targetTag = tags[1]; // penúltimo (último bueno, igual que rollback --auto)
      console.log(`[pull-prod-images] --latest: objetivo ${targetTag} (actual ${tags[0]})`);
    } catch (e) {
      console.error("[pull-prod-images] --latest falló:", e.message);
      process.exit(1);
    }
  }

  if (!targetTag) {
    console.error("[pull-prod-images] Debes pasar --tag <prod-*> o --latest. Usa --help");
    process.exit(1);
  }

  const sha = extractSha(targetTag);
  if (!sha) {
    console.error(
      `[pull-prod-images] El tag ${targetTag} no termina en un sha válido (7-12 hex).` +
        " No hay imagen por SHA que primar. Exit 1 (fail-closed).",
    );
    process.exit(1);
  }

  // ----------------------------------------------------------------------
  // --check: estado de priming sin tocar el registro
  // ----------------------------------------------------------------------
  if (args.includes("--check")) {
    let images = [];
    try {
      images = runCapture(`docker images --format "{{.Repository}}:{{.Tag}}"`).split("\n");
    } catch {
      console.error("[pull-prod-images] docker no disponible — no puedo confirmar priming. Exit 1.");
      process.exit(1);
    }
    const primed = isPrimed(sha, images);
    const missing = ["web", "api"].filter((n) => !images.includes(`bookmarkforge/${n}:${sha}`));
    if (primed) {
      console.log(`[pull-prod-images] Nodo PRIMADO para ${targetTag} (web/api:${sha}) ✓`);
      process.exit(0);
    }
    console.error(
      `[pull-prod-images] Nodo NO primado para ${targetTag}: faltan ${missing.join(", ")}.` +
        " Corre este script sin --check (hace pull). Exit 1.",
    );
    process.exit(1);
  }

  // ----------------------------------------------------------------------
  // Priming: pull + tag de las imágenes por SHA del tag
  // ----------------------------------------------------------------------
  const targets = planPullTargets(sha, REGISTRY);
  console.log(
    `\n[pull-prod-images] PRIMANDO nodo para ${targetTag} (sha ${sha}) desde ${REGISTRY}`,
  );

  let dockerImages = [];
  try {
    dockerImages = runCapture(`docker images --format "{{.Repository}}:{{.Tag}}"`).split("\n");
  } catch {
    // docker no disponible → asumimos nada primado; el pull lo confirmará
  }

  const need = targets.filter((t) => !dockerImages.includes(t.local));
  if (need.length === 0) {
    console.log("[pull-prod-images] Ya primado — ambas imágenes locales (nada que hacer) ✓");
    process.exit(0);
  }

  let primed = true;
  for (const t of need) {
    if (!runOk(["docker", "pull", t.remote], { timeout: 180_000 })) {
      console.warn(`[pull-prod-images] pull de ${t.remote} falló (¿no existe en el registro?)`);
      primed = false;
      break;
    }
    if (!runOk(["docker", "tag", t.remote, t.local])) {
      console.warn(`[pull-prod-images] tag local de ${t.remote} falló`);
      primed = false;
      break;
    }
  }

  if (!primed) {
    console.error(
      `[pull-prod-images] FAIL — el nodo NO quedó primado para ${sha}.` +
        " No intentes rollback con este sha o caerá a rebuild. Exit 1.",
    );
    process.exit(1);
  }

  console.log(
    `[pull-prod-images] NODO PRIMADO ✓ — bookmarkforge/{web,api}:${sha} local.` +
      " rollback.mjs --prev-tag <tag> hará CAMINO A (imagen, <1min).",
  );
  process.exit(0);
}