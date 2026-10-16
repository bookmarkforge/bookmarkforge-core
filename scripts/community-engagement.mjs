#!/usr/bin/env node

/**
 * Community Engagement Suggestion Script
 *
 * This script analyzes social listening data and suggests responses
 * for community engagement. It DOES NOT post automatically - it
 * generates suggestions that a human can review and approve.
 *
 * Usage: node scripts/community-engagement.mjs
 *
 * The script reads from marketing/social-listening-history.json
 * and generates response suggestions in marketing/response-suggestions.json
 */

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const HISTORY_FILE = join(__dirname, '..', 'marketing', 'social-listening-history.json');
const SUGGESTIONS_FILE = join(__dirname, '..', 'marketing', 'response-suggestions.json');

// Response templates based on keywords and sentiment
const RESPONSE_TEMPLATES = {
  'raindrop alternative': {
    positive: [
      "Thanks for the recommendation! If you're exploring Raindrop alternatives, you might be interested in BookmarkForge - it's local-first, privacy-focused, and encrypted. Your data stays on your device. More at https://bookmarkforgeapp.com",
    ],
    neutral: [
      "Have you tried BookmarkForge? It's a local-first bookmark manager with end-to-end encryption. Your bookmarks stay on your device, not in the cloud. Check it out: https://bookmarkforgeapp.com",
    ],
    negative: [
      "Sorry to hear you're having issues with Raindrop. BookmarkForge is a local-first alternative - your data is encrypted and stored locally, so you're in control. Might be worth a look: https://bookmarkforgeapp.com",
    ],
  },
  'bookmark manager privacy': {
    positive: [
      "Great to see privacy-conscious users! BookmarkForge is built with privacy in mind - AES-256-GCM encryption, local storage, and no account registration. Your bookmarks are yours alone. https://bookmarkforgeapp.com",
    ],
    neutral: [
      "If privacy is a priority for your bookmark manager, consider BookmarkForge. It uses end-to-end encryption and stores everything locally. No cloud sync unless you want it. https://bookmarkforgeapp.com",
    ],
    negative: [
      "I understand your privacy concerns. BookmarkForge addresses this by storing your bookmarks locally with AES-256-GCM encryption. No server ever sees your unencrypted data. https://bookmarkforgeapp.com",
    ],
  },
  'local-first bookmarks': {
    positive: [
      "Local-first is the way to go! BookmarkForge is built exactly for this - your bookmarks live in your browser, encrypted, and sync P2P if you want. Zero cloud dependency. https://bookmarkforgeapp.com",
    ],
    neutral: [
      "Looking for local-first bookmark management? BookmarkForge stores everything locally in IndexedDB, encrypted with AES-256-GCM. Works offline too. https://bookmarkforgeapp.com",
    ],
    negative: [
      "If you're tired of cloud-only bookmark managers, BookmarkForge might help. It's local-first, encrypted, and works offline. Your data never leaves your device. https://bookmarkforgeapp.com",
    ],
  },
  'encrypted bookmarks': {
    positive: [
      "Encryption is essential! BookmarkForge uses AES-256-GCM with Argon2id key derivation. Your bookmarks are encrypted before storage, and keys are zeroized after use. https://bookmarkforgeapp.com",
    ],
    neutral: [
      "For encrypted bookmark storage, check out BookmarkForge. It uses AES-256-GCM encryption with per-vault salts. Your data is secure even if someone gets your vault file. https://bookmarkforgeapp.com",
    ],
    negative: [
      "Security is non-negotiable. BookmarkForge encrypts everything with AES-256-GCM before storage. The server never sees your encryption keys. Open source for audit. https://bookmarkforgeapp.com",
    ],
  },
  'offline bookmark manager': {
    positive: [
      "Offline capability is a must! BookmarkForge is a PWA that works completely offline. Your bookmarks are stored locally in IndexedDB. https://bookmarkforgeapp.com",
    ],
    neutral: [
      "Need an offline bookmark manager? BookmarkForge is a Progressive Web App that works without internet. Your data is stored locally and encrypted. https://bookmarkforgeapp.com",
    ],
    negative: [
      "If offline access is important, BookmarkForge is designed for it. It's a PWA that stores bookmarks locally in IndexedDB with encryption. Works without internet. https://bookmarkforgeapp.com",
    ],
  },
  'self-hosted bookmarks': {
    positive: [
      "Self-hosting is great for control! BookmarkForge is MIT-licensed and can be self-hosted. The core is open source - you can audit and modify it. https://github.com/bookmarkforge/bookmarkforge-2026",
    ],
    neutral: [
      "For self-hosted bookmark management, BookmarkForge is open source (MIT). You can deploy it yourself and have full control. https://github.com/bookmarkforge/bookmarkforge-2026",
    ],
    negative: [
      "If you want to self-host, BookmarkForge is fully open source. The core is MIT-licensed and can be deployed on your own infrastructure. https://github.com/bookmarkforge/bookmarkforge-2026",
    ],
  },
  'open source bookmarks': {
    positive: [
      "Open source is the way! BookmarkForge's core is MIT-licensed. You can audit the code, self-host, and modify it. https://github.com/bookmarkforge/bookmarkforge-2026",
    ],
    neutral: [
      "Looking for open source bookmark managers? BookmarkForge is MIT-licensed. The core is fully open source and auditable. https://github.com/bookmarkforge/bookmarkforge-2026",
    ],
    negative: [
      "If transparency matters, BookmarkForge is open source (MIT). You can review the encryption implementation and self-host. https://github.com/bookmarkforge/bookmarkforge-2026",
    ],
  },
};

/**
 * Simple sentiment analysis (keyword-based)
 */
function analyzeSentiment(text) {
  const positiveWords = ['love', 'great', 'awesome', 'excellent', 'best', 'amazing', 'perfect', 'recommend', 'happy'];
  const negativeWords = ['hate', 'terrible', 'broken', 'slow', 'bug', 'crash', 'awful', 'worst', 'bad', 'issue', 'problem'];

  const lowerText = text.toLowerCase();
  const positiveCount = positiveWords.filter(w => lowerText.includes(w)).length;
  const negativeCount = negativeWords.filter(w => lowerText.includes(w)).length;

  if (positiveCount > negativeCount) return 'positive';
  if (negativeCount > positiveCount) return 'negative';
  return 'neutral';
}

/**
 * Detect urgency
 */
function detectUrgency(text) {
  const urgentKeywords = ['urgent', 'help', 'broken', 'not working', 'crash', 'emergency', 'asap'];
  return urgentKeywords.some(kw => text.toLowerCase().includes(kw));
}

/**
 * Generate response suggestion
 */
function generateResponseSuggestion(mention) {
  const sentiment = mention.sentiment || analyzeSentiment(mention.title);
  const urgency = detectUrgency(mention.title);
  const template = RESPONSE_TEMPLATES[mention.keyword];

  if (!template) {
    return null;
  }

  const responses = template[sentiment] || template.neutral;
  const suggestedResponse = responses[Math.floor(Math.random() * responses.length)];

  return {
    platform: mention.platform,
    subreddit: mention.subreddit,
    postUrl: mention.url,
    postTitle: mention.title,
    keyword: mention.keyword,
    sentiment,
    urgency,
    suggestedResponse,
    timestamp: mention.timestamp,
  };
}

/**
 * Load social listening history
 */
function loadHistory() {
  try {
    return JSON.parse(readFileSync(HISTORY_FILE, 'utf-8'));
  } catch (error) {
    console.log('No social listening history found. Run social listening first.');
    return [];
  }
}

/**
 * Filter recent mentions (last 7 days)
 */
function filterRecentMentions(mentions) {
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  return mentions.filter(m => {
    const mentionDate = new Date(m.timestamp);
    return mentionDate >= sevenDaysAgo;
  });
}

/**
 * Flatten mentions from history format
 */
function flattenMentions(history) {
  const mentions = [];

  for (const [postKey, platforms] of Object.entries(history)) {
    for (const [platform, data] of Object.entries(platforms)) {
      mentions.push({
        platform,
        url: data.url || postKey,
        title: data.title || postKey,
        keyword: data.keyword || '',
        timestamp: data.timestamp || new Date().toISOString(),
        subreddit: data.subreddit,
      });
    }
  }

  return mentions;
}

/**
 * Main execution
 */
function main() {
  try {
    console.log('=== Community Engagement Suggestion Generator ===\n');

    // Load history
    const history = loadHistory();
    if (!Array.isArray(history) && typeof history === 'object') {
      // Convert object format to array
      const mentions = flattenMentions(history);
      console.log(`Found ${mentions.length} mentions in history`);
    } else {
      console.log(`Found ${history.length} mentions in history`);
    }

    const mentions = Array.isArray(history) ? history : flattenMentions(history);

    // Filter recent mentions
    const recentMentions = filterRecentMentions(mentions);
    console.log(`Recent mentions (last 7 days): ${recentMentions.length}\n`);

    // Generate suggestions
    const suggestions = [];
    for (const mention of recentMentions) {
      const suggestion = generateResponseSuggestion(mention);
      if (suggestion) {
        suggestions.push(suggestion);
      }
    }

    // Save suggestions
    writeFileSync(SUGGESTIONS_FILE, JSON.stringify(suggestions, null, 2), 'utf-8');

    console.log(`✅ Generated ${suggestions.length} response suggestions`);
    console.log(`📝 Saved to: ${SUGGESTIONS_FILE}\n`);

    // Display suggestions
    if (suggestions.length > 0) {
      console.log('=== Suggested Responses ===\n');
      suggestions.forEach((s, i) => {
        console.log(`${i + 1}. [${s.platform}] ${s.subreddit || 'N/A'}`);
        console.log(`   Post: ${s.postTitle}`);
        console.log(`   URL: ${s.postUrl}`);
        console.log(`   Sentiment: ${s.sentiment}${s.urgency ? ' (URGENT)' : ''}`);
        console.log(`   Suggested: ${s.suggestedResponse}`);
        console.log();
      });
    } else {
      console.log('No response suggestions generated for recent mentions.');
    }

    console.log('\n⚠️  IMPORTANT:');
    console.log('  - These are suggestions only - DO NOT post automatically');
    console.log('  - Review each suggestion before responding');
    console.log('  - Ensure the response is relevant and helpful');
    console.log('  - Follow each platform\'s community guidelines');

  } catch (error) {
    console.error('❌ Error generating suggestions:', error);
    process.exit(1);
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { generateResponseSuggestion, analyzeSentiment, detectUrgency };
