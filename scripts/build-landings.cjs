const fs = require('fs');
const path = require('path');
const nunjucks = require('nunjucks');
const { buildLanguageLinks } = require('./generate-language-links.cjs');

const TEMPLATES_DIR = path.join(__dirname, 'templates');
const TRANSLATIONS_DIR = path.join(__dirname, 'translations');
const OUTPUT_DIR = path.join(__dirname, '..', 'public');

// Configure Nunjucks
const env = nunjucks.configure(TEMPLATES_DIR, {
  autoescape: false,
  throwOnUndefined: true,
  trimBlocks: true,
  lstripBlocks: true,
});

// Custom filter for safe HTML
env.addFilter('safe', (str) => str);

// Custom filter for JavaScript escaping in JSON-LD
env.addFilter('escapejs', (str) => {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/'/g, '\\u0027');
});

// Custom filter for startsWith
env.addFilter('startsWith', (str, prefix) => str && str.startsWith(prefix));

// Custom filter for lower case
env.addFilter('lower', (str) => str.toLowerCase());

// Custom filter for replace
env.addFilter('replace', (str, search, replace) => str.replace(search, replace));

function loadTranslations() {
  const translations = {};
  const files = fs.readdirSync(TRANSLATIONS_DIR).filter((f) => f.endsWith('.json'));

  for (const file of files) {
    const key = file.replace('.json', '');
    const content = fs.readFileSync(path.join(TRANSLATIONS_DIR, file), 'utf-8');
    translations[key] = JSON.parse(content);
  }

  return translations;
}

/**
 * The switcher's data comes from generate-language-links.cjs, derived from
 * scripts/translations/*.json. Rendering uses that derivation directly rather
 * than a copy on disk: the old read-the-file-with-`return []`-fallback meant a
 * clean clone (or a stale copy) silently emitted every landing page with an
 * empty language switcher and exited 0 — the same silent-degradation shape
 * that let the pre-30-locale builder ship 7 pages without complaint.
 */
function languageLinks() {
  return buildLanguageLinks();
}

/**
 * The versioned copy of that derivation (templates/landing/language-links.json)
 * is an OUTPUT, so the write path keeps it in step: `npm run build:landings`
 * (and scripts/gate-refresh.mjs, which runs this file) regenerates it instead
 * of leaving a stale or missing copy behind. No-op when it already matches.
 *
 * `file` is injectable so the contract tests
 * (scripts/__tests__/build-landings-sync.test.mjs) can drive it against a
 * temp tree; production callers use the default (the repo artifact).
 */
function syncLanguageLinksFile(
  file = path.join(__dirname, 'templates', 'landing', 'language-links.json'),
) {
  const links = buildLanguageLinks();
  const generated = JSON.stringify(links, null, 2);
  let onDisk = null;
  try {
    onDisk = fs.readFileSync(file, 'utf-8');
  } catch {
    // Missing is the interesting case: regenerate below.
  }
  // Compared with line endings normalized: an autocrlf checkout materializes
  // this file as CRLF, and treating that as drift would "regenerate" it (and
  // report it) on every build while changing nothing.
  if (onDisk !== null && onDisk.replace(/\r\n/g, '\n') === generated) return links;
  // Keep the working copy's line endings so a rewrite stays a no-op on disk.
  const eol = onDisk !== null && onDisk.includes('\r\n') ? '\r\n' : '\n';
  fs.writeFileSync(file, eol === '\n' ? generated : generated.replace(/\n/g, eol), 'utf-8');
  console.log(
    `\n${onDisk === null ? 'Created' : 'Regenerated'} templates/landing/language-links.json ` +
      `(${links.length} locales) — it is generated from scripts/translations/*.json\n`,
  );
  return links;
}

// All languages with translation files will be used for landing pages
// The script will dynamically detect all available translation files

/** Output path for a (pageType, translationKey) pair. Shared by the builder
 * and the freshness check so the two can never disagree on destinations. */
function outputPathFor(pageType, key) {
  if (pageType === 'landing') {
    return key === 'en'
      ? path.join(OUTPUT_DIR, 'landing.html')
      : path.join(OUTPUT_DIR, `${key}.html`);
  }
  if (pageType === 'pocket-alternative') {
    const lang = key.replace('pocket-alternative-', '');
    return lang === 'en'
      ? path.join(OUTPUT_DIR, 'pocket-alternative.html')
      : path.join(OUTPUT_DIR, `pocket-alternative-${lang}.html`);
  }
  if (pageType === '404') {
    return key === 'en'
      ? path.join(OUTPUT_DIR, '404.html')
      : path.join(OUTPUT_DIR, `404-${key}.html`);
  }
  throw new Error(`unknown page type: ${pageType}`);
}

/** Get all landing language keys from translation files (excluding pocket-alternative) */
function getLandingLangs(translations) {
  return Object.keys(translations).filter(key => 
    !key.startsWith('pocket-alternative') && translations[key]?.hero?.badge
  );
}

/** Pages a translation key contributes, given the page types the build
 * actually generates (404 stays a static file — see the TODO in main). */
function expectedOutputs(translations) {
  const outputs = [];
  const landingLangs = getLandingLangs(translations);
  
  for (const key of Object.keys(translations)) {
    const t = translations[key];
    if (t.hero?.badge && landingLangs.includes(key)) {
      outputs.push(outputPathFor('landing', key));
    }
    if (key.startsWith('pocket-alternative')) {
      outputs.push(outputPathFor('pocket-alternative', key));
    }
  }
  return outputs.sort();
}

/** Render every generated page in memory. Returns [{ key, pageType, path,
 * html }]; the builder writes them, the freshness check diffs them. */
function renderAll() {
  const translations = loadTranslations();
  const landingLangs = getLandingLangs(translations);
  const links = languageLinks();
  const rendered = [];
  
  for (const pageType of ['landing', 'pocket-alternative']) {
    const template = env.getTemplate(`landing/${pageType}.njk`);
    for (const [key, translation] of Object.entries(translations)) {
      if (pageType === 'landing') {
        if (!translation.hero?.badge) continue;
        if (!landingLangs.includes(key)) continue;
      }
      // pocket-alternative translations live in their own files
      // (pocket-alternative-<lang>.json); the main landing translation files
      // share the hero.badge shape but must not render the Pocket page.
      if (pageType === 'pocket-alternative' && !key.startsWith('pocket-alternative')) continue;

      const html = template.render({ t: translation, languageLinks: links });
      rendered.push({ key, pageType, path: outputPathFor(pageType, key), html });
    }
  }
  return rendered;
}

function buildLandings() {
  syncLanguageLinksFile();
  const rendered = renderAll();
  for (const { path: outputPath, html } of rendered) {
    fs.writeFileSync(outputPath, html);
    console.log(`✓ Generated ${outputPath}`);
  }
  return rendered;
}

function main() {
  console.log('Building landing pages...\n');

  const translations = loadTranslations();
  console.log(`Loaded ${Object.keys(translations).length} translation files\n`);

  buildLandings();

// 404 remains as a static file; not generated by the build.

  console.log('\n✓ All pages generated successfully!');
}

if (require.main === module) {
  main();
}

module.exports = {
  getLandingLangs,
  languageLinks,
  buildLandings,
  expectedOutputs,
  loadTranslations,
  outputPathFor,
  renderAll,
  syncLanguageLinksFile,
};
