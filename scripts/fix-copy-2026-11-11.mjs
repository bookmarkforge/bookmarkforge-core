#!/usr/bin/env node
/**
 * One-shot copy fix (2026-11-11):
 *  1. beforeAfter.after.items[4] promised sync to every user; P2P sync is Pro.
 *     Append a "(Pro)" qualifier in all 30 landing translations + pocket-en.
 *  2. en.json features.items sync line gets "Requires Pro." (matches es style).
 *  3. The six primary locales lacked the BYOK Free-card line that the other
 *     24 already carry — insert it before the knowledge-graph item.
 *  4. scripts/landing-translations.json (legacy secondary source still read
 *     by check-landing-free-plan) carries stale caps (2 500 / 300) — normalize
 *     to the real freeCap 500.
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TDIR = join(ROOT, "scripts", "translations");

const PRO_SUFFIX = { ja: "（Pro）", ko: "(Pro)", zh: "（Pro）" };
const suffixFor = (lang) => PRO_SUFFIX[lang] ?? " (Pro)";

const BYOK = {
  en: "AI with your own API key (you pay the provider)",
  es: "IA con tu propia clave de API (tú pagas al proveedor)", // i18n-allow: ES landing translation string
  fr: "IA avec votre propre clé API (vous payez le fournisseur)",
  de: "KI mit Ihrem eigenen API-Schlüssel (Sie zahlen den Anbieter)",
  it: "IA con la tua chiave API (paghi il provider)",
  pt: "IA com a sua própria chave de API (você paga ao provedor)",
};

const PRIMARY = ["en", "es", "fr", "de", "it", "pt"];
const changed = [];

function load(p) {
  return JSON.parse(readFileSync(p, "utf8"));
}
function save(p, obj) {
  writeFileSync(p, JSON.stringify(obj, null, 2) + "\n", "utf8");
}

// 1+2+3 — per-locale landing translations
for (const file of readdirSync(TDIR).filter((f) => f.endsWith(".json"))) {
  const lang = file.replace(/\.json$/, "");
  const p = join(TDIR, file);
  const d = load(p);
  let touched = false;

  const baItems = d.beforeAfter?.after?.items;
  if (Array.isArray(baItems) && baItems.length === 5 && typeof baItems[4] === "string") {
    const sfx = suffixFor(lang);
    if (!baItems[4].includes("Pro") && !baItems[4].includes("pro")) {
      baItems[4] = baItems[4] + sfx;
      touched = true;
    }
  }

  if (lang === "en") {
    const syncFeat = d.features?.items?.find((x) => x?.title === "Sync across your devices");
    if (syncFeat && !/Pro/i.test(syncFeat.text)) {
      syncFeat.text = syncFeat.text.replace(/\.?\s*$/, " Requires Pro.");
      touched = true;
    }
  }

  if (PRIMARY.includes(lang)) {
    const feats = d.pricing?.plans?.[0]?.features;
    if (Array.isArray(feats) && BYOK[lang]) {
      const hasByok = feats.some((f) => /api/i.test(f?.text ?? ""));
      if (!hasByok) {
        // Insert before the knowledge-graph item (index 3 in all six primaries).
        const graphIdx = feats.findIndex((f) => /graph|grafo|graphe|graph|grafo|grafo/i.test(f?.text ?? ""));
        const at = graphIdx > 0 ? graphIdx : 3;
        feats.splice(at, 0, { included: true, text: BYOK[lang] });
        touched = true;
      }
    }
  }

  if (touched) {
    save(p, d);
    changed.push(file);
  }
}

// 4 — legacy secondary source: stale bookmark caps. Both fields carry ONLY
// the cap figure (item0 leads with it; desc is a single parenthetical), so a
// scoped numeric replace is safe — no other quantity lives in these strings.
const CAP_RE = /2[\s.,  ]?500|(?<![\d.,  ])300(?![\d.,  ])/g;
const lp = join(ROOT, "scripts", "landing-translations.json");
const T = load(lp);
for (const [, t] of Object.entries(T)) {
  if (!t || typeof t !== "object") continue;
  if (Array.isArray(t.priceFreeItems) && typeof t.priceFreeItems[0] === "string") {
    t.priceFreeItems[0] = t.priceFreeItems[0].replace(CAP_RE, "500");
  }
  if (typeof t.priceFreeDesc === "string") {
    t.priceFreeDesc = t.priceFreeDesc.replace(CAP_RE, "500");
  }
}
save(lp, T);

console.log("changed:", changed.join(", "));
console.log("legacy landing-translations.json normalized");
