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
  const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

  // Convert to string and replace ALL /help links
  const jsonString = JSON.stringify(content);
  const updatedString = jsonString.replace(/\/help(#[^"]*)?"/g, `/help-${langCode}$1"`);

  if (jsonString !== updatedString) {
    fs.writeFileSync(filePath, JSON.stringify(JSON.parse(updatedString), null, 2) + '\n', 'utf-8');
    console.log(`✓ Updated all help links in ${file}`);
  } else {
    console.log(`⏭️  No help links to update in ${file}`);
  }
}

console.log('\n✓ All help links updated successfully!');
