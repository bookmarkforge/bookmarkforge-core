#!/usr/bin/env node

/**
 * setup-github-ruleset.mjs
 *
 * Installs the repository ruleset that protects `main`, through the API.
 * Usage: GITHUB_TOKEN=xxx node scripts/setup-github-ruleset.mjs [--dry-run]
 *
 * The ruleset body is NOT hardcoded here. It is read from
 * `.github/rulesets/main-protection.json` — the single payload that
 * `npm run check:launch-checklist` verifies — because a second copy can drift,
 * and it did: this script used to protect `release/v1.0.0` as well, demand one
 * approving review (a deadlock in a single-maintainer repository) and send no
 * required status checks at all, so it would have installed a ruleset that
 * blocked every merge while gating nothing on CI. Reading the payload makes
 * that divergence impossible rather than merely documented.
 *
 * `--dry-run` prints the body it would POST and touches no API, so the
 * install path can be verified before the plan gate lifts.
 *
 * Requires:
 * - GITHUB_TOKEN: token with `repo` scope and repository admin
 * - GITHUB_OWNER / GITHUB_REPO: repository coordinates
 *   (default: bookmarkforge/bookmarkforge)
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PAYLOAD_PATH = join(ROOT, '.github', 'rulesets', 'main-protection.json');

const OWNER = process.env.GITHUB_OWNER || 'bookmarkforge';
const REPO = process.env.GITHUB_REPO || 'bookmarkforge';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const DRY_RUN = process.argv.includes('--dry-run');

/** Fields GitHub emits when it EXPORTS a ruleset; a creation body must not carry them. */
const EXPORT_ONLY_FIELDS = [
  'id',
  'source',
  'source_type',
  'node_id',
  '_links',
  'created_at',
  'updated_at',
];

/**
 * The canonical creation body, loaded from the gate-verified payload.
 * Fails closed rather than POSTing something the payload gate would reject.
 */
function loadRulesetPayload() {
  let payload;
  try {
    payload = JSON.parse(readFileSync(PAYLOAD_PATH, 'utf8'));
  } catch (error) {
    throw new Error(`cannot read the ruleset payload at ${PAYLOAD_PATH}: ${error.message}`);
  }
  const offending = EXPORT_ONLY_FIELDS.filter((field) => field in payload);
  if (offending.length) {
    throw new Error(
      `${PAYLOAD_PATH} carries export-only fields (${offending.join(', ')}); ` +
        'a creation body must not contain them',
    );
  }
  return payload;
}

if (!DRY_RUN && !GITHUB_TOKEN) {
  console.error('❌ ERROR: GITHUB_TOKEN is not set');
  console.error('❗ Generate a token at: https://github.com/settings/tokens');
  console.error('❗ Required permissions: repo (admin)');
  console.error('❗ Run: GITHUB_TOKEN=xxx node scripts/setup-github-ruleset.mjs');
  process.exit(1);
}

// GitHub API
const GITHUB_API = 'https://api.github.com';

async function githubRequest(endpoint, options = {}) {
  const url = `${GITHUB_API}${endpoint}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`GitHub API error: ${response.status} ${response.statusText}\n${error}`);
  }

  return response.json();
}

// Ruleset configuration — the gate-verified payload, loaded once.
// The load happens at module scope so a malformed payload can never be
// partially applied; it is wrapped here because main()'s catch cannot cover a
// throw raised before main() is entered (that would surface as an unhandled
// rejection stack trace instead of an operator-readable message).
let RULESET_CONFIG;
try {
  RULESET_CONFIG = loadRulesetPayload();
} catch (error) {
  console.error('❌ ERROR: the ruleset payload is not usable');
  console.error(`❗ ${error.message}`);
  console.error('❗ Run: npm run check:launch-checklist');
  process.exit(1);
}

/** Branch patterns the payload covers, for the progress output. */
function branchPatterns() {
  return RULESET_CONFIG.conditions?.ref_name?.include ?? [];
}

/** The pull_request rule's parameters, when the payload carries one. */
function pullRequestParameters() {
  return RULESET_CONFIG.rules?.find((rule) => rule.type === 'pull_request')?.parameters ?? {};
}

/** Required status checks as short `{ context, integration_id }` records. */
function requiredStatusChecks() {
  return (
    RULESET_CONFIG.rules?.find((rule) => rule.type === 'required_status_checks')?.parameters
      ?.required_status_checks ?? []
  );
}

async function listExistingRulesets() {
  console.log('📋 Listing existing rulesets...');
  try {
    const rulesets = await githubRequest(`/repos/${OWNER}/${REPO}/rulesets`);
    console.log(`✅ Found ${rulesets.length} existing rulesets`);
    return rulesets;
  } catch (error) {
    console.error('❌ Failed to list rulesets:', error.message);
    throw error;
  }
}

async function deleteRuleset(rulesetId) {
  console.log(`🗑️  Deleting existing ruleset (ID: ${rulesetId})...`);
  try {
    await githubRequest(`/repos/${OWNER}/${REPO}/rulesets/${rulesetId}`, {
      method: 'DELETE',
    });
    console.log('✅ Ruleset deleted');
  } catch (error) {
    console.error('❌ Failed to delete ruleset:', error.message);
    throw error;
  }
}

async function createRuleset() {
  console.log('📝 Creating branch-protection ruleset...');
  console.log('📋 Configuration (from .github/rulesets/main-protection.json):');
  console.log(`  - Name: ${RULESET_CONFIG.name}`);
  console.log(`  - Branches: ${branchPatterns().join(', ') || 'none'}`);
  console.log(`  - Enforcement: ${RULESET_CONFIG.enforcement}`);
  console.log(
    `  - Required approving reviews: ${pullRequestParameters().required_approving_review_count ?? 0}`,
  );
  const checks = requiredStatusChecks();
  console.log(`  - Required status checks: ${checks.length}`);
  for (const check of checks) {
    console.log(`      · ${check.context}`);
  }

  try {
    const ruleset = await githubRequest(`/repos/${OWNER}/${REPO}/rulesets`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(RULESET_CONFIG),
    });

    console.log('✅ Ruleset created successfully');
    console.log(`📋 ID: ${ruleset.id}`);
    console.log(`📋 Name: ${ruleset.name}`);
    console.log(`📋 Status: ${ruleset.enforcement}`);
    
    return ruleset;
  } catch (error) {
    console.error('❌ Failed to create ruleset:', error.message);
    throw error;
  }
}

async function verifyRuleset() {
  console.log('🔍 Verifying ruleset...');
  try {
    const rulesets = await githubRequest(`/repos/${OWNER}/${REPO}/rulesets`);
    const newRuleset = rulesets.find(r => r.name === RULESET_CONFIG.name);
    
    if (newRuleset) {
      console.log('✅ Ruleset verified successfully');
      console.log(`📋 ID: ${newRuleset.id}`);
      console.log(`📋 Name: ${newRuleset.name}`);
      console.log(`📋 Status: ${newRuleset.enforcement}`);
      if (newRuleset.rules) {
        console.log(`📋 Rules configured: ${newRuleset.rules.length}`);
      }
      return true;
    } else {
      console.error('❌ Ruleset not found after creation');
      return false;
    }
  } catch (error) {
    console.error('❌ Failed to verify ruleset:', error.message);
    return false;
  }
}

async function main() {
  console.log('🚀 Configuring the GitHub branch-protection ruleset');
  console.log(`📦 Repo: ${OWNER}/${REPO}`);
  console.log('');

  if (DRY_RUN) {
    console.log('🧪 DRY RUN — no GitHub API call will be made.');
    console.log(`📦 Payload: ${PAYLOAD_PATH}`);
    console.log(JSON.stringify(RULESET_CONFIG, null, 2));
    console.log('');
    console.log('🧪 This is the exact body a real run would POST.');
    return;
  }

  try {
    // 1. List the existing rulesets
    const existingRulesets = await listExistingRulesets();
    
    // 2. Delete an existing ruleset that already carries the payload's name
    const existingRuleset = existingRulesets.find(r => r.name === RULESET_CONFIG.name);
    if (existingRuleset) {
      console.log(`⚠️  Ruleset "${RULESET_CONFIG.name}" already exists (ID: ${existingRuleset.id})`);
      console.log('ℹ️  It will be deleted and recreated with the new configuration');
      await deleteRuleset(existingRuleset.id);
      console.log('');
    }

    // 3. Create the ruleset
    await createRuleset();
    console.log('');

    // 4. Verify the ruleset
    const verified = await verifyRuleset();
    
    if (verified) {
      console.log('');
      console.log('✅ Configuration completed successfully');
      console.log('');
      console.log('📋 Next steps:');
      console.log('  1. Verify the ruleset in GitHub Dashboard → Settings → Rules → Rulesets');
      console.log('  2. Try pushing directly to main (it should fail)');
      console.log('  3. Open a PR and verify the checks run');
      console.log('');
      console.log('📚 Full documentation: docs/GITHUB-RULESET-IMPORT-GUIDE.md');
    } else {
      console.error('❌ Verification failed');
      process.exit(1);
    }
  } catch (error) {
    console.error('');
    console.error('❌ Configuration failed:', error.message);
    console.error('');
    console.error('📞 Troubleshooting:');
    console.error('  1. Check that GITHUB_TOKEN has repo:admin permissions');
    console.error('  2. Check that the repo exists: https://github.com/bookmarkforge/bookmarkforge');
    console.error('  3. Check that you have Admin permissions on the repo');
    process.exit(1);
  }
}

main();
