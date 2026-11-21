#!/usr/bin/env node
/**
 * check-all.mjs - Orchestrator for every quality and security check
 * 
 * Runs every check in the appropriate order:
 * 1. check:security - Security and compliance
 * 2. check:quality - Code quality
 * 3. check:content - Content and documentation
 * 4. check:brand - Brand and marketing
 * 5. check:build - Build verification
 */

import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const checks = [
  { name: 'Security', cmd: 'npm run check:security' },
  { name: 'Quality', cmd: 'npm run check:quality' },
  { name: 'Content', cmd: 'npm run check:content' },
  { name: 'Brand', cmd: 'npm run check:brand' },
  { name: 'Build', cmd: 'npm run check:build' }
];

console.log('🔍 Running all checks...\n');

let failed = false;

for (const check of checks) {
  console.log(`\n📋 ${check.name}...`);
  try {
    execSync(check.cmd, { 
      stdio: 'inherit',
      cwd: join(__dirname, '..')
    });
    console.log(`✅ ${check.name} passed`);
  } catch (_error) {
    console.error(`❌ ${check.name} failed`);
    failed = true;
  }
}

console.log('\n' + '='.repeat(50));

if (failed) {
  console.error('\n❌ Some checks failed. Please fix the errors above.');
  process.exit(1);
} else {
  console.log('\n✅ All checks passed!');
  process.exit(0);
}
