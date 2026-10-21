const fs = require('fs');
const path = require('path');

const TRANSLATIONS_DIR = path.join(__dirname, 'translations');
const OUTPUT_FILE = path.join(__dirname, 'templates', 'landing', 'language-links.json');

/**
 * The switcher's data, derived from scripts/translations/*.json — the whole
 * reason this file has a generator at all. Exported on its own so
 * build-landings.cjs can render from the SAME derivation instead of trusting
 * a copy on disk: that copy used to be read by the builder (with a silent
 * `return []` when missing), so a stale or absent file quietly produced pages
 * with an empty language switcher.
 */
function buildLanguageLinks() {
  const files = fs.readdirSync(TRANSLATIONS_DIR).filter((f) => f.endsWith('.json'));
  const languageLinks = [];
  
  for (const file of files) {
    const key = file.replace('.json', '');
    
    // Skip pocket-alternative files
    if (key.startsWith('pocket-alternative')) continue;
    
    const content = fs.readFileSync(path.join(TRANSLATIONS_DIR, file), 'utf-8');
    const translation = JSON.parse(content);
    
    // Only include languages that have hero.badge (landing page compatible)
    if (!translation.hero?.badge) continue;
    
    const langCode = translation.lang;
    const langName = translation.langName;
    const dir = translation.dir;
    
    // Generate the link based on language code
    let href;
    if (langCode === 'en') {
      href = '/';
    } else {
      href = `/${langCode}/`;
    }
    
    languageLinks.push({
      code: langCode,
      name: langName,
      dir: dir,
      href: href,
      hreflang: langCode,
      lang: langCode
    });
  }
  
  // Sort by language name
  languageLinks.sort((a, b) => a.name.localeCompare(b.name));

  return languageLinks;
}

/** CLI entrypoint: write the derivation to templates/landing/language-links.json. */
function generateLanguageLinks() {
  const languageLinks = buildLanguageLinks();

  // Write to JSON file
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(languageLinks, null, 2), 'utf-8');
  console.log(`✓ Generated language links with ${languageLinks.length} languages`);

  return languageLinks;
}

if (require.main === module) {
  generateLanguageLinks();
}

module.exports = { generateLanguageLinks, buildLanguageLinks };