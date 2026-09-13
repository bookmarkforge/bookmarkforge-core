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
env.addFilter('startsWith', (str, prefix) => {
  return str && str.startsWith(prefix);
});

// Custom filter for lower case
env.addFilter('lower', (str) => str.toLowerCase());

// Custom filter for replace
env.addFilter('replace', (str, search, replace) => str.replace(search, replace));

function loadTranslations() {
  const translations = {};
  const files = fs.readdirSync(TRANSLATIONS_DIR).filter(f => f.endsWith('.json'));
  
  for (const file of files) {
    const key = file.replace('.json', '');
    const content = fs.readFileSync(path.join(TRANSLATIONS_DIR, file), 'utf-8');
    translations[key] = JSON.parse(content);
  }
  
  return translations;
}

const LANDING_LANGS = ['en', 'es', 'fr', 'de', 'pt', 'it'];

function generatePage(pageType, translations) {
  const template = env.getTemplate(`landing/${pageType}.njk`);
  
  // Filter translations that have this page type
  for (const [key, translation] of Object.entries(translations)) {
    // Skip if this translation doesn't have the required structure for this page type
    if (pageType === 'landing' && !translation.hero?.badge) continue;
    if (pageType === 'pocket-alternative' && !translation.hero?.badge) continue;
    if (pageType === '404' && !translation.hero?.title) continue;
    
    // For landing pages, only process the 6 main languages
    if (pageType === 'landing' && !LANDING_LANGS.includes(key)) continue;
    
    const html = template.render({ t: translation });
    
    let outputPath;
    if (pageType === 'landing') {
      outputPath = key === 'en' 
        ? path.join(OUTPUT_DIR, 'landing.html')
        : path.join(OUTPUT_DIR, `${key}.html`);
    } else if (pageType === 'pocket-alternative') {
      outputPath = key === 'en'
        ? path.join(OUTPUT_DIR, 'pocket-alternative.html')
        : path.join(OUTPUT_DIR, `pocket-alternative-${key}.html`);
    } else if (pageType === '404') {
      outputPath = key === 'en'
        ? path.join(OUTPUT_DIR, '404.html')
        : path.join(OUTPUT_DIR, `404-${key}.html`);
    }
    
    fs.writeFileSync(outputPath, html);
    console.log(`✓ Generated ${outputPath}`);
  }
}

function main() {
  console.log('Building landing pages...\n');
  
  const translations = loadTranslations();
  console.log(`Loaded ${Object.keys(translations).length} translation files\n`);
  
  // Generate main landing pages
  console.log('Generating main landing pages...');
  generatePage('landing', translations);
  
  // Skip pocket-alternative and 404 for now - they remain as static files
  // TODO: Create proper translations and templates for these
  
  console.log('\n✓ All pages generated successfully!');
}

main();