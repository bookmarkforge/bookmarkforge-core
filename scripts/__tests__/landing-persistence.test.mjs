// @vitest-environment node
/**
 * scripts/__tests__/landing-persistence.test.mjs
 *
 * "The language and the light/dark choice survive a tour of the landings."
 *
 * Two independent gaps made that untrue, and both are wiring problems — cheap
 * to reintroduce, invisible without a real browser:
 *
 *   1. THEME. The choice did persist in localStorage, but landing.js is loaded
 *      with `defer`, so every navigation painted the default theme first and
 *      switched afterwards: a flash on each hop. A pre-paint hook cannot be an
 *      inline <script> (the shipped CSP is `script-src 'self'`), so it is the
 *      tiny external public/theme-init.js — which means every landing <head>
 *      must load it before the stylesheet, and it must agree with landing.js on
 *      the storage key. public/404.js used a DIFFERENT key and element, so the
 *      theme reset whenever a broken link sent the visitor there.
 *
 *   2. LANGUAGE. Only `?lang=xx` recorded the preference (the click handler
 *      looked for `href*="lang="`), but the 29 generated landings carry clean
 *      links (/es/, pinned by check:seo) — so choosing "English" on /es/ left
 *      ?lang=es in the cookie and the next visit to / was bounced straight back
 *      to /es/ on every host that negotiates. The visible page is now the
 *      signal, and hosts without server negotiation (Vercel) get the same
 *      redirect the nginx/Cloudflare/Netlify paths apply in the server.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LANDING_PAGES } from "../landing-registry.mjs";

const ROOT = process.cwd();
const PUBLIC = join(ROOT, "public");
const read = (rel) => readFileSync(join(PUBLIC, rel), "utf8");

const LANDING_JS = read("landing.js");
const THEME_INIT = read("theme-init.js");
const FOR_404_JS = read("404.js");

describe("pre-paint theme bootstrap", () => {
  it("exists and stays tiny enough to block rendering", () => {
    const size = statSync(join(PUBLIC, "theme-init.js")).size;
    expect(size).toBeLessThan(2048);
  });

  it("uses the same storage key and convention as landing.js", () => {
    expect(THEME_INIT).toContain("bmf_landing_theme");
    expect(LANDING_JS).toContain("localStorage.getItem('bmf_landing_theme')");
    expect(LANDING_JS).toContain("localStorage.setItem('bmf_landing_theme'");
    // Dark is the absence of the attribute on both sides.
    expect(THEME_INIT).not.toMatch(/setAttribute\('data-theme',\s*'dark'\)/);
    expect(LANDING_JS).toContain("html.removeAttribute('data-theme')");
  });

  it("is never loaded as an inline script (the CSP forbids it)", () => {
    expect(THEME_INIT).not.toContain("document.createElement('script')");
    expect(THEME_INIT).not.toMatch(/<\/script>/i);
    expect(THEME_INIT).not.toContain("innerHTML");
  });
});

describe("every landing loads the bootstrap before anything renders", () => {
  const pages = [
    ...LANDING_PAGES.filter((p) => p.file.startsWith("public/") || p.file === "index.html").map(
      (p) => p.file.replace(/^public\//, ""),
    ),
    "index.html",
    "landing.html",
    "help.html",
    "offline.html",
    "privacy-and-terms.html",
    "pocket-alternative.html",
  ];

  it("covers the whole landing surface", () => {
    expect(pages.length).toBeGreaterThan(20);
  });

  for (const page of [...new Set(pages)]) {
    it(`${page} loads /theme-init.js before the stylesheet and landing.js`, () => {
      const html = read(page);
      const init = html.indexOf('src="/theme-init.js"');
      const style = html.indexOf('<link rel="stylesheet"');
      const landing = html.indexOf('src="/landing.js"');
      expect(init, `${page}: theme-init.js missing`).toBeGreaterThan(-1);
      expect(style).toBeGreaterThan(-1);
      expect(init).toBeLessThan(style);
      if (landing > -1) expect(init).toBeLessThan(landing);
      // Synchronous on purpose: deferred/async would defeat the pre-paint hook.
      expect(html).toMatch(/<script src="\/theme-init\.js"><\/script>/);
    });
  }
});

describe("the 404 page shares the theme instead of resetting it", () => {
  it("reads and writes the landing's key", () => {
    expect(FOR_404_JS).toContain("bmf_landing_theme");
    expect(FOR_404_JS).toMatch(/localStorage\.setItem\('bmf_landing_theme'/);
    expect(FOR_404_JS).toMatch(/localStorage\.getItem\('bmf_landing_theme'\)/);
  });

  it("keeps the legacy key so an existing pick is not lost", () => {
    expect(FOR_404_JS).toMatch(/localStorage\.getItem\('theme'\)/);
  });
});

describe("landing.js — the language choice survives the tour", () => {
  it("records the language the page was served in", () => {
    expect(LANDING_JS).toMatch(/const servedLanguage = pageLanguage\(\);/);
    expect(LANDING_JS).toMatch(/setLangPreference\(servedLanguage\)/);
  });

  it("treats the EN root landing as English and general pages as no language", () => {
    // p === '/' → en; the language-agnostic pages must resolve to null, or an
    // ES visitor reading /privacy-and-terms would be pinned to EN.
    expect(LANDING_JS).toMatch(/p === '\/' \|\| p === '\/index\.html' \|\| p === '\/landing\.html'/);
    expect(LANDING_JS).toMatch(/return null;/);
  });

  it("records the choice from the clean links too, before the host redirects", () => {
    expect(LANDING_JS).toMatch(/match\(\/\^\\\/\(\[a-z\]\{2\}\)\\\/\?\$\/\)/);
  });

  it("mirrors the preference into localStorage (the help-link mapping reads it)", () => {
    expect(LANDING_JS).toMatch(/localStorage\.setItem\('bf_lang', lang\)/);
    expect(LANDING_JS).toMatch(/localStorage\.getItem\('bf_lang'\)/);
  });

  it("redirects the EN landing to the stored locale on hosts that cannot", () => {
    expect(LANDING_JS).toMatch(/function applyStoredLanguagePreference\(\)/);
    expect(LANDING_JS).toMatch(/if \(servedLanguage !== 'en'\) return;/);
    // A ?lang= in the URL always wins, and the call site runs after it.
    expect(LANDING_JS).toMatch(/params\.get\('lang'\)/);
    expect(LANDING_JS.indexOf("applyStoredLanguagePreference();")).toBeGreaterThan(
      LANDING_JS.indexOf("handleLangParam();"),
    );
  });

  it("keeps the icons optional so a page without them cannot abort the file", () => {
    expect(LANDING_JS).toMatch(/if \(themeIconLight\) themeIconLight\.style\.display/);
    expect(LANDING_JS).toMatch(/if \(themeToggle\) themeToggle\.setAttribute\('aria-pressed'/);
  });

  it("still satisfies the check:seo language contract", () => {
    for (const token of [
      "setLangPreference",
      "document.cookie",
      "bf_lang",
      "nf_lang",
      "URLSearchParams",
      "LANG_CODES",
    ]) {
      expect(LANDING_JS).toContain(token);
    }
  });
});

// `npm run build` copies public/index.html over the emitted dist/index.html,
// so the Vercel artifact is covered above. `npm run build:ci` (the Dockerfile
// and CI path) does NOT run that copy step: there dist/index.html is the
// Vite-processed ROOT index.html, and nginx falls back to it via
// `try_files $uri $uri/ /index.html`. The root entry is the same EN landing
// page, so it needs the same pre-paint hook — otherwise the only host that
// ships it flashes the default theme on every hop.
describe("the Vite entry (repo-root index.html) keeps the same pre-paint hook", () => {
  const html = readFileSync(join(ROOT, "index.html"), "utf8");

  it("loads /theme-init.js synchronously before the stylesheet", () => {
    const init = html.indexOf('src="/theme-init.js"');
    const style = html.indexOf('<link rel="stylesheet"');
    expect(init, "root index.html: theme-init.js missing").toBeGreaterThan(-1);
    expect(style).toBeGreaterThan(-1);
    expect(init).toBeLessThan(style);
    expect(html).toMatch(/<script src="\/theme-init\.js"><\/script>/);
  });

  it("loads landing.js so the language choice is recorded there too", () => {
    expect(html).toContain('src="/landing.js"');
  });
});

describe("theme-init.js is shipped", () => {
  it("is copied to the deployment output by the landing-asset step", () => {
    const copyScript = readFileSync(join(ROOT, "scripts", "copy-landing-assets.mjs"), "utf8");
    expect(copyScript).toContain("'theme-init.js'");
  });

  it("exists in public/ so Vite's publicDir copy picks it up", () => {
    expect(existsSync(join(PUBLIC, "theme-init.js"))).toBe(true);
  });
});
