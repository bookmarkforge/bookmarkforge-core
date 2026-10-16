#!/usr/bin/env node
/**
 * Fix Gemini provider text in translation files
 * Changes "Cloud — Google Gemini (key managed by us)" to "Cloud — Google Gemini (with your own key)"
 */

import { readFileSync, writeFileSync } from 'fs';
import { readdirSync } from 'fs';
import { join } from 'path';

const TRANSLATIONS_DIR = join(process.cwd(), 'scripts', 'translations');
const OLD_TEXT = 'Cloud — Google Gemini (key managed by us)';
const NEW_TEXT = 'Cloud — Google Gemini (with your own key)';

const files = readdirSync(TRANSLATIONS_DIR).filter(f => f.endsWith('.json'));

let modifiedCount = 0;

for (const file of files) {
  const filePath = join(TRANSLATIONS_DIR, file);
  const content = readFileSync(filePath, 'utf-8');

  if (content.includes(OLD_TEXT)) {
    const newContent = content.replace(OLD_TEXT, NEW_TEXT);
    writeFileSync(filePath, newContent, 'utf-8');
    console.log(`✓ Fixed ${file}`);
    modifiedCount++;
  }
}

console.log(`\nTotal files modified: ${modifiedCount}`);
