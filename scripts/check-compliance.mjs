#!/usr/bin/env node
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

console.log('📄 Running compliance checks...\n');
// Every check this orchestrator used to chain individually (check:i18n,
// check:english-only, check:audit-drift, check:audit-freshness) was folded
// into the check:content orchestrator by the 2026-10-20 consolidation, so
// running them by name always died with "Missing script".
execSync('npm run check:content', { stdio: 'inherit', cwd: join(__dirname, '..') });
console.log('\n✅ Compliance checks passed!');
