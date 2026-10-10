#!/usr/bin/env node

/**
 * Copy landing page assets from public/ to dist/
 * This ensures landing.js and landing.css are always up-to-date in dist/
 */

import { copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const filesToCopy = [
  'landing.js',
  'landing.css',
  'ar.html',
  'bg.html',
  'cs.html',
  'da.html',
  'de.html',
  'el.html',
  'es.html',
  'fi.html',
  'fr.html',
  'he.html',
  'hi.html',
  'hr.html',
  'hu.html',
  'id.html',
  'it.html',
  'ja.html',
  'ko.html',
  'nl.html',
  'no.html',
  'pl.html',
  'pt.html',
  'ro.html',
  'ru.html',
  'sv.html',
  'th.html',
  'tr.html',
  'uk.html',
  'vi.html',
  'zh.html',
  'landing.html',
  'index.html',
  '404.html',
];

let copied = 0;
let skipped = 0;

for (const file of filesToCopy) {
  const src = join('public', file);
  const dest = join('dist', file);

  if (existsSync(src)) {
    copyFileSync(src, dest);
    copied++;
  } else {
    skipped++;
  }
}

console.log(`Copied ${copied} landing assets to dist/`);
if (skipped > 0) {
  console.log(`Skipped ${skipped} missing files`);
}
