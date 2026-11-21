#!/usr/bin/env node
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const tests = [
  { name: 'Unit (Fast)', cmd: 'npm run test:fast' },
  { name: 'Integration (Slow)', cmd: 'npm run test:slow' }
];

console.log('🧪 Running all tests...\n');

for (const test of tests) {
  console.log(`\n📋 ${test.name}...`);
  try {
    execSync(test.cmd, { stdio: 'inherit', cwd: join(__dirname, '..') });
    console.log(`✅ ${test.name} passed`);
  } catch (_error) {
    console.error(`❌ ${test.name} failed`);
    process.exit(1);
  }
}

console.log('\n✅ All tests passed!');
