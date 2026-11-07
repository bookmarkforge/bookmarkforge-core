#!/usr/bin/env node

/**
 * Broken Link Checker
 * 
 * Scans HTML files in public/ for broken internal links.
 * Checks if linked files (anchors, images, scripts, styles) exist.
 * Validates external links for proper protocol (https only).
 * 
 * Usage: node scripts/check-broken-links.mjs
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const PUBLIC_DIR = join(__dirname, '..', 'public');

const errors = [];
const warnings = [];
const checkedLinks = new Set();

/**
 * Get all HTML files recursively
 */
function* getHtmlFiles(dir, baseDir = PUBLIC_DIR) {
  const files = readdirSync(dir, { withFileTypes: true });
  
  for (const [name, type] of Object.entries(files)) {
    const fullPath = join(dir, name);
    
    if (type.isDirectory()) {
      yield* getHtmlFiles(fullPath, baseDir);
    } else if (type.isFile() && name.endsWith('.html')) {
      yield relative(baseDir, fullPath);
    }
  }
}

/**
 * Extract links from HTML content
 */
function extractLinks(content, filePath) {
  const links = [];
  
  // Extract href links (anchors)
  const hrefRegex = /href=["']([^"']+)["']/g;
  let match;
  while ((match = hrefRegex.exec(content)) !== null) {
    links.push({ type: 'href', url: match[1], source: filePath });
  }
  
  // Extract src links (images, scripts, styles)
  const srcRegex = /src=["']([^"']+)["']/g;
  while ((match = srcRegex.exec(content)) !== null) {
    links.push({ type: 'src', url: match[1], source: filePath });
  }
  
  // Extract content (manifest, etc)
  const contentRegex = /content=["']([^"']+)["']/g;
  while ((match = contentRegex.exec(content)) !== null) {
    links.push({ type: 'content', url: match[1], source: filePath });
  }
  
  return links;
}

/**
 * Check if a link is internal (relative to site)
 */
function isInternalLink(url) {
  // Ignore protocol-relative links
  if (url.startsWith('//')) return false;
  
  // Ignore absolute URLs
  if (url.startsWith('http://') || url.startsWith('https://')) return false;
  
  // Ignore mailto, tel, javascript, etc.
  if (url.startsWith('mailto:') || url.startsWith('tel:') || url.startsWith('javascript:')) return false;
  
  // Ignore anchor-only links
  if (url.startsWith('#')) return false;
  
  return true;
}

/**
 * Check if an internal file exists
 */
function checkInternalFile(url, sourceFile) {
  const sourceDir = dirname(join(PUBLIC_DIR, sourceFile));
  const targetPath = join(sourceDir, url);
  
  try {
    statSync(targetPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate external link protocol
 */
function validateExternalLink(url, sourceFile) {
  // Check for insecure protocols
  if (url.startsWith('http://')) {
    warnings.push(`${sourceFile}: Insecure HTTP link: ${url}`);
  }
  
  // Check for non-HTTPS external links (data:, blob:, etc.)
  if (url.startsWith('data:') || url.startsWith('blob:')) {
    warnings.push(`${sourceFile}: Data/blob URL: ${url.substring(0, 50)}...`);
  }
}

/**
 * Check all links
 */
function checkAllLinks() {
  console.log('🔍 Checking for broken links...\n');
  
  for (const htmlFile of getHtmlFiles(PUBLIC_DIR)) {
    const filePath = join(PUBLIC_DIR, htmlFile);
    const content = readFileSync(filePath, 'utf-8');
    const links = extractLinks(content, htmlFile);
    
    for (const link of links) {
      const linkKey = `${htmlFile}:${link.url}`;
      
      // Skip already checked links
      if (checkedLinks.has(linkKey)) continue;
      checkedLinks.add(linkKey);
      
      if (isInternalLink(link.url)) {
        if (!checkInternalFile(link.url, htmlFile)) {
          errors.push(`${htmlFile}: Broken internal link: ${link.url}`);
        }
      } else {
        validateExternalLink(link.url, htmlFile);
      }
    }
  }
  
  console.log(`📊 Checked ${checkedLinks.size} unique links\n`);
}

/**
 * Main validation
 */
function main() {
  console.log('=== Broken Link Checker ===\n');
  
  checkAllLinks();
  
  console.log('=' + '='.repeat(49));
  
  if (errors.length === 0 && warnings.length === 0) {
    console.log('✅ No broken links found!');
    return true;
  }
  
  if (errors.length > 0) {
    console.log(`\n❌ ${errors.length} broken link(s) found:`);
    errors.forEach(err => console.log(`  - ${err}`));
  }
  
  if (warnings.length > 0) {
    console.log(`\n⚠️  ${warnings.length} warning(s) found:`);
    warnings.forEach(warn => console.log(`  - ${warn}`));
  }
  
  if (errors.length > 0) {
    console.log('\n❌ Broken link check FAILED');
    return false;
  }
  
  console.log('\n⚠️  Broken link check passed with warnings');
  return true;
}

/**
 * Main execution
 */
function mainExport() {
  try {
    const success = main();
    process.exit(success ? 0 : 1);
  } catch (error) {
    console.error('❌ Error checking broken links:', error);
    process.exit(1);
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  mainExport();
}

export { checkAllLinks, isInternalLink };
