#!/usr/bin/env node

/**
 * Copy landing page assets from public/ to dist/
 * This ensures landing.js and landing.css are always up-to-date in dist/.
 *
 * The list carries the EN landing (public/landing.html — the single generated
 * source every host serves at `/`) and the 29 localized landings; there is no
 * index.html any more (the root copies were retired in favour of that one
 * file).
 */

import { copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const filesToCopy = [
  'landing.js',
  'landing.css',
  'help.css',
  'theme-init.js',
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
