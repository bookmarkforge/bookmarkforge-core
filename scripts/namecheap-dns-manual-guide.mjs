#!/usr/bin/env node

/**
 * Namecheap DNS Manual Configuration Guide
 * 
 * This script provides step-by-step instructions for manual DNS configuration
 * on Namecheap when API access is not available.
 * 
 * Usage:
 *   node scripts/namecheap-dns-manual-guide.mjs
 * 
 * Environment variables:
 *   DOMAIN - The domain to configure (default: bookmarkforgeapp.com)
 *   SUBDOMAIN - The subdomain to configure (default: www)
 */

import dns from 'dns/promises';

// Configuration
const DEFAULT_DOMAIN = 'bookmarkforgeapp.com';
const DEFAULT_SUBDOMAIN = 'www';
const VERCEL_CNAME = 'cname.vercel-dns.com';
const VERCEL_IP = '76.76.21.21'; // Vercel's primary IP

// Get environment variables
const DOMAIN = process.env.DOMAIN || DEFAULT_DOMAIN;
const SUBDOMAIN = process.env.SUBDOMAIN || DEFAULT_SUBDOMAIN;

console.log(`🔧 DNS Manual Configuration Guide for ${SUBDOMAIN}.${DOMAIN}\n`);

/**
 * Display step-by-step instructions
 */
function displayInstructions() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('              NAMECHEAP DNS CONFIGURATION GUIDE');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log('📋 STEP 1: Log in to Namecheap');
  console.log('─────────────────────────────────────────────────────────────');
  console.log('1. Open your browser');
  console.log('2. Go to: https://www.namecheap.com/myaccount/login/');
  console.log('3. Log in with your Namecheap credentials\n');

  console.log('📋 STEP 2: Navigate to DNS Management');
  console.log('─────────────────────────────────────────────────────────────');
  console.log('1. In the top menu, click on "Domain List"');
  console.log(`2. Find your domain: ${DOMAIN}`);
  console.log('3. Click on the "Manage" button next to your domain');
  console.log('4. In the left sidebar, click on "Advanced DNS"\n');

  console.log('📋 STEP 3: Remove existing DNS records (if any)');
  console.log('─────────────────────────────────────────────────────────────');
  console.log('1. Look for any existing records for the following:');
  console.log(`   - @ (apex domain)`);
  console.log(`   - ${SUBDOMAIN} (subdomain)`);
  console.log('2. Click the trash icon 🗑️ to delete them');
  console.log('3. Click "Save Changes" if prompted\n');

  console.log('📋 STEP 4: Add CNAME record for subdomain');
  console.log('─────────────────────────────────────────────────────────────');
  console.log('1. Click the "Add New Record" button');
  console.log('2. Select "CNAME Record" from the dropdown');
  console.log('3. Fill in the fields:');
  console.log(`   Type: CNAME`);
  console.log(`   Host: ${SUBDOMAIN}`);
  console.log(`   Value: ${VERCEL_CNAME}`);
  console.log(`   TTL: Automatic (or 3600 seconds)`);
  console.log('4. Click "Save All Changes"\n');

  console.log('📋 STEP 5: Add A record for apex domain');
  console.log('─────────────────────────────────────────────────────────────');
  console.log('1. Click the "Add New Record" button again');
  console.log('2. Select "A Record" from the dropdown');
  console.log('3. Fill in the fields:');
  console.log(`   Type: A`);
  console.log(`   Host: @`);
  console.log(`   Value: ${VERCEL_IP}`);
  console.log(`   TTL: Automatic (or 3600 seconds)`);
  console.log('4. Click "Save All Changes"\n');

  console.log('📋 STEP 6: Verify the configuration');
  console.log('─────────────────────────────────────────────────────────────');
  console.log('1. Scroll down to see your DNS records');
  console.log('2. You should see:');
  console.log(`   CNAME: ${SUBDOMAIN} → ${VERCEL_CNAME}`);
  console.log(`   A: @ → ${VERCEL_IP}`);
  console.log('3. If you see any other records, delete them\n');

  console.log('📋 STEP 7: Wait for DNS propagation');
  console.log('─────────────────────────────────────────────────────────────');
  console.log('DNS changes typically take 5-30 minutes to propagate worldwide.');
  console.log('In some cases, it can take up to 48 hours.\n');

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('                    DNS RECORDS SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════\n');
  console.log('Record 1 (CNAME):');
  console.log(`  Type: CNAME`);
  console.log(`  Host: ${SUBDOMAIN}`);
  console.log(`  Value: ${VERCEL_CNAME}`);
  console.log(`  Points to: Vercel`);
  console.log(`  Full URL: https://${SUBDOMAIN}.${DOMAIN}\n`);

  console.log('Record 2 (A):');
  console.log(`  Type: A`);
  console.log(`  Host: @`);
  console.log(`  Value: ${VERCEL_IP}`);
  console.log(`  Points to: Vercel`);
  console.log(`  Full URL: https://${DOMAIN}\n`);

  console.log('═══════════════════════════════════════════════════════════════\n');
}

/**
 * Check DNS configuration using DNS lookup
 */
async function checkDNSConfiguration() {
  console.log('🔍 Checking current DNS configuration...\n');

  try {
    // Check CNAME record
    console.log(`Checking CNAME for ${SUBDOMAIN}.${DOMAIN}...`);
    try {
      const cnameResult = await dns.resolveCname(`${SUBDOMAIN}.${DOMAIN}`);
      const cname = cnameResult[0];
      if (cname === VERCEL_CNAME) {
        console.log(`✅ CNAME correct: ${cname}`);
      } else {
        console.log(`⚠️  CNAME incorrect: ${cname} (expected: ${VERCEL_CNAME})`);
      }
    } catch {
      console.log(`❌ CNAME not found or not configured yet`);
    }

    // Check A record
    console.log(`\nChecking A record for ${DOMAIN}...`);
    try {
      const aResult = await dns.resolve4(DOMAIN);
      const ip = aResult[0];
      if (ip === VERCEL_IP) {
        console.log(`✅ A record correct: ${ip}`);
      } else {
        console.log(`⚠️  A record incorrect: ${ip} (expected: ${VERCEL_IP})`);
      }
    } catch {
      console.log(`❌ A record not found or not configured yet`);
    }

    console.log('\n💡 If DNS is not yet propagated, wait 5-30 minutes and try again.');
    console.log('   You can check propagation at: https://dnschecker.org/');
  } catch (error) {
    console.error(`❌ Error checking DNS: ${error.message}`);
  }
}

/**
 * Provide verification commands
 */
function displayVerificationCommands() {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('              VERIFICATION COMMANDS');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log('Windows (Command Prompt):');
  console.log(`  nslookup ${SUBDOMAIN}.${DOMAIN}`);
  console.log(`  nslookup ${DOMAIN}\n`);

  console.log('Windows (PowerShell):');
  console.log(`  Resolve-DnsName -Name ${SUBDOMAIN}.${DOMAIN} -Type CNAME`);
  console.log(`  Resolve-DnsName -Name ${DOMAIN} -Type A\n`);

  console.log('macOS/Linux:');
  console.log(`  dig ${SUBDOMAIN}.${DOMAIN} CNAME`);
  console.log(`  dig ${DOMAIN} A\n`);

  console.log('Online tools:');
  console.log('  https://dnschecker.org/');
  console.log('  https://www.whatsmydns.net/\n');

  console.log('═══════════════════════════════════════════════════════════════\n');
}

/**
 * Main execution
 */
async function main() {
  try {
    // Display instructions
    displayInstructions();

    // Ask if user wants to check current DNS
    console.log('Would you like to check the current DNS configuration?');
    console.log('If you have already configured DNS, type "yes" and press Enter.');
    console.log('Otherwise, press Enter to skip.\n');

    // Since we can't get user input easily in this script context,
    // we'll just display verification commands
    console.log('After configuring DNS, you can verify with:');
    console.log('  node scripts/namecheap-dns-manual-guide.mjs --check\n');

    // If --check flag is provided, verify DNS
    if (process.argv.includes('--check')) {
      await checkDNSConfiguration();
    }

    displayVerificationCommands();

    console.log('📚 For more information:');
    console.log('   Namecheap DNS Documentation: https://www.namecheap.com/support/knowledgebase/article.aspx/294/33/how-to-configure-dns-records-for-your-domain/');
    console.log('   Vercel Custom Domains: https://vercel.com/docs/projects/domains\n');

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  }
}

// Run the script
main();
