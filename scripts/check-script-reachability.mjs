#!/usr/bin/env node
/**
 * scripts/check-script-reachability.mjs — no phantom scripts.
 *
 * Registered in `check-inspector-freeze.mjs` (KNOWN_GATES, `meta`) and
 * documented in `CONTRIBUTING.md` ("Manual command surface"): this is the gate
 * that fails when a declared script has no entry point.
 *
 * Three failure classes, each one already observed in this repository:
 *
 *   1. PHANTOM TARGET — a declared script whose local entry point/config does
 *      not exist. `check:script-reachability` and `check:landing-smoke` were
 *      declared in package.json, wired into `ci.yml`/`staging-smoke.yml`,
 *      documented and grouped in `npm run check:build` while the file each one
 *      runs had never been committed: `npm run check:build` died with
 *      MODULE_NOT_FOUND and nothing in the chain noticed the phantom.
 *   2. PHANTOM REFERENCE — a `npm run <name>` in the CI/infrastructure corpus
 *      naming a script nobody declares (a workflow step that can only fail).
 *   3. UNREACHABLE SCRIPT — a declared script no entry point reaches. By-hand
 *      diagnostics are legitimate, so the set is baselined ONE reason per entry
 *      (scripts/script-reachability-baseline.json); what the gate refuses is an
 *      unreachable script nobody decided to keep, and a baseline entry that
 *      went stale (the script became reachable again, or stopped existing).
 *
 * Entry points are the surfaces that actually run commands: the npm lifecycle
 * hooks npm itself invokes (`prepare`, `test`, …), the CI/infrastructure corpus
 * (.github, Dockerfile, compose, Netlify/Vercel, ZAP, functions) and the
 * documentation corpus (README/AGENTS/CONTRIBUTING/OPEN-CORE/docs) — the
 * manual-command table in CONTRIBUTING is precisely the declared entry point
 * for the commands a human runs by hand. Reachability is transitive through the
 * bodies of the declared scripts themselves.
 *
 * The corpus is narrowed on purpose: `scripts/__tests__` fixtures name
 * fictional commands to drive the other gates (`check:foo`, `check:ghost`), and
 * counting them as references would make this gate fail on its own test data.
 *
 * Usage:
 *   node scripts/check-script-reachability.mjs            # verify
 *   node scripts/check-script-reachability.mjs --update   # rewrite the baseline
 *   node scripts/check-script-reachability.mjs --json     # machine-readable
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const BASELINE_PATH = "scripts/script-reachability-baseline.json";

/**
 * Scripts npm itself invokes without a `npm run` line: lifecycle hooks plus the
 * `test`/`start`/`stop`/`restart` shorthands (`npm test` == `npm run test`).
 */
export const LIFECYCLE_ROOTS = [
  "prepare",
  "preinstall",
  "install",
  "postinstall",
  "prepublish",
  "prepublishOnly",
  "prepack",
  "postpack",
  "test",
  "start",
  "stop",
  "restart",
];

/** Surfaces whose `npm run` lines are entry points. */
export const ENTRY_SOURCES = [
  ".github",
  "docs",
  "README.md",
  "AGENTS.md",
  "CONTRIBUTING.md",
  "OPEN-CORE.md",
  "DEMO-README.md",
  "PRO-LICENSE.md",
  "Dockerfile",
  "docker-compose.prod.yml",
  "docker-compose.staging.yml",
  "netlify.toml",
  "vercel.json",
  ".zap",
  "functions",
];

/** Directories whose contents are never a reference (fixtures, build output). */
const SKIP_DIRS = new Set([
  "__tests__",
  "node_modules",
  ".git",
  "dist",
  "dist-extension",
  "coverage",
]);

const SCANNED_EXTENSIONS = /\.(?:md|ya?ml|json|toml|cjs|mjs|js|sh|txt)$/;
/** Tokens worth verifying on disk: local paths, package manifests, configs. */
const CHECKABLE_EXTENSION = /\.(?:mjs|cjs|js|ts|tsx|json|yml|yaml|html|css)$/;

/** `npm run <name>` — the only syntax that is an invocation, not a mention. */
export function npmRunReferences(text) {
  return [...String(text).matchAll(/npm run ([a-zA-Z0-9:_-]+)/g)].map((match) => match[1]);
}

/**
 * Local files a script body runs. A token counts when it names a file the repo
 * can be expected to hold: something under a directory (`scripts/x.mjs`), a
 * package manifest (`tsconfig.prod.json`) or a runner config
 * (`playwright.smoke.config.ts`, also when written as `--config=<path>`).
 * Absolute paths outside the repository (`C:\...`) and URLs are not ours.
 */
export function scriptTargets(command) {
  const targets = [];
  for (const raw of String(command).split(/\s+/)) {
    const token = raw
      .replace(/^["'`]+|["'`,;)]+$/g, "")
      .replace(/^--[A-Za-z0-9-]+=/, "");
    if (token.length === 0 || token.startsWith("-")) continue;
    if (!CHECKABLE_EXTENSION.test(token)) continue;
    if (/^[A-Za-z]:[\\/]/.test(token) || token.includes("://")) continue;
    const local = token.includes("/") || token.includes("\\");
    const config =
      /(?:^|[/\\])tsconfig[A-Za-z0-9_.-]*\.json$/.test(token) ||
      /\.config\.[cm]?[jt]s$/.test(token);
    if (!local && !config) continue;
    targets.push(token.replaceAll("\\", "/"));
  }
  return [...new Set(targets)];
}

/** Every scanned file under `source`, repo-relative, stable order. */
export function collectFiles(root, sources = ENTRY_SOURCES) {
  const found = [];
  const walk = (absolute, relative) => {
    let info;
    try {
      info = statSync(absolute);
    } catch {
      return; // an entry source that does not exist is simply not a source
    }
    if (info.isDirectory()) {
      if (SKIP_DIRS.has(basename(absolute))) return;
      for (const entry of readdirSync(absolute).sort()) {
        walk(join(absolute, entry), `${relative}/${entry}`);
      }
      return;
    }
    if (SCANNED_EXTENSIONS.test(absolute) || basename(absolute) === "Dockerfile") {
      found.push(relative);
    }
  };
  for (const source of sources) walk(resolve(root, source), source);
  return found;
}

/** Rule 1: every local file a declared script runs must exist. */
export function phantomTargetFailures({ root, scripts }) {
  const failures = [];
  for (const [name, command] of Object.entries(scripts)) {
    for (const target of scriptTargets(command)) {
      if (!existsSync(resolve(root, target))) {
        failures.push(
          `phantom target: \`${name}\` runs ${target}, which does not exist — ` +
            `commit the file or delete the script instead of leaving a command ` +
            `that can only fail`,
        );
      }
    }
  }
  return failures.sort();
}

/**
 * Rule 2: a `npm run <name>` in the entry corpus (or in another declared
 * script) must name a declared script.
 */
export function phantomReferenceFailures({ scripts, references }) {
  const failures = [];
  for (const { name, file } of references) {
    if (name in scripts) continue;
    failures.push(
      `phantom reference: ${file} runs \`npm run ${name}\`, which package.json ` +
        `does not declare`,
    );
  }
  return [...new Set(failures)].sort();
}

/**
 * Reachability from the entry points, transitive through declared script
 * bodies. `entryReferences` are the names the entry corpus invokes.
 */
export function reachableScripts({ scripts, entryReferences }) {
  const reachable = new Set();
  const stack = [...LIFECYCLE_ROOTS, ...entryReferences];
  while (stack.length > 0) {
    const name = stack.pop();
    if (reachable.has(name) || !(name in scripts)) continue;
    reachable.add(name);
    stack.push(...npmRunReferences(scripts[name]));
  }
  return reachable;
}

/** Rule 3: unreachable scripts need a baselined decision; stale entries fail. */
export function unreachableFailures({ scripts, reachable, baseline }) {
  const failures = [];
  const known = baseline?.knownUnreachable ?? {};
  if (typeof known !== "object" || Array.isArray(known)) {
    return [
      `malformed baseline: ${BASELINE_PATH} must map a script name to the reason ` +
        `it is allowed to stay unreachable`,
    ];
  }
  for (const name of Object.keys(scripts).sort()) {
    if (reachable.has(name)) continue;
    const reason = known[name];
    if (typeof reason !== "string" || reason.trim().length === 0) {
      failures.push(
        `unreachable script: nothing in the entry corpus (workflows, infra ` +
          `configs, docs) or in another declared script runs \`${name}\` — wire ` +
          `it up, delete it, or declare the decision in ${BASELINE_PATH} with a ` +
          `reason`,
      );
    }
  }
  for (const name of Object.keys(known).sort()) {
    const reason = known[name];
    if (typeof reason !== "string" || reason.trim().length === 0) {
      failures.push(
        `baseline without a reason: knownUnreachable["${name}"] — every ` +
          `baselined script needs a reason a reader can check`,
      );
      continue;
    }
    if (!(name in scripts)) {
      failures.push(
        `stale baseline: knownUnreachable lists "${name}", which package.json ` +
          `no longer declares`,
      );
      continue;
    }
    if (reachable.has(name)) {
      failures.push(
        `stale baseline: knownUnreachable lists "${name}", which an entry point ` +
          `reaches again — remove the entry`,
      );
    }
  }
  return failures.sort();
}

/** Everything the gate reads, so the CLI and the tests share one code path. */
export function inspect({ root = process.cwd(), baseline = null } = {}) {
  const pkgPath = resolve(root, "package.json");
  if (!existsSync(pkgPath)) {
    return { ok: false, failures: [`no package.json at ${pkgPath}`], notes: [], scripts: {}, reachable: [], unreachable: [] };
  }
  const scripts = JSON.parse(readFileSync(pkgPath, "utf8")).scripts ?? {};
  const files = collectFiles(root);
  const references = [];
  const entryReferences = [];
  for (const file of files) {
    const text = readFileSync(resolve(root, file), "utf8");
    for (const name of npmRunReferences(text)) {
      references.push({ name, file });
      entryReferences.push(name);
    }
  }
  const reachable = reachableScripts({ scripts, entryReferences });
  const unreachable = Object.keys(scripts)
    .filter((name) => !reachable.has(name))
    .sort();
  const resolvedBaseline =
    baseline ??
    (existsSync(resolve(root, BASELINE_PATH))
      ? JSON.parse(readFileSync(resolve(root, BASELINE_PATH), "utf8"))
      : {});
  const failures = [
    ...phantomTargetFailures({ root, scripts }),
    ...phantomReferenceFailures({ scripts, references }),
    ...unreachableFailures({ scripts, reachable, baseline: resolvedBaseline }),
  ];
  const notes = [
    `${Object.keys(scripts).length} declared script(s), ${reachable.size} reached from the entry corpus, ${unreachable.length} baselined as by-hand`,
    `${files.length} entry-corpus file(s) scanned`,
  ];
  return { ok: failures.length === 0, failures, notes, scripts, reachable, unreachable, baseline: resolvedBaseline };
}

/** The baseline `--update` writes: current unreachable set, reasons preserved. */
export function updatedBaseline({ scripts, reachable, baseline }, { updatedAt }) {
  const known = {};
  for (const name of Object.keys(scripts).sort()) {
    if (reachable.has(name)) continue;
    known[name] = typeof baseline?.knownUnreachable?.[name] === "string"
      ? baseline.knownUnreachable[name]
      : "";
  }
  return { updatedAt, knownUnreachable: known };
}

// ── CLI wrapper ──────────────────────────────────────────────────────
const isMain =
  process.argv[1] &&
  import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, "/")}`).href;

if (isMain) {
  const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
  const asJson = process.argv.includes("--json");
  const update = process.argv.includes("--update");
  const result = inspect({ root });

  if (update) {
    const baseline = updatedBaseline(
      { scripts: result.scripts, reachable: result.reachable, baseline: result.baseline },
      { updatedAt: new Date().toISOString().slice(0, 10) },
    );
    const missing = Object.entries(baseline.knownUnreachable)
      .filter(([, reason]) => reason.trim().length === 0)
      .map(([name]) => name);
    writeFileSync(
      resolve(root, BASELINE_PATH),
      `${JSON.stringify(baseline, null, 2)}\n`,
      "utf8",
    );
    console.log(
      `[check-script-reachability] wrote ${BASELINE_PATH}: ` +
        `${Object.keys(baseline.knownUnreachable).length} unreachable script(s)`,
    );
    if (missing.length > 0) {
      // A baseline without a reason is an oversight with a filename, not a
      // decision: keep the run red until the reasons are written.
      console.error(
        `[check-script-reachability] FAIL ${missing.length} entry(ies) have no ` +
          `reason yet — write one per script, then re-run: ${missing.join(", ")}`,
      );
      process.exitCode = 1;
    }
  } else if (asJson) {
    console.log(JSON.stringify({ ...result, reachable: [...result.reachable].sort() }, null, 2));
    process.exitCode = result.ok ? 0 : 1;
  } else {
    for (const note of result.notes) console.log(`[check-script-reachability] ${note}`);
    for (const failure of result.failures) {
      console.error(`[check-script-reachability] FAIL ${failure}`);
    }
    if (!result.ok) {
      console.error(
        "[check-script-reachability] a declared script that nothing runs and a `npm run` " +
          "nobody declares are both release-path failures, not cosmetic ones",
      );
      process.exitCode = 1;
    } else {
      console.log(
        `ok: ${Object.keys(result.scripts).length} declared script(s), no phantom ` +
          `target, no phantom reference, ${result.unreachable.length} baselined`,
      );
    }
  }
}
