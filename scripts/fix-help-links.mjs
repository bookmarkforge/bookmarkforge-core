import fs from 'fs';
import path from 'path';

const TRANSLATIONS_DIR = path.join(process.cwd(), 'scripts', 'translations');

// Get all translation files except en.json
const files = fs.readdirSync(TRANSLATIONS_DIR)
  .filter(f => f.endsWith('.json') && f !== 'en.json' && !f.startsWith('pocket-alternative-'));

console.log(`Processing ${files.length} translation files...`);

for (const file of files) {
  const langCode = file.replace('.json', '');
  const filePath = path.join(TRANSLATIONS_DIR, file);
  let content = fs.readFileSync(filePath, 'utf-8');

  // Replace /help with /help-{lang}
  const original = content;
  content = content.replace(/href="\/help"/g, `href="/help-${langCode}"`);
  content = content.replace(/href="\/help#/g, `href="/help-${langCode}#`);

  if (content !== original) {
    fs.writeFileSync(filePath, content, 'utf-8');
    console.log(`✓ Updated help links in ${file}`);
  } else {
    console.log(`⏭️  No help links to update in ${file}`);
  }
}

console.log('\n✓ All help links updated successfully!');
