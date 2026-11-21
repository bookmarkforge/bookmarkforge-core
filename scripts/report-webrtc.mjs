#!/usr/bin/env node
import { execSync } from 'child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
console.log('📊 Running WebRTC reports...\n');
// The npm wrappers this used to call (report:webrtc-nightly,
// report:webrtc-handshake) were removed in the 2026-10-20 consolidation, but
// the summarizers they wrapped still exist — invoke them directly. The cwd
// must come from fileURLToPath: new URL(...).pathname yields a leading-slash
// "/C:/..." on Windows, which is not a usable directory.
execSync('node scripts/summarize-webrtc-e2e.mjs && node scripts/summarize-webrtc-handshake.mjs', { stdio: 'inherit', cwd: join(__dirname, '..') });
console.log('\n✅ WebRTC reports generated!');
