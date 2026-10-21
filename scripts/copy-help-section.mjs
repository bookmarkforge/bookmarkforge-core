import fs from 'fs';
import path from 'path';

const TRANSLATIONS_DIR = path.join(process.cwd(), 'scripts', 'translations');
const EN_FILE = path.join(TRANSLATIONS_DIR, 'en.json');

// Read the help section from en.json
const enContent = JSON.parse(fs.readFileSync(EN_FILE, 'utf-8'));
const helpSection = JSON.parse(JSON.stringify(enContent.help)); // Deep copy

if (!helpSection) {
  console.error('No help section found in en.json');
  process.exit(1);
}

console.log('Extracted help section from en.json');

// Get all translation files except en.json and es.json (already have help)
const files = fs.readdirSync(TRANSLATIONS_DIR)
  .filter(f => f.endsWith('.json') && f !== 'en.json' && f !== 'es.json' && !f.startsWith('pocket-alternative-'));

console.log(`\nProcessing ${files.length} translation files...`);

for (const file of files) {
  const langCode = file.replace('.json', '');
  const filePath = path.join(TRANSLATIONS_DIR, file);
  const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

  // Check if help section already exists
  if (content.help) {
    console.log(`⏭️  Skipping ${file} (already has help section)`);
    continue;
  }

  // Deep copy help section and replace internal /help links
  const localizedHelp = JSON.parse(JSON.stringify(helpSection));

  // Replace /help links in the help section
  function replaceHelpLinks(obj) {
    if (typeof obj === 'string') {
      return obj.replace(/href="\/help(#[^"]*)?"/g, `href="/help-${langCode}$1"`);
    }
    if (Array.isArray(obj)) {
      return obj.map(replaceHelpLinks);
    }
    if (obj && typeof obj === 'object') {
      const result = {};
      for (const [key, value] of Object.entries(obj)) {
        result[key] = replaceHelpLinks(value);
      }
      return result;
    }
    return obj;
  }

  content.help = replaceHelpLinks(localizedHelp);

  // Write back
  fs.writeFileSync(filePath, JSON.stringify(content, null, 2) + '\n', 'utf-8');
  console.log(`✓ Added help section to ${file}`);
}

console.log('\n✓ All help sections added successfully!');
