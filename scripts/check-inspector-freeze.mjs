/**
 * scripts/check-inspector-freeze.mjs — the inspector freeze (O-1).
 *
 * This gate enforces the inspector freeze (O-1): documentation-format
 * inspectors (a `check:*` gate whose sole job is validating the shape,
 * format, volume or hygiene of docs) may not grow freely. Adding one
 * requires an ADR that (a) names the concrete failure it prevents and
 * (b) shows it is catchable by the negative-path gate-drift-detection job
 * (ADR-028). Security and language inspectors are the protected core and
 * may keep growing without this ADR gate.
 *
 * This gate enforces that rule mechanically:
 *
 *   1. Parse the `check` script in package.json and list every gate it
 *      runs (plus `lint`).
 *   2. Every gate must be registered in KNOWN_GATES below with a
 *      category. A gate in the chain that is NOT registered is *new*.
 *   3. A new gate is accepted only if:
 *        - it is a protected-core category (`security` / `language`), or
 *        - at least one ADR names the gate (`check:<name>`
 *          appears in the ADR body), proving the documentation-format
 *          freeze was justified per O-1.
 *   4. A new gate whose category is `docs` (or unknown) with no naming
 *      ADR fails the check with an actionable message.
 *
 * Registration shape (extends KNOWN_GATES, keep it sorted):
 *   "check:example": "docs"        // documentation-format → needs an ADR
 *   "check:example": "security"    // protected core → no ADR needed
 *   "check:example": "language"    // protected core → no ADR needed
 *   "check:example": "meta"        // other (build/chunks/lint…) → no ADR
 *
 * Usage:
 *   node scripts/check-inspector-freeze.mjs   # verify
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
// ADRs live in docs/ as ADR-###-*.md (AGENTS.md §2). An earlier version
// pointed at docs/adr/ — a directory that never existed — so the corpus was
// always empty and the "new gate must be named by an ADR" rule was
// unreachable. Pinned by check-inspector-freeze.test.mjs (FS regression).
const ADR_DIR = join(ROOT, "docs");

/**
 * The freeze baseline. Every gate currently in the `npm run check` chain
 * is registered with its category. Do NOT add new `docs` gates here
 * without an ADR that names them (see the header).
 */
const KNOWN_GATES = {
  // Protected core — security (may grow without an ADR).
  "check:csp": "security",
  "check:extension-csp": "security",
  "check:extension-dist": "security",
  "check:license-keys": "security",
  "check:server-log-ip-privacy": "security",
  "check:static-brand": "meta",
  "check:audit-drift": "security",
  "check:override-cve": "security",
  // Paid-route enforcement: a route under a paid namespace must be
  // entitlement-gated. Security core, like check:license-keys.
  "check:pro-routes": "security",
  // Declared-dependency vulnerabilities: every advisory classified as ours or
  // inherited, with the minimal bump. Security core, like check:override-cve.
  "check:direct-cve": "security",
  "check:direct-cve:dev": "security",
  "check:env": "security",
  "check:workflows": "security",
  "check:http-config": "security",
  "check:compose-config": "security",
  "check:runtime-config": "security",
  // Open Core export boundary: prevents proprietary Pro source from entering
  // the MIT public tree and validates the exported license metadata.
  "check:open-core": "security",
  // Runtime Pro boundary: Core code must resolve Pro modules through the
  // pro-access seam; blocks erosion by new static Pro imports.
  "check:pro-imports": "security",

  // Protected core — language (may grow without an ADR).
  "check:i18n": "language",
  "check:english-only": "language",
  "check:no-unbounded-text": "language",
  "check:landing-free-plan": "language",
  "check:pocket-onboarding-copy": "language",

  // Frozen documentation-format inspectors (grandfathered; O-1).
  // The command cross-reference gate is governed by ADR-056: it prevents
  // release runbooks from teaching npm scripts that do not exist.
  "check:documented-doc-references": "docs",
  "check:documented-npm-commands": "docs",
  // NOTE: the three original Markdown gates were fused into
  // check:docs-markdown (ADR-040). The new gate is intentionally NOT
  // registered here — the freeze requires the ADR that names it to be
  // present in an ADR before the gate accepts it (self-enforcing).

  // Other / meta gates (not documentation-format; no ADR required).
  "check:brand-logo": "meta",
  "check:boundaries": "meta",
  "check:e2e-helpers": "meta",
  "check:baseline-drift": "meta",
  "check:baseline-gaps": "meta",
  "check:tailwind-drift": "meta",
  // Factual claim-drift (ADR-047): user-visible numbers must match the code
  // constants (password minimum, 24-word phrase, device limits, Argon2id MiB,
  // backup intervals, prices). Documentation-format gate: ADR-047 names the
  // concrete failure class and maps it onto ADR-028's drift-detection model.
  "check:claim-drift": "docs",
  // License claim-drift (ADR-048): the user-visible corpus (manuals, PDFs,
  // landings, legal pages, API metadata) must never mention a non-MIT
  // license, and the root MIT contract must stay intact. Documentation-format
  // gate: ADR-048 names the failure class and maps it onto ADR-028's
  // drift-detection model, like ADR-047 does for numeric claims.
  "check:license-claims": "docs",
  // gate: ADR-049 names the failure class (numeric figure drift between the
  // localized manuals and the pricing/license code) and maps it onto
  // ADR-028's drift-detection model, like ADR-048 does for license claims.
  "check:manual-figures": "docs",
  "check:page-figures": "docs",
  "check:landings-fresh": "meta",
  "plan:manual-figures": "docs",
  "check:rxdb17": "meta",
  "check:nginx-render": "meta",
  "check:sitemap-coverage": "meta",
  "check:seo": "meta",
  // Release-target confirmation (ADR-058): a release must not be prepared
  // against an unconfirmed repository target (provisional/placeholder slug,
  // no remote, or declared≠actual drift). The blocking variant guards the
  // release path (public export, launch smoke); the chain runs the advisory
  // variant so the signal stays visible in every check without turning the
  // whole chain red while the target is still being decided.
  "check:release-target": "meta",
  "check:release-target:advisory": "meta",
  "check:chunks": "meta",
  "check:inspector-freeze": "meta",
  lint: "meta",
};

/** Parse the gate tokens (check:* | lint) out of the `check` script chain. */
export function checkChain(pkg) {
  const script = pkg?.scripts?.check;
  if (typeof script !== "string" || script.trim().length === 0) {
    throw new Error("[check-inspector-freeze] package.json has no `check` script");
  }
  return new Set(
    [...script.matchAll(/(?:npm run )?(check:[a-z0-9:-]+|lint)/g)].map(
      (m) => m[1],
    ),
  );
}

/** Collect every ADR body. Handles missing directory gracefully. */
export function adrBodies() {
  let files = [];
  try {
    files = readdirSync(ADR_DIR).filter((f) => /^ADR-\d+.*\.md$/.test(f));
  } catch {
    /* ADR dir missing → treated as empty; the freeze still runs */
  }
  return files
    .map((f) => readFileSync(join(ADR_DIR, f), "utf8"))
    .join("\n");
}

/** Does any ADR name this gate (check:<name> appears in the body)? */
export function adrNamesGate(gate, bodies) {
  return bodies.includes(`check:${gate.replace(/^check:/, "")}`);
}

/** Run the freeze checks against in-memory fixtures. */
export function runInspectorFreezeChecks({ pkg, adrBody }) {
  const failures = [];
  const oks = [];
  const ok = (msg) => oks.push(msg);
  const fail = (msg) => failures.push(msg);

  const chain = checkChain(pkg);
  const sorted = [...chain].sort();

  for (const gate of sorted) {
    const category = KNOWN_GATES[gate];
    if (category !== undefined) {
      ok(`gate "${gate}" registered (${category})`);
      continue;
    }
    // New gate — apply the freeze.
    if (adrNamesGate(gate, adrBody)) {
      ok(`new gate "${gate}" justified by an ADR that names it`);
      continue;
    }
    fail(
      `new gate "${gate}" in the \`npm run check\` chain has no ADR naming it. ` +
        `The inspector freeze (O-1) requires an ADR that (a) names the concrete ` +
        `failure this documentation-format inspector prevents and (b) shows it is ` +
        `catchable by gate-drift-detection (ADR-028). Write that ADR mentioning ` +
        `\`${gate}\`, or register the gate in KNOWN_GATES with an explicit ` +
        `category (\`security\`/` + "`language`" + ` are the protected core and need no ADR).`,
    );
  }

  return { ok: failures.length === 0, oks, failures };
}

// ── CLI wrapper ──────────────────────────────────────────────────────
const isMain =
  process.argv[1] &&
  import.meta.url ===
    new URL(`file://${process.argv[1].replace(/\\/g, "/")}`).href;

if (isMain) {
  const pkg = JSON.parse(
    readFileSync(join(ROOT, "package.json"), "utf8"),
  );
  const result = runInspectorFreezeChecks({
    pkg,
    adrBody: adrBodies(),
  });
  for (const o of result.oks) console.log(`[check-inspector-freeze] ok ${o}`);
  for (const f of result.failures) console.error(`[check-inspector-freeze] FAIL ${f}`);
  if (!result.ok) {
    console.error("[check-inspector-freeze] freeze violation — unregistered gate in check chain");
    process.exit(1);
  }
  console.log("[check-inspector-freeze] freeze intact");
}
