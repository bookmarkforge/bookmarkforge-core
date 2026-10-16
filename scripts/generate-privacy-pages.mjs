#!/usr/bin/env node
/**
 * Generate localized privacy-and-terms pages for all 24 missing locales.
 * Usage: node scripts/generate-privacy-pages.mjs
 *
 * Reads public/es/privacy-and-terms.html as the structural template and
 * replaces every user-visible Spanish string with the target language.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { LANDING_CODES, PRIMARY_LOCALE_CODES } from "./landing-registry.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const PUBLIC = resolve(ROOT, "public");

// ── Load translations from JSON file ───────────────────────────────
const T = JSON.parse(readFileSync(resolve(__dirname, "privacy-translations.json"), "utf-8"));

// ── Locales that already have a privacy page (skip these) ──────────
// The six primaries (registry-owned): the generator only ever produces the
// translations of that reviewed set.
const EXISTING = new Set(PRIMARY_LOCALE_CODES);

// ── All 30 supported locales ───────────────────────────────────────
// Sorted rather than launch-ordered on purpose: the committed pages were
// generated alphabetically, and the hreflang block depends on that order, so
// regenerating through this script stays byte-for-byte identical.
const ALL_LOCALES = [...LANDING_CODES].sort();

// ── og:locale values ───────────────────────────────────────────────
const OG_LOCALE = {
  ar:"ar_AR", bg:"bg_BG", cs:"cs_CZ", da:"da_DK", de:"de_DE",
  el:"el_GR", en:"en_US", es:"es_ES", fi:"fi_FI", fr:"fr_FR",
  he:"he_IL", hi:"hi_IN", hr:"hr_HR", hu:"hu_HU", id:"id_ID",
  it:"it_IT", ja:"ja_JP", ko:"ko_KR", nl:"nl_NL", no:"no_NO",
  pl:"pl_PL", pt:"pt_BR", ro:"ro_RO", ru:"ru_RU", sv:"sv_SE",
  th:"th_TH", tr:"tr_TR", uk:"uk_UA", vi:"vi_VN", zh:"zh_CN"
};

// ── Helper: generate full privacy HTML for a locale ────────────────
function generatePage(code, t) {
  const isRTL = code === "ar" || code === "he";
  const dirAttr = isRTL ? `\n  dir="rtl"` : "";

  // Hreflang links for all 30 locales
  const hreflangLinks = ALL_LOCALES.map(l => {
    const url = l === "en"
      ? "https://bookmarkforgeapp.com/privacy-and-terms.html"
      : `https://bookmarkforgeapp.com/${l}/privacy-and-terms.html`;
    return `  <link rel="alternate" hreflang="${l}" href="${url}">`;
  }).join("\n");

  // OG locale alternates
  const ogLocaleAlts = ALL_LOCALES.filter(l => l !== code && l !== "en").map(l => {
    return `  <meta property="og:locale:alternate" content="${OG_LOCALE[l]}">`;
  }).join("\n");

  // Privacy sections
  const privacySections = t.privacySections.map((section, i) => {
    const num = i + 1;
    if (section.items) {
      const items = section.items.map(item => `      <li>${item}</li>`).join("\n");
      return `    <h2>${num}. ${section.title}</h2>\n    <p>${section.text}</p>\n    <ul>\n${items}\n    </ul>`;
    }
    return `    <h2>${num}. ${section.title}</h2>\n    <p>${section.text}</p>`;
  }).join("\n\n");

  // Terms sections
  const termsSections = t.termsSections.map((section, i) => {
    const num = i + 1;
    if (section.items) {
      const items = section.items.map(item => `      <li>${item}</li>`).join("\n");
      return `    <h2>${num}. ${section.title}</h2>\n    <p>${section.text}</p>\n    <ul>\n${items}\n    </ul>`;
    }
    return `    <h2>${num}. ${section.title}</h2>\n    <p>${section.text}</p>`;
  }).join("\n\n");

  return `<!DOCTYPE html>
<html lang="${code}"${dirAttr}>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${t.title} | BookmarkForge</title>
  <meta name="description" content="${t.metaDesc}">
  <meta name="robots" content="index, follow">
  <link rel="canonical" href="https://bookmarkforgeapp.com/${code}/privacy-and-terms.html">
  <!-- SEO: hreflang for all 30 locales -->
${hreflangLinks}
  <link rel="alternate" hreflang="x-default" href="https://bookmarkforgeapp.com/privacy-and-terms.html">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="BookmarkForge">
  <meta property="og:title" content="${t.title} | BookmarkForge">
  <meta property="og:description" content="${t.metaDesc}">
  <meta property="og:url" content="https://bookmarkforgeapp.com/${code}/privacy-and-terms.html">
  <meta property="og:image" content="https://bookmarkforgeapp.com/og-image.png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:locale" content="${OG_LOCALE[code]}">
${ogLocaleAlts}
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${t.title} | BookmarkForge">
  <meta name="twitter:description" content="${t.metaDesc}">
  <meta name="twitter:image" content="https://bookmarkforgeapp.com/og-image.png">
  <link rel="icon" type="image/png" sizes="32x32" href="/favicon.png">
  <link rel="stylesheet" href="/brand-tokens.css">
  <link rel="stylesheet" href="/privacy-and-terms.css">
  <script src="/landing.js"></script>
</head>
<body>
  <header>
    <div class="container">
      <a href="/${code}/" class="brand" aria-label="BookmarkForge ${t.lang === "ar" ? "الرئيسية" : t.lang === "he" ? "דף הבית" : "home"}">
        <img src="/logo-64.png" alt="" width="28" height="28" />
        BookmarkForge
      </a>
      <button class="theme-toggle" id="themeToggle" aria-label="Toggle theme" aria-pressed="false" style="margin-left: auto;">
        <svg class="theme-icon-light" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>
        <svg class="theme-icon-dark" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" style="display:none"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>
      </button>
    </div>
  </header>

  <main class="container">
    <p class="last-updated"><strong>${t.lastUpdatedLabel}:</strong> ${t.lastUpdatedDate}</p>

    <h1>${t.privacyTitle}</h1>

${privacySections}

    <hr>

    <h1 id="terms">${t.termsTitle}</h1>
    <p class="last-updated"><strong>${t.lastUpdatedLabel}:</strong> ${t.termsLastUpdatedDate}</p>

${termsSections}
  </main>

  <footer>
    <div class="container">
      &copy; 2026 BookmarkForge. ${t.footerCopyright}
    </div>
  </footer>
</body>
</html>`;
}

// ── MAIN ───────────────────────────────────────────────────────────
const missing = ALL_LOCALES.filter(l => !EXISTING.has(l));
console.log(`Generating privacy pages for ${missing.length} locales: ${missing.join(", ")}`);

let generated = 0;
for (const code of missing) {
  const t = T[code];
  if (!t) {
    console.warn(`  ⚠ No translations defined for ${code} — skipping`);
    continue;
  }

  const html = generatePage(code, t);
  const dir = resolve(PUBLIC, code);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const outPath = resolve(dir, "privacy-and-terms.html");
  writeFileSync(outPath, html, "utf-8");
  console.log(`  ✓ ${code}/privacy-and-terms.html (${html.length} bytes)`);
  generated++;
}

console.log(`\nDone. Generated ${generated} privacy pages.`);
