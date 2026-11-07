#!/usr/bin/env node
import { execSync } from 'child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
console.log('📊 Running all reports...\n');
// The per-variant npm wrappers (report:webrtc-nightly, report:webrtc-handshake,
// history:webrtc-recovery, charts:webrtc-recovery) were removed in the
// 2026-10-20 consolidation; the scripts they wrapped still exist, so call the
// surviving summarizer, history appender and chart renderer directly.
execSync('npm run report:webrtc && node scripts/webrtc-recovery-history.mjs && node scripts/render-webrtc-recovery-charts.mjs', { stdio: 'inherit', cwd: join(__dirname, '..') });
console.log('\n✅ All reports generated!');
