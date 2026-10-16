#!/usr/bin/env node

/**
 * Sitemap Generator for BookmarkForge
 * 
 * Automatically generates sitemap.xml from the public/ directory structure.
 * Scans for HTML files and creates SEO-optimized sitemap entries with:
 * - All 30 language variants
 * - Proper lastmod dates
 * - Change frequency priorities
 * - Alternative language links
 * 
 * Usage: node scripts/generate-sitemap.mjs
 */

import { readFileSync, readdirSync, statSync, writeFileSync } from 'fs';
import { join, relative } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const PUBLIC_DIR = join(__dirname, '..', 'public');
const SITE_URL = 'https://bookmarkforgeapp.com';
const OUTPUT_FILE = join(PUBLIC_DIR, 'sitemap.xml');

// Language codes for hreflang
const LANGUAGES = [
  'ar', 'bg', 'cs', 'da', 'de', 'el', 'en', 'es', 'fi', 'fr',
  'he', 'hi', 'hr', 'hu', 'id', 'it', 'ja', 'ko', 'nl', 'no',
  'pl', 'pt', 'ro', 'ru', 'sv', 'th', 'tr', 'uk', 'vi', 'zh'
];

// Priority and change frequency mapping
const PAGE_CONFIG = {
  'landing.html': { priority: '1.0', changefreq: 'daily' },
  'index.html': { priority: '1.0', changefreq: 'daily' },
  'pocket-alternative.html': { priority: '0.9', changefreq: 'weekly' },
  'help.html': { priority: '0.8', changefreq: 'weekly' },
  'privacy-and-terms.html': { priority: '0.5', changefreq: 'monthly' },
  '404.html': { priority: '0.1', changefreq: 'never' },
  'offline.html': { priority: '0.1', changefreq: 'never' },
};

/**
 * Recursively scan directory for HTML files
 */
function* scanHtmlFiles(dir, baseDir = PUBLIC_DIR) {
  const files = readdirSync(dir);
  
  for (const file of files) {
    const fullPath = join(dir, file);
    const stat = statSync(fullPath);
    
    if (stat.isDirectory()) {
      yield* scanHtmlFiles(fullPath, baseDir);
    } else if (file.endsWith('.html')) {
      const relPath = relative(baseDir, fullPath);
      yield relPath;
    }
  }
}

/**
 * Get file modification time as ISO string
 */
function getLastModified(filePath) {
  const fullPath = join(PUBLIC_DIR, filePath);
  const stats = statSync(fullPath);
  return stats.mtime.toISOString();
}

/**
 * Convert file path to URL path
 */
function filePathToUrl(filePath) {
  // Remove .html extension
  let path = filePath.replace(/\.html$/, '');
  
  // If it's just "landing" or "index", it's the root
  if (path === 'landing' || path === 'index') {
    return '/';
  }
  
  // Add leading slash
  return '/' + path;
}

/**
 * Get page configuration
 */
function getPageConfig(filePath) {
  const basename = filePath.split('/').pop();
  return PAGE_CONFIG[basename] || { priority: '0.5', changefreq: 'monthly' };
}

/**
 * Extract language code from file path
 */
function getLanguageFromPath(filePath) {
  const parts = filePath.split('/');
  
  // Check if file is in a language directory (e.g., es/help-es.html)
  if (parts.length > 1 && LANGUAGES.includes(parts[0])) {
    return parts[0];
  }
  
  // Check if filename has language suffix (e.g., help-es.html)
  const match = parts[parts.length - 1].match(/-(ar|bg|cs|da|de|el|en|es|fi|fr|he|hi|hr|hu|id|it|ja|ko|nl|no|pl|pt|ro|ru|sv|th|tr|uk|vi|zh)\.html$/);
  if (match) {
    return match[1];
  }
  
  // Default to English
  return 'en';
}

/**
 * Get base page name (without language suffix)
 */
function getBasePageName(filePath) {
  const parts = filePath.split('/');
  const filename = parts[parts.length - 1];
  
  // Remove language suffix if present
  return filename.replace(/-(ar|bg|cs|da|de|el|en|es|fi|fr|he|hi|hr|hu|id|it|ja|ko|nl|no|pl|pt|ro|ru|sv|th|tr|uk|vi|zh)\.html$/, '.html');
}

/**
 * Group files by base page name for hreflang links
 */
function groupFilesByBasePage(files) {
  const groups = new Map();
  
  for (const file of files) {
    const baseName = getBasePageName(file);
    if (!groups.has(baseName)) {
      groups.set(baseName, []);
    }
    groups.get(baseName).push(file);
  }
  
  return groups;
}

/**
 * Generate hreflang links for a page
 */
function generateHreflangLinks(groupFiles) {
  const links = [];
  
  for (const file of groupFiles) {
    const lang = getLanguageFromPath(file);
    const url = SITE_URL + filePathToUrl(file);
    
    // Add language-specific link
    links.push(`    <xhtml:link rel="alternate" hreflang="${lang}" href="${url}" />`);
  }
  
  // Add x-default (English)
  const enFile = groupFiles.find(f => getLanguageFromPath(f) === 'en');
  if (enFile) {
    const enUrl = SITE_URL + filePathToUrl(enFile);
    links.push(`    <xhtml:link rel="alternate" hreflang="x-default" href="${enUrl}" />`);
  }
  
  return links.join('\n');
}

/**
 * Generate sitemap XML
 */
function generateSitemap() {
  const htmlFiles = Array.from(scanHtmlFiles(PUBLIC_DIR));
  const groups = groupFilesByBasePage(htmlFiles);
  
  let xml = `<?xml version="1.0" encoding="UTF-8"?>
<?xml-stylesheet type="text/xsl" href="/sitemap.xsl"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
`;
  
  for (const [baseName, groupFiles] of groups) {
    // Skip excluded pages
    if (baseName === '404.html' || baseName === 'offline.html') {
      continue;
    }
    
    // Use English version as primary entry
    const enFile = groupFiles.find(f => getLanguageFromPath(f) === 'en') || groupFiles[0];
    const url = filePathToUrl(enFile);
    const lastmod = getLastModified(enFile);
    const config = getPageConfig(enFile);
    const hreflangLinks = generateHreflangLinks(groupFiles);
    
    xml += `  <url>
    <loc>${SITE_URL}${url}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>${config.changefreq}</changefreq>
    <priority>${config.priority}</priority>
${hreflangLinks}
  </url>
`;
  }
  
  xml += `</urlset>`;
  
  return xml;
}

/**
 * Generate sitemap index (if sitemap is split into multiple files)
 */
function generateSitemapIndex() {
  // For now, we use a single sitemap, so no index needed
  // This can be extended if the sitemap grows beyond 50,000 URLs
  return null;
}

/**
 * Main execution
 */
function main() {
  try {
    console.error('🗺️  Generating sitemap.xml...');
    
    const sitemap = generateSitemap();
    writeFileSync(OUTPUT_FILE, sitemap, 'utf-8');
    
    console.error(`✅ Sitemap generated: ${OUTPUT_FILE}`);
    
    // Count URLs
    const urlCount = (sitemap.match(/<url>/g) || []).length;
    console.error(`📊 Total URLs: ${urlCount}`);
    
    console.error('\n🔍 Preview:');
    console.error(sitemap.substring(0, 500) + '...');
    
  } catch (error) {
    console.error('❌ Error generating sitemap:', error);
    process.exit(1);
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { generateSitemap, scanHtmlFiles };
