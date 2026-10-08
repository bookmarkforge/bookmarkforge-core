#!/usr/bin/env node

/**
 * audit-whop-config.mjs
 *
 * Automated Whop configuration audit script
 * Uses local Whop API key from environment to verify configuration
 *
 * Prerequisites:
 * - WHOP_API_KEY set in environment or .env.local
 *
 * Usage:
 *   export WHOP_API_KEY=your_key_here
 *   node scripts/audit-whop-config.mjs
 *
 * Or use .env.local:
 *   echo "WHOP_API_KEY=your_key_here" > .env.local
 *   node scripts/audit-whop-config.mjs
 */

import { readFileSync } from 'fs';
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

// Load environment variables
function loadEnv() {
  try {
    const envContent = readFileSync('.env.local', 'utf-8');
    const lines = envContent.split('\n');
    lines.forEach(line => {
      const [key, ...valueParts] = line.split('=');
      if (key && valueParts.length > 0 && !line.startsWith('#')) {
        process.env[key.trim()] = valueParts.join('=').trim();
      }
    });
  } catch (_error) {
    // .env.local might not exist, that's ok
  }
}

async function main() {
  log('🚀 Starting Whop Configuration Audit...', colors.blue);
  log('📦 This script uses your local WHOP_API_KEY to verify configuration\n', colors.yellow);

  // Load environment
  loadEnv();

  const apiKey = process.env.WHOP_API_KEY;

  if (!apiKey) {
    log('\n❌ WHOP_API_KEY not found in environment', colors.red);
    log('\nSet it with:', colors.yellow);
    log('  export WHOP_API_KEY=your_key_here', colors.cyan);
    log('  OR create .env.local:', colors.cyan);
    log('  echo "WHOP_API_KEY=your_key_here" > .env.local', colors.cyan);
    process.exit(1);
  }

  log('✅ WHOP_API_KEY found in environment', colors.green);
  log(`   (Key length: ${apiKey.length} characters)`, colors.yellow);

  const results = {
    validate: null,
    test: null,
  };

  // 1. Validate Whop service
  log('\n🔧 Validating Whop service...', colors.cyan);
  try {
    results.validate = execSync('npm run whop:validate', {
      encoding: 'utf-8',
      stdio: 'pipe',
      env: { ...process.env }
    });
    log('✅ Whop service validation completed', colors.green);
  } catch (error) {
    log('❌ Whop service validation failed', colors.red);
    results.validate = { success: false, error: error.message };
  }

  // 2. Run Whop tests
  log('\n🔧 Running Whop tests...', colors.cyan);
  try {
    results.test = execSync('npm run whop:test', {
      encoding: 'utf-8',
      stdio: 'pipe',
      env: { ...process.env }
    });
    log('✅ Whop tests completed', colors.green);
  } catch (error) {
    log('❌ Whop tests failed', colors.red);
    results.test = { success: false, error: error.message };
  }

  // Summary
  log('\n' + '='.repeat(70), colors.blue);
  log('📊 WHOP AUDIT SUMMARY', colors.blue);
  log('='.repeat(70), colors.blue);

  log(`\nService Validation: ${results.validate?.success !== false ? '✅ PASSED' : '❌ FAILED'}`,
      results.validate?.success !== false ? colors.green : colors.red);
  log(`Tests: ${results.test?.success !== false ? '✅ PASSED' : '❌ FAILED'}`,
      results.test?.success !== false ? colors.green : colors.red);

  // Show details
  if (results.validate?.output) {
    log('\n📝 Validation Output:', colors.cyan);
    log(results.validate.output, colors.reset);
  }

  if (results.test?.output) {
    log('\n📝 Test Output:', colors.cyan);
    log(results.test.output, colors.reset);
  }

  // Recommendations
  log('\n' + '='.repeat(70), colors.blue);
  log('💡 RECOMMENDATIONS', colors.blue);
  log('='.repeat(70), colors.blue);

  log('\nManual checks required in Whop Dashboard:', colors.yellow);
  log('  1. Products → Verify "BookmarkForge Pro" exists and is active', colors.cyan);
  log('  2. Products → Verify LIFETIME plan is configured correctly', colors.cyan);
  log('  3. Products → Verify Software Licensing is enabled', colors.cyan);
  log('  4. Settings → API Keys → Verify API key is active', colors.cyan);
  log('  5. Orders → Check for suspicious orders', colors.cyan);

  log('\n📚 Full integration guide:', colors.cyan);
  log('  docs/WHOP-INTEGRATION.md', colors.reset);

  log('\n✅ Whop audit completed\n', colors.green);
}

main().catch(error => {
  log(`\n❌ Error: ${error.message}`, colors.red);
  process.exit(1);
});
