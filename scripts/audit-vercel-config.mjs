#!/usr/bin/env node

/**
 * audit-vercel-config.mjs
 *
 * Automated Vercel configuration audit script
 * Uses Vercel CLI to verify project configuration without sharing credentials
 *
 * Prerequisites:
 * - Vercel CLI installed: npm i -g vercel
 * - Logged in to Vercel: vercel login
 *
 * Usage: node scripts/audit-vercel-config.mjs
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

function checkVercelCLI() {
  try {
    execSync('vercel --version', { encoding: 'utf-8' });
    return true;
  } catch {
    return false;
  }
}

async function main() {
  log('🚀 Starting Vercel Configuration Audit...', colors.blue);
  log('📦 This script uses Vercel CLI to verify your configuration locally\n', colors.yellow);

  // Check if Vercel CLI is installed
  if (!checkVercelCLI()) {
    log('\n❌ Vercel CLI is not installed', colors.red);
    log('Install it with: npm i -g vercel', colors.yellow);
    log('Then login with: vercel login', colors.yellow);
    process.exit(1);
  }

  log('✅ Vercel CLI is installed', colors.green);

  const results = {
    project: null,
    env: null,
    domains: null,
    deployments: null,
  };

  // 1. Check project info
  results.project = runCommand('vercel project ls', 'Project list');

  // 2. Check environment variables
  results.env = runCommand('vercel env ls', 'Environment variables list');

  // 3. Check domains
  results.domains = runCommand('vercel domains ls', 'Domains list');

  // 4. Check recent deployments
  results.deployments = runCommand('vercel ls --yes', 'Recent deployments');

  // 5. Summary
  log('\n' + '='.repeat(70), colors.blue);
  log('📊 VERCEL AUDIT SUMMARY', colors.blue);
  log('='.repeat(70), colors.blue);

  log(`\nProject Info: ${results.project.success ? '✅ PASSED' : '❌ FAILED'}`,
      results.project.success ? colors.green : colors.red);
  log(`Environment Variables: ${results.env.success ? '✅ PASSED' : '❌ FAILED'}`,
      results.env.success ? colors.green : colors.red);
  log(`Domains: ${results.domains.success ? '✅ PASSED' : '❌ FAILED'}`,
      results.domains.success ? colors.green : colors.red);
  log(`Deployments: ${results.deployments.success ? '✅ PASSED' : '❌ FAILED'}`,
      results.deployments.success ? colors.green : colors.red);

  // Show details if checks passed
  if (results.project.success) {
    log('\n📝 Project Details:', colors.cyan);
    log(results.project.output, colors.reset);
  }

  if (results.env.success) {
    log('\n📝 Environment Variables:', colors.cyan);
    log(results.env.output, colors.reset);
    log('\n⚠️  SECURITY CHECK: Verify NO real secrets in VITE_* variables', colors.yellow);
  }

  if (results.domains.success) {
    log('\n📝 Domains:', colors.cyan);
    log(results.domains.output, colors.reset);
  }

  if (results.deployments.success) {
    log('\n📝 Recent Deployments:', colors.cyan);
    log(results.deployments.output, colors.reset);
  }

  // Recommendations
  log('\n' + '='.repeat(70), colors.blue);
  log('💡 RECOMMENDATIONS', colors.blue);
  log('='.repeat(70), colors.blue);

  log('\nManual checks required in Vercel Dashboard:', colors.yellow);
  log('  1. Settings → Environment Variables → Verify VITE_* have no secrets', colors.cyan);
  log('  2. Settings → Headers → Verify CSP is configured (or documented)', colors.cyan);
  log('  3. Settings → Functions → Verify serverless functions are active', colors.cyan);
  log('  4. Settings → Git → Verify correct repo is connected', colors.cyan);

  log('\n✅ Vercel audit completed\n', colors.green);
}

main().catch(error => {
  log(`\n❌ Error: ${error.message}`, colors.red);
  process.exit(1);
});
