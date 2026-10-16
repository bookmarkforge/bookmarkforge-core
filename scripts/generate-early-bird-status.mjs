#!/usr/bin/env node
/**
 * scripts/generate-early-bird-status.mjs — the producer for
 * public/api/early-bird-status.json.
 *
 * WHY THIS EXISTS
 * ---------------
 * public/landing.js probes `/api/early-bird-status` to decide whether the
 * pricing card sells the Early Bird ($59, first 200 licenses) or the Regular
 * price. It shipped WITHOUT a producer: there is no serverless layer in this
 * deployment (a static Vite build served behind a catch-all rewrite), so the
 * request was answered by the root landing document (`landing.html`; it was
 * the root `index.html` before the duplicates were removed) with
 * `Content-Type: text/html`, the
 * `await response.json()` threw, and the function's `catch {}` swallowed it.
 * The sell-out switch — the one thing that code exists for — could never fire,
 * and the landing would have kept advertising an exhausted Early Bird
 * checkout. The probe also downloaded a full landing document per call (every
 * 5 minutes, per open tab).
 *
 * WHAT IT IS (AND IS NOT)
 * -----------------------
 * It is generated from the SAME source of truth the app reads: `phase` in
 * src/constants/pricing.ts. Landing and in-app copy therefore cannot disagree
 * about which price is active, and the documented phase flip
 * (docs/pricing-decision.md §3) updates both in one commit.
 *
 * It is NOT a live stock probe: a static file cannot ask Whop how many of the
 * 200 licenses are left. It answers "is the Early Bird phase still on?", which
 * is exactly the predicate the client-side switch acts on (`available`).
 * A live count would need a serverless function plus a WHOP_API_KEY — until
 * that exists, `earlyBird.phase` is the contract, and the landing keeps
 * failing closed (static Early Bird copy) whenever this file is absent.
 *
 * Fail-closed by construction: a pricing.ts that cannot be parsed throws, and
 * the caller exits 2 — it never writes an `available: true` guess.
 *
 * Usage:
 *   node scripts/generate-early-bird-status.mjs           # write the file
 *   node scripts/generate-early-bird-status.mjs --check   # verify, write nothing
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import process from "node:process";

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(HERE, "..");

/** Where the client looks for it. Changing this means changing landing.js. */
export const STATUS_URL = "/api/early-bird-status.json";
/** Path of the committed artifact, relative to public/. */
export const STATUS_RELPATH = "api/early-bird-status.json";

export const PRICING_SOURCE = join(ROOT, "src", "constants", "pricing.ts");

/** The phase ladder, in the order pricing.ts declares it. */
export const PHASES = ["early", "regular", "full"];

/** `pro` price per phase comes from this tier field — cross-checked below. */
const TIER_PRICE_FIELD = {
  early: "earlyBirdPrice",
  regular: "regularPrice",
  full: "fullPrice",
};

function must(condition, message) {
  if (!condition) throw new Error(message);
}

/** The `earlyBird: { ... }` slice of pricing.ts, or throw. */
function earlyBirdBlock(src) {
  const start = src.indexOf("earlyBird:");
  must(start !== -1, "src/constants/pricing.ts has no `earlyBird` block (refactor?)");
  return src.slice(start);
}

/** One `early: { label, pro }` sub-block of `earlyBird.phases`. */
function phaseBlock(src, phase) {
  const re = new RegExp(`(?:^|\\s)${phase}:\\s*\\{([\\s\\S]*?)\\n\\s*\\}`, "m");
  const m = re.exec(src);
  must(m, `src/constants/pricing.ts is missing the \`${phase}\` phase block`);
  return m[1];
}

/**
 * Extract the pricing truth this artifact is derived from. Throws on anything
 * it cannot read — a guessed status is worse than a failed build.
 */
export function readPricingTruth(src) {
  const earlyBird = earlyBirdBlock(src);

  const phaseMatch = /phase:\s*["']([a-zA-Z]+)["']/.exec(earlyBird);
  must(phaseMatch, "`earlyBird.phase` not found (refactor?)");
  const phase = phaseMatch[1];
  must(PHASES.includes(phase), `unknown earlyBird.phase "${phase}" (expected one of ${PHASES.join(", ")})`);

  const enabledMatch = /enabled:\s*(true|false)/.exec(earlyBird);
  must(enabledMatch, "`earlyBird.enabled` not found (refactor?)");
  const enabled = enabledMatch[1] === "true";

  const capMatch = /caps:\s*\{[^}]*\bearly:\s*(\d+)/.exec(earlyBird);
  must(capMatch, "`earlyBird.caps.early` not found (refactor?)");
  const cap = Number(capMatch[1]);

  const phases = {};
  for (const name of PHASES) {
    const block = phaseBlock(earlyBird, name);
    const labelMatch = /label:\s*"([^"]+)"/.exec(block);
    must(labelMatch, `\`earlyBird.phases.${name}.label\` not found (refactor?)`);
    const proMatch = /pro:\s*(\d+)/.exec(block);
    must(proMatch, `\`earlyBird.phases.${name}.pro\` not found (refactor?)`);
    phases[name] = { label: labelMatch[1], pro: Number(proMatch[1]) };
  }

  // pricing.ts may be read through a copy (Open Core export, fixtures); the
  // tier cross-check only runs when the Pro tier is present in the same file.
  const proTier = /id:\s*"pro",([\s\S]*?)limitations:/.exec(src)?.[1];
  if (proTier) {
    for (const name of PHASES) {
      const field = TIER_PRICE_FIELD[name];
      const m = new RegExp(`${field}:\\s*(\\d+)`).exec(proTier);
      must(m, `Pro tier is missing \`${field}\` for the \`${name}\` phase (refactor?)`);
      must(
        Number(m[1]) === phases[name].pro,
        `price drift: Pro.${field} = ${m[1]} but earlyBird.phases.${name}.pro = ${phases[name].pro}`,
      );
    }
  }

  must(phases.early.pro < phases.regular.pro, "the Early Bird price must undercut the regular price");
  must(cap > 0, `earlyBird.caps.early must be a positive license count, got ${cap}`);

  const currencyMatch = /currency:\s*"([A-Z]{3})"/.exec(src);
  must(currencyMatch, "no `currency` in src/constants/pricing.ts (refactor?)");

  return { phase, enabled, cap, phases, currency: currencyMatch[1] };
}

/**
 * The status the landing acts on. `available` is the single boolean the
 * client switches on: false ⇒ stop presenting the Early Bird offer. A
 * disabled Early Bird is not available either, whatever the phase says.
 */
export function deriveStatus(src) {
  const truth = readPricingTruth(src);
  const active = truth.phases[truth.phase];
  return {
    available: truth.enabled && truth.phase === "early",
    phase: truth.phase,
    label: active.label,
    price: active.pro,
    regularPrice: truth.phases.regular.pro,
    cap: truth.cap,
    currency: truth.currency,
  };
}

/** Byte-exact serialization: LF, 2-space indent, trailing newline. */
export function renderStatusJson(status) {
  return `${JSON.stringify(status, null, 2)}\n`;
}

export function deriveStatusJson(src = readFileSync(PRICING_SOURCE, "utf8")) {
  return renderStatusJson(deriveStatus(src));
}

function main() {
  const checkOnly = process.argv.includes("--check");
  const target = join(ROOT, "public", STATUS_RELPATH);

  let json;
  try {
    json = deriveStatusJson();
  } catch (error) {
    console.error(`[generate-early-bird-status] FAIL: ${error.message}`);
    process.exit(2);
  }

  if (checkOnly) {
    const committed = existsSync(target) ? readFileSync(target, "utf8") : null;
    if (committed === json) {
      console.log(`[generate-early-bird-status] ok: public/${STATUS_RELPATH} matches pricing.ts`);
      return;
    }
    console.error(
      `[generate-early-bird-status] FAIL: public/${STATUS_RELPATH} ` +
        (committed === null ? "is missing" : "is stale") +
        " (fix: node scripts/generate-early-bird-status.mjs)",
    );
    process.exit(1);
  }

  const status = JSON.parse(json);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, json, "utf8");
  console.log(
    `✓ Generated public/${STATUS_RELPATH} — phase "${status.phase}", ` +
      `available ${status.available}, $${status.price} ${status.currency}`,
  );
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main();
}
