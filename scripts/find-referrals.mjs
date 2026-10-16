#!/usr/bin/env node

/**
 * Referral Identification Script
 *
 * Identifies potential referral partners for BookmarkForge:
 * - Privacy-focused influencers
 * - Self-hosting advocates
 * - Tech reviewers
 * - Open source maintainers
 *
 * Usage: node scripts/find-referrals.mjs
 *
 * This is a research tool - does not send automated outreach.
 */

import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const MARKETING_DIR = join(__dirname, '..', 'marketing');

const REFERRAL_CATEGORIES = {
  privacyInfluencers: {
    name: 'Privacy-Focused Influencers',
    description: 'Content creators focused on privacy, encryption, data sovereignty',
    platforms: ['YouTube', 'Twitter/X', 'Mastodon', 'Blog'],
    searchTerms: [
      'privacy advocate',
      'encryption tools',
      'data sovereignty',
      'self-hosted apps',
      'privacy-focused',
    ],
    examples: [
      'The Privacy, Security, & OSINT Show',
      'Technology Connections',
      'Privacy Guid',
      'Techlore',
    ],
  },
  selfHostingAdvocates: {
    name: 'Self-Hosting Advocates',
    description: 'Advocates of self-hosting and DIY tech',
    platforms: ['YouTube', 'Blogs', 'Reddit', 'Hacker News'],
    searchTerms: [
      'self-hosted',
      'homelab',
      'DIY server',
      'self-hosting guide',
      'home server',
    ],
    examples: [
      'LinuxServer',
      'SelfHosted',
      'r/selfhosted',
      'r/homelab',
    ],
  },
  openSourceMaintainers: {
    name: 'Open Source Maintainers',
    description: 'Maintainers of related open source projects',
    platforms: ['GitHub', 'Twitter/X', 'Discord'],
    searchTerms: [
      'open source bookmark',
      'open source note-taking',
      'open source knowledge base',
      'MIT licensed',
    ],
    examples: [
      'Joplin',
      'Obsidian',
      'Logseq',
      'TriliumNotes',
    ],
  },
  techReviewers: {
    name: 'Tech Reviewers',
    description: 'Tech reviewers who cover productivity tools',
    platforms: ['YouTube', 'Blogs', 'Twitter/X'],
    searchTerms: [
      'bookmark manager review',
      'productivity tools review',
      'privacy tools review',
      'alternatives to',
    ],
    examples: [
      'Thomas Frank',
      'Ali Abdaal',
      'Keep Productive',
      'Productivity Hunt',
    ],
  },
  developerAdvocates: {
    name: 'Developer Advocates',
    description: 'Developers who share privacy tools',
    platforms: ['Twitter/X', 'Mastodon', 'Hacker News', 'Dev.to'],
    searchTerms: [
      'developer tools',
      'privacy tools for developers',
      'local-first apps',
      'end-to-end encryption',
    ],
    examples: [
      'The Primeagen',
      'Fireship',
      'DevTools',
    ],
  },
  privacyCommunities: {
    name: 'Privacy Communities',
    description: 'Communities focused on privacy and security',
    platforms: ['Reddit', 'Discord', 'Matrix', 'Mastodon'],
    searchTerms: [
      'privacy community',
      'encryption community',
      'data privacy group',
      'privacy enthusiasts',
    ],
    examples: [
      'r/privacy',
      'r/privatelife',
      'r/DataHoarder',
      'PrivacyGuid',
    ],
  },
};

/**
 * Generate referral candidates list
 */
function generateReferralList() {
  const candidates = [];

  for (const [key, category] of Object.entries(REFERRAL_CATEGORIES)) {
    candidates.push({
      category: key,
      name: category.name,
      description: category.description,
      platforms: category.platforms,
      searchTerms: category.searchTerms,
      examples: category.examples,
      suggestedOutreach: 'Direct message or email with personalized pitch',
    });
  }

  return candidates;
}

/**
 * Generate outreach template
 */
function generateOutreachTemplate(category) {
  const templates = {
    privacyInfluencers: `Hi [Name],

I've been following your content on privacy and data sovereignty. I think your audience would be interested in BookmarkForge, a local-first, privacy-preserving bookmark manager I've been working on.

**What is BookmarkForge?**
- Local-first: Your data stays on your device
- End-to-end encryption: AES-256-GCM + Argon2id
- Open source: MIT-licensed core
- No account required: Works offline

I'd love to send you a free Pro license to try it out. Would you be interested in reviewing it or mentioning it in your content?

Best regards,
[Your Name]
[Your Contact]`,

    selfHostingAdvocates: `Hi [Name],

I've been following your work on self-hosting and homelab setups. I think BookmarkForge would be a great addition to your toolkit - it's a local-first bookmark manager that can run entirely on your own infrastructure.

**Why it fits your audience:**
- Self-hostable: Deploy on your own server
- No cloud dependency: Works without internet
- Open source: MIT-licensed
- P2P sync: Direct device-to-device synchronization

I can provide setup guides and technical documentation. Would you be interested in trying it out or featuring it in your content?

Best regards,
[Your Name]
[Your Contact]`,

    openSourceMaintainers: `Hi [Name],

I'm the maintainer of BookmarkForge, a local-first bookmark manager with end-to-end encryption. I've been following your work on [project name] and think there might be synergy between our projects.

**Potential collaboration:**
- Cross-promotion: Mention each other's projects
- Integration ideas: [specific idea]
- Shared users: Our communities overlap significantly

Would you be open to discussing a collaboration? I'm happy to provide details about our architecture and design decisions.

Best regards,
[Your Name]
[Your Contact]`,

    techReviewers: `Hi [Name],

I've been following your productivity tool reviews. I'd love to send you a free Pro license of BookmarkForge to review.

**Why it's worth reviewing:**
- Unique privacy-first approach
- Local-first architecture (trending topic)
- Open source with active development
- Solves a real problem: bookmark management with privacy

Unlike cloud-based bookmark managers, BookmarkForge keeps your data encrypted and local - no account required, works offline, and syncs P2P.

Would you be interested in trying it out? I can provide a demo, screenshots, and technical details.

Best regards,
[Your Name]
[Your Contact]`,

    developerAdvocates: `Hi [Name],

I've been following your content for developers. I think BookmarkForge would be valuable to your audience - it's a privacy-first bookmark manager built with local-first architecture and end-to-end encryption.

**Technical highlights:**
- React 19 + TypeScript + RxDB
- IndexedDB for local storage
- WebCrypto for encryption
- P2P sync via WebRTC
- 30+ languages support

I'm looking for developer advocates who appreciate privacy and local-first design. Would you be interested in trying it out or mentioning it to your audience?

Best regards,
[Your Name]
[Your Contact]`,

    privacyCommunities: `Hi Community,

I wanted to share BookmarkForge with this community. It's a local-first, privacy-preserving bookmark manager with end-to-end encryption.

**Why it fits this community:**
- Privacy-first design: Your data never leaves your device unencrypted
- Open source: MIT-licensed, fully auditable
- Self-hostable: Run on your own infrastructure
- No vendor lock-in: Your data is yours

I'm happy to answer questions, provide technical details, or help with setup. Would the community be interested in trying it out?

Best regards,
[Your Name]
[Your Contact]`,
  };

  return templates[category] || templates.privacyInfluencers;
}

/**
 * Generate outreach strategy
 */
function generateOutreachStrategy() {
  return {
    priority: [
      'privacyInfluencers',
      'selfHostingAdvocates',
      'techReviewers',
    ],
    approach: 'Personalized, not spammy',
    followUp: 'Wait 1-2 weeks before follow-up',
    offer: 'Free Pro license for reviewers',
    documentation: 'Provide docs, screenshots, demos',
  };
}

/**
 * Main execution
 */
function main() {
  try {
    console.log('=== Referral Identification System ===\n');

    const candidates = generateReferralList();
    const strategy = generateOutreachStrategy();

    console.log('Marketing directory:', MARKETING_DIR);
    console.log('Directory exists:', existsSync(MARKETING_DIR));
    console.log('Candidates count:', candidates.length);

    // Save candidates
    if (!existsSync(MARKETING_DIR)) {
      mkdirSync(MARKETING_DIR, { recursive: true });
      console.log('Created marketing directory');
    }

    const candidatesFile = join(MARKETING_DIR, 'referral-candidates.json');
    writeFileSync(candidatesFile, JSON.stringify(candidates, null, 2), 'utf-8');
    console.log(`✅ Saved referral candidates: ${candidatesFile}`);

    // Save strategy
    const strategyFile = join(MARKETING_DIR, 'referral-strategy.json');
    writeFileSync(strategyFile, JSON.stringify(strategy, null, 2), 'utf-8');
    console.log(`✅ Saved outreach strategy: ${strategyFile}`);

    console.log('\n=== Referral Categories ===\n');
    candidates.forEach((c, i) => {
      console.log(`${i + 1}. ${c.name}`);
      console.log(`   Description: ${c.description}`);
      console.log(`   Platforms: ${c.platforms.join(', ')}`);
      console.log(`   Examples: ${c.examples.join(', ')}`);
      console.log('');
    });

    console.log('=== Outreach Strategy ===\n');
    console.log('Priority categories:', strategy.priority.join(', '));
    console.log('Approach:', strategy.approach);
    console.log('Follow-up:', strategy.followUp);
    console.log('Offer:', strategy.offer);
    console.log('Documentation:', strategy.documentation);

    console.log('\n=== Next Steps ===\n');
    console.log('1. Research specific influencers/advocates in each category');
    console.log('2. Personalize outreach for each contact');
    console.log('3. Send outreach (email, DM, or community post)');
    console.log('4. Follow up after 1-2 weeks');
    console.log('5. Track responses and relationships');

    console.log('\n⚠️  IMPORTANT:');
    console.log('  - This script only generates lists, not automated outreach');
    console.log('  - Always personalize your outreach');
    console.log('  - Don\'t spam - quality over quantity');
    console.log('  - Build genuine relationships, not just transactions');

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

export { main, generateReferralList, generateOutreachTemplate };
