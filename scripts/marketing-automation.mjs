#!/usr/bin/env node

/**
 * Marketing Automation Orchestrator
 *
 * This script runs all marketing automation tasks in sequence:
 * 1. Social listening (Reddit RSS)
 * 2. Community engagement suggestions
 * 3. Content syndication (if new posts)
 * 4. Structured data generation
 *
 * Usage: node scripts/marketing-automation.mjs
 *
 * Environment Variables:
 * - WEBHOOK_URL: Discord/Telegram webhook for notifications
 * - DEV_API_KEY: dev.to API key for content syndication
 * - HASHNODE_API_KEY: Hashnode API key for content syndication
 * - HASHNODE_PUBLICATION_ID: Hashnode publication ID
 */

import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

/**
 * Execute a command and return the result
 */
function runCommand(command, options = {}) {
  try {
    console.log(`\n🔧 Running: ${command}`);
    const result = execSync(command, {
      cwd: join(__dirname, '..'),
      stdio: 'inherit',
      ...options,
    });
    return { success: true, output: result };
  } catch (error) {
    console.error(`❌ Command failed: ${command}`);
    return { success: false, error };
  }
}

/**
 * Check if environment variable is set
 */
function checkEnvVar(name) {
  const value = process.env[name];
  if (value) {
    console.log(`✅ ${name} is set`);
    return true;
  } else {
    console.log(`⚠️  ${name} is not set (optional)`);
    return false;
  }
}

/**
 * Main execution
 */
async function main() {
  console.log('=== BookmarkForge Marketing Automation ===\n');

  // Check environment variables
  console.log('🔍 Checking environment variables...');
  const hasWebhook = checkEnvVar('WEBHOOK_URL');
  const hasDevKey = checkEnvVar('DEV_API_KEY');
  const hasHashnodeKey = checkEnvVar('HASHNODE_API_KEY');
  const hasHashnodePubId = checkEnvVar('HASHNODE_PUBLICATION_ID');

  console.log('\n');

  // Step 1: Social Listening
  console.log('=== Step 1: Social Listening ===');
  const socialListeningResult = runCommand('npm run marketing:social-listen');
  if (!socialListeningResult.success) {
    console.log('⚠️  Social listening failed, continuing...');
  }

  // Step 2: Community Engagement Suggestions
  console.log('\n=== Step 2: Community Engagement Suggestions ===');
  const engagementResult = runCommand('npm run marketing:engage');
  if (!engagementResult.success) {
    console.log('⚠️  Community engagement failed, continuing...');
  }

  // Step 3: Content Syndication (only if API keys are set)
  console.log('\n=== Step 3: Content Syndication ===');
  if (hasDevKey || hasHashnodeKey) {
    const syndicationResult = runCommand('npm run marketing:syndicate');
    if (!syndicationResult.success) {
      console.log('⚠️  Content syndication failed, continuing...');
    }
  } else {
    console.log('⏭️  Skipping content syndication (no API keys configured)');
  }

  // Step 4: Structured Data Generation
  console.log('\n=== Step 4: Structured Data Generation ===');
  const structuredDataResult = runCommand('npm run generate:structured-data');
  if (!structuredDataResult.success) {
    console.log('⚠️  Structured data generation failed, continuing...');
  }

  // Step 5: Article Schema Generation
  console.log('\n=== Step 5: Article Schema Generation ===');
  const articleSchemaResult = runCommand('npm run generate:article-schema');
  if (!articleSchemaResult.success) {
    console.log('⚠️  Article schema generation failed, continuing...');
  }

  // Step 6: HowTo Schema Generation
  console.log('\n=== Step 6: HowTo Schema Generation ===');
  const howtoSchemaResult = runCommand('npm run generate:howto-schema');
  if (!howtoSchemaResult.success) {
    console.log('⚠️  HowTo schema generation failed, continuing...');
  }

  // Summary
  console.log('\n=== Summary ===');
  console.log('✅ Marketing automation completed');
  console.log('\n📊 Results:');
  console.log(`  Social Listening: ${socialListeningResult.success ? '✅' : '❌'}`);
  console.log(`  Community Engagement: ${engagementResult.success ? '✅' : '❌'}`);
  console.log(`  Content Syndication: ${hasDevKey || hasHashnodeKey ? (socialListeningResult.success ? '✅' : '⏭️') : '⏭️'}`);
  console.log(`  Structured Data: ${structuredDataResult.success ? '✅' : '❌'}`);

  console.log('\n📁 Generated Files:');
  if (existsSync(join(__dirname, '..', 'marketing', 'social-listening-history.json'))) {
    console.log('  - marketing/social-listening-history.json');
  }
  if (existsSync(join(__dirname, '..', 'marketing', 'response-suggestions.json'))) {
    console.log('  - marketing/response-suggestions.json (review required!)');
  }
  if (existsSync(join(__dirname, '..', 'marketing', 'syndication-history.json'))) {
    console.log('  - marketing/syndication-history.json');
  }
  if (existsSync(join(__dirname, '..', 'public', 'structured-data.json'))) {
    console.log('  - public/structured-data.json');
  }

  console.log('\n⚠️  IMPORTANT:');
  console.log('  - Review response-suggestions.json before responding to mentions');
  console.log('  - Update structured-data.json in your landing pages');
  console.log('  - Configure environment variables for full automation');

  console.log('\n🚀 Next Steps:');
  console.log('  1. Review marketing/response-suggestions.json');
  console.log('  2. Respond to mentions manually (Reddit, HN, etc.)');
  console.log('  3. Inject structured-data.json into landing pages');
  console.log('  4. Commit and push changes');
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export { main };
