#!/usr/bin/env node

/**
 * Hacker News Social Listening Script
 *
 * Monitors Hacker News RSS feed for relevant keywords.
 * Similar to Reddit social listening but for HN.
 *
 * Usage: node scripts/social-listening-hn.mjs
 *
 * Environment Variables:
 * - WEBHOOK_URL: Discord/Telegram webhook for notifications
 */

import fetch from "node-fetch";
import { parseStringPromise } from "xml2js";
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const MARKETING_DIR = join(__dirname, '..', 'marketing');

// Hacker News RSS URL
const HN_RSS_URL = 'https://news.ycombinator.com/rss';

// Keywords to search for
const KEYWORDS = [
  'bookmark manager',
  'local-first',
  'privacy',
  'encryption',
  'self-hosted',
  'offline',
  'BookmarkForge',
  'data sovereignty',
  'end-to-end encryption',
];

// Webhook URL (optional)
const WEBHOOK_URL = process.env.WEBHOOK_URL || '';

/**
 * Fetch Hacker News RSS feed
 */
async function fetchHNFeed() {
  try {
    console.log(`Fetching ${HN_RSS_URL}...`);

    const response = await fetch(HN_RSS_URL, {
      headers: {
        'User-Agent': 'BookmarkForge-SocialListener/1.0 (+https://github.com/bookmarkforge/bookmarkforge-2026)',
      },
    });

    if (!response.ok) {
      console.error(`Failed to fetch HN RSS: ${response.status}`);
      return [];
    }

    const xml = await response.text();
    const result = await parseStringPromise(xml);

    const items = result.rss.channel.item.map((item) => ({
      title: item.title[0],
      link: item.link[0],
      pubDate: item.pubDate[0],
      author: item['dc:creator']?.[0] || 'unknown',
    }));

    console.log(`Found ${items.length} posts on Hacker News`);
    return items;
  } catch (error) {
    console.error('Error fetching HN RSS:', error);
    return [];
  }
}

/**
 * Send notification to Discord/Telegram webhook
 */
async function sendWebhook(item, matchedKeyword) {
  if (!WEBHOOK_URL) {
    console.log('Webhook URL not configured - skipping notification');
    return;
  }

  try {
    const payload = {
      content: `🔍 **Hacker News Social Listening Alert**\n\n` +
        `**Keyword:** "${matchedKeyword}"\n` +
        `**Title:** ${item.title}\n` +
        `**Author:** ${item.author}\n` +
        `**Link:** ${item.link}\n` +
        `**Posted:** ${new Date(item.pubDate).toLocaleString()}`,
    };

    const response = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      console.error(`Webhook failed: ${response.status}`);
    } else {
      console.log(`✅ Notification sent for: ${item.title}`);
    }
  } catch (error) {
    console.error('Error sending webhook:', error);
  }
}

/**
 * Save matches to history
 */
function saveMatches(matches) {
  if (!existsSync(MARKETING_DIR)) {
    mkdirSync(MARKETING_DIR, { recursive: true });
  }

  const historyFile = join(MARKETING_DIR, 'hn-history.json');
  let history = [];

  if (existsSync(historyFile)) {
    try {
      history = JSON.parse(require('fs').readFileSync(historyFile, 'utf-8'));
    } catch (error) {
      console.error('Error loading history:', error);
    }
  }

  const newEntries = matches.map(m => ({
    platform: 'hackernews',
    item: m.item,
    keyword: m.keyword,
    timestamp: new Date().toISOString(),
  }));

  history = [...history, ...newEntries];
  require('fs').writeFileSync(historyFile, JSON.stringify(history, null, 2), 'utf-8');
  console.log(`✅ Saved ${newEntries.length} matches to history`);
}

/**
 * Main execution
 */
async function main() {
  console.log('=== BookmarkForge Social Listening - Hacker News ===');
  console.log(`Monitoring for ${KEYWORDS.length} keywords\n`);

  const items = await fetchHNFeed();
  const allMatches = [];

  for (const item of items) {
    const combinedText = `${item.title} ${item.link}`;

    for (const keyword of KEYWORDS) {
      if (combinedText.toLowerCase().includes(keyword.toLowerCase())) {
        allMatches.push({ item, keyword });

        console.log(`\n🎯 MATCH FOUND on Hacker News:`);
        console.log(`   Keyword: "${keyword}"`);
        console.log(`   Title: ${item.title}`);
        console.log(`   Link: ${item.link}`);
        console.log(`   Author: ${item.author}`);

        // Send webhook notification
        await sendWebhook(item, keyword);
      }
    }
  }

  // Summary
  console.log('\n=== Summary ===');
  console.log(`Total matches found: ${allMatches.length}`);

  if (allMatches.length === 0) {
    console.log('No keyword matches found in this run.');
  } else {
    console.log('\nAll matches:');
    allMatches.forEach((match, index) => {
      console.log(`${index + 1}. ${match.item.title}`);
    });

    // Save to history
    saveMatches(allMatches);
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export { main, fetchHNFeed };
