#!/usr/bin/env node

/**
 * Content Syndication Script for BookmarkForge
 *
 * This script automatically publishes blog posts to multiple platforms:
 * - dev.to (requires DEV_API_KEY)
 * - Hashnode (requires HASHNODE_API_KEY)
 * - Medium (optional, requires OAuth flow)
 *
 * Usage:
 *   DEV_API_KEY=your_key HASHNODE_API_KEY=your_key node scripts/content-syndication.mjs
 *
 * The script reads from docs/blog-posts/ directory and publishes to configured platforms.
 * All platforms support Markdown formatting.
 */

import { readFileSync, readdirSync, statSync, writeFileSync } from 'fs';
import { join, relative } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const BLOG_DIR = join(__dirname, '..', 'docs', 'blog-posts');
const HISTORY_FILE = join(__dirname, '..', 'marketing', 'syndication-history.json');

// Platform configurations
const PLATFORMS = {
  devto: {
    name: 'dev.to',
    apiUrl: 'https://dev.to/api/articles',
    apiKey: process.env.DEV_API_KEY,
    enabled: !!process.env.DEV_API_KEY,
  },
  hashnode: {
    name: 'Hashnode',
    apiUrl: 'https://api.hashnode.com',
    apiKey: process.env.HASHNODE_API_KEY,
    enabled: !!process.env.HASHNODE_API_KEY,
  },
};

/**
 * Read a blog post from a Markdown file
 */
function readBlogPost(filePath) {
  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');

  // Extract frontmatter (between --- markers)
  let frontmatter = {};
  let frontmatterEnd = 0;
  if (lines[0] === '---') {
    let i = 1;
    while (i < lines.length && lines[i] !== '---') {
      const [key, ...valueParts] = lines[i].split(':');
      if (key && valueParts.length > 0) {
        frontmatter[key.trim()] = valueParts.join(':').trim();
      }
      i++;
    }
    frontmatterEnd = i + 1;
  }

  // Extract content (after frontmatter)
  const markdown = lines.slice(frontmatterEnd).join('\n').trim();

  return {
    title: frontmatter.title || 'Untitled',
    description: frontmatter.description || '',
    tags: frontmatter.tags ? frontmatter.tags.split(',').map(t => t.trim()) : [],
    published: frontmatter.published === 'true',
    markdown,
    filePath,
  };
}

/**
 * Get all blog posts from the blog directory
 */
function* getBlogPosts() {
  try {
    const files = readdirSync(BLOG_DIR);
    for (const file of files) {
      if (file.endsWith('.md')) {
        const filePath = join(BLOG_DIR, file);
        yield readBlogPost(filePath);
      }
    }
  } catch (error) {
    console.log('No blog-posts directory found, skipping...');
  }
}

/**
 * Publish to dev.to
 */
async function publishToDevTo(post) {
  if (!PLATFORMS.devto.enabled) {
    console.log('⏭️  Skipping dev.to (API key not configured)');
    return null;
  }

  try {
    const response = await fetch(PLATFORMS.devto.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': PLATFORMS.devto.apiKey,
      },
      body: JSON.stringify({
        article: {
          title: post.title,
          description: post.description,
          body_markdown: post.markdown,
          published: post.published,
          tags: post.tags,
          main_image: post.main_image || 'https://bookmarkforgeapp.com/og-image.png',
        },
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`dev.to API error: ${response.status} - ${error}`);
    }

    const data = await response.json();
    console.log(`✅ Published to dev.to: ${data.url}`);
    return { platform: 'dev.to', url: data.url, id: data.id };
  } catch (error) {
    console.error(`❌ Failed to publish to dev.to:`, error.message);
    return null;
  }
}

/**
 * Publish to Hashnode
 */
async function publishToHashnode(post) {
  if (!PLATFORMS.hashnode.enabled) {
    console.log('⏭️  Skipping Hashnode (API key not configured)');
    return null;
  }

  try {
    const query = `
      mutation PublishPost($input: PublishPostInput!) {
        publishPost(input: $input) {
          post {
            slug
            url
          }
        }
      }
    `;

    const variables = {
      input: {
        title: post.title,
        contentMarkdown: post.markdown,
        coverImageURL: post.main_image || 'https://bookmarkforgeapp.com/og-image.png',
        tags: post.tags.map(tag => ({ _id: '', name: tag, slug: tag.toLowerCase() })),
        publicationId: process.env.HASHNODE_PUBLICATION_ID, // Required: Your Hashnode publication ID
      },
    };

    const response = await fetch(PLATFORMS.hashnode.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': PLATFORMS.hashnode.apiKey,
      },
      body: JSON.stringify({ query, variables }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Hashnode API error: ${response.status} - ${error}`);
    }

    const data = await response.json();
    console.log(`✅ Published to Hashnode: ${data.data.publishPost.post.url}`);
    return { platform: 'hashnode', url: data.data.publishPost.post.url, id: data.data.publishPost.post.slug };
  } catch (error) {
    console.error(`❌ Failed to publish to Hashnode:`, error.message);
    return null;
  }
}

/**
 * Load syndication history
 */
function loadHistory() {
  try {
    return JSON.parse(readFileSync(HISTORY_FILE, 'utf-8'));
  } catch (error) {
    return {};
  }
}

/**
 * Save syndication history
 */
function saveHistory(history) {
  writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
}

/**
 * Check if a post has already been syndicated to a platform
 */
function isAlreadySyndicated(post, platform, history) {
  const postKey = relative(BLOG_DIR, post.filePath);
  return history[postKey]?.[platform];
}

/**
 * Main execution
 */
async function main() {
  console.log('=== BookmarkForge Content Syndication ===\n');

  // Check if any platforms are enabled
  const enabledPlatforms = Object.values(PLATFORMS).filter(p => p.enabled);
  if (enabledPlatforms.length === 0) {
    console.log('⚠️  No platforms enabled. Set environment variables:');
    console.log('   DEV_API_KEY=your_key');
    console.log('   HASHNODE_API_KEY=your_key');
    console.log('   HASHNODE_PUBLICATION_ID=your_publication_id');
    process.exit(0);
  }

  console.log(`Enabled platforms: ${enabledPlatforms.map(p => p.name).join(', ')}\n`);

  // Load history
  const history = loadHistory();
  let syndicatedCount = 0;

  // Process each blog post
  for (const post of getBlogPosts()) {
    const postKey = relative(BLOG_DIR, post.filePath);
    console.log(`\n📝 Processing: ${post.title}`);
    console.log(`   File: ${postKey}`);

    if (!post.published) {
      console.log('   ⏭️  Skipping (published: false in frontmatter)');
      continue;
    }

    // Initialize history entry if needed
    if (!history[postKey]) {
      history[postKey] = {};
    }

    // Publish to each enabled platform
    for (const [platformKey, platform] of Object.entries(PLATFORMS)) {
      if (!platform.enabled) continue;

      if (isAlreadySyndicated(post, platformKey, history)) {
        console.log(`   ⏭️  Already on ${platform.name} (${history[postKey][platformKey]})`);
        continue;
      }

      let result;
      if (platformKey === 'devto') {
        result = await publishToDevTo(post);
      } else if (platformKey === 'hashnode') {
        result = await publishToHashnode(post);
      }

      if (result) {
        history[postKey][platformKey] = result.url;
        syndicatedCount++;
      }
    }
  }

  // Save updated history
  saveHistory(history);

  console.log('\n=== Summary ===');
  console.log(`Total posts syndicated: ${syndicatedCount}`);
  console.log(`History saved to: ${HISTORY_FILE}`);
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export { main, publishToDevTo, publishToHashnode };
