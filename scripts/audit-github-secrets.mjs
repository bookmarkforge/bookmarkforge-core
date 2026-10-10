#!/usr/bin/env node

/**
 * audit-github-secrets.mjs
 *
 * Automated GitHub secrets audit script
 * Uses GitHub CLI to verify repository secrets without sharing credentials
 *
 * Prerequisites:
 * - GitHub CLI installed: https://cli.github.com/
 * - Logged in to GitHub: gh auth login
 * - Repo: bookmarkforge/bookmarkforge
 *
 * Usage: node scripts/audit-github-secrets.mjs
 */

import { execSync } from 'child_process';

const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
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

function checkGitHubCLI() {
  try {
    execSync('gh --version', { encoding: 'utf-8' });
    return true;
  } catch {
    return false;
  }
}

async function main() {
  log('🚀 Starting GitHub Secrets Audit...', colors.blue);
  log('📦 This script uses GitHub CLI to verify your repository secrets locally\n', colors.yellow);

  // Check if GitHub CLI is installed
  if (!checkGitHubCLI()) {
    log('\n❌ GitHub CLI is not installed', colors.red);
    log('Install it from: https://cli.github.com/', colors.yellow);
    log('Then login with: gh auth login', colors.yellow);
    process.exit(1);
  }

  log('✅ GitHub CLI is installed', colors.green);

  // Check if logged in
  const authStatus = runCommand('gh auth status', 'GitHub auth status');
  if (!authStatus.success) {
    log('\n❌ Not logged in to GitHub', colors.red);
    log('Login with: gh auth login', colors.yellow);
    process.exit(1);
  }

  log('✅ Logged in to GitHub', colors.green);

  const results = {
    secrets: null,
    variables: null,
    repo: null,
  };

  // Get repo info
  results.repo = runCommand('gh repo view --json name,owner', 'Repository info');

  // List secrets
  results.secrets = runCommand('gh secret list', 'Secrets list');

  // List variables
  results.variables = runCommand('gh variable list', 'Variables list');

  // Summary
  log('\n' + '='.repeat(70), colors.blue);
  log('📊 GITHUB SECRETS AUDIT SUMMARY', colors.blue);
  log('='.repeat(70), colors.blue);

  log(`\nRepository: ${results.repo.success ? '✅ PASSED' : '❌ FAILED'}`,
      results.repo.success ? colors.green : colors.red);
  log(`Secrets: ${results.secrets.success ? '✅ PASSED' : '❌ FAILED'}`,
      results.secrets.success ? colors.green : colors.red);
  log(`Variables: ${results.variables.success ? '✅ PASSED' : '❌ FAILED'}`,
      results.variables.success ? colors.green : colors.red);

  // Show details
  if (results.repo.success) {
    log('\n📝 Repository:', colors.cyan);
    log(results.repo.output, colors.reset);
  }

  if (results.secrets.success) {
    log('\n📝 Secrets:', colors.cyan);
    log(results.secrets.output, colors.reset);
    log('\n⚠️  Verify these secrets are set:', colors.yellow);
    log('  - WHOP_API_KEY', colors.cyan);
    log('  - LICENSE_SIGNING_PRIVATE_KEY_PKCS8', colors.cyan);
    log('  - STAGING_URL', colors.cyan);
    log('  - CSP_REPORT_ADMIN_TOKEN', colors.cyan);
    log('  - SIGNALING_ADMIN_TOKEN', colors.cyan);
  }

  if (results.variables.success) {
    log('\n📝 Variables:', colors.cyan);
    log(results.variables.output, colors.reset);
    log('\n⚠️  Verify these variables are set:', colors.yellow);
    log('  - NODE_ENV=production', colors.cyan);
    log('  - VITE_APP_VERSION=1.0.0', colors.cyan);
    log('  - AI_SESSION_ORIGINS=https://bookmarkforgeapp.com', colors.cyan);
    log('  - ENFORCE_SIGNAL_HMAC=1', colors.cyan);
  }

  // Recommendations
  log('\n' + '='.repeat(70), colors.blue);
  log('💡 RECOMMENDATIONS', colors.blue);
  log('='.repeat(70), colors.blue);

  log('\n📚 Full secrets documentation:', colors.cyan);
  log('  docs/GITHUB-SECRETS.md', colors.reset);

  log('\n📋 To add a secret:', colors.cyan);
  log('  gh secret set SECRET_NAME', colors.reset);

  log('\n📋 To add a variable:', colors.cyan);
  log('  gh variable set VARIABLE_NAME', colors.reset);

  log('\n✅ GitHub secrets audit completed\n', colors.green);
}

main().catch(error => {
  log(`\n❌ Error: ${error.message}`, colors.red);
  process.exit(1);
});
