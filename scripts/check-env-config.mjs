#!/usr/bin/env node
/**
 * scripts/check-env-config.mjs — static gate for environment-variable reads.
 *
 * Verifies that every DIRECT read of `import.meta.env.X` / `process.env.X`
 * anywhere under `src/` is either:
 *
 *   (a) registered in the ENV_REGISTRY of `src/env.config.ts` (the
 *       registry's `ALLOWED_ENV_VAR_NAMES`, extracted by parsing the
 *       `envVar: "..."` entries), or
 *   (b) listed in the committed baseline
 *       (`scripts/env-direct-reads.baseline.json`).
 *
 * New direct reads fail CI immediately, pushing authors to either add the
 * var to the registry (typed, validated, defaultable) or — for
 * test-only / operator-only vars — document it in the baseline.
 *
 * Second gate — compose env contract (deploy verification): when
 * docker-compose.prod.yml exists, the required (`${VAR:?...}`) vars must be
 * present in `.env.production` when that file exists, and
 * CLIENT_EVENTS_WEBHOOK_URL (when set) must be https-only (the server
 * rejects plaintext webhooks fail-closed in production — catch it at
 * deploy). Optional vars with `:-` defaults are never violations: their
 * defaults are fail-safe by design. Without `.env.production` (CI/dev) the
 * presence check is skipped and only the declaration is reported.
 *
 * Dynamic access through `readEnvVar()` / `getEnvVar()` / `env.*` is the
 * sanctioned path and is never flagged. Comments and string literals are
 * stripped before scanning so documentation examples (`process.env.X`) and
 * `vi.stubEnv("VITE_X", …)` fixtures don't produce false positives.
 *
 * Usage:
 *   node scripts/check-env-config.mjs                 # CI gate (exit 1 on violations)
 *   node scripts/check-env-config.mjs --write-baseline  # regenerate the baseline
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

// ROOT is process.cwd() (not the script's own location) so the gate can be
// pointed at a checkout — including the temp-dir scaffolds used by its unit
// tests — via cwd. All other check-* gates use the same convention.
const ROOT = process.cwd();
const SRC_DIR = join(ROOT, "src");
const REGISTRY_FILE = join(ROOT, "src", "env.config.ts");
const BASELINE_FILE = join(ROOT, "scripts", "env-direct-reads.baseline.json");
const COMPOSE_FILE = join(ROOT, "docker-compose.prod.yml");
const ENV_PROD_FILE = join(ROOT, ".env.production");
const WRITE_BASELINE = process.argv.includes("--write-baseline");

// ── 1. Allowed names from the registry ───────────────────────────────
function readAllowedEnvVarNames() {
  const source = readFileSync(REGISTRY_FILE, "utf8");
  const names = new Set();
  const re = /envVar:\s*"([A-Za-z_$][\w$]*)"/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    names.add(m[1]);
  }
  if (names.size === 0) {
    throw new Error(
      `[check-env-config] Could not parse ENV_REGISTRY from ${REGISTRY_FILE}`,
    );
  }
  return names;
}

// ── 2. Scan src/ for direct reads (comments/strings stripped) ────────
function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) {
      walk(p, out);
    } else if (/\.(ts|tsx|mjs|cjs|js)$/.test(entry)) {
      out.push(p);
    }
  }
  return out;
}

/** Strip string literals and comments so only code tokens remain. */
export function stripStringsAndComments(source) {
  return source
    .replace(/`(?:[^`\\]|\\.)*`/g, " ") // template literals
    .replace(/"(?:[^"\\]|\\.)*"/g, " ") // double-quoted
    .replace(/'(?:[^'\\]|\\.)*'/g, " ") // single-quoted
    .replace(/\/\/[^\n]*/g, " ") // line comments
    .replace(/\/\*[\s\S]*?\*\//g, " "); // block comments
}

const DIRECT_READ_RE =
  /(?:import\.meta\.env|process\.env)\??\.([A-Za-z_$][\w$]*)|(?:import\.meta\.env|process\.env)\??\.\[["']([A-Za-z_$][\w$]*)["']\]/g;

/** Direct env reads in one source file: Map var -> [{ file, line }]. */
export function scanDirectReadsInSource(source, relFile) {
  const found = new Map();
  const stripped = stripStringsAndComments(source);
  const re = new RegExp(DIRECT_READ_RE.source, "g");
  let m;
  while ((m = re.exec(stripped)) !== null) {
    const name = m[1] ?? m[2];
    if (!name) continue;
    const line = stripped.slice(0, m.index).split("\n").length;
    if (!found.has(name)) found.set(name, []);
    found.get(name).push({ file: relFile, line });
  }
  return found;
}

// ── 3. Baseline ──────────────────────────────────────────────────────
function readBaseline() {
  if (!existsSync(BASELINE_FILE)) return new Map();
  return new Map(Object.entries(JSON.parse(readFileSync(BASELINE_FILE, "utf8"))));
}

// ── Pure check logic (unit-testable with in-memory fixtures) ─────────

/**
 * Compute violations + stale baseline entries from in-memory inputs.
 *
 * @param {object} inputs
 * @param {Set<string>} inputs.allowed  registered env var names
 * @param {Map<string, Array<{file: string, line: number}>>} inputs.found  direct reads
 * @param {Map<string, string>} inputs.baseline  baselined vars → reason
 * @returns {{ ok: boolean, oks: string[], violations: string[], stale: string[] }}
 */
export function runEnvConfigChecks({ allowed, found, baseline }) {
  const violations = [];
  for (const [name, hits] of found) {
    if (allowed.has(name)) continue;
    if (baseline.has(name)) continue;
    for (const h of hits) {
      violations.push(`${h.file}:${h.line}  ${name}`);
    }
  }
  // Stale baseline entries (no longer read anywhere) are warnings, not errors.
  const stale = [...baseline.keys()].filter((v) => !found.has(v)).sort();
  return {
    ok: violations.length === 0,
    oks: [`scanned ${[...found.keys()].length} distinct vars`],
    violations,
    stale,
  };
}

/**
 * Compose env contract — deploy-time verification of docker-compose.prod.yml.
 *
 * Parses `${VAR}` references (skipping `$${...}` shell escapes) and, when
 * `envProdSource` is provided (the deploy host has .env.production):
 *   - every required (`${VAR:?...}`) compose var must be present in
 *     .env.production — a missing one fails inside compose anyway, the gate
 *     reports it early with a clear list,
 *   - CLIENT_EVENTS_WEBHOOK_URL, when set, must be https (the server
 *     rejects http webhooks fail-closed in production).
 * Optional vars (`${VAR:-...}`) are never violations (fail-safe defaults).
 */
export function runComposeEnvContract({ composeSource, envProdSource, deployInjectedVars = ["IMAGE_TAG"] }) {
  const violations = [];
  const summary = [];

  // Vars injected by deploy tooling at deploy time (scripts/deploy-prod.mjs,
  // rollback.mjs, staging-deploy.mjs all pass IMAGE_TAG=<sha> explicitly in
  // the compose environment). They must NOT live in .env.production: a value
  // there would silently pin every deploy to one image tag and defeat the
  // per-deploy SHA injection. So they are exempt from the presence check.
  const deployInjected = new Set(deployInjectedVars);

  const composeVars = new Map(); // name -> { required: boolean }
  const re = /(?<!\$)\$\{([A-Za-z_][A-Za-z0-9_]*)(?::([^}]*))?\}/g;
  let m;
  while ((m = re.exec(composeSource ?? "")) !== null) {
    const modifier = m[2] ?? "";
    composeVars.set(m[1], { required: modifier.startsWith("?") });
  }

  if (envProdSource === null) {
    summary.push(
      `compose env contract: ${composeVars.size} vars declaradas, sin .env.production (presencia no verificada)`,
    );
    return { ok: true, violations, summary };
  }

  const envProdVars = new Map(); // name -> raw value
  for (const line of (envProdSource ?? "").split("\n")) {
    const vm = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (vm) envProdVars.set(vm[1], vm[2]);
  }

  const missing = [];
  for (const [name, info] of composeVars) {
    if (!info.required) continue;
    if (deployInjected.has(name)) continue;
    if (!envProdVars.has(name)) missing.push(name);
  }
  if (missing.length > 0) {
    violations.push(
      `vars requeridas por docker-compose.prod.yml ausentes en .env.production: ${missing.join(", ")}`,
    );
  }

  const webhook = envProdVars.get("CLIENT_EVENTS_WEBHOOK_URL")?.trim() ?? "";
  if (webhook && !/^https:\/\//i.test(webhook)) {
    violations.push(
      "CLIENT_EVENTS_WEBHOOK_URL debe ser https:// en producción (el servidor rechaza webhooks http fail-closed)",
    );
  }

  const requiredCount = [...composeVars.values()].filter((v) => v.required).length;
  summary.push(
    `compose env contract: ${composeVars.size} vars (${requiredCount} requeridas), ` +
      `${envProdVars.size} en .env.production, ${missing.length} faltantes`,
  );
  return { ok: violations.length === 0, violations, summary };
}

// ── Main (CLI only) ──────────────────────────────────────────────────
const isMain =
  process.argv[1] &&
  import.meta.url ===
    new URL(`file://${process.argv[1].replace(/\\/g, "/")}`).href;

if (isMain) {
  const allowed = readAllowedEnvVarNames();
  const found = new Map(); // var -> [{ file, line }]
  for (const file of walk(SRC_DIR)) {
    const source = readFileSync(file, "utf8");
    const rel = relative(ROOT, file).split(sep).join("/");
    for (const [name, hits] of scanDirectReadsInSource(source, rel)) {
      if (!found.has(name)) found.set(name, []);
      found.get(name).push(...hits);
    }
  }
  const baseline = readBaseline();

  if (WRITE_BASELINE) {
    const unregistered = [...found.keys()]
      .filter((v) => !allowed.has(v))
      .sort();
    const next = {};
    for (const v of unregistered) {
      next[v] = baseline.get(v) ?? `direct read (${found.get(v)[0].file}:${found.get(v)[0].line})`;
    }
    writeFileSync(
      BASELINE_FILE,
      `${JSON.stringify(next, null, 2)}\n`,
    );
    console.log(`[check-env-config] baseline written: ${Object.keys(next).length} entries -> ${BASELINE_FILE}`);
    process.exit(0);
  }

  const result = runEnvConfigChecks({ allowed, found, baseline });
  if (result.violations.length > 0) {
    console.error("[check-env-config] UNREGISTERED direct env reads (register in ENV_REGISTRY or add to scripts/env-direct-reads.baseline.json):");
    for (const v of result.violations) console.error(`  ${v}`);
  }
  if (result.stale.length > 0) {
    console.warn(`[check-env-config] stale baseline entries (not read anywhere): ${result.stale.join(", ")}`);
  }
  console.log(
    `[check-env-config] scanned ${[...found.keys()].length} distinct vars, ` +
      `${allowed.size} registered, ${baseline.size} baselined, ${result.violations.length} violations`,
  );

  // ── 4. Compose env contract (deploy verification) ───────────────────
  const composeSource = existsSync(COMPOSE_FILE) ? readFileSync(COMPOSE_FILE, "utf8") : null;
  const envProdSource = existsSync(ENV_PROD_FILE) ? readFileSync(ENV_PROD_FILE, "utf8") : null;
  const composeResult = composeSource
    ? runComposeEnvContract({ composeSource, envProdSource })
    : { ok: true, violations: [], summary: [`compose env contract: sin docker-compose.prod.yml — skip`] };
  for (const s of composeResult.summary) console.log(`[check-env-config] ${s}`);
  if (composeResult.violations.length > 0) {
    console.error("[check-env-config] COMPOSE ENV VIOLATIONS:");
    for (const v of composeResult.violations) console.error(`  ${v}`);
  }

  process.exit(result.violations.length > 0 || composeResult.violations.length > 0 ? 1 : 0);
}
