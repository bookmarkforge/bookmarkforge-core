#!/usr/bin/env node
import { execSync } from 'child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
console.log('📝 Running generate commands...\n');
// generate:og-images and its script were deleted in the 2026-10-20
// consolidation; the sitemap generator and the structured-data injector are
// the generators that survive, so invoke them directly.
execSync('node scripts/generate-sitemap.mjs && node scripts/inject-structured-data.mjs', { stdio: 'inherit', cwd: join(__dirname, '..') });
console.log('\n✅ Generate commands passed!');
