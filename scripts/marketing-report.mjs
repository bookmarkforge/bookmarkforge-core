#!/usr/bin/env node

/**
 * Marketing Daily Report Generator
 *
 * This script generates a daily report of marketing activity:
 * - Social listening matches
 * - Response suggestions
 * - Content syndication status
 * - Structured data status
 *
 * Usage: node scripts/marketing-report.mjs
 *
 * Output: marketing/daily-report.md
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const MARKETING_DIR = join(__dirname, '..', 'marketing');
const REPORT_FILE = join(MARKETING_DIR, 'daily-report.md');

/**
 * Load JSON file safely
 */
function loadJsonFile(filePath) {
  try {
    if (existsSync(filePath)) {
      return JSON.parse(readFileSync(filePath, 'utf-8'));
    }
    return null;
  } catch (error) {
    console.error(`❌ Error loading ${filePath}:`, error.message);
    return null;
  }
}

/**
 * Generate social listening section
 */
function generateSocialListeningSection(history) {
  if (!history || !Array.isArray(history) || history.length === 0) {
    return 'No social listening data available.';
  }

  const today = new Date();
  const todayMatches = history.filter(m => {
    const matchDate = new Date(m.timestamp);
    return matchDate.toDateString() === today.toDateString();
  });

  if (todayMatches.length === 0) {
    return 'No new mentions today.';
  }

  let section = `**Total matches today:** ${todayMatches.length}\n\n`;
  section += '| Platform | Subreddit | Keyword | Title |\n';
  section += '|----------|-----------|---------|-------|\n';

  for (const match of todayMatches) {
    section += `| ${match.platform} | ${match.subreddit || 'N/A'} | ${match.keyword} | [${match.title.substring(0, 50)}...](${match.url}) |\n`;
  }

  return section;
}

/**
 * Generate response suggestions section
 */
function generateSuggestionsSection(suggestions) {
  if (!suggestions || !Array.isArray(suggestions) || suggestions.length === 0) {
    return 'No response suggestions available.';
  }

  const urgent = suggestions.filter(s => s.urgency);
  const nonUrgent = suggestions.filter(s => !s.urgency);

  let section = `**Total suggestions:** ${suggestions.length}\n`;
  section += `**Urgent:** ${urgent.length}\n`;
  section += `**Non-urgent:** ${nonUrgent.length}\n\n`;

  if (urgent.length > 0) {
    section += '### Urgent Suggestions\n\n';
    for (const s of urgent) {
      section += `- [${s.platform}] ${s.postTitle}\n`;
      section += `  URL: ${s.postUrl}\n`;
      section += `  Suggested: ${s.suggestedResponse.substring(0, 100)}...\n\n`;
    }
  }

  if (nonUrgent.length > 0) {
    section += '### Non-Urgent Suggestions\n\n';
    for (const s of nonUrgent.slice(0, 5)) { // Show first 5
      section += `- [${s.platform}] ${s.postTitle}\n`;
      section += `  URL: ${s.postUrl}\n\n`;
    }
    if (nonUrgent.length > 5) {
      section += `... and ${nonUrgent.length - 5} more\n\n`;
    }
  }

  return section;
}

/**
 * Generate syndication section
 */
function generateSyndicationSection(history) {
  if (!history) {
    return 'No syndication history available.';
  }

  const totalPosts = Object.keys(history).length;
  const platforms = new Set();

  for (const [postKey, platformsData] of Object.entries(history)) {
    for (const platform of Object.keys(platformsData)) {
      platforms.add(platform);
    }
  }

  let section = `**Total syndicated posts:** ${totalPosts}\n`;
  section += `**Platforms used:** ${Array.from(platforms).join(', ')}\n\n`;

  if (totalPosts > 0) {
    section += '### Recently Syndicated\n\n';
    const recentPosts = Object.entries(history).slice(-5);
    for (const [postKey, platformsData] of recentPosts) {
      section += `- ${postKey}\n`;
      for (const [platform, url] of Object.entries(platformsData)) {
        section += `  - ${platform}: ${url}\n`;
      }
      section += '\n';
    }
  }

  return section;
}

/**
 * Generate structured data section
 */
function generateStructuredDataSection() {
  const structuredDataFile = join(__dirname, '..', 'public', 'structured-data.json');

  if (!existsSync(structuredDataFile)) {
    return 'Structured data not generated. Run `npm run generate:structured-data`.';
  }

  try {
    const data = JSON.parse(readFileSync(structuredDataFile, 'utf-8'));
    const schemas = Object.keys(data);

    let section = '✅ Structured data generated\n\n';
    section += '**Schemas included:**\n';
    for (const schema of schemas) {
      section += `- ${schema}\n`;
    }

    return section;
  } catch (error) {
    return '❌ Error reading structured data file.';
  }
}

/**
 * Generate full report
 */
function generateReport() {
  const date = new Date().toISOString().split('T')[0];
  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  let report = `# Marketing Daily Report\n\n`;
  report += `**Date:** ${today}\n`;
  report += `**Generated:** ${new Date().toISOString()}\n\n`;
  report += `---\n\n`;

  // Social Listening
  report += `## 1. Social Listening\n\n`;
  const socialHistory = loadJsonFile(join(MARKETING_DIR, 'social-listening-history.json'));
  report += generateSocialListeningSection(socialHistory);
  report += '\n';

  // Response Suggestions
  report += `## 2. Response Suggestions\n\n`;
  const suggestions = loadJsonFile(join(MARKETING_DIR, 'response-suggestions.json'));
  report += generateSuggestionsSection(suggestions);
  report += '\n';

  // Content Syndication
  report += `## 3. Content Syndication\n\n`;
  const syndicationHistory = loadJsonFile(join(MARKETING_DIR, 'syndication-history.json'));
  report += generateSyndicationSection(syndicationHistory);
  report += '\n';

  // Structured Data
  report += `## 4. Structured Data\n\n`;
  report += generateStructuredDataSection();
  report += '\n';

  // Action Items
  report += `## 5. Action Items\n\n`;
  report += `- [ ] Review response suggestions in \`marketing/response-suggestions.json\`\n`;
  report += `- [ ] Respond to urgent mentions\n`;
  report += `- [ ] Respond to non-urgent mentions\n`;
  report += `- [ ] Create new blog posts if needed\n`;
  report += `- [ ] Update structured data if needed\n`;
  report += '\n';

  // Footer
  report += `---\n\n`;
  report += `*This report was generated automatically by \`npm run marketing:report\`*\n`;

  return report;
}

/**
 * Main execution
 */
function main() {
  try {
    console.log('=== Generating Marketing Daily Report ===\n');

    const report = generateReport();
    writeFileSync(REPORT_FILE, report, 'utf-8');

    console.log(`✅ Report generated: ${REPORT_FILE}`);
    console.log('\n📊 Report Summary:');
    console.log('  - Social listening matches');
    console.log('  - Response suggestions (urgent + non-urgent)');
    console.log('  - Content syndication status');
    console.log('  - Structured data status');
    console.log('  - Action items');

    console.log('\n💡 View the report:');
    console.log(`  cat ${REPORT_FILE}`);

  } catch (error) {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { main, generateReport };
