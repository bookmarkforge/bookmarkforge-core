#!/usr/bin/env node

/**
 * Article Schema Generator for Blog Posts
 *
 * Generates JSON-LD Article schema for each blog post.
 * Enhances SEO with rich snippets for blog content.
 *
 * Usage: node scripts/generate-article-schema.mjs
 *
 * Output: docs/blog-posts/*.schema.json (one per blog post)
 */

import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const BLOG_DIR = join(__dirname, '..', 'docs', 'blog-posts');

const ORGANIZATION = {
  '@type': 'Organization',
  name: 'BookmarkForge',
  url: 'https://bookmarkforgeapp.com',
  logo: 'https://bookmarkforgeapp.com/logo.png',
};

/**
 * Read blog post frontmatter
 */
function readBlogPost(filePath) {
  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');

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

  const markdown = lines.slice(frontmatterEnd).join('\n').trim();

  return {
    title: frontmatter.title || 'Untitled',
    description: frontmatter.description || '',
    tags: frontmatter.tags ? frontmatter.tags.split(',').map(t => t.trim()) : [],
    published: frontmatter.published === 'true',
    main_image: frontmatter.main_image || 'https://bookmarkforgeapp.com/og-image.png',
    markdown,
    filePath,
  };
}

/**
 * Generate Article schema
 */
function generateArticleSchema(post, url) {
  const now = new Date();
  const publishedDate = post.datePublished || now.toISOString();
  const modifiedDate = post.dateModified || now.toISOString();

  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: post.title,
    description: post.description,
    image: post.main_image,
    author: {
      '@type': 'Organization',
      name: 'BookmarkForge Team',
      url: 'https://bookmarkforgeapp.com',
    },
    publisher: ORGANIZATION,
    datePublished: publishedDate,
    dateModified: modifiedDate,
    mainEntityOfPage: {
      '@type': 'WebPage',
      '@id': url,
    },
    keywords: post.tags.join(', '),
    articleSection: 'Technology',
    inLanguage: 'en-US',
    about: {
      '@type': 'Thing',
      name: 'Bookmark Management',
      description: 'Local-first, privacy-preserving bookmark manager',
    },
  };
}

/**
 * Get all blog posts
 */
function* getBlogPosts() {
  try {
    const files = readdirSync(BLOG_DIR);
    for (const file of files) {
      if (file.endsWith('.md') && !file.endsWith('.schema.json')) {
        const filePath = join(BLOG_DIR, file);
        yield readBlogPost(filePath);
      }
    }
  } catch (error) {
    console.log('No blog-posts directory found, skipping...');
  }
}

/**
 * Main execution
 */
function main() {
  try {
    console.log('=== Article Schema Generator ===\n');

    let generatedCount = 0;

    for (const post of getBlogPosts()) {
      const fileName = post.filePath.split('/').pop();
      const schemaFileName = fileName.replace('.md', '.schema.json');
      const schemaFilePath = join(BLOG_DIR, schemaFileName);

      // Generate URL for the post
      const postUrl = `https://bookmarkforgeapp.com/blog/${fileName.replace('.md', '')}`;

      // Generate schema
      const schema = generateArticleSchema(post, postUrl);

      // Save schema
      writeFileSync(schemaFilePath, JSON.stringify(schema, null, 2), 'utf-8');

      console.log(`✅ Generated schema for: ${post.title}`);
      console.log(`   File: ${schemaFileName}`);
      console.log(`   URL: ${postUrl}\n`);

      generatedCount++;
    }

    console.log('=== Summary ===');
    console.log(`Total schemas generated: ${generatedCount}`);

    if (generatedCount > 0) {
      console.log('\n💡 Usage:');
      console.log('  1. Include the schema in your blog post HTML');
      console.log('  2. Or reference it via script tag:');
      console.log('     <script type="application/ld+json" src="/blog/post.schema.json"></script>');
    }

  } catch (error) {
    console.error('❌ Error generating article schemas:', error);
    process.exit(1);
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { main, generateArticleSchema };
