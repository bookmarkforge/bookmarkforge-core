#!/usr/bin/env node
import { execSync } from 'child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
console.log('✅ Running validation...\n');
// The npm wrappers this used to call were dropped in the 2026-10-20
// consolidation while the validators themselves survived — call the two
// scripts directly so this orchestrator no longer dies on "Missing script".
execSync('node scripts/validate-performance-budget.mjs && node scripts/validate-landing-pages.mjs', { stdio: 'inherit', cwd: join(__dirname, '..') });
console.log('\n✅ Validation passed!');
