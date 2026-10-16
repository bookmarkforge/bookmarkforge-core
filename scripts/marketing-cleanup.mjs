#!/usr/bin/env node

/**
 * Marketing Automation Cleanup Script
 *
 * This script cleans up old marketing data:
 * - Removes social listening history older than 30 days
 * - Removes response suggestions older than 7 days
 * - Archives old data before deletion
 *
 * Usage: node scripts/marketing-cleanup.mjs
 *
 * Options:
 *   --dry-run: Show what would be deleted without deleting
 *   --days=N: Override default retention days
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const MARKETING_DIR = join(__dirname, '..', 'marketing');
const ARCHIVE_DIR = join(MARKETING_DIR, 'archive');

const DEFAULT_RETENTION_DAYS = {
  'social-listening-history.json': 30,
  'response-suggestions.json': 7,
  'syndication-history.json': 90, // Keep syndication history longer
};

/**
 * Parse command line arguments
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    dryRun: args.includes('--dry-run'),
    days: null,
  };

  const daysArg = args.find(arg => arg.startsWith('--days='));
  if (daysArg) {
    options.days = parseInt(daysArg.split('=')[1], 10);
  }

  return options;
}

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
 * Filter entries by date
 */
function filterByDate(data, retentionDays) {
  if (!Array.isArray(data)) return data;

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

  return data.filter(entry => {
    const entryDate = new Date(entry.timestamp);
    return entryDate >= cutoffDate;
  });
}

/**
 * Archive old data
 */
function archiveData(filePath, oldData, options) {
  if (!existsSync(ARCHIVE_DIR)) {
    mkdirSync(ARCHIVE_DIR, { recursive: true });
  }

  const fileName = filePath.split('/').pop();
  const timestamp = new Date().toISOString().split('T')[0];
  const archivePath = join(ARCHIVE_DIR, `${fileName}.${timestamp}.json`);

  if (options.dryRun) {
    console.log(`[DRY RUN] Would archive to: ${archivePath}`);
    return;
  }

  writeFileSync(archivePath, JSON.stringify(oldData, null, 2), 'utf-8');
  console.log(`✅ Archived old data to: ${archivePath}`);
}

/**
 * Process a single history file
 */
function processHistoryFile(fileName, retentionDays, options) {
  const filePath = join(MARKETING_DIR, fileName);

  if (!existsSync(filePath)) {
    console.log(`⏭️  ${fileName} does not exist, skipping`);
    return;
  }

  const data = loadJsonFile(filePath);
  if (!data) {
    console.log(`⏭️  ${fileName} is empty or invalid, skipping`);
    return;
  }

  const originalCount = Array.isArray(data) ? data.length : Object.keys(data).length;
  const filteredData = filterByDate(data, retentionDays);
  const newCount = Array.isArray(filteredData) ? filteredData.length : Object.keys(filteredData).length;
  const removedCount = originalCount - newCount;

  if (removedCount === 0) {
    console.log(`⏭️  ${fileName}: No old entries to remove`);
    return;
  }

  console.log(`📄 ${fileName}:`);
  console.log(`   Original: ${originalCount} entries`);
  console.log(`   After cleanup: ${newCount} entries`);
  console.log(`   Removed: ${removedCount} entries`);

  if (options.dryRun) {
    console.log(`[DRY RUN] Would remove ${removedCount} old entries`);
    return;
  }

  // Archive old data first
  const oldData = Array.isArray(data)
    ? data.filter(entry => !filteredData.includes(entry))
    : Object.fromEntries(
        Object.entries(data).filter(([key]) => !filteredData[key])
      );

  if (Object.keys(oldData).length > 0) {
    archiveData(filePath, oldData, options);
  }

  // Write filtered data
  writeFileSync(filePath, JSON.stringify(filteredData, null, 2), 'utf-8');
  console.log(`✅ Cleaned up ${fileName}`);
}

/**
 * Main execution
 */
function main() {
  const options = parseArgs();

  console.log('=== Marketing Automation Cleanup ===\n');

  if (options.dryRun) {
    console.log('⚠️  DRY RUN MODE - No files will be modified\n');
  }

  if (options.days) {
    console.log(`📅 Custom retention days: ${options.days}\n`);
  }

  console.log('🔍 Processing history files...\n');

  // Process each history file
  for (const [fileName, defaultDays] of Object.entries(DEFAULT_RETENTION_DAYS)) {
    const retentionDays = options.days || defaultDays;
    processHistoryFile(fileName, retentionDays, options);
  }

  console.log('\n=== Summary ===');
  console.log('✅ Cleanup complete');
  console.log(`📁 Archive directory: ${ARCHIVE_DIR}`);

  if (!options.dryRun) {
    console.log('\n💡 Tip: Archive files are kept indefinitely.');
    console.log('   Manually delete old archives if needed.');
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { main, filterByDate };
