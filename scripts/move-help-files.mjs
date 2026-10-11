#!/usr/bin/env node
/**
 * Move help files to their respective language directories
 */

import { readdirSync, renameSync } from 'fs';
import { join } from 'path';

const PUBLIC_DIR = join(process.cwd(), 'public');
const LANGUAGES = ['ar', 'bg', 'cs', 'da', 'de', 'el', 'es', 'fi', 'fr', 'he', 'hi', 'hr', 'hu', 'id', 'it', 'ja', 'ko', 'nl', 'no', 'pl', 'pt', 'ro', 'ru', 'sv', 'th', 'tr', 'uk', 'vi', 'zh'];

let movedCount = 0;

for (const lang of LANGUAGES) {
  const source = join(PUBLIC_DIR, `help-${lang}.html`);
  const dest = join(PUBLIC_DIR, lang, `help-${lang}.html`);
  
  try {
    renameSync(source, dest);
    console.log(`✓ Moved help-${lang}.html to ${lang}/`);
    movedCount++;
  } catch (error) {
    // File might not exist or already moved
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error(`Error moving help-${lang}.html:`, error);
    }
  }
}

console.log(`\nTotal files moved: ${movedCount}`);
