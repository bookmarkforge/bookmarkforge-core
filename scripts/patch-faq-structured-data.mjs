#!/usr/bin/env node
/**
 * scripts/patch-faq-structured-data.mjs — one-shot FAQPage completion.
 *
 * WHY: the landing template emits FAQPage JSON-LD from `structuredData.faq`
 * but renders the visible FAQ from `faq.items` (landing.njk), and the two are
 * meant to mirror each other. 26 locales carry both; ar, bg and ja have a
 * populated visible FAQ and an EMPTY `structuredData.faq`, so their pages ship
 * a FAQPage with `mainEntity: []` — invalid markup for a FAQPage, and the one
 * thing check-seo rejects on the real tree.
 *
 * WHERE THE COPY COMES FROM — nothing here is authored: the JSON-LD is DERIVED
 * from the locale's own visible `faq.items`, with anchor tags flattened to
 * their text (`<a href="mailto:...">x@y</a>` → `x@y`), which is exactly what
 * the 26 populated locales already store. Google requires FAQPage markup to
 * match the on-page content, so deriving it is also the correct direction.
 *
 * Guards (all abort before writing; the derivation rule is self-checking):
 *   - every locale must have a non-empty visible `faq.items`,
 *   - the rule must reproduce `structuredData.faq` byte-for-byte on every
 *     locale that already carries one, except the two known divergent locales
 *     below (whose markup carries a Founder-SLA clause the visible FAQ does
 *     not show — pre-existing drift, reported rather than silently rewritten),
 *   - the derived text must be markup-free, since it goes into JSON-LD,
 *   - JSON.stringify(parse(raw)) must reproduce the file byte-for-byte, so the
 *     diff is exactly the FAQPage array.
 *
 * Usage:
 *   node scripts/patch-faq-structured-data.mjs           # fill
 *   node scripts/patch-faq-structured-data.mjs --check   # report, write nothing
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const TRANS_DIR = join(ROOT, "scripts", "translations");
const CHECK_ONLY = process.argv.includes("--check");

/**
 * Locales whose stored markup is a newer edit than their visible FAQ (the
 * Founder-SLA clause). They already have data, so they are out of scope here:
 * leaving them alone keeps this migration from rewriting copy, and the drift
 * stays visible instead of being papered over by the derived value.
 */
const KNOWN_DIVERGENT = new Set(["de", "pt"]);

const ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: String.fromCharCode(39),
  nbsp: "\u00A0", mdash: "\u2014", ndash: "\u2013", hellip: "\u2026",
  rsquo: "\u2019", lsquo: "\u2018", ldquo: "\u201C", rdquo: "\u201D",
};

/** Flatten anchors/markup to the plain text FAQPage wants. */
function stripMarkup(s) {
  let current = String(s);
  for (;;) {
    const open = current.indexOf("<");
    if (open === -1) {
      return current.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, g) => {
        if (g[0] === "#") {
          const code = g[1].toLowerCase() === "x" ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10);
          return String.fromCodePoint(code);
        }
        return ENTITIES[g.toLowerCase()] ?? m;
      });
    }
    const close = current.indexOf(">", open + 1);
    if (close === -1) return current.slice(0, open);
    current = current.slice(0, open) + current.slice(close + 1);
  }
}

const derive = (t) =>
  (t.faq?.items ?? []).map(({ question, answer }) => ({
    question: stripMarkup(question),
    answer: stripMarkup(answer),
  }));

const FAILURES = [];
const fail = (msg) => FAILURES.push(msg);

// ── Pass 1 — validate every locale, write nothing ────────────────────────────
const pending = [];
const fresh = [];
const divergent = [];

for (const file of readdirSync(TRANS_DIR).filter((f) => f.endsWith(".json")).sort()) {
  const lang = file.replace(".json", "");
  const path = join(TRANS_DIR, file);
  const raw = readFileSync(path, "utf8");
  const parsed = JSON.parse(raw);

  const visible = parsed.faq?.items ?? [];
  if (!visible.length) {
    fail(`${lang}: no visible faq.items to derive from`);
    continue;
  }

  const derived = derive(parsed);
  for (const { question, answer } of derived) {
    if (/[<>]/.test(question) || /[<>]/.test(answer)) {
      fail(`${lang}: markup survived flattening: ${(question + answer).slice(0, 80)}`);
    }
  }

  const stored = parsed.structuredData?.faq ?? [];
  if (stored.length) {
    if (JSON.stringify(stored) === JSON.stringify(derived)) fresh.push(lang);
    else if (KNOWN_DIVERGENT.has(lang)) divergent.push(lang);
    else fail(`${lang}: derivation no longer reproduces the stored FAQPage`);
    continue;
  }

  if (JSON.stringify(parsed, null, 2) !== raw) {
    fail(`${lang}: JSON round-trip is not byte-exact — refusing to reformat`);
    continue;
  }

  pending.push({ lang, path, parsed, derived, raw });
}

if (FAILURES.length) {
  console.error(`patch-faq-structured-data: ${FAILURES.length} violation(s), nothing written:\n`);
  for (const f of FAILURES) console.error(`  - ${f}`);
  process.exit(2);
}

// ── Pass 2 — writes ─────────────────────────────────────────────────────────
const filled = [];
for (const { lang, path, parsed, derived, raw } of pending) {
  parsed.structuredData.faq = derived;
  if (!CHECK_ONLY) {
    const eol = raw.includes("\r\n") ? "\r\n" : "\n";
    const trailing = /\n$/.test(raw) ? eol : "";
    writeFileSync(path, JSON.stringify(parsed, null, 2).replace(/\n/g, eol) + trailing, "utf8");
  }
  filled.push(lang);
}

const verb = CHECK_ONLY ? "to fill" : "filled";
console.log(
  `patch-faq-structured-data: ${filled.length} ${verb}` +
    (filled.length ? `: ${filled.join(", ")}` : "") +
    `\n  ${fresh.length} already mirror the visible FAQ` +
    `\n  ${divergent.length} left alone (markup newer than the visible FAQ): ${divergent.join(", ")}`,
);
if (CHECK_ONLY && filled.length) process.exit(1);
