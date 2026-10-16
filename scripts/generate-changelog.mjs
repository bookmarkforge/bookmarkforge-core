#!/usr/bin/env node

/**
 * Automated Changelog Generator
 * 
 * Generates release notes from git commits.
 * categorizes commits by type (feat, fix, docs, etc.)
 * formats for Markdown output.
 * 
 * Usage: node scripts/generate-changelog.mjs [since-tag]
 */

import { execSync } from 'child_process';
import { writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const CHANGELOG_FILE = join(REPO_ROOT, 'CHANGELOG.md');

/**
 * Get git commits since a tag
 */
function getCommits(sinceTag = null) {
  try {
    const cmd = sinceTag 
      ? `git log ${sinceTag}..HEAD --pretty=format:"%H|%s|%an|%ae|%ad" --date=short`
      : `git log HEAD --pretty=format:"%H|%s|%an|%ae|%ad" --date=short -20`;
    
    const output = execSync(cmd, { 
      cwd: REPO_ROOT, 
      encoding: 'utf-8' 
    });
    
    return output.trim().split('\n').map(line => {
      const [hash, subject, author, email, date] = line.split('|');
      return { hash, subject, author, email, date };
    });
  } catch (error) {
    console.error('Error getting git commits:', error.message);
    return [];
  }
}

/**
 * Categorize commit by conventional commit format
 */
function categorizeCommit(subject) {
  const patterns = {
    feat: /^feat(?:\([^)]+\))?:/,
    fix: /^fix(?:\([^)]+\))?:/,
    docs: /^docs(?:\([^)]+\))?:/,
    style: /^style(?:\([^)]+\))?:/,
    refactor: /^refactor(?:\([^)]+\))?:/,
    perf: /^perf(?:\([^)]+\))?:/,
    test: /^test(?:\([^)]+\))?:/,
    chore: /^chore(?:\([^)]+\))?:/,
    build: /^build(?:\([^)]+\))?:/,
    ci: /^ci(?:\([^)]+\))?:/,
  };
  
  for (const [type, pattern] of Object.entries(patterns)) {
    if (pattern.test(subject)) {
      return type;
    }
  }
  
  return 'other';
}

/**
 * Format commit for changelog
 */
function formatCommit(commit) {
  const category = categorizeCommit(commit.subject);
  const cleanSubject = commit.subject
    .replace(/^(feat|fix|docs|style|refactor|perf|test|chore|build|ci)(\([^)]+\))?:\s*/, '')
    .replace(/!\s*$/, ''); // Remove breaking change indicator
  
  return `- ${cleanSubject} (${commit.hash.substring(0, 7)})`;
}

/**
 * Group commits by category
 */
function groupCommits(commits) {
  const groups = {
    feat: [],
    fix: [],
    docs: [],
    style: [],
    refactor: [],
    perf: [],
    test: [],
    chore: [],
    build: [],
    ci: [],
    other: [],
  };
  
  for (const commit of commits) {
    const category = categorizeCommit(commit.subject);
    groups[category].push(commit);
  }
  
  return groups;
}

/**
 * Generate changelog markdown
 */
function generateChangelog(version, date, groups) {
  let markdown = `## [${version}] - ${date}\n\n`;
  
  const sections = [
    { title: '### ✨ Features', key: 'feat' },
    { title: '### 🐛 Bug Fixes', key: 'fix' },
    { title: '### 📚 Documentation', key: 'docs' },
    { title: '### ♻️  Refactoring', key: 'refactor' },
    { title: '### ⚡ Performance', key: 'perf' },
    { title: '### 🧪 Testing', key: 'test' },
    { title: '### 🔧 Maintenance', key: 'chore' },
    { title: '### 📦 Build', key: 'build' },
    { title: '### 👷 CI', key: 'ci' },
    { title: '### 🔄 Other', key: 'other' },
  ];
  
  for (const section of sections) {
    const commits = groups[section.key];
    if (commits.length > 0) {
      markdown += `${section.title}\n\n`;
      for (const commit of commits) {
        markdown += formatCommit(commit) + '\n';
      }
      markdown += '\n';
    }
  }
  
  return markdown;
}

/**
 * Get latest tag
 */
function getLatestTag() {
  try {
    const output = execSync('git describe --tags --abbrev=0', {
      cwd: REPO_ROOT,
      encoding: 'utf-8'
    });
    return output.trim();
  } catch (error) {
    return null;
  }
}

/**
 * Update existing changelog
 */
function updateChangelog(newEntry) {
  let existingContent = '';
  
  try {
    existingContent = readFileSync(CHANGELOG_FILE, 'utf-8');
  } catch (error) {
    // File doesn't exist, create header
    existingContent = `# Changelog\n\nAll notable changes to BookmarkForge will be documented in this file.\n\n`;
  }
  
  // Insert new entry after header
  const lines = existingContent.split('\n');
  const headerEndIndex = lines.findIndex(line => line.startsWith('## [')) || 2;
  
  lines.splice(headerEndIndex, 0, newEntry);
  
  writeFileSync(CHANGELOG_FILE, lines.join('\n'), 'utf-8');
}

/**
 * Main execution
 */
function main() {
  const args = process.argv.slice(2);
  const sinceTag = args[0] || getLatestTag();
  
  console.log('📝 Generating changelog...\n');
  
  if (sinceTag) {
    console.log(`📦 Since tag: ${sinceTag}`);
  } else {
    console.log('📦 Using last 20 commits');
  }
  
  const commits = getCommits(sinceTag);
  
  if (commits.length === 0) {
    console.log('ℹ️  No commits found');
    return;
  }
  
  console.log(`📊 Found ${commits.length} commits\n`);
  
  const groups = groupCommits(commits);
  
  // Generate version (can be customized)
  const version = sinceTag ? process.env.RELEASE_VERSION || 'Unreleased' : 'Latest';
  const date = new Date().toISOString().split('T')[0];
  
  const changelogEntry = generateChangelog(version, date, groups);
  
  console.log('📄 Generated changelog entry:\n');
  console.log(changelogEntry);
  
  // Update CHANGELOG.md
  updateChangelog(changelogEntry);
  
  console.log(`\n✅ Updated: ${CHANGELOG_FILE}`);
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { getCommits, groupCommits, generateChangelog };
