#!/usr/bin/env node
/**
 * scripts/generate-landing-namespace.mjs — emits the `landing` i18next
 * namespace from the landing translation sources.
 *
 * WHY A GENERATED NAMESPACE. The public landing is pre-rendered static HTML
 * (scripts/templates/landing/*.njk), so it never boots i18next and never
 * downloads a locale payload. The app shell, however, must be able to render
 * public marketing copy on the client (a client-rendered landing surface, an
 * embedded pricing block, the `/` marketing shell in a host that serves the
 * SPA there) WITHOUT pulling those strings into the app's boot payload. Two
 * namespaces, two files, one source of truth:
 *
 *   app      public/locales/<lng>.json          (UI + AI assistant, eager)
 *   landing  public/locales/landing/<lng>.json  (public copy, on demand)
 *
 * Sources: scripts/translations/<lng>.json — the same nested files the static
 * build renders. Splitting them by hand would drift; this generator keeps the
 * runtime namespace a pure projection of that source.
 *
 * Usage: node scripts/generate-landing-namespace.mjs [--check]
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();
const SOURCE_DIR = join(ROOT, "scripts", "translations");
const OUTPUT_DIR = join(ROOT, "public", "locales", "landing");

/**
 * Marketing sections every public surface may need. Deliberately excludes
 * `help` and `structuredData`: the Help Center is its own static page and the
 * schema.org graph is server-rendered, so neither belongs in a client payload.
 */
const SECTIONS = [
  "lang",
  "langName",
  "dir",
  "title",
  "description",
  "ogTitle",
  "ogDescription",
  "ogImage",
  "ogImageAlt",
  "twitterTitle",
  "twitterDescription",
  "twitterImage",
  "skipLink",
  "navBrandAria",
  "navAriaLabel",
  "navLinks",
  "navCta",
  "themeToggleAria",
  "navToggleAria",
  "navToggleAriaClose",
  "languageToggleAria",
  "githubAria",
  "hero",
  "demo",
  "pocketAlternative",
  "raindropCompare",
  "features",
  "ai",
  "privacy",
  "pricing",
  "faq",
  "cta",
  "footer",
];

/** Project one landing translation file into the runtime namespace shape. */
export function projectLandingNamespace(translation) {
  const out = {};
  for (const key of SECTIONS) {
    if (translation[key] !== undefined) out[key] = translation[key];
  }
  return out;
}

function main() {
  const check = process.argv.includes("--check");
  const files = readdirSync(SOURCE_DIR)
    .filter((f) => f.endsWith(".json") && !f.startsWith("pocket-alternative"))
    .sort();

  const emitted = [];
  for (const file of files) {
    const lang = file.replace(/\.json$/, "");
    const translation = JSON.parse(readFileSync(join(SOURCE_DIR, file), "utf8"));
    if (!translation.hero?.badge) continue; // not a landing source
    emitted.push([lang, JSON.stringify(projectLandingNamespace(translation), null, 2) + "\n"]);
  }

  if (check) {
    let drift = 0;
    for (const [lang, body] of emitted) {
      let onDisk = null;
      try {
        onDisk = readFileSync(join(OUTPUT_DIR, `${lang}.json`), "utf8");
      } catch {
        // missing below
      }
      if (onDisk !== body) {
        console.error(`[landing-namespace] drift: public/locales/landing/${lang}.json`);
        drift += 1;
      }
    }
    if (drift > 0) process.exit(1);
    console.log(`[landing-namespace] ok: ${emitted.length} landing namespace file(s) in sync`);
    return;
  }

  mkdirSync(OUTPUT_DIR, { recursive: true });
  for (const [lang, body] of emitted) {
    writeFileSync(join(OUTPUT_DIR, `${lang}.json`), body, "utf8");
  }
  console.log(`[landing-namespace] wrote ${emitted.length} landing namespace file(s)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
