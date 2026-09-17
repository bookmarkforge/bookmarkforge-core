#!/usr/bin/env node
/**
 * BookmarkForge — Checklist de Blindeo Pre-Deploy
 * 
 * Ejecutar SIEMPRE antes de cualquier despliegue a producción.
 * Fallo en cualquiera de estos puntos = BLOQUEO de deploy.
 */

import { execSync, execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const WORKSPACE = process.cwd();

function pass(msg) { console.log(`  ✓ ${msg}`); }
function fail(msg) { console.log(`  ✗ ${msg}`); process.exit(1); }

/**
 * Detecta líneas `proxy_pass http://bookmarkforge_api...` SIN puerto
 * explícito. Un upstream sin puerto (nginx → :80 default) contra un api que
 * escucha en 8787 produce 502 permanente tras el rollback. Fuente de
 * verdad: public/nginx.conf del tag (el que se hornea en la imagen web).
 *
 * @param {string} nginxConf contenido de public/nginx.conf
 * @returns {string[]} líneas ofensivas (vacío = sano)
 */
export function findProxyPassWithoutPort(nginxConf) {
  if (typeof nginxConf !== "string") return [];
  const lines = nginxConf.split(/\r?\n/);
  const violations = [];
  for (const line of lines) {
    // Skip nginx comments — a commented-out proxy_pass is harmless.
    if (/^\s*#/.test(line)) continue;
    // proxy_pass http://bookmarkforge_api/api/...  → sin puerto → VIOLACIÓN
    // proxy_pass http://bookmarkforge_api:8787/... → puerto explícito → OK
    if (/proxy_pass\s+http:\/\/bookmarkforge_api(?!:)/i.test(line)) {
      violations.push(line.trim());
    }
  }
  return violations;
}

/**
 * Selecciona el rollback target: el penúltimo tag prod-* DISTINTO del
 * actual (último bueno), con deduplicación por SHA para evitar rollbacks
 * no-op cuando hay tags duplicados sobre el mismo commit (regresión bb21664).
 * Misma lógica que selectAutoTarget en rollback.mjs: deduplica por SHA
 * case-insensitive, y trata tags sin SHA válido como builds distintos por
 * nombre. `tags` ya debe venir ordenado por creatordate desc.
 * Devuelve null si hay menos de 2 tags prod- tras dedup.
 */
export function selectRollbackTarget(tags) {
  const prodTags = (Array.isArray(tags) ? tags : [])
    .filter((t) => typeof t === "string" && t.startsWith("prod-"));
  const distinct = [];
  const seen = new Set();
  for (const tag of prodTags) {
    const sha = (tag.split("-").pop() ?? "");
    const isSha = /^[0-9a-f]{7,12}$/i.test(sha);
    const key = isSha ? sha.toLowerCase() : `name:${tag}`;
    if (seen.has(key)) continue;
    seen.add(key);
    distinct.push(tag);
  }
  if (distinct.length < 2) return null;
  return distinct[1]; // penúltimo build DISTINTO del actual
}

/**
 * Valida que docker-compose.prod.yml define el alias bookmarkforge_api.
 * Sin este alias, nginx no resuelve el upstream y el stack entra en
 * crash-loop ("host not found in upstream").
 *
 * @param {string} composeContent contenido de docker-compose.prod.yml
 * @returns {boolean} true si el alias está presente
 */
export function hasBookmarkforgeApiAlias(composeContent) {
  if (typeof composeContent !== "string") return false;
  return composeContent.includes("aliases: [bookmarkforge_api]") ||
    composeContent.includes("aliases:\n        - bookmarkforge_api");
}

// El flujo principal solo corre cuando se ejecuta directamente, no al ser
// importado por los tests unitarios (mismo patrón que rollback.mjs /
// deploy-prod.mjs / monitoring-alerts.mjs).
const isMain =
  typeof process.argv[1] === "string" &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {

console.log("🔒 BookmarkForge — Checklist de Blindeo Pre-Deploy");
console.log("=".repeat(50));

// Punto 1: Tags prod- disponibles en git
try {
  // Windows-safe: execSync uses cmd.exe, where single-quoted --list patterns
  // are passed literally and match nothing. List all tags and filter in JS.
  const tags = execSync("git tag --sort=-creatordate", { encoding: "utf8" })
    .toString()
    .trim()
    .split("\n")
    .filter(t => t.startsWith("prod-"));
  if (tags.length >= 2) pass(`Tags prod- disponibles: ${tags.length}`);
  else fail("Necesitas al menos 2 tags prod- para rollback");
} catch (_e) { fail("No se pueden listar tags git"); }

// Punto 2: CSP config source of truth
try {
  const cspSource = readFileSync(join(WORKSPACE, "scripts", "csp-config.js"), "utf8");
  if (cspSource.includes("CSP_STRICT") && cspSource.includes("CSP_MODERATE")) {
    pass("CSP config source of truth presente (scripts/csp-config.js)");
  } else fail("CSP config incompleta");
} catch (_e) { fail("No scripts/csp-config.js"); }

// Punto 3: CSP inlined en vite.config.ts
try {
  const viteCfg = readFileSync(join(WORKSPACE, "vite.config.ts"), "utf8");
  if (viteCfg.includes("CSP_MODERATE")) pass("CSP inlined en vite.config.ts");
  else fail("CSP no inlined en vite.config.ts");
} catch (_e) { fail("No vite.config.ts"); }

// Punto 4: bundleIntegrity service presente + evento cableado a productionMonitor
try {
  const bi = readFileSync(join(WORKSPACE, "src", "utils", "bundleIntegrity.ts"), "utf8");
  const pm = readFileSync(join(WORKSPACE, "src", "telemetry", "productionMonitor.ts"), "utf8");
  if (bi.includes("bundle-integrity-failed") && pm.includes("bundle-integrity-failed")) {
    pass("bundleIntegrity → productionMonitor cableado (bundle-integrity-failed)");
  } else fail("bundleIntegrity.ts o productionMonitor.ts sin contrato bundle-integrity-failed");
} catch (_e) { fail("No src/utils/bundleIntegrity.ts"); }

// Punto 5: productionMonitor.ts con thresholds
try {
  const pm = readFileSync(join(WORKSPACE, "src", "telemetry", "productionMonitor.ts"), "utf8");
  if (pm.includes("INTEGRITY_SPIKE_THRESHOLD") && pm.includes("CSP_SPIKE_THRESHOLD")) {
    pass("productionMonitor.ts con umbrales configurados");
  } else fail("productionMonitor.ts sin umbrales");
} catch (_e) { fail("No src/telemetry/productionMonitor.ts"); }

// Punto 6: Error handler setup en main.tsx
try {
  const mainTsx = readFileSync(join(WORKSPACE, "src", "main.tsx"), "utf8");
  if (mainTsx.includes("initCrisisHandler")) {
    pass("main.tsx tiene handlers de crisis registrados (initCrisisHandler)");
  } else fail("main.tsx sin handlers de crisis");
} catch (_e) { fail("No src/main.tsx"); }

// Punto 7: Zeroización (doble llenado con reuse guard) + password validation
try {
  const cryptoCore = readFileSync(join(WORKSPACE, "src", "utils", "crypto-core.ts"), "utf8");
  const config = readFileSync(join(WORKSPACE, "src", "constants", "config.ts"), "utf8");
  if (cryptoCore.includes("zeroPasswordBytes") && cryptoCore.includes("already zero")) {
    pass("zeroPasswordBytes presente (zeroización doble con reuse guard)");
  } else fail("zeroPasswordBytes no encontrado en crypto-core.ts");
  if (config.includes("MIN_PASSWORD_LENGTH: 12")) pass("MIN_PASSWORD_LENGTH configurado (= 12 en constants/config.ts)");
  else fail("MIN_PASSWORD_LENGTH no configurado");
} catch (_e) { fail("No src/utils/crypto-core.ts o src/constants/config.ts"); }

// Punto 8: Rollback target (penúltimo tag prod-*) con web válida:
// proxy_pass hacia el api con puerto explícito. Un rollback a un tag cuya
// imagen web no pueda alcanzar el api (proxy_pass sin :puerto) deja la web
// en 502 permanente: rollback.mjs --verify lo detecta, pero este gate lo
// impide ANTES de desplegar sobre un blanco inservible.
try {
  const tags = execSync("git tag --sort=-creatordate", { encoding: "utf8" })
    .toString()
    .trim()
    .split("\n");
  const target = selectRollbackTarget(tags);
  if (!target) {
    fail("No hay rollback target (se necesitan >= 2 tags prod-)");
  }
  // public/nginx.conf es el que se hornea en la imagen web al build
  // (Dockerfile), por lo que validar el archivo del tag == validar la
  // imagen del tag.
  const nginxConf = execFileSync("git", ["show", `${target}:public/nginx.conf`], { encoding: "utf8" }).toString();
  const violations = findProxyPassWithoutPort(nginxConf);
  if (violations.length > 0) {
    fail(
      `rollback target ${target}: ${violations.length} proxy_pass sin puerto explícito ` +
      `(la web restaurada serviría 502). Corrige el nginx.conf o despliega un tag previo sano.`,
    );
  }
  pass(`rollback target ${target}: proxy_pass hacia el api con puerto explícito`);
} catch (_e) {
  fail(`No se pudo validar el nginx.conf del rollback target: ${_e.message}`);
}

// Punto 9: docker-compose.prod.yml define el alias bookmarkforge_api
try {
  const compose = readFileSync(join(WORKSPACE, "docker-compose.prod.yml"), "utf8");
  if (hasBookmarkforgeApiAlias(compose)) {
    pass("docker-compose.prod.yml: alias bookmarkforge_api definido en el servicio api");
  } else {
    fail("docker-compose.prod.yml: alias bookmarkforge_api NO encontrado — nginx entrará en crash-loop");
  }
} catch (_e) {
  fail("No se pudo leer docker-compose.prod.yml");
}

// Punto 10: Checklist de pre-lanzamiento (bloqueantes) — check:launch-checklist:strict.
// No lanzar mientras haya bloqueantes 🔴 abiertos (ruleset, RPO/RTO,
// guardia, RGPD). El gate emite el informe completo y sale != 0 con bloqueantes.
try {
  execFileSync(
    process.execPath,
    [join(WORKSPACE, "scripts", "check-launch-checklist.mjs"), "--strict"],
    { stdio: "inherit" },
  );
  pass("Checklist de pre-lanzamiento: sin bloqueantes (check:launch-checklist:strict)");
} catch (_e) {
  fail(
    "Checklist de pre-lanzamiento con bloqueantes sin completar (check:launch-checklist:strict). " +
    "Corrige los 🔴 bloqueantes (docs/launch-checklist.md) antes de desplegar a producción.",
  );
}

console.log("\n" + "=".repeat(50));
console.log("✅ Checklist de blindeo completado exitosamente");
process.exit(0);

} // fin if (isMain)