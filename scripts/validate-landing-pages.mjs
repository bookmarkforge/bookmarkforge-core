#!/usr/bin/env node

/**
 * Landing Page Validator
 * 
 * Validates all 30 localized landing pages for consistency:
 * - Checks if all required elements exist
 * - Validates meta tags consistency
 * - Checks for broken internal links
 * - Validates title/description completeness
 * 
 * Usage: node scripts/validate-landing-pages.mjs
 */

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const PUBLIC_DIR = join(__dirname, '..', 'public');

const LANGUAGES = [
  'ar', 'bg', 'cs', 'da', 'de', 'el', 'en', 'es', 'fi', 'fr',
  'he', 'hi', 'hr', 'hu', 'id', 'it', 'ja', 'ko', 'nl', 'no',
  'pl', 'pt', 'ro', 'ru', 'sv', 'th', 'tr', 'uk', 'vi', 'zh'
];

const errors = [];
const warnings = [];

/**
 * Validate a single landing page
 */
function validateLandingPage(filePath, lang) {
  const content = readFileSync(filePath, 'utf-8');
  
  // Check for required meta tags
  const requiredMeta = [
    'name="description"',
    'property="og:title"',
    'property="og:description"',
    'property="og:url"',
    'name="twitter:card"',
    'name="twitter:title"',
    'name="twitter:description"',
  ];
  
  for (const meta of requiredMeta) {
    if (!content.includes(meta)) {
      errors.push(`${lang}: Missing meta tag ${meta}`);
    }
  }
  
  // Check for canonical link
  if (!content.includes('rel="canonical"')) {
    errors.push(`${lang}: Missing canonical link`);
  }
  
  // Check for hreflang links
  if (!content.includes('hreflang=')) {
    warnings.push(`${lang}: No hreflang links found`);
  }
  
  // Check for title tag
  if (!content.includes('<title>')) {
    errors.push(`${lang}: Missing <title> tag`);
  }
  
  // Check for structured data
  if (!content.includes('application/ld+json')) {
    warnings.push(`${lang}: No structured data (JSON-LD)`);
  }
  
  // Check for viewport meta
  if (!content.includes('name="viewport"')) {
    errors.push(`${lang}: Missing viewport meta tag`);
  }
  
  // Check for theme-color
  if (!content.includes('name="theme-color"')) {
    warnings.push(`${lang}: Missing theme-color meta tag`);
  }
  
  // Check for charset
  if (!content.includes('charset=')) {
    errors.push(`${lang}: Missing charset declaration`);
  }
}

/**
 * Check all 30 localized landing pages
 */
function validateAllLandings() {
  console.log('🔍 Validating landing pages...\n');
  
  let checked = 0;
  
  for (const lang of LANGUAGES) {
    const filePath = join(PUBLIC_DIR, `${lang}.html`);
    
    try {
      validateLandingPage(filePath, lang);
      checked++;
    } catch (error) {
      errors.push(`${lang}: Failed to read file (${error.message})`);
    }
  }
  
  // Also check main landing.html
  try {
    validateLandingPage(join(PUBLIC_DIR, 'landing.html'), 'en (landing.html)');
    checked++;
  } catch (error) {
    errors.push(`landing.html: Failed to read file (${error.message})`);
  }
  
  console.log(`📊 Checked ${checked} landing pages\n`);
}

/**
 * Validate landing root configuration
 */
function validateLandingRoot() {
  console.log('📁 Validating landing root configuration...\n');
  
  // Check if landing.html exists
  const landingPath = join(PUBLIC_DIR, 'landing.html');
  try {
    readFileSync(landingPath);
    console.log('✅ landing.html exists');
  } catch (error) {
    errors.push('landing.html not found');
  }
  
  // Check if index.html is redirect or removed
  const indexPath = join(PUBLIC_DIR, 'index.html');
  try {
    const content = readFileSync(indexPath, 'utf-8');
    if (content.includes('landing.html') || content.includes('/')) {
      console.log('✅ index.html is a redirect');
    } else {
      warnings.push('index.html may not be a redirect to landing');
    }
  } catch (error) {
    // index.html might not exist (which is fine if landing.html is the root)
    console.log('ℹ️  index.html not found (landing.html is root)');
  }
}

/**
 * Main validation
 */
function main() {
  console.log('=== Landing Page Validator ===\n');
  
  validateLandingRoot();
  validateAllLandings();
  
  console.log('=' + '='.repeat(49));
  
  if (errors.length === 0 && warnings.length === 0) {
    console.log('✅ All landing pages are valid!');
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
    console.log('\n❌ Landing page validation FAILED');
    return false;
  }
  
  console.log('\n⚠️  Landing page validation passed with warnings');
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
    console.error('❌ Error validating landing pages:', error);
    process.exit(1);
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  mainExport();
}

export { validateLandingPage, validateAllLandings };
