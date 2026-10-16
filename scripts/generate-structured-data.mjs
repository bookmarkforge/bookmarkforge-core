#!/usr/bin/env node

/**
 * Structured Data (JSON-LD) Generator for BookmarkForge
 *
 * This script generates SEO-optimized JSON-LD structured data for:
 * - Organization schema
 * - WebSite schema
 * - SoftwareApplication schema
 * - Article schema (for blog posts)
 *
 * Usage: node scripts/generate-structured-data.mjs
 *
 * Output: public/structured-data.json (injected into landing pages)
 */

import { writeFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const OUTPUT_FILE = join(__dirname, '..', 'public', 'structured-data.json');

// Organization data
const ORGANIZATION = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: 'BookmarkForge',
  url: 'https://bookmarkforgeapp.com',
  logo: 'https://bookmarkforgeapp.com/logo.png',
  description: 'Local-first, privacy-preserving AI knowledge vault with end-to-end encryption',
  sameAs: [
    'https://github.com/bookmarkforge/bookmarkforge-2026',
    'https://twitter.com/bookmarkforge',
  ],
  contactPoint: {
    '@type': 'ContactPoint',
    contactType: 'customer support',
    email: 'support@bookmarkforgeapp.com',
    availableLanguage: ['en', 'es', 'de', 'fr', 'ja', 'zh'],
  },
};

// WebSite data
const WEBSITE = {
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  name: 'BookmarkForge',
  url: 'https://bookmarkforgeapp.com',
  description: 'Local-first bookmark manager with AI-powered knowledge management',
  potentialAction: {
    '@type': 'SearchAction',
    target: 'https://bookmarkforgeapp.com/search?q={search_term_string}',
    'query-input': 'required name=search_term_string',
  },
  publisher: {
    '@type': 'Organization',
    name: 'BookmarkForge',
  },
};

// SoftwareApplication data
const SOFTWARE_APPLICATION = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'BookmarkForge',
  applicationCategory: 'ProductivityApplication',
  operatingSystem: 'Web, iOS, Android, Windows, macOS, Linux',
  offers: {
    '@type': 'Offer',
    price: '0',
    priceCurrency: 'USD',
    description: 'Free core version with optional Pro features',
  },
  aggregateRating: {
    '@type': 'AggregateRating',
    ratingValue: '4.8',
    ratingCount: '150',
    bestRating: '5',
    worstRating: '1',
  },
  featureList: [
    'End-to-end encryption',
    'Local-first storage',
    'Offline mode',
    'P2P sync',
    'AI-powered search',
    'Multi-language support (30 languages)',
    'Cross-platform (PWA)',
  ],
  description: 'BookmarkForge is a local-first, privacy-preserving bookmark manager and AI-powered knowledge vault. Your data stays on your device, encrypted with AES-256-GCM and protected by Argon2id.',
  downloadUrl: 'https://bookmarkforgeapp.com',
  license: 'https://github.com/bookmarkforge/bookmarkforge-2026/blob/main/LICENSE',
  publisher: {
    '@type': 'Organization',
    name: 'BookmarkForge',
  },
};

// FAQ schema (from FAQ page)
const FAQ_PAGE = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: [
    {
      '@type': 'Question',
      name: 'Is BookmarkForge free?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Yes, the core version of BookmarkForge is free and open source (MIT-licensed). Pro features require a paid license.',
      },
    },
    {
      '@type': 'Question',
      name: 'Is my data encrypted?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Yes, all your bookmarks and documents are encrypted with AES-256-GCM before storage. Your data never leaves your device unencrypted.',
      },
    },
    {
      '@type': 'Question',
      name: 'Does BookmarkForge work offline?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Yes, BookmarkForge is a Progressive Web App that works offline. Your data is stored locally in your browser.',
      },
    },
    {
      '@type': 'Question',
      name: 'Can I sync between devices?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Yes, BookmarkForge supports P2P sync via WebRTC for direct device-to-device synchronization. Cloud sync is available as a Pro feature.',
      },
    },
    {
      '@type': 'Question',
      name: 'What AI providers are supported?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'BookmarkForge supports OpenAI, Anthropic, Gemini, Groq, Hugging Face, OpenRouter, and local models via Ollama and WebLLM.',
      },
    },
  ],
};

// BreadcrumbList schema
const BREADCRUMB_LIST = {
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: [
    {
      '@type': 'ListItem',
      position: 1,
      name: 'Home',
      item: 'https://bookmarkforgeapp.com/',
    },
    {
      '@type': 'ListItem',
      position: 2,
      name: 'Help',
      item: 'https://bookmarkforgeapp.com/help',
    },
    {
      '@type': 'ListItem',
      position: 3,
      name: 'Privacy',
      item: 'https://bookmarkforgeapp.com/privacy',
    },
  ],
};

/**
 * Generate structured data for a blog post
 */
function generateArticleSchema(post) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: post.title,
    description: post.description,
    image: post.main_image || 'https://bookmarkforgeapp.com/og-image.png',
    author: {
      '@type': 'Organization',
      name: 'BookmarkForge Team',
    },
    publisher: {
      '@type': 'Organization',
      name: 'BookmarkForge',
      logo: {
        '@type': 'ImageObject',
        url: 'https://bookmarkforgeapp.com/logo.png',
      },
    },
    datePublished: post.datePublished || new Date().toISOString(),
    dateModified: post.dateModified || new Date().toISOString(),
    mainEntityOfPage: {
      '@type': 'WebPage',
      '@id': post.url,
    },
    keywords: post.tags ? post.tags.join(', ') : '',
  };
}

/**
 * Generate all structured data
 */
function generateStructuredData() {
  return {
    organization: ORGANIZATION,
    website: WEBSITE,
    softwareApplication: SOFTWARE_APPLICATION,
    faqPage: FAQ_PAGE,
    breadcrumbList: BREADCRUMB_LIST,
  };
}

/**
 * Main execution
 */
function main() {
  try {
    console.log('🔍 Generating structured data (JSON-LD)...');
    console.log('Output file:', OUTPUT_FILE);

    const structuredData = generateStructuredData();
    const jsonString = JSON.stringify(structuredData, null, 2);
    console.log('Structured data generated, size:', jsonString.length);

    writeFileSync(OUTPUT_FILE, jsonString, 'utf-8');

    console.log('✅ Structured data generated:', OUTPUT_FILE);
    console.log('\n📊 Generated schemas:');
    console.log('  - Organization');
    console.log('  - WebSite');
    console.log('  - SoftwareApplication');
    console.log('  - FAQPage');
    console.log('  - BreadcrumbList');

    console.log('\n💡 To inject into landing pages, add this script tag:');
    console.log('  <script type="application/ld+json" src="/structured-data.json"></script>');

  } catch (error) {
    console.error('❌ Error generating structured data:', error);
    console.error('Error stack:', error.stack);
    process.exit(1);
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { generateStructuredData, generateArticleSchema, ORGANIZATION, WEBSITE, SOFTWARE_APPLICATION, main };
