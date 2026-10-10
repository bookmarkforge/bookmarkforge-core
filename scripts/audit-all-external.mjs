#!/usr/bin/env node

/**
 * audit-all-external.mjs
 *
 * Master script that runs all external service audits
 * Combines Vercel, Whop, and GitHub audits in one execution
 *
 * Prerequisites:
 * - Vercel CLI installed and logged in
 * - GitHub CLI installed and logged in
 * - WHOP_API_KEY in environment or .env.local
 *
 * Usage: node scripts/audit-all-external.mjs
 */

import { execSync } from 'child_process';

const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
};

function log(message, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function runCommand(command, description) {
  log(`\n🔧 ${description}...`, colors.cyan);
  try {
    const output = execSync(command, {
      encoding: 'utf-8',
      stdio: 'pipe',
      maxBuffer: 10 * 1024 * 1024
    });
    log(`✅ ${description} completed`, colors.green);
    return { success: true, output };
  } catch (error) {
    log(`❌ ${description} failed`, colors.red);
    return { success: false, error: error.message, output: error.stdout || '' };
  }
}

async function main() {
  log('🚀 Starting Comprehensive External Services Audit...', colors.blue);
  log('📦 This script audits Vercel, Whop, and GitHub configurations locally\n', colors.yellow);

  log('\n' + '='.repeat(70), colors.magenta);
  log('PHASE 1: VERCEL AUDIT', colors.magenta);
  log('='.repeat(70), colors.magenta);

  const vercelResult = runCommand('node scripts/audit-vercel-config.mjs', 'Vercel configuration audit');

  log('\n' + '='.repeat(70), colors.magenta);
  log('PHASE 2: WHOP AUDIT', colors.magenta);
  log('='.repeat(70), colors.magenta);

  const whopResult = runCommand('node scripts/audit-whop-config.mjs', 'Whop configuration audit');

  log('\n' + '='.repeat(70), colors.magenta);
  log('PHASE 3: GITHUB SECRETS AUDIT', colors.magenta);
  log('='.repeat(70), colors.magenta);

  const githubResult = runCommand('node scripts/audit-github-secrets.mjs', 'GitHub secrets audit');

  // Overall summary
  log('\n' + '='.repeat(70), colors.blue);
  log('📊 OVERALL EXTERNAL SERVICES AUDIT SUMMARY', colors.blue);
  log('='.repeat(70), colors.blue);

  log(`\nVercel: ${vercelResult.success ? '✅ PASSED' : '❌ FAILED'}`,
      vercelResult.success ? colors.green : colors.red);
  log(`Whop: ${whopResult.success ? '✅ PASSED' : '❌ FAILED'}`,
      whopResult.success ? colors.green : colors.red);
  log(`GitHub Secrets: ${githubResult.success ? '✅ PASSED' : '❌ FAILED'}`,
      githubResult.success ? colors.green : colors.red);

  const allPassed = vercelResult.success && whopResult.success && githubResult.success;

  if (allPassed) {
    log('\n✅ ALL EXTERNAL SERVICES AUDITS PASSED', colors.green);
    log('\n🎉 Your external services configuration looks good!', colors.green);
  } else {
    log('\n⚠️  SOME AUDITS FAILED - REVIEW NEEDED', colors.yellow);
    log('\n📝 Review the output above for specific issues', colors.yellow);
  }

  // Next steps
  log('\n' + '='.repeat(70), colors.blue);
  log('💡 NEXT STEPS', colors.blue);
  log('='.repeat(70), colors.blue);

  log('\n1. Manual verification in dashboards:', colors.cyan);
  log('   - Vercel Dashboard: https://vercel.com', colors.reset);
  log('   - Whop Dashboard: https://whop.com/dashboard', colors.reset);
  log('   - GitHub Settings: https://github.com/settings/secrets', colors.reset);

  log('\n2. Use the detailed checklist:', colors.cyan);
  log('   docs/EXTERNAL-SERVICES-AUDIT-CHECKLIST.md', colors.reset);

  log('\n3. Test integrations:', colors.cyan);
  log('   - Make a test purchase on Whop', colors.reset);
  log('   - Verify license activation in the app', colors.reset);
  log('   - Verify Pro features unlock', colors.reset);

  log('\n✅ Comprehensive external audit completed\n', colors.green);
}

main().catch(error => {
  log(`\n❌ Error: ${error.message}`, colors.red);
  process.exit(1);
});
