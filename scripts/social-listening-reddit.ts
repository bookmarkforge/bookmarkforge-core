/**
 * Social Listening Script for Reddit
 *
 * This script monitors public Reddit RSS feeds for relevant keywords without
 * requiring Reddit API keys. It fetches RSS feeds directly and searches for
 * mentions of BookmarkForge or related bookmark manager alternatives.
 *
 * EXECUTION:
 *   npx tsx scripts/social-listening-reddit.ts
 *
 * CONFIGURATION:
 *   - Set WEBHOOK_URL environment variable to receive Discord/Telegram notifications
 *   - Or modify the KEYWORDS array to add/remove search terms
 *
 * DEPENDENCIES:
 *   - node-fetch: npm install node-fetch
 *   - xml2js: npm install xml2js
 *
 * Example with webhook:
 *   WEBHOOK_URL=https://discord.com/api/webhooks/... npx tsx scripts/social-listening-reddit.ts
 */

import fetch from "node-fetch";
import { parseStringPromise } from "xml2js";

// Configuration: Subreddits to monitor
const SUBREDDITS = [
  "selfhosted",
  "privacy",
  "DataHoarder",
  "privatelife",
  "linux",
  "webdev",
];

// Configuration: Keywords to search for
const KEYWORDS = [
  "Raindrop alternative",
  "bookmark manager privacy",
  "local-first bookmarks",
  "BookmarkForge",
  "self-hosted bookmarks",
  "encrypted bookmarks",
  "offline bookmark manager",
  "open source bookmarks",
];

// Configuration: Webhook URL (Discord/Telegram)
// Set this environment variable to receive notifications
const WEBHOOK_URL = process.env.WEBHOOK_URL || "";

interface RedditItem {
  title: string;
  link: string;
  pubDate: string;
  author: string;
}

interface RSSFeed {
  rss: {
    channel: {
      item: Array<{
        title: string[];
        link: string[];
        pubDate: string[];
        "dc:creator"?: string[];
      }>;
    };
  };
}

/**
 * Check if a text contains any of the configured keywords (case-insensitive)
 */
function containsKeyword(text: string): boolean {
  const lowerText = text.toLowerCase();
  return KEYWORDS.some((keyword) =>
    lowerText.includes(keyword.toLowerCase())
  );
}

/**
 * Parse RSS feed and extract Reddit posts
 */
async function fetchRedditFeed(subreddit: string): Promise<RedditItem[]> {
  try {
    const rssUrl = `https://www.reddit.com/r/${subreddit}/new/.rss`;
    console.log(`Fetching ${rssUrl}...`);

    const response = await fetch(rssUrl, {
      headers: {
        "User-Agent":
          "BookmarkForge-SocialListener/1.0 (+https://github.com/bookmarkforge/bookmarkforge-core)",
      },
    });

    if (!response.ok) {
      console.error(`Failed to fetch ${subreddit}: ${response.status}`);
      return [];
    }

    const xml = await response.text();
    const result = (await parseStringPromise(xml)) as RSSFeed;

    const items = result.rss.channel.item.map((item) => ({
      title: item.title[0],
      link: item.link[0],
      pubDate: item.pubDate[0],
      author: item["dc:creator"]?.[0] || "unknown",
    }));

    console.log(`Found ${items.length} posts in r/${subreddit}`);
    return items;
  } catch (error) {
    console.error(`Error fetching r/${subreddit}:`, error);
    return [];
  }
}

/**
 * Send notification to Discord/Telegram webhook
 */
async function sendWebhook(
  subreddit: string,
  item: RedditItem,
  matchedKeyword: string
): Promise<void> {
  if (!WEBHOOK_URL) {
    console.log("Webhook URL not configured - skipping notification");
    return;
  }

  try {
    const payload = {
      content: `🔍 **Social Listening Alert**\n\n` +
        `**Subreddit:** r/${subreddit}\n` +
        `**Keyword:** "${matchedKeyword}"\n` +
        `**Title:** ${item.title}\n` +
        `**Author:** u/${item.author}\n` +
        `**Link:** ${item.link}\n` +
        `**Posted:** ${new Date(item.pubDate).toLocaleString()}`,
    };

    const response = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      console.error(`Webhook failed: ${response.status}`);
    } else {
      console.log(`✅ Notification sent for: ${item.title}`);
    }
  } catch (error) {
    console.error("Error sending webhook:", error);
  }
}

/**
 * Main execution function
 */
async function main() {
  console.log("=== BookmarkForge Social Listening - Reddit ===");
  console.log(`Monitoring ${SUBREDDITS.length} subreddits for ${KEYWORDS.length} keywords\n`);

  const allMatches: Array<{
    subreddit: string;
    item: RedditItem;
    keyword: string;
  }> = [];

  // Fetch and analyze each subreddit
  for (const subreddit of SUBREDDITS) {
    const items = await fetchRedditFeed(subreddit);

    for (const item of items) {
      const combinedText = `${item.title} ${item.link}`;

      for (const keyword of KEYWORDS) {
        if (combinedText.toLowerCase().includes(keyword.toLowerCase())) {
          allMatches.push({
            subreddit,
            item,
            keyword,
          });

          console.log(`\n🎯 MATCH FOUND in r/${subreddit}:`);
          console.log(`   Keyword: "${keyword}"`);
          console.log(`   Title: ${item.title}`);
          console.log(`   Link: ${item.link}`);
          console.log(`   Author: u/${item.author}`);

          // Send webhook notification
          await sendWebhook(subreddit, item, keyword);
        }
      }
    }
  }

  // Summary
  console.log("\n=== Summary ===");
  console.log(`Total matches found: ${allMatches.length}`);

  if (allMatches.length === 0) {
    console.log("No keyword matches found in this run.");
  } else {
    console.log("\nAll matches:");
    allMatches.forEach((match, index) => {
      console.log(`${index + 1}. r/${match.subreddit}: ${match.item.title}`);
    });
  }
}

// Run the script
main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
