#!/usr/bin/env node

/**
 * Inject Structured Data into Landing Pages
 *
 * This script automatically injects the generated structured-data.json
 * into landing pages by adding a <script> tag in the <head> section.
 *
 * Usage: node scripts/inject-structured-data.mjs
 *
 * It modifies:
 * - public/landing.html
 * - public/pocket-alternative.html
 * - public/help.html
 * - Any other HTML files in public/
 */

import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const PUBLIC_DIR = join(__dirname, '..', 'public');
const STRUCTURED_DATA_FILE = join(PUBLIC_DIR, 'structured-data.json');

const SCRIPT_TAG = `  <script type="application/ld+json" src="/structured-data.json"></script>`;

/**
 * Check if HTML file already has the structured data script tag
 */
function hasStructuredDataTag(html) {
  return html.includes('structured-data.json') || html.includes('application/ld+json');
}

/**
 * Inject script tag into HTML head
 */
function injectScriptTag(html) {
  // Find the closing </head> tag
  const headEndIndex = html.indexOf('</head>');
  if (headEndIndex === -1) {
    console.error('❌ No </head> tag found in HTML');
    return html;
  }

  // Insert before </head>
  const injected = html.slice(0, headEndIndex) + SCRIPT_TAG + '\n' + html.slice(headEndIndex);
  return injected;
}

/**
 * Process a single HTML file
 */
function processHtmlFile(filePath) {
  try {
    const html = readFileSync(filePath, 'utf-8');

    if (hasStructuredDataTag(html)) {
      console.log(`⏭️  Skipping ${filePath} (already has structured data)`);
      return false;
    }

    const injected = injectScriptTag(html);
    writeFileSync(filePath, injected, 'utf-8');
    console.log(`✅ Injected structured data into ${filePath}`);
    return true;
  } catch (error) {
    console.error(`❌ Error processing ${filePath}:`, error.message);
    return false;
  }
}

/**
 * Get all HTML files in public directory
 */
function* getHtmlFiles(dir) {
  const files = readdirSync(dir, { withFileTypes: true });

  for (const file of files) {
    const fullPath = join(dir, file.name);

    if (file.isDirectory()) {
      yield* getHtmlFiles(fullPath);
    } else if (file.name.endsWith('.html')) {
      yield fullPath;
    }
  }
}

/**
 * Main execution
 */
function main() {
  try {
    console.log('=== Injecting Structured Data into Landing Pages ===\n');

    // Check if structured-data.json exists
    if (!require('fs').existsSync(STRUCTURED_DATA_FILE)) {
      console.error('❌ structured-data.json not found. Run npm run generate:structured-data first.');
      process.exit(1);
    }

    console.log(`📄 Structured data file: ${STRUCTURED_DATA_FILE}\n`);

    let injectedCount = 0;
    let skippedCount = 0;

    // Process all HTML files
    for (const htmlFile of getHtmlFiles(PUBLIC_DIR)) {
      const relativePath = htmlFile.replace(PUBLIC_DIR, '');
      console.log(`Processing: ${relativePath}`);

      if (processHtmlFile(htmlFile)) {
        injectedCount++;
      } else {
        skippedCount++;
      }
    }

    console.log('\n=== Summary ===');
    console.log(`✅ Injected: ${injectedCount} files`);
    console.log(`⏭️  Skipped: ${skippedCount} files`);
    console.log(`📁 Total: ${injectedCount + skippedCount} files`);

    if (injectedCount > 0) {
      console.log('\n⚠️  IMPORTANT:');
      console.log('  - Review the changes with git diff');
      console.log('  - Commit the changes to preserve structured data injection');
      console.log('  - The script tag will be included in the build output');
    }

  } catch (error) {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { main, injectScriptTag, hasStructuredDataTag };
