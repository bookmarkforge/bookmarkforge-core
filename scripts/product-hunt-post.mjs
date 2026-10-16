#!/usr/bin/env node

/**
 * Product Hunt Posting Automation
 *
 * Automates posting updates to Product Hunt.
 * Note: Initial launch should be manual for authenticity.
 * Use this for updates, new features, milestones.
 *
 * Usage: node scripts/product-hunt-post.mjs
 *
 * Privacy: Only posts content you explicitly provide.
 * Does not collect user data.
 */

import { writeFileSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const MARKETING_DIR = join(__dirname, '..', 'marketing');

/**
 * Product Hunt post template
 */
function generateProductHuntPost(postData) {
  const {
    title,
    description,
    features,
    tags,
    media = [],
    callToAction,
  } = postData;

  return {
    platform: 'Product Hunt',
    title,
    description,
    features,
    tags,
    media,
    callToAction,
    postedAt: new Date().toISOString(),
  };
}

/**
 * Generate milestone post
 */
function generateMilestonePost(milestone) {
  const templates = {
    '10k-users': {
      title: 'BookmarkForge hits 10,000 users! 🎉',
      description: 'Thank you to our amazing community for supporting privacy-first bookmark management.',
      features: [
        'End-to-end encryption for all bookmarks',
        'Local-first architecture',
        '30+ languages supported',
        'P2P sync without cloud',
      ],
      tags: ['milestone', 'privacy', 'open-source', 'bookmark-manager'],
      callToAction: 'Try it free at https://bookmarkforgeapp.com',
    },
    'new-feature': {
      title: 'New Feature: [Feature Name]',
      description: 'We just launched [feature name] to make your bookmark management even better.',
      features: [
        '[Feature description]',
        '[Benefit 1]',
        '[Benefit 2]',
      ],
      tags: ['new-feature', 'privacy', 'bookmark-manager'],
      callToAction: 'Update to the latest version at https://bookmarkforgeapp.com',
    },
    'open-source': {
      title: 'BookmarkForge is now open source! 🚀',
      description: 'The core of BookmarkForge is now MIT-licensed. Fork, contribute, and audit.',
      features: [
        'MIT-licensed core',
        'Fully auditable code',
        'Community contributions welcome',
        'GitHub: bookmarkforge-2026',
      ],
      tags: ['open-source', 'MIT', 'privacy', 'bookmark-manager'],
      callToAction: 'Star us on GitHub: https://github.com/bookmarkforge/bookmarkforge-2026',
    },
    'privacy-milestone': {
      title: 'Privacy Milestone: 1M bookmarks encrypted',
      description: 'Over 1 million bookmarks are now end-to-end encrypted with BookmarkForge.',
      features: [
        'AES-256-GCM encryption',
        'Argon2id key derivation',
        'Zero-knowledge architecture',
        'Data stays on your device',
      ],
      tags: ['privacy', 'encryption', 'milestone', 'bookmark-manager'],
      callToAction: 'Secure your bookmarks at https://bookmarkforgeapp.com',
    },
  };

  return templates[milestone] || templates['new-feature'];
}

/**
 * Save post to file
 */
function savePost(post, filename) {
  if (!existsSync(MARKETING_DIR)) {
    mkdirSync(MARKETING_DIR, { recursive: true });
  }

  const postFile = join(MARKETING_DIR, filename);
  writeFileSync(postFile, JSON.stringify(post, null, 2), 'utf-8');
  return postFile;
}

/**
 * Main execution
 */
function main() {
  try {
    console.log('=== Product Hunt Post Generator ===\n');

    // Generate example posts
    const milestonePost = generateMilestonePost('10k-users');
    console.log('Generated milestone post:', milestonePost.title);

    const featurePost = generateMilestonePost('new-feature');
    console.log('Generated feature post:', featurePost.title);

    // Save posts
    const milestoneFile = savePost(milestonePost, 'product-hunt-milestone.json');
    console.log(`✅ Saved milestone post: ${milestoneFile}`);

    const featureFile = savePost(featurePost, 'product-hunt-feature.json');
    console.log(`✅ Saved feature post: ${featureFile}`);

    console.log('\n=== Post Templates ===\n');
    console.log('Available milestones:');
    console.log('  - 10k-users: 10,000 users milestone');
    console.log('  - new-feature: New feature announcement');
    console.log('  - open-source: Open source announcement');
    console.log('  - privacy-milestone: Privacy statistics');

    console.log('\n=== How to Use ===\n');
    console.log('1. Edit the generated JSON files in marketing/');
    console.log('2. Customize title, description, features');
    console.log('3. Add your media (screenshots, videos)');
    console.log('4. Post manually to Product Hunt for authenticity');
    console.log('5. Track engagement in Product Hunt dashboard');

    console.log('\n⚠️  IMPORTANT:');
    console.log('  - Initial launch should be manual for authenticity');
    console.log('  - Use this for updates, not initial launch');
    console.log('  - Customize posts before posting');
    console.log('  - Engage with comments after posting');

    console.log('\n💡 Tips:');
    console.log('  - Post on Tuesday/Wednesday for maximum visibility');
    console.log('  - Include high-quality screenshots');
    console.log('  - Respond to comments quickly');
    console.log('  - Tag relevant makers/products');

  } catch (error) {
    console.error('❌ Error:', error);
    console.error('Error stack:', error.stack);
    process.exit(1);
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { main, generateProductHuntPost, generateMilestonePost, main as default };
