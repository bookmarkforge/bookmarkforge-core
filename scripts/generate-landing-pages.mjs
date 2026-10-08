#!/usr/bin/env node
/**
 * Generate localized landing pages for all 24 missing locales.
 * Usage: node scripts/generate-landing-pages.mjs
 *
 * Reads public/es.html as the structural template and replaces
 * every user-visible Spanish string with the target language.
 * Also injects the correct hreflang graph, OG image, canonical, etc.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const PUBLIC = resolve(ROOT, "public");

// ── Load translations from JSON file ───────────────────────────────
const T = JSON.parse(readFileSync(resolve(__dirname, "landing-translations.json"), "utf-8"));

// ── Locales that already have a landing page (skip these) ──────────
const EXISTING = new Set(["en", "es", "fr", "de", "pt", "it"]);

// ── All 30 supported locales ───────────────────────────────────────
const ALL_LOCALES = [
  "ar","bg","cs","da","de","el","en","es","fi","fr",
  "he","hi","hr","hu","id","it","ja","ko","nl","no",
  "pl","pt","ro","ru","sv","th","tr","uk","vi","zh"
];

// ── Native language names ──────────────────────────────────────────
const NATIVE_NAME = {
  ar:"العربية", bg:"Български", cs:"Čeština", da:"Dansk", de:"Deutsch",
  el:"Ελληνικά", en:"English", es:"Español", fi:"Suomi", fr:"Français",
  he:"עברית", hi:"हिन्दी", hr:"Hrvatski", hu:"Magyar", id:"Bahasa Indonesia",
  it:"Italiano", ja:"日本語", ko:"한국어", nl:"Nederlands", no:"Norsk",
  pl:"Polski", pt:"Português", ro:"Română", ru:"Русский", sv:"Svenska",
  th:"ไทย", tr:"Türkçe", uk:"Українська", vi:"Tiếng Việt", zh:"中文"
};

// ── og:locale values ───────────────────────────────────────────────
const OG_LOCALE = {
  ar:"ar_AR", bg:"bg_BG", cs:"cs_CZ", da:"da_DK", de:"de_DE",
  el:"el_GR", en:"en_US", es:"es_ES", fi:"fi_FI", fr:"fr_FR",
  he:"he_IL", hi:"hi_IN", hr:"hr_HR", hu:"hu_HU", id:"id_ID",
  it:"it_IT", ja:"ja_JP", ko:"ko_KR", nl:"nl_NL", no:"no_NO",
  pl:"pl_PL", pt:"pt_BR", ro:"ro_RO", ru:"ru_RU", sv:"sv_SE",
  th:"th_TH", tr:"tr_TR", uk:"uk_UA", vi:"vi_VN", zh:"zh_CN"
};

// ── RTL languages ──────────────────────────────────────────────────
const RTL = new Set(["ar", "he"]);

// ── Helper: generate full HTML for a locale ────────────────────────
function generatePage(code, t) {
  // Use localized OG image if it exists, otherwise fall back to default
  const ogImageFile = resolve(PUBLIC, `og-image-${code}.png`);
  const ogImageUrl = existsSync(ogImageFile)
    ? `https://bookmarkforgeapp.com/og-image-${code}.png`
    : "https://bookmarkforgeapp.com/og-image.png";

  const hreflangLinks = ALL_LOCALES.map(l => {
    const url = l === "en" ? "https://bookmarkforgeapp.com/" : `https://bookmarkforgeapp.com/${l}/`;
    return `  <link rel="alternate" hreflang="${l}" href="${url}">`;
  }).join("\n");

  const ogLocaleAlts = ALL_LOCALES.filter(l => l !== code && l !== "en").map(l => {
    return `  <meta property="og:locale:alternate" content="${OG_LOCALE[l]}">`;
  }).join("\n");

  const ldJsonGraph = JSON.stringify({
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        "@id": `https://bookmarkforgeapp.com/${code}/#website`,
        "url": `https://bookmarkforgeapp.com/${code}/`,
        "name": "BookmarkForge",
        "description": t.heroSub,
        "inLanguage": code,
        "potentialAction": {
          "@type": "SearchAction",
          "target": {
            "@type": "EntryPoint",
            "urlTemplate": `https://bookmarkforgeapp.com/${code}/?s={search_term_string}`
          },
          "query-input": "required name=search_term_string"
        },
        "publisher": { "@id": "https://bookmarkforgeapp.com/#organization" }
      },
      {
        "@type": "Organization",
        "@id": "https://bookmarkforgeapp.com/#organization",
        "name": "BookmarkForge",
        "url": "https://bookmarkforgeapp.com/",
        "logo": { "@type": "ImageObject", "url": "https://bookmarkforgeapp.com/logo.png", "width": 64, "height": 64 },
        "email": "bookmarkforge@proton.me"
      },
      {
        "@type": "SoftwareApplication",
        "@id": `https://bookmarkforgeapp.com/${code}/#software`,
        "name": "BookmarkForge",
        "applicationCategory": "ProductivityApplication",
        "operatingSystem": "Web",
        "url": `https://bookmarkforgeapp.com/${code}/`,
        "image": ogImageUrl,
        "description": t.heroSub,
        "offers": [
          { "@type": "Offer", "name": "Free", "price": "0", "priceCurrency": "USD", "description": "2,500 bookmarks. Forever free." },
          { "@type": "Offer", "name": "Pro Lifetime v1 — Early Bird", "price": "59", "priceCurrency": "USD", "description": "Early Bird 200. Lifetime of v1, 12 months features, security forever, v2 60% off.", "priceValidUntil": "2026-12-31" },
          { "@type": "Offer", "name": "Pro Lifetime v1", "price": "79", "priceCurrency": "USD", "description": "Regular. Lifetime of v1." }
        ],
        "featureList": [
          "100% local storage", "End-to-end encryption", "Offline-first", "AI search", "Notion-style editor", "P2P sync"
        ]
      },
      {
        "@type": "FAQPage",
        "@id": `https://bookmarkforgeapp.com/${code}/#faq`,
        "mainEntity": [
          {
            "@type": "Question",
            "name": t.faq1Q,
            "acceptedAnswer": { "@type": "Answer", "text": t.faq1A }
          },
          {
            "@type": "Question",
            "name": t.faq2Q,
            "acceptedAnswer": { "@type": "Answer", "text": t.faq2A }
          },
          {
            "@type": "Question",
            "name": t.faq3Q || "Payment & refund?",
            "acceptedAnswer": { "@type": "Answer", "text": t.faq3A || "30-day refund via Whop." }
          },
          ...(t.faq5Q ? [{ "@type": "Question", "name": t.faq5Q, "acceptedAnswer": { "@type": "Answer", "text": t.faq5A } }] : []),
          ...(t.faq6Q ? [{ "@type": "Question", "name": t.faq6Q, "acceptedAnswer": { "@type": "Answer", "text": t.faq6A } }] : [])
        ].filter(Boolean)
      }
    ]
  }, null, 2);

  const isRTL = RTL.has(code);
  const dirAttr = isRTL ? `\n  dir="rtl"` : "";
  const skipLinkText = t.lang === "ar" ? "انتقل إلى المحتوى الرئيسي" : t.lang === "he" ? "דלג לתוכן הראשי" : "Skip to main content";

  // Nav language links — all 30 locales (clean paths; the ?lang= query
  // form was dropped from visible links in f83eb3a)
  const navLangLinks = ALL_LOCALES.map(l => {
    const nativeName = NATIVE_NAME[l];
    const href = l === "en" ? "/" : `/${l}/`;
    return `        <a href="${href}" hreflang="${l}" lang="${l}">${nativeName}</a>`;
  }).join("\n");

  // Footer language links — same 30 locales
  const footerLangLinks = ALL_LOCALES.map(l => {
    const nativeName = NATIVE_NAME[l];
    const href = l === "en" ? "/" : `/${l}/`;
    return `          <li><a href="${href}">${nativeName}</a></li>`;
  }).join("\n");

  // Feature items
  const featureItems = t.featItems.map(item => `          <div class="feature-item">
            <h3>${item}</h3>
          </div>`).join("\n");

  // Price free items
  const priceFreeItems = t.priceFreeItems.map(item => `              <li>${item}</li>`).join("\n");

  // Price pro items
  const priceProItems = t.priceProItems.map(item => `              <li><span aria-hidden="true">✅</span> ${item}</li>`).join("\n");

  // Privacy items
  const privItems = t.privItems.map(item => `          <div class="feature-item">
            <h3>${item}</h3>
          </div>`).join("\n");

  return `<!DOCTYPE html>
<html lang="${code}"${dirAttr}>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="theme-color" content="#00aeef" media="(prefers-color-scheme: light)">
  <meta name="theme-color" content="#111827" media="(prefers-color-scheme: dark)">
  <meta name="description" content="${t.metaDesc}">
  <title>${t.title}</title>
  <link rel="icon" type="image/png" sizes="32x32" href="/favicon.png">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png">
  <link rel="manifest" href="/manifest.json">
  <!-- SEO: canonical + hreflang -->
  <link rel="canonical" href="https://bookmarkforgeapp.com/${code}/">
${hreflangLinks}
  <link rel="alternate" hreflang="x-default" href="https://bookmarkforgeapp.com/">
  <!-- Open Graph (og-image.png is 1200x630) -->
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="BookmarkForge">
  <meta property="og:title" content="${t.title}">
  <meta property="og:description" content="${t.metaDesc}">
  <meta property="og:url" content="https://bookmarkforgeapp.com/${code}/">
  <meta property="og:image" content="${ogImageUrl}">
  <meta property="og:image:alt" content="BookmarkForge — private AI-powered bookmark and notes app">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:locale" content="${OG_LOCALE[code]}">
${ogLocaleAlts}
  <!-- Twitter Cards -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${t.title}">
  <meta name="twitter:description" content="${t.metaDesc}">
  <meta name="twitter:image" content="${ogImageUrl}">
  <link rel="stylesheet" href="/brand-tokens.css">
  <link rel="stylesheet" href="/landing.css">
  <!-- Structured data: WebSite / Organization / SoftwareApplication / FAQPage -->
  <script type="application/ld+json">
${ldJsonGraph}
  </script>
</head>
<body>
  <a href="#main" class="skip-link">${skipLinkText}</a>

  <header class="nav" role="banner">
    <div class="nav-inner">
      <a href="/${code}/" class="nav-brand" aria-label="BookmarkForge ${t.lang === "ar" ? "الرئيسية" : t.lang === "he" ? "דף הבית" : "home"}">
        <img src="/logo-64.png" width="32" height="32" alt="" />
        <span>BookmarkForge</span>
      </a>

      <nav class="nav-links" aria-label="Navigation">
        <a href="#features">${t.featItems[0] || "Features"}</a>
        <a href="#ai">${t.aiTag}</a>
        <a href="#privacy">${t.privItems[0] || "Privacy"}</a>
        <a href="#pricing">${t.priceTitle}</a>

${navLangLinks}
        <a href="/app" class="btn-primary nav-cta">${t.heroCtaPrimary}</a>
      </nav>

      <button class="theme-toggle" id="themeToggle" aria-label="Toggle theme" aria-pressed="false">
        <svg class="theme-icon-light" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>
        <svg class="theme-icon-dark" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" style="display:none"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>
      </button>
    </div>
  </header>

  <main id="main">
    <!-- Hero -->
    <section class="hero" aria-labelledby="hero-title">
      <div class="container">
        <div class="hero-content">
          <span class="hero-badge">${t.heroBadge}</span>
          <h1 id="hero-title">${t.heroTitle}</h1>
          <p class="hero-subtitle">${t.heroSub}</p>
          <div class="hero-ctas">
            <a href="/app" class="btn-primary">${t.heroCtaPrimary}</a>
            <a href="#pricing" class="btn-secondary">${t.heroCtaSecondary}</a>
          </div>
          <div class="hero-pillars">
            ${t.heroPillars.map(p => `<span>${p}</span>`).join("\n            ")}
          </div>
        </div>
      </div>
    </section>

    <!-- Pocket Alternative Section -->
    <section id="alternativa-pocket" class="comparison-section" aria-labelledby="alternativa-pocket-title">
      <div class="container">
        <div class="section-header">
          <span class="section-tag">${t.pocketTag}</span>
          <h2 id="alternativa-pocket-title">${t.pocketTitle}</h2>
          <p class="section-subtitle">${t.pocketDesc}</p>
        </div>
        <div class="features-grid-3">
          <div class="feat-card">
            <h3>${t.pocketFeat1Title}</h3>
            <p>${t.pocketFeat1Desc}</p>
          </div>
          <div class="feat-card">
            <h3>${t.pocketFeat2Title}</h3>
            <p>${t.pocketFeat2Desc}</p>
          </div>
          <div class="feat-card">
            <h3>${t.pocketFeat3Title}</h3>
            <p>${t.pocketFeat3Desc}</p>
          </div>
        </div>
        <div class="center-cta">
          <a href="/app" class="btn-primary">${t.pocketCta}</a>
          <a href="/pocket-alternative" class="btn-link">${t.pocketLink}</a>
        </div>
      </div>
    </section>

    <!-- Features Section -->
    <section id="features" class="features-section" aria-labelledby="features-title">
      <div class="container">
        <div class="section-header">
          <span class="section-tag">${t.featTag}</span>
          <h2 id="features-title">${t.featTitle}</h2>
        </div>
        <div class="features-grid">
${featureItems}
        </div>
      </div>
    </section>

    <!-- AI Section -->
    <section id="ai" class="ai-section" aria-labelledby="ai-title">
      <div class="container">
        <div class="section-header">
          <span class="section-tag">${t.aiTag}</span>
          <h2 id="ai-title">${t.aiTitle}</h2>
          <p class="section-subtitle">${t.aiSub}</p>
        </div>

        <div class="ai-split">
          <div class="ai-column">
            <h3>${t.aiProvidersTitle}</h3>
            <ul class="providers-list">
              <li>WebLLM local (TinyLlama, Llama-3.2-1B/3B, Phi-3.5-mini) — Pro</li>
              <li>Ollama local (any model you run)</li>
              <li>Google Gemini cloud (your API key)</li>
              <li>OpenAI / GPT-4o cloud (your API key)</li>
              <li>Anthropic Claude cloud (your API key)</li>
              <li>Groq cloud (your API key)</li>
              <li>Custom / OpenRouter via custom provider (your API key)</li>
            </ul>
          </div>

          <div class="ai-column">
            <h3>${t.aiModesTitle}</h3>
            <div class="mode-items">
              <div class="mode-item">
                <h4>${t.aiMode1Title}</h4>
                <p>${t.aiMode1Desc}</p>
              </div>
              <div class="mode-item">
                <h4>${t.aiMode2Title}</h4>
                <p>${t.aiMode2Desc}</p>
              </div>
              <div class="mode-item">
                <h4>${t.aiMode3Title}</h4>
                <p>${t.aiMode3Desc}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- Privacy Section -->
    <section id="privacy" class="privacy-section" aria-labelledby="privacy-title">
      <div class="container">
        <div class="section-header">
          <h2 id="privacy-title">${t.privTitle}</h2>
          <p class="section-subtitle">${t.privSub}</p>
        </div>
        <div class="features-grid">
${privItems}
        </div>
      </div>
    </section>

    <!-- Pricing Section -->
    <section id="pricing" class="pricing-section" aria-labelledby="pricing-title">
      <div class="container">
        <div class="section-header">
          <h2 id="pricing-title">${t.priceTitle}</h2>
          <p class="section-subtitle">${t.priceSub}</p>
        </div>
        <div class="pricing-cards three-col">
          <div class="price-card ">
            <h3>${t.priceFreeName}</h3>
            <div class="price">${t.priceFreePrice}<span>${t.priceFreeInterval}</span></div>
            <p>${t.priceFreeDesc}</p>
            <ul>
${priceFreeItems}
            </ul>
            <a href="/app" class="btn-outline ">${t.priceFreeCta}</a>
          </div>
          <div class="price-card popular">
            <span class="badge">Most Popular</span>
            <span class="badge badge-early">Early Bird — 200</span>
            <h3>${t.priceProName}</h3>
            <div class="price">${t.priceProPrice}<span>${t.priceProInterval}</span></div>
            <p>${t.priceProDesc}</p>
            <ul>
${priceProItems}
            </ul>
            <a href="https://whop.com/checkout/plan_9oP0DrBuqFEb7" class="btn-primary btn-block" target="_blank" rel="noopener noreferrer">${t.priceProCta}</a>
            <a href="https://whop.com/checkout/plan_FTmrDjPDKqQVC" class="btn-secondary btn-block" target="_blank" rel="noopener noreferrer">Get Pro $79 Regular</a>
          </div>
        </div>
        <p class="pricing-legal">${t.priceLegal || 'Lifetime license for BookmarkForge v1. Includes all v1.x updates and 12 months of feature updates. Security updates forever. Future majors 60% off for owners. 30-day refund via Whop.'}</p>
      </div>
    </section>

    <!-- FAQ Section -->
    <section class="faq-section" aria-labelledby="faq-title">
      <div class="container">
        <h2 id="faq-title">${t.faqTitle}</h2>
        <div class="faq-grid">
          <div class="faq-item">
            <h3>${t.faq1Q}</h3>
            <p>${t.faq1A}</p>
          </div>
          <div class="faq-item">
            <h3>${t.faq2Q}</h3>
            <p>${t.faq2A}</p>
          </div>
          <div class="faq-item">
            <h3>${t.faq3Q}</h3>
            <p>${t.faq3A}</p>
          </div>
          <div class="faq-item">
            <h3>${t.faq4Q}</h3>
            <p>${t.faq4A}</p>
          </div>
        </div>
      </div>
    </section>

    <!-- CTA Section -->
    <section class="final-cta">
      <div class="container">
        <h2>${t.ctaTitle}</h2>
        <p>${t.ctaDesc}</p>
        <div class="ctas">
          <a href="/app" class="btn-primary">${t.ctaPrimary}</a>
          <a href="#pricing" class="btn-secondary">${t.ctaSecondary}</a>
        </div>
        <p class="note">${t.ctaNote}</p>
      </div>
    </section>
  </main>

  <footer class="footer">
    <div class="container footer-grid">
      <div class="footer-brand">
        <span>BookmarkForge</span>
        <p>${t.footerTagline}</p>
      </div>
      <div class="footer-links">
        <h4>${t.footerProduct}</h4>
        <ul>
${t.footerProductItems.map((item, i) => `          <li><a href="${t.footerProductLinks[i]}">${item}</a></li>`).join("\n")}
        </ul>
      </div>
      <div class="footer-links">
        <h4>${t.footerResources}</h4>
        <ul>
${t.footerResourcesItems.map((item, i) => `          <li><a href="${t.footerResourcesLinks[i]}">${item}</a></li>`).join("\n")}
        </ul>
      </div>
      <div class="footer-links">
        <h4>${t.footerLangs}</h4>
        <ul>
${footerLangLinks}
        </ul>
      </div>
      <div class="footer-links">
        <h4>${t.footerSupport}</h4>
        <ul>
${t.footerSupportItems.map(item => `          <li><a href="mailto:bookmarkforge@proton.me">${item}</a></li>`).join("\n")}
        </ul>
      </div>
    </div>
    <div class="footer-bottom">
      <p>${t.footerCopyright}</p>
      <a href="/${code}/privacy-and-terms.html">${t.footerPrivacy}</a> · <a href="/${code}/privacy-and-terms.html#terms">${t.footerTerms}</a> · <a href="mailto:bookmarkforge@proton.me">bookmarkforge@proton.me</a>
    </div>
  </footer>

  <script src="/landing.js" defer></script>
</body>
</html>`;
}

// ── MAIN ───────────────────────────────────────────────────────────
const missing = ALL_LOCALES.filter(l => !EXISTING.has(l));
console.log(`Generating landing pages for ${missing.length} locales: ${missing.join(", ")}`);

let generated = 0;
for (const code of missing) {
  const t = T[code];
  if (!t) {
    console.warn(`  ⚠ No translations defined for ${code} — skipping`);
    continue;
  }
  const html = generatePage(code, t);
  const outPath = resolve(PUBLIC, `${code}.html`);
  writeFileSync(outPath, html, "utf-8");
  console.log(`  ✓ ${code}.html (${html.length} bytes)`);
  generated++;
}

console.log(`\nDone. Generated ${generated} landing pages.`);
console.log(`\nNext steps:`);
console.log(`  1. Create OG images: public/og-image-{code}.png for each locale`);
console.log(`  2. Add _redirects entries: /{code}  /{code}.html  200`);
console.log(`  3. Add sitemap.xml entries for each locale`);
console.log(`  4. Update privacy pages in public/{code}/privacy-and-terms.html`);
console.log(`  5. Run: npm run check:seo && npm run build`);
