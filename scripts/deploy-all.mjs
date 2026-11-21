#!/usr/bin/env node
import { execSync } from 'child_process';
const __dirname = new URL('.', import.meta.url).pathname;
console.log('🚀 Running deploy commands...\n');
execSync('npm run build:ci && npm run check:launch-checklist:strict', { stdio: 'inherit', cwd: __dirname + '/..' });
console.log('\n✅ Deploy commands completed!');
