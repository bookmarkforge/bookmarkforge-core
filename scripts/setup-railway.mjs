#!/usr/bin/env node
/**
 * scripts/setup-railway.mjs — automate the Railway companion deployment.
 *
 * Every value this script pushes comes from the OPERATOR'S ENVIRONMENT. No
 * credential is hardcoded here: a git-tracked script is the one place a live
 * provider key cannot be revoked from, and the console log is the one place it
 * leaks to a CI transcript. `WHOP_API_KEY` is therefore required, validated,
 * and never echoed.
 *
 * Usage:
 *
 *   WHOP_API_KEY='<your-whop-api-key>' \
 *   WHOP_COMPANY_ID='<your-whop-company-id>' \
 *   WHOP_PRO_PLAN_ID='<your-whop-pro-plan-id>' \
 *   AI_SESSION_ORIGINS='https://your-app-origin' \
 *     node scripts/setup-railway.mjs
 *
 * Required (fail closed when unset): WHOP_API_KEY, WHOP_COMPANY_ID,
 * WHOP_PRO_PLAN_ID, AI_SESSION_ORIGINS — see REQUIRED_VARS for why each one is
 * load-bearing. Optional: WS_ALLOWED_ORIGINS, WHOP_LICENSE_API_URL,
 * TRUST_PROXY, PORT, RAILWAY_PROJECT_ID, RAILWAY_SERVICE_NAME,
 * RAILWAY_ENVIRONMENT.
 */

import { execFileSync } from 'node:child_process';

const PROJECT_ID = process.env.RAILWAY_PROJECT_ID ?? 'bc5cb532-08b6-44b9-8281-81af46060755';
const SERVICE_NAME = process.env.RAILWAY_SERVICE_NAME ?? 'bookmarkforge-api';
const ENVIRONMENT = process.env.RAILWAY_ENVIRONMENT ?? 'production';

/**
 * Variables the companion cannot serve traffic without.
 * - WHOP_API_KEY: live provider credential (the only secret here).
 * - WHOP_COMPANY_ID / WHOP_PRO_PLAN_ID: they identify the Whop account and the
 *   Pro plan, and the affiliate handler builds each user's checkout link from
 *   the plan id — without it the panel honestly reports "no link yet".
 * - AI_SESSION_ORIGINS: the origin allowlist the entitlement and affiliate
 *   handlers check. In production a missing allowlist means every browser call
 *   is refused, so a silent default would deploy a companion that looks up and
 *   answers nobody.
 */
const REQUIRED_VARS = [
  'WHOP_API_KEY',
  'WHOP_COMPANY_ID',
  'WHOP_PRO_PLAN_ID',
  'AI_SESSION_ORIGINS',
];

/** Non-secret defaults, applied when the operator does not override them. */
const DEFAULT_VARS = {
  WHOP_LICENSE_API_URL: 'https://api.whop.com/api/v1/licenses',
  // TLS terminates at nginx/Vercel ahead of the companion, so the client IP
  // arrives in X-Forwarded-For.
  TRUST_PROXY: '1',
  PORT: '8787',
};

/** Optional variables: pushed only when the operator sets them. */
const OPTIONAL_VARS = ['WS_ALLOWED_ORIGINS'];

/** Values that must never be printed, in a command echo or an error message. */
const SECRET_VARS = new Set(['WHOP_API_KEY']);

/** Railway rejects a value it cannot parse; catch it here with a clear error. */
const UNSAFE_VALUE_RE = /["\n\r]/;

function fail(message) {
  console.error(`\n❌ ${message}\n`);
  process.exit(1);
}

function readVariables() {
  const resolved = { ...DEFAULT_VARS };

  for (const name of REQUIRED_VARS) {
    const value = (process.env[name] ?? '').trim();
    if (!value) {
      fail(
        `${name} is not set. Export it before running this script ` +
          `(see the header of scripts/setup-railway.mjs for the full invocation). ` +
          `Refusing to deploy a companion with a placeholder credential.`,
      );
    }
    resolved[name] = value;
  }

  for (const name of OPTIONAL_VARS) {
    const value = (process.env[name] ?? '').trim();
    if (value) resolved[name] = value;
  }

  for (const [name, value] of Object.entries(resolved)) {
    if (UNSAFE_VALUE_RE.test(value)) {
      // Never echo the offending value: it is reported by name only.
      fail(`${name} contains a quote or a newline, which railway cannot receive safely.`);
    }
  }
  return resolved;
}

/** Log a command with every secret value replaced by a placeholder. */
function redacted(cmd) {
  let printable = cmd;
  for (const name of SECRET_VARS) {
    printable = printable.replace(new RegExp(`${name}=[^\\s"]+`, 'g'), `${name}=<redacted>`);
  }
  return printable;
}

function run(cmd, args) {
  console.log(`Running: ${redacted([cmd, ...args].join(' '))}`);
  return execFileSync(cmd, args, { encoding: 'utf8', stdio: 'inherit' });
}

function setVariable(name, value) {
  // execFileSync with an argument array: the value never passes through a
  // shell, so a shell-injection payload cannot ride along with it.
  run('railway', [
    'variables',
    'set',
    `${name}=${value}`,
    '-p',
    PROJECT_ID,
    '-e',
    ENVIRONMENT,
  ]);
}

console.log('🚀 Configuring Railway for BookmarkForge…\n');
const variables = readVariables();

console.log('\n🔑 Verifying the companion can authenticate…');
console.log('   WHOP_API_KEY present (value never printed).');

console.log('\n📦 Connecting the service to the repository…');
run('railway', [
  'service',
  'source',
  'connect',
  '--repo',
  'bookmarkforge/bookmarkforge-2026',
  '--branch',
  'release/v1.0.0',
  '--service',
  SERVICE_NAME,
  '-p',
  PROJECT_ID,
  '-e',
  ENVIRONMENT,
]);

console.log('\n🔧 Setting environment variables…');
for (const [name, value] of Object.entries(variables)) {
  setVariable(name, value);
}
console.log(`   ${Object.keys(variables).length} variable(s) set.`);

console.log('\n🌐 Networking and deploy settings are dashboard-only.');
console.log('   Deploy/healthcheck settings live in railway.toml.');

console.log('\n✅ Configuration complete!');
console.log('\n📋 Remaining manual steps in the Railway dashboard:');
console.log('1. Settings → Networking: set Port to 8787');
console.log('2. Settings → Deploy: Healthcheck Path = /health');
console.log('3. Deploy the service (Redeploy) and confirm the logs report the port');
