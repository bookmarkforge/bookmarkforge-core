#!/usr/bin/env node
/**
 * scripts/drill-rollback.mjs — drill de rollback repetible en CI.
 *
 * Automatiza la cadena completa detect → rollback → restaurar. Dos modos:
 *
 *   SIN Docker (default, topología de local-smoke.mjs):
 *     1. BASELINE   — levanta ai-mock + license-mock + companion server y
 *                     corre los checks de producción (runApiSurfaceChecks).
 *     2. KILL       — mata SOLO el proceso del api (falla inducida).
 *     3. DETECT     — monitoring-alerts.mjs: APP_CAIDA debe fallar y
 *                     BUNDLE_CORRUPTO debe ejercitarse (probe SRI Docker-free).
 *     4. ROLLBACK   — rollback.mjs --auto (requiere >= 2 tags prod-*).
 *     5. RE-VERIFY  — re-arranca el server local y re-corre los checks.
 *
 *   CON Docker (DRILL_DOCKER=1, topología docker-compose.staging.yml):
 *     0. PREP       — construye las imágenes REALES por SHA del tag prod-*
 *                     previo (blanco del rollback) desde el ÁRBOL de ese tag
 *                     (git worktree), para que CAMINO A sea imagen == código
 *                     del tag. Las de HEAD las deja construidas staging-smoke
 *                     en CI (o las construye BASELINE si faltan).
 *     1. BASELINE   — levanta el stack staging con IMAGE_TAG=<sha de HEAD>
 *                     (--build solo si las imágenes no existen localmente).
 *     2. KILL       — docker compose stop api (falla inducida); el health vía
 *                     web cae en ~5s (proxy_connect_timeout 5s).
 *     3. DETECT     — igual, contra la web (PROD_BASE_URL=http://127.0.0.1:18080).
 *     4. ROLLBACK   — rollback.mjs --auto con DEPLOY_COMPOSE_FILE=staging y
 *                     GATE del drill: debe restaurar POR IMAGEN (CAMINO A,
 *                     sin rebuild) y el tiempo medido del camino (up -d +
 *                     sanity, línea 'CAMINO A confirmado … en X.Xs' de
 *                     rollback.mjs) debe ser < 60s; un fallback a CAMINO B o
 *                     un tiempo >= 60s hace FALLAR el drill.
 *     5. RE-VERIFY  — health + smoke contra la web restaurada.
 *
 * Reporta una tabla por fase con PASS/FAIL y tiempos, y sale 0/1 (CI-ready).
 *
 * ⚠️  Efectos git: la fase 4 ejecuta rollback.mjs --auto, que hace checkout
 * del tag prod-* previo (git stash primero si el árbol está sucio). Corre el
 * drill en CI o en un worktree aislado — tu working tree terminará en el tag
 * restaurado.
 *
 * Uso:
 *   node scripts/drill-rollback.mjs
 *   node scripts/drill-rollback.mjs --json
 *   node scripts/drill-rollback.mjs --no-rollback   # debug: sin mutar git
 *   DRILL_DOCKER=1 node scripts/drill-rollback.mjs  # modo Docker (staging)
 *
 * Env (opcionales):
 *   API_PORT / AI_MOCK_PORT / LICENSE_MOCK_PORT  (default 8787 / 8081 / 8082)
 *   DRILL_ROLLBACK_TIMEOUT_MS                    (default 180000)
 *   LICENSE_SIGNING_PRIVATE_KEY_FILE             (checks de licencia)
 *   DRILL_DOCKER=1                               (modo Docker staging)
 *   DRILL_COMPOSE_FILE                           (default docker-compose.staging.yml)
 *   HTTP_PORT                                    (puerto web staging, default 18080)
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, writeFileSync, unlinkSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { runApiSurfaceChecks } from "./production-smoke.mjs";
import { findProxyPassWithoutPort } from "./check-blindeo.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const isJson = process.argv.includes("--json");
const NO_ROLLBACK = process.argv.includes("--no-rollback");

const SERVER_PORT = Number(process.env.API_PORT ?? 8787);
const AI_MOCK_PORT = Number(process.env.AI_MOCK_PORT ?? 8081);
const LICENSE_MOCK_PORT = Number(process.env.LICENSE_MOCK_PORT ?? 8082);
const AI_MOCK_KEY = process.env.AI_MOCK_KEY ?? "ai-mock-key";
const LICENSE_MOCK_KEY = process.env.LICENSE_MOCK_KEY ?? "license-mock-key";
const ROLLBACK_TIMEOUT_MS = Number(process.env.DRILL_ROLLBACK_TIMEOUT_MS ?? 180_000);

// Modo Docker: el drill corre contra docker-compose.staging.yml (la web
// publica 18080 y proxyea al api, que no expone puerto host).
const DOCKER = process.env.DRILL_DOCKER === "1";
const COMPOSE_FILE = process.env.DRILL_COMPOSE_FILE?.trim() || "docker-compose.staging.yml";
const DRILL_ENV_FILE = process.env.DRILL_ENV_FILE?.trim() || "";
const PRODUCTION_COMPOSE = COMPOSE_FILE === "docker-compose.prod.yml";
const COMPOSE_ENV_ARGS = DRILL_ENV_FILE ? ["--env-file", DRILL_ENV_FILE] : [];
const WEB_PORT = Number(process.env.HTTP_PORT ?? (PRODUCTION_COMPOSE ? 18082 : 18080));
const BASE_URL = DOCKER
  ? `http://127.0.0.1:${WEB_PORT}`
  : `http://127.0.0.1:${SERVER_PORT}`;

const signingKeyFile =
  process.env.LICENSE_SIGNING_PRIVATE_KEY_FILE ??
  join(ROOT, "server", ".license-signing-key.pkcs8");
const signingConfigured = existsSync(signingKeyFile);

function composeProject() {
  return process.env.COMPOSE_PROJECT_NAME ?? (PRODUCTION_COMPOSE ? "bookmarkforge-prod-drill" : "bookmarkforge-staging");
}

// ── Backup/restauración de topología (modo Docker) ──────────────────
// El checkout de housekeeping del rollback puede BORRAR archivos de la
// topología que el tag prod-* previo aún no contiene (p.ej. un compose
// de staging commiteado después del tag). El drill respalda esos archivos
// antes del rollback y los restaura antes de RE-VERIFY/teardown: la
// recuperación no debe depender del contenido del tag antiguo (espeja lo
// que PREP ya hace para el worktree de build).
const topologyBackup = new Map();
function backupTopology() {
  if (!DOCKER || topologyBackup.size > 0) return;
  for (const rel of [COMPOSE_FILE, "public/nginx.conf", join("server", ".license-signing-key.pkcs8")]) {
    const abs = join(ROOT, rel);
    if (existsSync(abs)) topologyBackup.set(rel, abs);
  }
}
function ensureTopology() {
  if (!DOCKER) return;
  for (const [rel, src] of topologyBackup) {
    const dst = join(ROOT, rel);
    if (!existsSync(dst)) {
      try {
        copyFileSync(src, dst);
        console.log(`[DRILL] topología restaurada tras checkout del tag: ${rel}`);
      } catch {
        // sin copia: el RE-VERIFY reportará el fallo real
      }
    }
  }
}

// ── Fases ─────────────────────────────────────────────────────────────
const phases = [];
function recordPhase(name, ok, detail, ms) {
  phases.push({ name, ok, detail, ms: Math.round(ms) });
  const icon = ok === true ? "PASS" : ok === false ? "FAIL" : "SKIP";
  console.log(`[DRILL] ${name.padEnd(10)} ${icon.padEnd(5)} ${(ms / 1000).toFixed(1)}s — ${detail}`);
}

// ── Stack local (mocks + server) ──────────────────────────────────────
const children = [];

function spawnChild(command, args, env, label) {
  const child = spawn(command, args, {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push({ child, label });
  child.stdout.on("data", (chunk) => process.stdout.write(`[${label}] ${chunk}`));
  child.stderr.on("data", (chunk) => process.stderr.write(`[${label}] ${chunk}`));
  return child;
}

async function waitForReady(url, attempts = 60, intervalMs = 250) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return false;
}

async function waitForDown(url, attempts = 60, intervalMs = 250) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      await fetch(url);
    } catch {
      return true; // connection refused → down
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return false;
}

/** En modo Docker la web sigue viva y nginx responde 502/504 — "caído" es !ok. */
async function waitForNotOk(url, attempts = 60, intervalMs = 250) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetch(url);
      if (!res.ok) return true;
    } catch {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return false;
}

// ── Docker helpers (modo DRILL_DOCKER) ───────────────────────────────
function dockerOk(args, env = {}, cwd = ROOT) {
  return spawnSync("docker", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...env },
    timeout: 600_000,
  });
}

function dockerPs() {
  const r = dockerOk(["compose", "-p", process.env.COMPOSE_PROJECT_NAME ?? (PRODUCTION_COMPOSE ? "bookmarkforge-prod-drill" : "bookmarkforge-staging"), ...COMPOSE_ENV_ARGS, "-f", COMPOSE_FILE, "ps", "--format", "{{.Service}}:{{.Status}}"]);
  return (r.stdout ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
}

function dockerImageExists(name, tag) {
  const r = dockerOk(["images", "--format", "{{.Repository}}:{{.Tag}}"]);
  return (r.stdout ?? "").split("\n").includes(`${name}:${tag}`);
}

function killChild(entry) {
  const { child } = entry;
  if (child.exitCode === null) {
    try {
      child.kill();
    } catch {
      /* already gone */
    }
  }
}

function teardown() {
  if (DOCKER) {
    ensureTopology();
    dockerOk(["compose", "-p", composeProject(), ...COMPOSE_ENV_ARGS, "-f", COMPOSE_FILE, "down", "--remove-orphans", "--volumes"]);
    return;
  }
  for (const entry of children) killChild(entry);
}

function serverEnv() {
  return {
    NODE_ENV: "staging",
    PORT: String(SERVER_PORT),
    HOST: "127.0.0.1",
    TRUST_PROXY: "0",
    GEMINI_API_KEY: AI_MOCK_KEY,
    GEMINI_API_BASE: `http://127.0.0.1:${AI_MOCK_PORT}/v1beta/models`,
    AI_SESSION_REQUIRE_LICENSE: "0",
    WHOP_LICENSE_API_URL: `http://127.0.0.1:${LICENSE_MOCK_PORT}/license`,
    WHOP_API_KEY: LICENSE_MOCK_KEY,
    LICENSE_PROVIDER_ALLOW_HTTP: "1",
    ...(signingConfigured ? { LICENSE_SIGNING_PRIVATE_KEY_FILE: signingKeyFile } : {}),
  };
}

async function startStack() {
  if (DOCKER) {
    const sha = gitHead();
    const hasWeb = dockerImageExists("bookmarkforge/web", sha);
    const hasApi = dockerImageExists("bookmarkforge/api", sha);
    const buildArgs = hasWeb && hasApi ? [] : ["--build"];
    const composeProject = process.env.COMPOSE_PROJECT_NAME ?? (PRODUCTION_COMPOSE ? "bookmarkforge-prod-drill" : "bookmarkforge-staging");
    const up = dockerOk(
      ["compose", "-p", composeProject, ...COMPOSE_ENV_ARGS, "-f", COMPOSE_FILE, "up", "-d", ...buildArgs, "web", "api", "ai-mock"],
      { IMAGE_TAG: sha, HTTP_PORT: String(WEB_PORT), AI_SESSION_ORIGINS: `http://127.0.0.1:${WEB_PORT},http://localhost:${WEB_PORT}` },
    );
    if (up.status !== 0) {
      return `docker compose up falló (exit ${up.status})${buildArgs.length ? " — revisa el build" : ""}`;
    }
    if (!(await waitForReady(`${BASE_URL}/health`, 120, 500))) {
      return `la web no responde en ${BASE_URL}/health tras el up`;
    }
    return null;
  }
  spawnChild(
    process.execPath,
    [join(ROOT, "scripts", "ai-mock.mjs")],
    { AI_MOCK_PORT: String(AI_MOCK_PORT), AI_MOCK_KEY },
    "ai-mock",
  );
  spawnChild(
    process.execPath,
    [join(ROOT, "scripts", "license-mock.mjs")],
    { LICENSE_MOCK_PORT: String(LICENSE_MOCK_PORT), LICENSE_MOCK_KEY },
    "license-mock",
  );
  spawnChild(
    process.execPath,
    ["--import", "tsx", join(ROOT, "server", "src", "index.ts")],
    serverEnv(),
    "api",
  );
  const targets = [
    { label: "ai-mock", url: `http://127.0.0.1:${AI_MOCK_PORT}/health` },
    { label: "license-mock", url: `http://127.0.0.1:${LICENSE_MOCK_PORT}/health` },
    { label: "api", url: `${BASE_URL}/health` },
  ];
  for (const target of targets) {
    if (!(await waitForReady(target.url))) {
      return `no arrancó ${target.label} (${target.url}) — ¿puerto ocupado?`;
    }
  }
  return null;
}

function gitRevParse(rev) {
  const r = spawnSync("git", ["rev-parse", rev], { cwd: ROOT, encoding: "utf8" });
  return r.status === 0 ? (r.stdout ?? "").trim() : "";
}

/** Tags prod-* ordenados por creatordate desc, deduplicados por SHA.
 * Mismalógica que selectAutoTarget en rollback.mjs: tags duplicados sobre
 * el mismo commit se colapsan para evitar rollbacks no-op. */
function prodTags() {
  const r = spawnSync("git", ["tag", "--sort=-creatordate"], { cwd: ROOT, encoding: "utf8" });
  const all = (r.stdout ?? "").split("\n").filter((t) => t.trim().startsWith("prod-"));
  const distinct = [];
  const seen = new Set();
  for (const tag of all) {
    const sha = (tag.split("-").pop() ?? "");
    const isSha = /^[0-9a-f]{7,12}$/i.test(sha);
    const key = isSha ? sha.toLowerCase() : `name:${tag}`;
    if (seen.has(key)) continue;
    seen.add(key);
    distinct.push(tag);
  }
  return distinct;
}

function gitHead() {
  return gitRevParse("HEAD").slice(0, 7) || "?";
}

// ── Drill ─────────────────────────────────────────────────────────────
const t0 = Date.now();

console.log("=".repeat(64));
console.log(
  `DRILL DE ROLLBACK — ${BASE_URL} — HEAD ${gitHead()}${DOCKER ? ` — modo Docker (${COMPOSE_FILE})` : " — modo procesos local"}`,
);
console.log("=".repeat(64));
if (!signingConfigured) {
  console.log(`[DRILL] WARN sin key de licencia (${signingKeyFile}) — checks de licencia se omiten`);
}
if (NO_ROLLBACK) {
  console.log("[DRILL] --no-rollback: la fase ROLLBACK se omitirá (sin mutación git)");
} else {
  console.log("[DRILL] ⚠️  la fase ROLLBACK hará git checkout del tag prod-* previo");
}
console.log("");

let overallOk = true;

// ── Fase 0: PREP (solo Docker) — imágenes reales por SHA ─────────────
// Construye las imágenes del tag prod-* previo (blanco del rollback)
// DESDE EL ÁRBOL DE ESE TAG (worktree git) para que CAMINO A sea real:
// imagen == código del tag. Las de HEAD las construye staging-smoke (CI)
// o BASELINE si faltan. Sin >= 2 tags, PREP se omite y ROLLBACK fallará
// con su mensaje claro. La topología del drill puede incluir archivos
// untracked (docker-compose.staging.yml, key de licencia) — se sincronizan
// al worktree para que el build sea reproducible.
if (overallOk && DOCKER) {
  const s = Date.now();
  const tags = prodTags();
  if (tags.length < 2) {
    recordPhase("PREP", true, `se requieren >= 2 tags prod-* (hay ${tags.length}) — build de imágenes omitido`, Date.now() - s);
  } else {
    const prevTag = tags[1];
    const prevSha = gitRevParse(`${prevTag}^{commit}`).slice(0, 7);
    const hasPrevImages =
      dockerImageExists("bookmarkforge/web", prevSha) &&
      dockerImageExists("bookmarkforge/api", prevSha);
    if (hasPrevImages) {
      recordPhase("PREP", true, `imágenes del tag previo ya existen (web/api:${prevSha}) — sin build`, Date.now() - s);
    } else {
      const wt = join(tmpdir(), `bmf-prev-build-${process.pid}`);
      const add = spawnSync("git", ["worktree", "add", "--detach", wt, prevSha], {
        cwd: ROOT,
        encoding: "utf8",
      });
      if (add.status !== 0) {
        recordPhase(
          "PREP",
          false,
          `no se pudo crear worktree de ${prevSha} (git worktree add exit ${add.status}) — CAMINO A imposible`,
          Date.now() - s,
        );
        overallOk = false;
      } else {
        try {
          // Sincroniza la topología del drill al árbol del tag (archivos
          // untracked/gitignored que el compose y el build necesitan).
          for (const rel of ["docker-compose.staging.yml", "public/nginx.conf"]) {
            const src = join(ROOT, rel);
            if (existsSync(src)) copyFileSync(src, join(wt, rel));
          }
          const keySrc = signingKeyFile;
          if (existsSync(keySrc)) {
            const relKey = join("server", ".license-signing-key.pkcs8");
            copyFileSync(keySrc, join(wt, relKey));
          }
          const build = dockerOk(
            ["compose", "-f", "docker-compose.staging.yml", "build", "web", "api"],
            { IMAGE_TAG: prevSha },
            wt,
          );
          if (build.status !== 0) {
            recordPhase(
              "PREP",
              false,
              `build de ${prevSha} falló (exit ${build.status}) — CAMINO A imposible. Tail:\n${(build.stderr ?? "").split("\n").slice(-4).join("\n")}`,
              Date.now() - s,
            );
            overallOk = false;
          } else {
            recordPhase(
              "PREP",
              true,
              `imágenes construidas desde el árbol del tag ${prevTag} (web/api:${prevSha})`,
              Date.now() - s,
            );
          }
        } finally {
          spawnSync("git", ["worktree", "remove", "--force", wt], { cwd: ROOT, encoding: "utf8" });
        }
      }
    }
  }
}

// ── Fase 1: BASELINE ─────────────────────────────────────────────────
{
  const s = Date.now();
  const err = await startStack();
  if (err) {
    recordPhase("BASELINE", false, err, Date.now() - s);
    overallOk = false;
  } else {
    const result = await runApiSurfaceChecks({
      baseUrl: BASE_URL,
      skipLicense: !signingConfigured,
    });
    recordPhase(
      "BASELINE",
      result.ok,
      result.ok ? `${result.checks.length}/${result.checks.length} checks PASS` : "smoke FAIL",
      Date.now() - s,
    );
    if (!result.ok) overallOk = false;
  }
}

// ── Fase 2: KILL (falla inducida) ────────────────────────────────────
if (overallOk) {
  const s = Date.now();
  let down = false;
  let mocksAlive = false;
  if (DOCKER) {
    const stop = dockerOk(["compose", "-p", composeProject(), ...COMPOSE_ENV_ARGS, "-f", COMPOSE_FILE, "stop", "api"]);
    down = stop.status === 0 && (await waitForNotOk(`${BASE_URL}/health`, 30, 300));
    const ps = dockerPs();
    mocksAlive =
      ps.some((l) => l.startsWith("ai-mock") && l.includes("Up"));
  } else {
    const apiEntry = children.find((e) => e.label === "api");
    killChild(apiEntry);
    down = await waitForDown(`${BASE_URL}/health`);
    mocksAlive =
      (await waitForReady(`http://127.0.0.1:${AI_MOCK_PORT}/health`, 5, 100)) &&
      (await waitForReady(`http://127.0.0.1:${LICENSE_MOCK_PORT}/health`, 5, 100));
  }
  recordPhase(
    "KILL",
    down && mocksAlive,
    down
      ? mocksAlive
        ? "api caído, mocks vivos ✓"
        : "api caído pero un mock murió ✗"
      : "el api siguió respondiendo — falla no inducida",
    Date.now() - s,
  );
  if (!down || !mocksAlive) overallOk = false;
}

// ── Fase 3: DETECT (monitoring-alerts) ───────────────────────────────
if (overallOk) {
  const s = Date.now();
  // Neutraliza CLIENT_CRITICAL: este drill no genera eventos de clientes;
  // un log vacío evita el fail-closed por log ilegible del compose.
  const tmpLog = join(tmpdir(), `bmf-drill-events-${process.pid}.log`);
  writeFileSync(tmpLog, "");
  const r = spawnSync(
    process.execPath,
    [join(ROOT, "scripts", "monitoring-alerts.mjs"), "--json"],
    {
      cwd: ROOT,
      encoding: "utf8",
      timeout: 120_000,
      env: { ...process.env, PROD_BASE_URL: BASE_URL, CLIENT_EVENTS_LOG_FILE: tmpLog, DEPLOY_COMPOSE_FILE: COMPOSE_FILE },
    },
  );
  unlinkSync(tmpLog);
  let appDown = false;
  let bundleOk = false;
  let bundleDetail = "";
  let parsed = null;
  try {
    parsed = JSON.parse((r.stdout ?? "").trim());
    const app = (parsed.results ?? []).find((x) => x.name === "APP_CAIDA");
    appDown = Boolean(app && app.ok === false);
    // Alerta 2 (BUNDLE_CORRUPTO): el probe SRI Docker-free debe ejercitarse
    // y detectar la violación → cubre la alerta 2 en el drill.
    const bundle = (parsed.results ?? []).find((x) => x.name === "BUNDLE_CORRUPTO");
    bundleOk = Boolean(bundle && bundle.ok === true);
    bundleDetail = bundle?.detail ?? "";
  } catch {
    // fallthrough: parse failed → not detected
  }
  const detail = parsed
    ? `APP_CAIDA detectado ✓ · BUNDLE_CORRUPTO ${bundleOk ? "probe OK" : "NO ejercitado"}${bundleDetail ? ` (${bundleDetail})` : ""} (monitoring exit ${r.status})`
    : `no se pudo parsear monitoring-alerts (exit ${r.status})`;
  recordPhase("DETECT", appDown && bundleOk, detail, Date.now() - s);
  if (!appDown || !bundleOk) overallOk = false;
}

// ── Fase 4: ROLLBACK (rollback.mjs --auto) ───────────────────────────
if (overallOk && !NO_ROLLBACK) {
  const s = Date.now();
  const tags = prodTags();
  if (tags.length < 2) {
    recordPhase(
      "ROLLBACK",
      false,
      `se requieren >= 2 tags prod-* (hay ${tags.length}) — crea tags con deploy-prod.mjs`,
      Date.now() - s,
    );
    overallOk = false;
  } else {
    // El criterio de restauración compara el SHA de HEAD contra el SHA del
    // penúltimo tag (la misma selección que rollback --auto). Comparar por
    // SHA es robusto incluso si dos tags apuntan al mismo commit.
    const expectedTag = tags[1];
    const expectedSha = gitRevParse(`${expectedTag}^{commit}`);
    const beforeSha = gitRevParse("HEAD");

    // ── Gate: validates rollback target's web is healthy ────────────
    // Before executing the rollback, verify the target tag's nginx.conf
    // has all proxy_pass directives with explicit ports. A rollback to a
    // tag with broken web (proxy_pass without :port) would leave the
    // service in permanent 502 — this gate catches it BEFORE the damage.
    let targetWebOk = true;
    let targetWebDetail = "";
    try {
      const nginxConf = spawnSync(
        "git", ["show", `${expectedTag}:public/nginx.conf`],
        { cwd: ROOT, encoding: "utf8" },
      );
      if (nginxConf.status !== 0) {
        targetWebOk = false;
        targetWebDetail = `no se pudo leer nginx.conf del tag ${expectedTag} (git show exit ${nginxConf.status})`;
      } else {
        const violations = findProxyPassWithoutPort(nginxConf.stdout ?? "");
        if (violations.length > 0) {
          targetWebOk = false;
          targetWebDetail = `${expectedTag} tiene ${violations.length} proxy_pass sin puerto explícito — la web restaurada serviría 502`;
        }
      }
    } catch (e) {
      targetWebOk = false;
      targetWebDetail = `error validando nginx.conf del tag ${expectedTag}: ${e.message}`;
    }
    if (!targetWebOk) {
      recordPhase("ROLLBACK", false, `GATE: rollback target con web rota — ${targetWebDetail}`, Date.now() - s);
      overallOk = false;
    }
    if (targetWebOk) {
    // Respaldar la topología ANTES del rollback: el checkout del tag puede
    // eliminarla si el tag es anterior a su commiteo.
    backupTopology();
    const r2 = spawnSync(
      process.execPath,
      [join(ROOT, "scripts", "rollback.mjs"), "--auto"],
      {
        cwd: ROOT,
        encoding: "utf8",
        timeout: ROLLBACK_TIMEOUT_MS,
        env: {
          ...process.env,
          PROD_BASE_URL: BASE_URL,
          ...(DOCKER
            ? {
                DEPLOY_COMPOSE_FILE: COMPOSE_FILE,
                HTTP_PORT: String(WEB_PORT),
                // rollback.mjs invoca compose SIN -p: sin esta variable el
                // proyecto sería el basename del directorio y crearía un
                // stack PARALELO al del drill (colisión de puerto web).
                COMPOSE_PROJECT_NAME: composeProject(),
              }
            : {}),
        },
      },
    );
    const out = r2.stdout ?? "";
    const camino = out.includes("CAMINO A")
      ? "CAMINO A (imagen por SHA)"
      : out.includes("CAMINO B")
        ? "CAMINO B (rebuild)"
        : "camino no identificado";
    // Tiempo REAL medido por rollback.mjs para el paso up -d + sanity del
    // camino imagen-por-SHA (línea 'CAMINO A confirmado … en X.Xs').
    const caminoMatch = out.match(/CAMINO A confirmado[^\n]*?en ([\d.]+)s/);
    const caminoASeconds = caminoMatch ? Number(caminoMatch[1]) : null;
    const afterSha = gitRevParse("HEAD");
    const restoreOk = Boolean(afterSha && afterSha === expectedSha);
    // GATE del drill: el rollback debe restaurar POR IMAGEN (CAMINO A) y el
    // tiempo medido del camino debe ser < 60s. Un fallback a rebuild (CAMINO
    // B) o un tiempo >= 60s hacen FALLAR el drill — el objetivo es probar la
    // vía imagen-por-SHA, no el rebuild.
    const caminoGateOk = camino === "CAMINO A (imagen por SHA)" && caminoASeconds !== null && caminoASeconds < 60;
    const tail = out.split("\n").slice(-6).join("\n").trim();
    recordPhase(
      "ROLLBACK",
      restoreOk && caminoGateOk,
      restoreOk
        ? caminoGateOk
          ? `HEAD=${afterSha.slice(0, 7)} = ${expectedTag} — ${camino} medido ${caminoASeconds}s (< 60s GATE) (rollback exit ${r2.status})`
          : `restauró pero ${camino}${caminoASeconds === null ? " — tiempo del camino no medible" : ` — CAMINO A en ${caminoASeconds}s >= 60s (GATE)`}. Tail:\n${tail}`
        : `no restauró ${expectedTag} — antes ${beforeSha.slice(0, 7)} / después ${afterSha.slice(0, 7)} — exit ${r2.status}. Tail:\n${tail}`,
      Date.now() - s,
    );
    if (!restoreOk || !caminoGateOk) overallOk = false;
    } // fin if (targetWebOk)
  }
} else if (overallOk) {
  recordPhase("ROLLBACK", null, "omitido (--no-rollback)", 0);
}

// ── Fase 5: RE-VERIFY ────────────────────────────────────────────────
if (overallOk) {
  const s = Date.now();
  // Si el rollback docker trajo el api arriba, úsalo; si no, lo re-arranca
  // (en Docker: compose start api; en local: spawn desde el árbol restaurado).
  let ready = await waitForReady(`${BASE_URL}/health`, 20, 250);
  if (!ready) {
    ensureTopology();
    if (DOCKER) {
      // up -d recreates the container from the (restored) compose file;
      // 'start' only restarts the existing container with stale code.
      dockerOk(["compose", "-p", composeProject(), ...COMPOSE_ENV_ARGS, "-f", COMPOSE_FILE, "up", "-d", "api"]);
    } else {
      spawnChild(
        process.execPath,
        ["--import", "tsx", join(ROOT, "server", "src", "index.ts")],
        serverEnv(),
        "api",
      );
    }
    ready = await waitForReady(`${BASE_URL}/health`);
  }
  if (!ready) {
    recordPhase("RE-VERIFY", false, "el server no volvió a arrancar tras el rollback", Date.now() - s);
    overallOk = false;
  } else {
    const result = await runApiSurfaceChecks({
      baseUrl: BASE_URL,
      skipLicense: !signingConfigured,
    });
    recordPhase(
      "RE-VERIFY",
      result.ok,
      result.ok ? `${result.checks.length}/${result.checks.length} checks PASS post-rollback` : "smoke FAIL post-rollback",
      Date.now() - s,
    );
    if (!result.ok) overallOk = false;
  }
}

// ── Reporte ──────────────────────────────────────────────────────────
teardown();
const totalMs = Date.now() - t0;
console.log("");
console.log("-".repeat(64));
console.log(`DRILL ${overallOk ? "PASS ✅" : "FAIL ❌"} — ${phases.length} fases en ${(totalMs / 1000).toFixed(1)}s`);
console.log("-".repeat(64));

if (isJson) {
  console.log(
    JSON.stringify(
      {
        ok: overallOk,
        at: new Date().toISOString(),
        baseUrl: BASE_URL,
        head: gitHead(),
        totalSeconds: Math.round(totalMs / 100) / 10,
        phases,
      },
      null,
      2,
    ),
  );
}

process.exit(overallOk ? 0 : 1);
