#!/usr/bin/env node

/**
 * Marketing Automation Setup Script
 *
 * This script initializes the marketing automation system:
 * - Creates marketing directory
 * - Creates empty history files
 * - Sets up .env.example for API keys
 * - Provides setup instructions
 *
 * Usage: node scripts/marketing-setup.mjs
 */

import { mkdirSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const MARKETING_DIR = join(__dirname, '..', 'marketing');
const ENV_EXAMPLE = join(__dirname, '..', '.env.marketing.example');

/**
 * Create marketing directory
 */
function createMarketingDir() {
  if (!existsSync(MARKETING_DIR)) {
    mkdirSync(MARKETING_DIR, { recursive: true });
    console.log('✅ Created marketing directory');
  } else {
    console.log('⏭️  Marketing directory already exists');
  }
}

/**
 * Create empty history files
 */
function createHistoryFiles() {
  const files = [
    'social-listening-history.json',
    'response-suggestions.json',
    'syndication-history.json',
  ];

  for (const file of files) {
    const filePath = join(MARKETING_DIR, file);
    if (!existsSync(filePath)) {
      writeFileSync(filePath, '[]', 'utf-8');
      console.log(`✅ Created ${file}`);
    } else {
      console.log(`⏭️  ${file} already exists`);
    }
  }
}

/**
 * Create .env.marketing.example
 */
function createEnvExample() {
  const content = `# Marketing Automation Environment Variables
# Copy this file to .env.local and fill in your values

# Discord/Telegram Webhook for Social Listening Notifications
WEBHOOK_URL=https://discord.com/api/webhooks/YOUR_WEBHOOK_ID/YOUR_WEBHOOK_TOKEN

# dev.to API Key for Content Syndication
DEV_API_KEY=your_dev_to_api_key

# Hashnode API Key for Content Syndication
HASHNODE_API_KEY=your_hashnode_api_key
HASHNODE_PUBLICATION_ID=your_hashnode_publication_id

# GitHub Token (optional, for enhanced GitHub Discussions monitoring)
GITHUB_TOKEN=ghp_YOUR_GITHUB_TOKEN
`;

  if (!existsSync(ENV_EXAMPLE)) {
    writeFileSync(ENV_EXAMPLE, content, 'utf-8');
    console.log('✅ Created .env.marketing.example');
  } else {
    console.log('⏭️  .env.marketing.example already exists');
  }
}

/**
 * Print setup instructions
 */
function printInstructions() {
  console.log('\n=== Setup Instructions ===\n');
  console.log('1. Copy environment variables:');
  console.log('   cp .env.marketing.example .env.local');
  console.log('');
  console.log('2. Fill in your API keys in .env.local');
  console.log('');
  console.log('3. Run marketing automation:');
  console.log('   npm run marketing:all');
  console.log('');
  console.log('4. Generate daily report:');
  console.log('   npm run marketing:report');
  console.log('');
  console.log('5. For GitHub Actions automation:');
  console.log('   - Add secrets to your repository settings:');
  console.log('     - WEBHOOK_URL');
  console.log('     - DEV_API_KEY');
  console.log('     - HASHNODE_API_KEY');
  console.log('     - HASHNODE_PUBLICATION_ID');
  console.log('   - The workflow is at .github/workflows/marketing-automation.yml');
  console.log('');
  console.log('=== Documentation ===\n');
  console.log('Main guide: docs/marketing-automation.md');
  console.log('Webhook setup: docs/marketing/webhook-setup-guide.md');
  console.log('Content syndication: docs/marketing/content-syndication-guide.md');
  console.log('Structured data: docs/marketing/structured-data-guide.md');
  console.log('Community engagement: docs/marketing/community-engagement-guide.md');
  console.log('Improvements roadmap: docs/marketing/social-listening-improvements.md');
}

/**
 * Main execution
 */
function main() {
  console.log('=== BookmarkForge Marketing Automation Setup ===\n');

  createMarketingDir();
  createHistoryFiles();
  createEnvExample();

  console.log('\n✅ Setup complete!\n');
  printInstructions();
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { main };
