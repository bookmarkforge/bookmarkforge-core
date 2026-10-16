#!/usr/bin/env node

/**
 * Performance Budget Validator
 * 
 * Validates that the build output meets performance budgets.
 * Runs locally, checks bundle sizes, resource counts, and other metrics.
 * No external services, no data transmission.
 * 
 * Usage: node scripts/validate-performance-budget.mjs
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const DIST_DIR = join(__dirname, '..', 'dist');

// Performance budgets (in bytes)
const BUDGETS = {
  'js': {
    'total': 500 * 1024, // 500 KB total JS
    'vendor': 300 * 1024, // 300 KB vendor chunk
    'single': 100 * 1024, // 100 KB max per chunk
  },
  'css': {
    'total': 50 * 1024, // 50 KB total CSS
    'single': 20 * 1024, // 20 KB max per file
  },
  'assets': {
    'total': 200 * 1024, // 200 KB total assets
    'single': 100 * 1024, // 100 KB max per asset
  },
  'html': {
    'max': 10 * 1024, // 10 KB max HTML
  },
};

const errors = [];
const warnings = [];

/**
 * Get file size in bytes
 */
function getFileSize(filePath) {
  try {
    return statSync(filePath).size;
  } catch (error) {
    return 0;
  }
}

/**
 * Format bytes to human readable
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Validate JS bundle sizes
 */
function validateJSBundles(files) {
  console.log('\n📦 Validating JS bundles...');
  
  const jsFiles = files.filter(f => f.endsWith('.js'));
  let totalSize = 0;
  let vendorSize = 0;
  
  for (const file of jsFiles) {
    const size = getFileSize(join(DIST_DIR, file));
    totalSize += size;
    
    // Check if this is a vendor chunk (contains 'vendor' or 'chunk-')
    if (file.includes('vendor') || file.includes('chunk-')) {
      vendorSize += size;
    }
    
    // Check single file budget
    if (size > BUDGETS.js.single) {
      errors.push(`JS chunk exceeds budget: ${file} (${formatBytes(size)} > ${formatBytes(BUDGETS.js.single)})`);
    } else if (size > BUDGETS.js.single * 0.8) {
      warnings.push(`JS chunk near budget: ${file} (${formatBytes(size)})`);
    }
  }
  
  // Check total budget
  if (totalSize > BUDGETS.js.total) {
    errors.push(`Total JS exceeds budget: ${formatBytes(totalSize)} > ${formatBytes(BUDGETS.js.total)}`);
  } else if (totalSize > BUDGETS.js.total * 0.8) {
    warnings.push(`Total JS near budget: ${formatBytes(totalSize)}`);
  }
  
  // Check vendor budget
  if (vendorSize > BUDGETS.js.vendor) {
    errors.push(`Vendor JS exceeds budget: ${formatBytes(vendorSize)} > ${formatBytes(BUDGETS.js.vendor)}`);
  }
  
  console.log(`  Total JS: ${formatBytes(totalSize)} (budget: ${formatBytes(BUDGETS.js.total)})`);
  console.log(`  Vendor JS: ${formatBytes(vendorSize)} (budget: ${formatBytes(BUDGETS.js.vendor)})`);
  console.log(`  Chunks: ${jsFiles.length}`);
}

/**
 * Validate CSS bundle sizes
 */
function validateCSSBundles(files) {
  console.log('\n🎨 Validating CSS bundles...');
  
  const cssFiles = files.filter(f => f.endsWith('.css'));
  let totalSize = 0;
  
  for (const file of cssFiles) {
    const size = getFileSize(join(DIST_DIR, file));
    totalSize += size;
    
    // Check single file budget
    if (size > BUDGETS.css.single) {
      errors.push(`CSS file exceeds budget: ${file} (${formatBytes(size)} > ${formatBytes(BUDGETS.css.single)})`);
    }
  }
  
  // Check total budget
  if (totalSize > BUDGETS.css.total) {
    errors.push(`Total CSS exceeds budget: ${formatBytes(totalSize)} > ${formatBytes(BUDGETS.css.total)}`);
  }
  
  console.log(`  Total CSS: ${formatBytes(totalSize)} (budget: ${formatBytes(BUDGETS.css.total)})`);
  console.log(`  Files: ${cssFiles.length}`);
}

/**
 * Validate asset sizes
 */
function validateAssets(files) {
  console.log('\n🖼️  Validating assets...');
  
  const assetExtensions = ['.png', '.jpg', '.jpeg', '.svg', '.webp', '.woff', '.woff2'];
  const assetFiles = files.filter(f => assetExtensions.some(ext => f.endsWith(ext)));
  let totalSize = 0;
  
  for (const file of assetFiles) {
    const size = getFileSize(join(DIST_DIR, file));
    totalSize += size;
    
    // Check single file budget
    if (size > BUDGETS.assets.single) {
      errors.push(`Asset exceeds budget: ${file} (${formatBytes(size)} > ${formatBytes(BUDGETS.assets.single)})`);
    }
  }
  
  // Check total budget
  if (totalSize > BUDGETS.assets.total) {
    errors.push(`Total assets exceed budget: ${formatBytes(totalSize)} > ${formatBytes(BUDGETS.assets.total)}`);
  }
  
  console.log(`  Total assets: ${formatBytes(totalSize)} (budget: ${formatBytes(BUDGETS.assets.total)})`);
  console.log(`  Files: ${assetFiles.length}`);
}

/**
 * Validate HTML size
 */
function validateHTML(files) {
  console.log('\n📄 Validating HTML...');
  
  const htmlFiles = files.filter(f => f.endsWith('.html'));
  
  for (const file of htmlFiles) {
    const size = getFileSize(join(DIST_DIR, file));
    
    if (size > BUDGETS.html.max) {
      errors.push(`HTML exceeds budget: ${file} (${formatBytes(size)} > ${formatBytes(BUDGETS.html.max)})`);
    }
  }
  
  console.log(`  HTML files: ${htmlFiles.length}`);
}

/**
 * Validate bundle count
 */
function validateBundleCount(files) {
  console.log('\n📊 Validating bundle count...');
  
  const jsFiles = files.filter(f => f.endsWith('.js'));
  const cssFiles = files.filter(f => f.endsWith('.css'));
  
  // Warn if too many chunks (may impact performance)
  if (jsFiles.length > 20) {
    warnings.push(`High JS chunk count: ${jsFiles.length} (may impact loading performance)`);
  }
  
  if (cssFiles.length > 10) {
    warnings.push(`High CSS file count: ${cssFiles.length} (may impact loading performance)`);
  }
  
  console.log(`  JS chunks: ${jsFiles.length}`);
  console.log(`  CSS files: ${cssFiles.length}`);
}

/**
 * Main validation
 */
function validatePerformanceBudget() {
  console.log('⚡ Validating performance budgets...\n');
  console.log(`📁 Dist directory: ${DIST_DIR}`);
  
  // Check if dist directory exists
  try {
    readdirSync(DIST_DIR);
  } catch (error) {
    console.error('❌ Dist directory not found. Run `npm run build` first.');
    process.exit(1);
  }
  
  // Get all files in dist
  const files = readdirSync(DIST_DIR, { recursive: true })
    .filter(f => typeof f === 'string')
    .map(f => f.replace(/\\/g, '/')); // Normalize paths
  
  console.log(`📊 Total files: ${files.length}\n`);
  
  // Run validations
  validateJSBundles(files);
  validateCSSBundles(files);
  validateAssets(files);
  validateHTML(files);
  validateBundleCount(files);
  
  // Report results
  console.log('\n' + '='.repeat(50));
  
  if (errors.length === 0 && warnings.length === 0) {
    console.log('✅ All performance budgets passed!');
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
    console.log('\n❌ Performance budget validation FAILED');
    return false;
  }
  
  console.log('\n⚠️  Performance budget validation passed with warnings');
  return true;
}

/**
 * Main execution
 */
function main() {
  try {
    const success = validatePerformanceBudget();
    process.exit(success ? 0 : 1);
  } catch (error) {
    console.error('❌ Error validating performance budget:', error);
    process.exit(1);
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { validatePerformanceBudget, BUDGETS };
