#!/usr/bin/env node

/**
 * GitHub Branch Protection Configuration Script
 * 
 * This script automates branch protection configuration for GitHub repositories:
 * - Blocks force push
 * - Blocks branch deletion
 * - Configures status checks (optional)
 * - Configures PR requirements (optional)
 * 
 * Usage:
 *   node scripts/github-branch-protection.mjs
 * 
 * Environment variables:
 *   GITHUB_TOKEN - Your GitHub Personal Access Token (required)
 *   GITHUB_REPO_OWNER - Repository owner (default: bookmarkforge)
 *   GITHUB_REPO_NAME - Repository name (default: bookmarkforge)
 *   BRANCH_NAME - Branch to protect (default: release/v1.0.0)
 *   REQUIRE_PR - Require pull request before merging (default: false)
 *   REQUIRE_STATUS_CHECKS - Require status checks before merging (default: false)
 */

import https from 'https';

// Configuration
const GITHUB_API_BASE = 'https://api.github.com';
const DEFAULT_OWNER = 'bookmarkforge';
const DEFAULT_REPO = 'bookmarkforge';
const DEFAULT_BRANCH = 'release/v1.0.0';

// Get environment variables
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO_OWNER = process.env.GITHUB_REPO_OWNER || DEFAULT_OWNER;
const GITHUB_REPO_NAME = process.env.GITHUB_REPO_NAME || DEFAULT_REPO;
const BRANCH_NAME = process.env.BRANCH_NAME || DEFAULT_BRANCH;
const REQUIRE_PR = process.env.REQUIRE_PR === 'true';
const REQUIRE_STATUS_CHECKS = process.env.REQUIRE_STATUS_CHECKS === 'true';

// Validate required environment variables
if (!GITHUB_TOKEN) {
  console.error('❌ Error: GITHUB_TOKEN environment variable is required');
  console.error('Get your token from: https://github.com/settings/tokens');
  console.error('Token permissions needed: repo (full control)');
  process.exit(1);
}

console.log(`🔧 Configuring branch protection for ${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}:${BRANCH_NAME}`);
console.log(`📦 Repository: ${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}`);
console.log(`🌿 Branch: ${BRANCH_NAME}`);
console.log(`🔒 Require PR: ${REQUIRE_PR}`);
console.log(`✅ Require Status Checks: ${REQUIRE_STATUS_CHECKS}\n`);

/**
 * Make an authenticated request to GitHub API
 */
async function githubRequest(endpoint, method = 'GET', body = null) {
  const url = `${GITHUB_API_BASE}${endpoint}`;
  const options = {
    method,
    headers: {
      'Authorization': `Bearer ${GITHUB_TOKEN}`,
      'User-Agent': 'BookmarkForge-Branch-Protection-Script',
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  };

  if (body) {
    options.headers['Content-Type'] = 'application/json';
  }

  return new Promise((resolve, reject) => {
    const req = https.request(url, options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(parsed);
          } else {
            reject(new Error(`GitHub API error: ${res.statusCode} - ${parsed.message || data}`));
          }
        } catch (_e) {
          resolve(data);
        }
      });
    });

    req.on('error', reject);

    if (body) {
      req.write(JSON.stringify(body));
    }

    req.end();
  });
}

/**
 * Check if branch exists
 */
async function checkBranchExists() {
  console.log(`🔍 Checking if branch ${BRANCH_NAME} exists...`);
  
  try {
    const result = await githubRequest(`/repos/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/branches/${BRANCH_NAME}`);
    console.log(`✅ Branch ${BRANCH_NAME} exists`);
    return result;
  } catch (error) {
    console.error(`❌ Branch ${BRANCH_NAME} not found: ${error.message}`);
    throw error;
  }
}

/**
 * Get current branch protection rules
 */
async function getCurrentProtection() {
  console.log(`📋 Fetching current branch protection rules...`);
  
  try {
    const result = await githubRequest(`/repos/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/branches/${BRANCH_NAME}/protection`);
    console.log(`✅ Current protection rules fetched`);
    return result;
  } catch (error) {
    if (error.message.includes('404')) {
      console.log(`ℹ️  No existing protection rules found`);
      return null;
    }
    throw error;
  }
}

/**
 * Configure branch protection
 */
async function configureBranchProtection() {
  console.log(`🔒 Configuring branch protection...`);
  
  const protectionConfig = {
    required_linear_history: true,
    allow_force_pushes: false,
    allow_deletions: false,
    required_conversation_resolution: true,
    enforce_admins: true,
  };

  // Optional: Require PR
  if (REQUIRE_PR) {
    protectionConfig.required_pull_request_reviews = {
      required_approving_review_count: 1,
      dismiss_stale_reviews: false,
      require_code_owner_reviews: false,
    };
  }

  // Optional: Require status checks
  if (REQUIRE_STATUS_CHECKS) {
    protectionConfig.required_status_checks = {
      strict: true,
      contexts: ['ci', 'build', 'test'],
    };
  }

  try {
    const result = await githubRequest(
      `/repos/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/branches/${BRANCH_NAME}/protection`,
      'PUT',
      protectionConfig
    );
    console.log(`✅ Branch protection configured successfully`);
    return result;
  } catch (error) {
    console.error(`❌ Failed to configure branch protection: ${error.message}`);
    throw error;
  }
}

/**
 * Display protection summary
 */
function displayProtectionSummary() {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('              BRANCH PROTECTION SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log('Repository:');
  console.log(`  Owner: ${GITHUB_REPO_OWNER}`);
  console.log(`  Name: ${GITHUB_REPO_NAME}`);
  console.log(`  Branch: ${BRANCH_NAME}\n`);

  console.log('Protection Rules:');
  console.log(`  ✅ Block force push: ${true}`);
  console.log(`  ✅ Block branch deletion: ${true}`);
  console.log(`  ✅ Require linear history: ${true}`);
  console.log(`  ✅ Enforce on admins: ${true}`);
  console.log(`  ✅ Require conversation resolution: ${true}`);
  console.log(`  🔒 Require PR: ${REQUIRE_PR}`);
  console.log(`  ✅ Require status checks: ${REQUIRE_STATUS_CHECKS}\n`);

  console.log('What this means:');
  console.log('  • Force push is blocked - history cannot be overwritten');
  console.log('  • Branch deletion is blocked - cannot be deleted by accident');
  console.log('  • Linear history is required - no merge commits allowed');
  console.log('  • Admins must follow rules - even repository admins');
  console.log('  • Conversation resolution required - all comments must be resolved');
  
  if (REQUIRE_PR) {
    console.log('  • Pull request required - changes must go through PR');
  }
  
  if (REQUIRE_STATUS_CHECKS) {
    console.log('  • Status checks required - CI/CD must pass before merge');
  }

  console.log('\n═══════════════════════════════════════════════════════════════\n');
}

/**
 * Main execution
 */
async function main() {
  try {
    // Step 1: Check if branch exists
    await checkBranchExists();
    
    // Step 2: Get current protection (if any)
    const currentProtection = await getCurrentProtection();
    
    if (currentProtection) {
      console.log('\n⚠️  Branch already has protection rules');
      console.log('   The script will overwrite existing rules');
    }
    
    // Step 3: Configure branch protection
    await configureBranchProtection();
    
    // Step 4: Display summary
    displayProtectionSummary();
    
    console.log('✅ Branch protection configuration completed successfully!');
    console.log(`\n🌐 View at: https://github.com/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/settings/branches`);
    
  } catch (error) {
    console.error('\n❌ Branch protection configuration failed:', error.message);
    process.exit(1);
  }
}

// Run the script
main();
