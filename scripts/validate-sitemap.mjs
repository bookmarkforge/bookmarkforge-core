#!/usr/bin/env node

/**
 * Sitemap Validator for BookmarkForge
 * 
 * Validates the generated sitemap.xml against Google's sitemap protocol:
 * - XML structure validation
 * - URL format validation
 * - Priority range validation (0.0-1.0)
 * - Change frequency validation
 * - hreflang completeness check
 * 
 * Usage: node scripts/validate-sitemap.mjs
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const SITEMAP_FILE = join(__dirname, '..', 'public', 'sitemap.xml');

const VALID_CHANGEFREQ = [
  'always', 'hourly', 'daily', 'weekly', 'monthly', 'yearly', 'never'
];

const LANGUAGES = [
  'ar', 'bg', 'cs', 'da', 'de', 'el', 'en', 'es', 'fi', 'fr',
  'he', 'hi', 'hr', 'hu', 'id', 'it', 'ja', 'ko', 'nl', 'no',
  'pl', 'pt', 'ro', 'ru', 'sv', 'th', 'tr', 'uk', 'vi', 'zh'
];

const errors = [];
const warnings = [];

/**
 * Parse XML (simplified parser for validation)
 */
function parseSitemap(xml) {
  const urls = [];
  const urlRegex = /<url>([\s\S]*?)<\/url>/g;
  let match;
  
  while ((match = urlRegex.exec(xml)) !== null) {
    const urlBlock = match[1];
    
    const locMatch = urlBlock.match(/<loc>(.*?)<\/loc>/);
    const lastmodMatch = urlBlock.match(/<lastmod>(.*?)<\/lastmod>/);
    const changefreqMatch = urlBlock.match(/<changefreq>(.*?)<\/changefreq>/);
    const priorityMatch = urlBlock.match(/<priority>(.*?)<\/priority>/);
    
    const hreflangRegex = /<xhtml:link rel="alternate" hreflang="([^"]+)" href="([^"]+)" \/>/g;
    const hreflangs = [];
    let hreflangMatch;
    
    while ((hreflangMatch = hreflangRegex.exec(urlBlock)) !== null) {
      hreflangs.push({
        lang: hreflangMatch[1],
        href: hreflangMatch[2]
      });
    }
    
    urls.push({
      loc: locMatch ? locMatch[1] : null,
      lastmod: lastmodMatch ? lastmodMatch[1] : null,
      changefreq: changefreqMatch ? changefreqMatch[1] : null,
      priority: priorityMatch ? parseFloat(priorityMatch[1]) : null,
      hreflangs
    });
  }
  
  return urls;
}

/**
 * Validate URL format
 */
function validateUrl(url) {
  try {
    const urlObj = new URL(url);
    if (urlObj.protocol !== 'https:') {
      errors.push(`URL must use HTTPS: ${url}`);
      return false;
    }
    if (urlObj.hostname !== 'bookmarkforgeapp.com') {
      errors.push(`URL must be on bookmarkforgeapp.com domain: ${url}`);
      return false;
    }
    return true;
  } catch (e) {
    errors.push(`Invalid URL format: ${url}`);
    return false;
  }
}

/**
 * Validate lastmod date
 */
function validateLastmod(lastmod) {
  if (!lastmod) {
    warnings.push('Missing lastmod date');
    return false;
  }
  
  const date = new Date(lastmod);
  if (isNaN(date.getTime())) {
    errors.push(`Invalid lastmod date format: ${lastmod}`);
    return false;
  }
  
  // Check if date is not in the future
  if (date > new Date()) {
    warnings.push(`lastmod date is in the future: ${lastmod}`);
  }
  
  return true;
}

/**
 * Validate changefreq
 */
function validateChangefreq(changefreq) {
  if (!changefreq) {
    warnings.push('Missing changefreq');
    return false;
  }
  
  if (!VALID_CHANGEFREQ.includes(changefreq)) {
    errors.push(`Invalid changefreq: ${changefreq}. Must be one of: ${VALID_CHANGEFREQ.join(', ')}`);
    return false;
  }
  
  return true;
}

/**
 * Validate priority
 */
function validatePriority(priority) {
  if (priority === null || priority === undefined) {
    warnings.push('Missing priority');
    return false;
  }
  
  if (isNaN(priority) || priority < 0 || priority > 1) {
    errors.push(`Invalid priority: ${priority}. Must be between 0.0 and 1.0`);
    return false;
  }
  
  return true;
}

/**
 * Validate hreflang completeness
 */
function validateHreflangs(hreflangs, url) {
  if (hreflangs.length === 0) {
    warnings.push(`No hreflang links found for: ${url}`);
    return false;
  }
  
  const foundLangs = new Set(hreflangs.map(h => h.lang));
  const missingLangs = LANGUAGES.filter(lang => !foundLangs.has(lang));
  
  if (missingLangs.length > 0) {
    warnings.push(`Missing hreflang links for ${missingLangs.length} languages: ${missingLangs.join(', ')} in ${url}`);
  }
  
  // Check for x-default
  if (!foundLangs.has('x-default')) {
    warnings.push(`Missing x-default hreflang for: ${url}`);
  }
  
  // Check for duplicates
  const duplicates = hreflangs.filter(h => h.lang === 'en');
  if (duplicates.length > 1) {
    errors.push(`Duplicate hreflang for 'en' in: ${url}`);
  }
  
  return foundLangs.size === LANGUAGES.length + 1; // +1 for x-default
}

/**
 * Main validation
 */
function validateSitemap() {
  console.log('🔍 Validating sitemap.xml...\n');
  console.log(`Reading sitemap from: ${SITEMAP_FILE}`);
  
  let xml;
  try {
    xml = readFileSync(SITEMAP_FILE, 'utf-8');
    console.log(`✅ Read ${xml.length} bytes from sitemap`);
  } catch (error) {
    console.error('❌ Failed to read sitemap file:', error);
    errors.push(`Failed to read sitemap file: ${error.message}`);
    return false;
  }
  
  // Check XML declaration
  if (!xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')) {
    errors.push('Missing or invalid XML declaration');
  }
  
  // Check urlset namespace
  if (!xml.includes('xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"')) {
    errors.push('Missing sitemap namespace');
  }
  
  // Check xhtml namespace
  if (!xml.includes('xmlns:xhtml="http://www.w3.org/1999/xhtml"')) {
    errors.push('Missing xhtml namespace for hreflang');
  }
  
  const urls = parseSitemap(xml);
  
  console.log(`📊 Found ${urls.length} URLs\n`);
  
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    console.log(`Validating URL ${i + 1}/${urls.length}: ${url.loc}`);
    
    validateUrl(url.loc);
    validateLastmod(url.lastmod);
    validateChangefreq(url.changefreq);
    validatePriority(url.priority);
    validateHreflangs(url.hreflangs, url.loc);
  }
  
  // Report results
  console.log('\n' + '='.repeat(50));
  
  if (errors.length === 0 && warnings.length === 0) {
    console.log('✅ Sitemap is valid!');
    console.log(`📈 ${urls.length} URLs with complete hreflang links`);
    return true;
  }
  
  if (errors.length > 0) {
    console.log(`\n❌ ${errors.length} error(s) found:`);
    errors.forEach(err => console.log(`  - ${err}`));
  }
  
  if (warnings.length > 0) {
    console.log(`\n⚠️  ${warnings.length} warning(s) found:`);
    warnings.forEach(warn => console.log(`  - ${warn}`));
  }
  
  if (errors.length > 0) {
    console.log('\n❌ Sitemap validation FAILED');
    return false;
  }
  
  console.log('\n⚠️  Sitemap validation passed with warnings');
  return true;
}

/**
 * Main execution
 */
function main() {
  try {
    console.log('Starting sitemap validation...');
    const success = validateSitemap();
    console.log('Validation complete');
    process.exit(success ? 0 : 1);
  } catch (error) {
    console.error('❌ Error validating sitemap:', error);
    process.exit(1);
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { validateSitemap };
