/**
 * scripts/check-override-cve.mjs — CVE gate for the `overrides` block.
 *
 * `overrides` is the one place where a dependency version is chosen by hand.
 * That makes it the one place where a CVE fix can be silently undone: pinning
 * `adm-zip` back to a vulnerable release (or leaving a pin that the lockfile
 * never actually applied — the exact state this repo shipped with
 * `sharp: ^0.35.4` while package-lock.json still resolved 0.35.3) reopens the
 * advisory without touching a line of our code. `npm audit` alone cannot tell
 * that story apart from an unfixable transitive advisory owned by an upstream
 * package; this gate makes the difference explicit.
 *
 * Three contracts, checked against `npm audit --omit=dev --json` (the same
 * profile CI runs) and the committed package-lock.json. The pins are
 * dependency overrides, so the gate reads the lockfile exactly like npm
 * does: a top-level pin governs every instance of that package, while a
 * nested pin governs only its parent's subtree:
 *
 *   A. A pinned package must not be reported vulnerable. If an override
 *      targets a package that `npm audit` still flags, the pin is either
 *      pointing at an old version or failing to apply — both are CI red.
 *      `fixAvailable` is printed so the fix is one edit away.
 *   B. Every pin must actually apply. Each pinned package must resolve in
 *      package-lock.json to a version its spec accepts (exact, `^` and `~`
 *      are understood; anything else is treated as unknown and skipped
 *      rather than guessed at).
 *   C. No stale pins. A pinned package with no installed instance in the
 *      lockfile is dead weight that hides intent — an override that matches
 *      nothing also protects nothing.
 *
 * FAIL CLOSED: if `npm audit` cannot run (no network, registry outage) the
 * gate exits 2 with the npm error, because "audit is unavailable" is not
 * evidence that the pins are safe. `--audit-json <path>` consumes a
 * previously saved `npm audit --json` payload (used by CI to avoid auditing
 * the tree twice, and by the unit tests to stay offline).
 *
 * Usage:
 *   node scripts/check-override-cve.mjs
 *   node scripts/check-override-cve.mjs --audit-json audit.json
 *   node scripts/check-override-cve.mjs --include-dev
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { getAuditPayload } from "./npm-audit-payload.mjs";

// Shared single-acquisition audit (see npm-audit-payload.mjs). The alias
// keeps the historical export name for tests and consumers.
export { getAuditPayload as runNpmAudit };

// Deliberately process.cwd() (not import.meta.url): vitest rewrites module
// URLs to a non-file scheme, so fileURLToPath(new URL("..", import.meta.url))
// throws when the gate is imported by its test. Both the CLI and vitest run
// from the repo root.
const ROOT = process.cwd();
const TAG = "[check-override-cve]";

/**
 * Flatten the `overrides` block into `{ name, spec, path }` pins.
 *
 * package.json accepts both shapes: a direct `"pkg": "1.2.3"` and a nested
 * `"parent": { "pkg": "1.2.3" }` that only applies under that parent. Both
 * pin a version by hand, so both must be audited.
 */
export function collectOverridePins(overrides, parent = []) {
  const pins = [];
  if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) {
    return pins;
  }
  for (const [key, value] of Object.entries(overrides)) {
    const path = [...parent, key];
    if (typeof value === "string") {
      pins.push({ name: key, spec: value, path: path.join(".") });
    } else if (value && typeof value === "object") {
      pins.push(...collectOverridePins(value, path));
    }
  }
  return pins;
}

/**
 * Installed instances a pin is responsible for, read from the lockfile.
 *
 * A top-level pin forces the version project-wide, so every instance of that
 * name in the tree must match it. A nested pin (`"parent": {"pkg": …}`)
 * only governs its parent's subtree: `node_modules/<parent>/node_modules/
 * <pkg>` when npm had to nest a copy, otherwise the hoisted
 * `node_modules/<pkg>`. Unrelated copies are deliberately ignored — eslint's
 * `ajv@6` is not evidence that the `rxdb.ajv` pin failed.
 */
export function resolvePinInstances(pin, lock) {
  const packages = lock?.packages ?? {};
  const instances = [];
  const push = (key) => {
    const version = packages[key]?.version;
    if (typeof version === "string") instances.push({ key, version });
  };

  const parentPath = pin.path.split(".").slice(0, -1).join("/node_modules/");
  if (parentPath) {
    const direct = `node_modules/${parentPath}/node_modules/${pin.name}`;
    push(direct);
    if (instances.length === 0) push(`node_modules/${pin.name}`);
    return instances;
  }

  for (const [key, meta] of Object.entries(packages)) {
    if (!key.startsWith("node_modules/")) continue;
    if (key.slice("node_modules/".length).split("/node_modules/").pop() !== pin.name) {
      continue;
    }
    if (typeof meta?.version === "string") instances.push({ key, version: meta.version });
  }
  return instances;
}

const EXACT_SPEC = /^\d+\.\d+\.\d+$/;
const CARET_SPEC = /^\^\d+\.\d+\.\d+$/;
const TILDE_SPEC = /^~\d+\.\d+\.\d+$/;

function parseVersion(version) {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(String(version ?? ""));
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function compare(a, b) {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

/**
 * Does `version` satisfy the pinned `spec`? Returns "ok" | "mismatch" |
 * "unknown". Only exact, caret and tilde specs are interpreted — a range
 * (`>=1.2.3`, `1.x`, `a || b`) returns "unknown" so the gate can never fail a
 * legitimate pin it does not fully understand.
 */
export function pinMatch(spec, version) {
  const pinned = parseVersion(spec.replace(/^[\^~]/, ""));
  const got = parseVersion(version);
  if (!pinned || !got) return "unknown";
  const trimmed = String(spec).trim();
  if (EXACT_SPEC.test(trimmed)) {
    return compare(got, pinned) === 0 ? "ok" : "mismatch";
  }
  if (CARET_SPEC.test(trimmed)) {
    // ^1.2.3 → same major, >= pin (major 0 keeps the same minor).
    if (compare(got, pinned) < 0) return "mismatch";
    return got[0] === pinned[0] && (pinned[0] !== 0 || got[1] === pinned[1])
      ? "ok"
      : "mismatch";
  }
  if (TILDE_SPEC.test(trimmed)) {
    // ~1.2.3 → same major.minor, >= pin.
    if (compare(got, pinned) < 0) return "mismatch";
    return got[0] === pinned[0] && got[1] === pinned[1] ? "ok" : "mismatch";
  }
  return "unknown";
}

/** One-line summary of the advisories carried by an audit entry. */
export function summarizeAdvisories(entry) {
  const advisories = (entry?.via ?? []).filter((v) => typeof v === "object");
  return advisories
    .map((a) => `${a.title ?? a.name ?? "advisory"} [${a.url ?? "no url"}]`)
    .join(" | ");
}

/**
 * Evaluate the three contracts. `audit` is a parsed `npm audit --json`
 * payload, `lock` the parsed package-lock.json. Returns the list of failure
 * strings (empty when the pins are clean). Pure — no I/O — so the unit tests
 * can drive every branch with synthetic inputs.
 */
export function evaluateOverridePins({ pins, lock, audit }) {
  const failures = [];
  const pinnedNames = new Set(pins.map((p) => p.name));

  for (const [name, entry] of Object.entries(audit?.vulnerabilities ?? {})) {
    if (!pinnedNames.has(name)) continue; // upstream-owned, not our pin
    const pinsForName = pins.filter((p) => p.name === name);
    const fix = entry.fixAvailable;
    const fixHint =
      fix && typeof fix === "object" && fix.version
        ? `fix available: ${fix.version}`
        : "no fix published by npm audit";
    failures.push(
      `pin A: override(s) ${pinsForName.map((p) => `${p.path}="${p.spec}"`).join(", ")} ` +
        `but "${name}" is still reported ${String(entry.severity ?? "?").toUpperCase()} ` +
        `(vulnerable range ${entry.range ?? "?"}) — ${summarizeAdvisories(entry)} — ${fixHint}`,
    );
  }

  for (const pin of pins) {
    const instances = resolvePinInstances(pin, lock);
    if (instances.length === 0) {
      failures.push(
        `pin C: override ${pin.path}="${pin.spec}" matches nothing installed in package-lock.json — ` +
          `stale pin (remove it, or fix the package name)`,
      );
      continue;
    }
    for (const { key, version } of instances) {
      const verdict = pinMatch(pin.spec, version);
      if (verdict === "mismatch") {
        failures.push(
          `pin B: override ${pin.path}="${pin.spec}" does not take effect — ` +
            `package-lock.json installs ${pin.name}@${version} at ${key}. Run npm install to refresh the lockfile.`,
        );
      }
    }
  }

  return failures;
}



/** Run the gate against the repo. Returns the failure list (prints ok lines). */
export function runCheck({ auditJsonPath = null, includeDev = false } = {}) {
  const failures = [];
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const pins = collectOverridePins(pkg.overrides);

  const lockPath = join(ROOT, "package-lock.json");
  if (!existsSync(lockPath)) {
    failures.push("package-lock.json is missing — override pins cannot be verified");
  }
  const lock = existsSync(lockPath)
    ? JSON.parse(readFileSync(lockPath, "utf8"))
    : { packages: {} };

  let audit;
  if (auditJsonPath) {
    if (!existsSync(auditJsonPath)) {
      failures.push(`--audit-json ${auditJsonPath}: file not found`);
      audit = { vulnerabilities: {} };
    } else {
      audit = JSON.parse(readFileSync(auditJsonPath, "utf8"));
    }
  } else {
    audit = getAuditPayload({ includeDev });
  }

  failures.push(...evaluateOverridePins({ pins, lock, audit }));

  const advisories = Object.keys(audit?.vulnerabilities ?? {});
  if (failures.length === 0) {
    console.log(
      `${TAG} ok  ${pins.length} override pin(s) — none of them resolves a vulnerable package, ` +
        `all applied in package-lock.json (audit reported ${advisories.length} advisory source(s), ` +
        `all upstream-owned)`,
    );
    for (const pin of pins) {
      const resolved = resolvePinInstances(pin, lock)
        .map((i) => `${i.version} (${i.key})`)
        .join(", ");
      console.log(`${TAG} ok  ${pin.path}="${pin.spec}" → ${pin.name}: ${resolved}`);
    }
  }
  return failures;
}

// Run only when executed directly (importable for tests).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2);
  const auditJsonIdx = argv.indexOf("--audit-json");
  const auditJsonPath = auditJsonIdx === -1 ? null : (argv[auditJsonIdx + 1] ?? null);
  if (auditJsonIdx !== -1 && !auditJsonPath) {
    console.error(`${TAG} FAIL: --audit-json requires a path`);
    process.exit(2);
  }
  let failures;
  try {
    failures = runCheck({
      auditJsonPath,
      includeDev: argv.includes("--include-dev"),
    });
  } catch (error) {
    console.error(`${TAG} FAIL (fail-closed): ${error instanceof Error ? error.message : String(error)}`);
    process.exit(2);
  }
  if (failures.length > 0) {
    for (const f of failures) {
      console.error(`${TAG} FAIL: ${f}`);
    }
    console.error(`${TAG} FAIL: ${failures.length} override-pin violation(s)`);
    process.exit(1);
  }
  process.exit(0);
}
