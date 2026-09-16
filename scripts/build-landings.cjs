const fs = require('fs');
const path = require('path');
const nunjucks = require('nunjucks');

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

const LANDING_LANGS = ['en', 'es', 'fr', 'de', 'pt', 'it'];

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

/** Pages a translation key contributes, given the page types the build
 * actually generates (404 stays a static file — see the TODO in main). */
function expectedOutputs(translations) {
  const outputs = [];
  for (const key of Object.keys(translations)) {
    const t = translations[key];
    if (t.hero?.badge && LANDING_LANGS.includes(key)) {
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
  const rendered = [];
  for (const pageType of ['landing', 'pocket-alternative']) {
    const template = env.getTemplate(`landing/${pageType}.njk`);
    for (const [key, translation] of Object.entries(translations)) {
      if (pageType === 'landing') {
        if (!translation.hero?.badge) continue;
        if (!LANDING_LANGS.includes(key)) continue;
      }
      // pocket-alternative translations live in their own files
      // (pocket-alternative-<lang>.json); the main landing translation files
      // share the hero.badge shape but must not render the Pocket page.
      if (pageType === 'pocket-alternative' && !key.startsWith('pocket-alternative')) continue;

      const html = template.render({ t: translation });
      rendered.push({ key, pageType, path: outputPathFor(pageType, key), html });
    }
  }
  return rendered;
}

function buildLandings() {
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

  // Skip 404 for now - it remains as a static file
  // TODO: Create proper translations and template for it

  console.log('\n✓ All pages generated successfully!');
}

if (require.main === module) {
  main();
}

module.exports = {
  LANDING_LANGS,
  buildLandings,
  expectedOutputs,
  loadTranslations,
  outputPathFor,
  renderAll,
};
