#!/usr/bin/env node
/**
 * scripts/patch-free-plan-copy.mjs — one-shot Free-card migration for the 24
 * secondary locales.
 *
 * WHY: the 30-locale expansion scaffolded scripts/translations/<locale>.json
 * for the 24 secondary locales by copying the English Free card verbatim (23
 * of the 24 were byte-identical to en.json), and ja kept its own translated
 * card in primary-locale order. Both shapes fail check-landing-free-plan:
 *   - the 23 shells carry no localized wedge line -> rule B (wedge-missing),
 *   - ja leads with the wedge -> rule C (wedge-position; secondary = slot 1).
 *
 * WHERE THE COPY COMES FROM — nothing here is authored. Every description and
 * feature line is lifted verbatim from scripts/landing-translations.json
 * (priceFreeDesc / priceFreeItems): the versioned NATIVE source for these 24
 * locales, which check-landing-free-plan already validates as its "secondary
 * source", and whose ja payload is the exact fixture the gate's own test uses
 * for "clean secondary card, wedge at slot 1". That source also encodes the
 * ✅/❌ split as a leading `<span aria-hidden='true'>❌</span>`; the template
 * re-emits the marker from `feature.included`, so the span is stripped here
 * rather than copied into `text`.
 *
 * Invariants (every one aborts before writing anything):
 *   - the target has a pricing.plans[0] object,
 *   - the secondary payload is present and is NOT the English shell (proof the
 *     copy is native, so this can never re-fill English into a locale),
 *   - the payload passes the gate's own checkFreeCardContent(payload, lang, 1),
 *     i.e. it is clean as a secondary card before it is anywhere near a file,
 *   - JSON.stringify(JSON.parse(raw)) reproduces the file byte-for-byte, so
 *     the diff is exactly the Free card and never a reformat,
 *   - the file's existing EOL style and final-newline state are preserved
 *     (these 24 are LF with no trailing newline, unlike the CRLF primary set).
 *
 * Usage:
 *   node scripts/patch-free-plan-copy.mjs           # migrate
 *   node scripts/patch-free-plan-copy.mjs --check   # report drift, write nothing
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { checkFreeCardContent } from "./check-landing-free-plan.mjs";

const ROOT = process.cwd();
const TRANS_DIR = join(ROOT, "scripts", "translations");
const SECONDARY_SOURCE = join(ROOT, "scripts", "landing-translations.json");
const EN = join(TRANS_DIR, "en.json");

const CHECK_ONLY = process.argv.includes("--check");

const FAILURES = [];
const fail = (msg) => FAILURES.push(msg);

/** `<span aria-hidden='true'>❌</span> P2P sync` → { included: false, text: "P2P sync" }. */
const PRO_PREFIX = /^<span aria-hidden='true'>❌<\/span>\s*/;

function toFeature(item, lang) {
  const s = String(item);
  const pro = PRO_PREFIX.test(s);
  const text = s.replace(PRO_PREFIX, "").trim();
  if (/[<>]/.test(text)) {
    fail(`${lang}: feature markup survived the ❌ strip: ${text.slice(0, 80)}`);
  }
  return { included: !pro, text };
}

const secondary = JSON.parse(readFileSync(SECONDARY_SOURCE, "utf8"));
const en = JSON.parse(readFileSync(EN, "utf8"));

const changed = [];
const fresh = [];

// Pass 1 — validate every locale and compute the payload, writing nothing.
// Pass 2 only runs when this pass is clean, so a single bad locale can never
// leave the other 23 files mutated.
const pending = [];
if (FAILURES.length === 0) {
  for (const [lang, src] of Object.entries(secondary)) {
    const items = Array.isArray(src.priceFreeItems) ? src.priceFreeItems : [];
    const description = String(src.priceFreeDesc ?? "").trim();

    if (items.length < 3) {
      fail(`${lang}: priceFreeItems has ${items.length} entries`);
      continue;
    }
    if (!description) {
      fail(`${lang}: priceFreeDesc is empty`);
      continue;
    }
    if (description === String(en.pricing.plans[0].description)) {
      fail(`${lang}: priceFreeDesc is the English shell — no native copy to migrate`);
      continue;
    }

    const features = items.map((it) => toFeature(it, lang));
    const payload = {
      description,
      features: features.map((f) => f.text),
    };
    const problems = checkFreeCardContent(payload, lang, 1);
    if (problems.length) {
      fail(
        `${lang}: secondary payload is not gate-clean — ` +
          problems.map((p) => `${p.rule} (${p.detail})`).join("; "),
      );
      continue;
    }

    const file = join(TRANS_DIR, `${lang}.json`);
    const raw = readFileSync(file, "utf8");
    const parsed = JSON.parse(raw);

    if (JSON.stringify(parsed, null, 2) !== raw) {
      fail(`${lang}: JSON round-trip is not byte-exact — refusing to reformat`);
      continue;
    }

    const plan = parsed.pricing?.plans?.[0];
    if (!plan) {
      fail(`${lang}: pricing.plans[0] missing`);
      continue;
    }

    if (
      plan.description === description &&
      JSON.stringify(plan.features) === JSON.stringify(features)
    ) {
      fresh.push(lang);
      continue;
    }

    pending.push({ lang, file, parsed, plan, description, features, raw });
  }
}

if (FAILURES.length) {
  console.error(`patch-free-plan-copy: ${FAILURES.length} violation(s), nothing written:\n`);
  for (const f of FAILURES) console.error(`  - ${f}`);
  process.exit(2);
}

// Pass 2 — all locales validated, so the writes can be applied.
for (const { lang, file, parsed, plan, description, features, raw } of pending) {
  plan.description = description;
  plan.features = features;
  if (!CHECK_ONLY) {
    const eol = raw.includes("\r\n") ? "\r\n" : "\n";
    const trailing = /\n$/.test(raw) ? eol : "";
    writeFileSync(file, JSON.stringify(parsed, null, 2).replace(/\n/g, eol) + trailing, "utf8");
  }
  changed.push(lang);
}

const verb = CHECK_ONLY ? "stale" : "rewritten";
console.log(
  `patch-free-plan-copy: ${changed.length} locale(s) ${verb}, ` +
    `${fresh.length} already on the versioned copy` +
    (changed.length ? `\n  ${verb}: ${changed.join(", ")}` : ""),
);
if (CHECK_ONLY && changed.length) process.exit(1);
