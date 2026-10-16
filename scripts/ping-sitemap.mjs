#!/usr/bin/env node

/**
 * Sitemap Ping Manual
 * 
 * Manually pings search engines to notify them of sitemap updates.
 * Sends HTTP requests to search engine submission endpoints.
 * 
 * This is safe because:
 * - It only sends public sitemap URLs
 * - No user data or secrets involved
 * - Standard webmaster practice
 * - Manual trigger only (not automated)
 * 
 * Usage: node scripts/ping-sitemap.mjs
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const SITEMAP_FILE = join(__dirname, '..', 'public', 'sitemap.xml');

// Search engine submission endpoints
const SEARCH_ENGINES = {
  google: {
    name: 'Google',
    url: 'https://www.google.com/ping?sitemap=',
  },
  bing: {
    name: 'Bing',
    url: 'https://www.bing.com/webmaster/ping.aspx?sitemap=',
  },
};

/**
 * Read sitemap and get public URL
 */
function getSitemapURL() {
  try {
    const content = readFileSync(SITEMAP_FILE, 'utf-8');
    
    // Extract URL from sitemap (first <loc> tag)
    const match = content.match(/<loc>(https:\/\/[^<]+)<\/loc>/);
    if (match) {
      return match[1];
    }
    
    // Fallback: construct from site URL
    return 'https://bookmarkforgeapp.com/sitemap.xml';
  } catch (error) {
    console.error('Error reading sitemap:', error.message);
    return null;
  }
}

/**
 * Submit sitemap to a search engine
 */
async function submitSitemap(engine, sitemapURL) {
  const url = engine.url + encodeURIComponent(sitemapURL);
  
  console.log(`Pinging ${engine.name}...`);
  
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'BookmarkForge-Sitemap-Pinger/1.0',
      },
    });
    
    if (response.ok) {
      const text = await response.text();
      console.log(`✅ ${engine.name}: ${response.status} ${response.statusText}`);
      
      // Google returns simple text response
      if (text.includes('Successfully') || text.includes('200')) {
        console.log(`   ${text.trim()}`);
      }
    } else {
      console.log(`⚠️  ${engine.name}: ${response.status} ${response.statusText}`);
    }
  } catch (error) {
    console.error(`❌ ${engine.name}: ${error.message}`);
  }
}

/**
 * Main execution
 */
async function main() {
  console.log('=== Sitemap Ping Manual ===\n');
  
  const sitemapURL = getSitemapURL();
  
  if (!sitemapURL) {
    console.error('❌ Failed to get sitemap URL. Run `npm run generate:sitemap` first.');
    process.exit(1);
  }
  
  console.log(`📡 Sitemap URL: ${sitemapURL}\n`);
  
  console.log('This will ping search engines to notify them of sitemap updates.');
  console.log('This is a standard webmaster practice and safe to run.\n');
  
  for (const [key, engine] of Object.entries(SEARCH_ENGINES)) {
    await submitSitemap(engine, sitemapURL);
  }
  
  console.log('\n=== Ping Complete ===');
  console.log('\n💡 Note: Search engines may take hours to days to process sitemap updates.');
  console.log('💡 You can also submit manually via:');
  console.log('   - Google Search Console: https://search.google.com/search-console/sitemaps');
  console.log('   - Bing Webmaster Tools: https://www.bing.com/webmasters/sitemaps');
}

/**
 * Main execution
 */
function mainExport() {
  main().catch((error) => {
    console.error('❌ Error pinging sitemap:', error);
    process.exit(1);
  });
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  mainExport();
}

export { submitSitemap, getSitemapURL };
