#!/usr/bin/env node

/**
 * Namecheap DNS Configuration Script
 * 
 * This script automates DNS configuration for BookmarkForge on Namecheap:
 * - Configures CNAME record for www subdomain
 * - Configures A record for apex domain
 * - Verifies DNS configuration
 * 
 * Usage:
 *   node scripts/namecheap-dns-config.mjs
 * 
 * Environment variables:
 *   NAMECHEAP_USER - Your Namecheap username (required)
 *   NAMECHEAP_API_KEY - Your Namecheap API key (required)
 *   DOMAIN - The domain to configure (default: bookmarkforgeapp.com)
 *   SUBDOMAIN - The subdomain to configure (default: www)
 * 
 * API Documentation:
 *   https://www.namecheap.com/support/api/methods/
 */

import https from 'https';

// Configuration
const NAMECHEAP_API_BASE = 'https://api.namecheap.com/xml.response';
const DEFAULT_DOMAIN = 'bookmarkforgeapp.com';
const DEFAULT_SUBDOMAIN = 'www';
const VERCEL_CNAME = 'cname.vercel-dns.com';
const VERCEL_IP = '76.76.21.21'; // Vercel's primary IP

// Get environment variables
const NAMECHEAP_USER = process.env.NAMECHEAP_USER;
const NAMECHEAP_API_KEY = process.env.NAMECHEAP_API_KEY;
const DOMAIN = process.env.DOMAIN || DEFAULT_DOMAIN;
const SUBDOMAIN = process.env.SUBDOMAIN || DEFAULT_SUBDOMAIN;

// Validate required environment variables
if (!NAMECHEAP_USER) {
  console.error('❌ Error: NAMECHEAP_USER environment variable is required');
  console.error('Get your API key from: https://ap.www.namecheap.com/grant/api-key');
  process.exit(1);
}

if (!NAMECHEAP_API_KEY) {
  console.error('❌ Error: NAMECHEAP_API_KEY environment variable is required');
  console.error('Get your API key from: https://ap.www.namecheap.com/grant/api-key');
  process.exit(1);
}

console.log(`🔧 Configuring DNS for ${SUBDOMAIN}.${DOMAIN}`);
console.log(`👤 Namecheap User: ${NAMECHEAP_USER}\n`);

/**
 * Make a request to Namecheap API
 */
async function namecheapRequest(endpoint, params = {}) {
  const queryString = new URLSearchParams({
    ApiUser: NAMECHEAP_USER,
    ApiKey: NAMECHEAP_API_KEY,
    UserName: NAMECHEAP_USER,
    ...params,
  });

  const url = `${NAMECHEAP_API_BASE}${endpoint}?${queryString}`;

  return new Promise((resolve, reject) => {
    const req = https.request(url, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        // Namecheap returns XML, so we return it as-is
        resolve(data);
      });
    });

    req.on('error', (_e) => reject(_e));
    req.end();
  });
}

/**
 * Get current DNS records for the domain
 */
async function getDNSRecords() {
  console.log(`📋 Fetching current DNS records for ${DOMAIN}...`);
  
  try {
    const response = await namecheapRequest('/dns/getHosts', {
      DomainName: DOMAIN,
    });
    console.log(`✅ DNS records fetched`);
    return response;
  } catch (error) {
    console.error(`❌ Failed to fetch DNS records: ${error.message}`);
    throw error;
  }
}

/**
 * Set CNAME record for subdomain
 */
async function setCNAMERecord() {
  console.log(`➕ Setting CNAME record for ${SUBDOMAIN}.${DOMAIN}...`);
  
  try {
    const response = await namecheapRequest('/dns/setHosts', {
      DomainName: DOMAIN,
      SubDomainName: SUBDOMAIN,
      RecordType: 'CNAME',
      Address: VERCEL_CNAME,
      TTL: 3600,
    });
    console.log(`✅ CNAME record set: ${SUBDOMAIN}.${DOMAIN} → ${VERCEL_CNAME}`);
    return response;
  } catch (error) {
    console.error(`❌ Failed to set CNAME record: ${error.message}`);
    throw error;
  }
}

/**
 * Set A record for apex domain
 */
async function setARecord() {
  console.log(`➕ Setting A record for ${DOMAIN}...`);
  
  try {
    const response = await namecheapRequest('/dns/setHosts', {
      DomainName: DOMAIN,
      SubDomainName: '@',
      RecordType: 'A',
      Address: VERCEL_IP,
      TTL: 3600,
    });
    console.log(`✅ A record set: ${DOMAIN} → ${VERCEL_IP}`);
    return response;
  } catch (error) {
    console.error(`❌ Failed to set A record: ${error.message}`);
    throw error;
  }
}

/**
 * Parse Namecheap XML response to check for errors
 */
function parseNamecheapResponse(xml) {
  // Simple XML parsing to check for success/failure
  const isError = xml.includes('<Status>ERROR</Status>');
  if (isError) {
    const errorMatch = xml.match(/<Error>([^<]+)<\/Error>/);
    const errorMessage = errorMatch ? errorMatch[1] : 'Unknown error';
    throw new Error(`Namecheap API error: ${errorMessage}`);
  }
  return xml;
}

/**
 * Verify DNS configuration
 */
async function verifyDNS() {
  console.log(`🔍 Verifying DNS configuration...`);
  
  try {
    const response = await getDNSRecords();
    const xml = parseNamecheapResponse(response);
    
    // Check if CNAME record exists
    const hasCNAME = xml.includes(`HostName="${SUBDOMAIN}"`) && xml.includes('RecordType="CNAME"');
    if (hasCNAME) {
      console.log(`✅ CNAME record verified for ${SUBDOMAIN}.${DOMAIN}`);
    } else {
      console.log(`⚠️  CNAME record not found for ${SUBDOMAIN}.${DOMAIN}`);
    }
    
    // Check if A record exists
    const hasA = xml.includes('HostName="@"') && xml.includes('RecordType="A"');
    if (hasA) {
      console.log(`✅ A record verified for ${DOMAIN}`);
    } else {
      console.log(`⚠️  A record not found for ${DOMAIN}`);
    }
    
    return { hasCNAME, hasA };
  } catch (error) {
    console.error(`❌ Failed to verify DNS: ${error.message}`);
    throw error;
  }
}

/**
 * Get DNS records for manual configuration guidance
 */
function getManualDNSInstructions() {
  console.log('\n📋 Manual DNS Configuration Instructions (if API fails):');
  console.log('\n1. Log in to Namecheap:');
  console.log('   https://www.namecheap.com/myaccount/login/');
  console.log('\n2. Go to Domain List → Manage → Advanced DNS');
  console.log(`   Domain: ${DOMAIN}`);
  console.log('\n3. Add CNAME record:');
  console.log(`   Type: CNAME`);
  console.log(`   Host: ${SUBDOMAIN}`);
  console.log(`   Value: ${VERCEL_CNAME}`);
  console.log(`   TTL: 3600`);
  console.log('\n4. Add A record (for apex domain):');
  console.log(`   Type: A`);
  console.log(`   Host: @`);
  console.log(`   Value: ${VERCEL_IP}`);
  console.log(`   TTL: 3600`);
  console.log('\n5. Save changes');
  console.log('\n6. Wait for DNS propagation (5-30 minutes)');
  console.log(`\n7. Verify at: https://${SUBDOMAIN}.${DOMAIN}`);
}

/**
 * Main execution
 */
async function main() {
  try {
    console.log('🔄 Configuring DNS records...\n');
    
    // Step 1: Verify current DNS configuration
    await verifyDNS();
    
    // Step 2: Set CNAME record for subdomain
    await setCNAMERecord();
    
    // Step 3: Set A record for apex domain
    await setARecord();
    
    // Step 4: Verify final configuration
    await verifyDNS();
    
    console.log('\n✅ DNS configuration completed successfully!');
    console.log('\n📋 Records configured:');
    console.log(`   CNAME: ${SUBDOMAIN}.${DOMAIN} → ${VERCEL_CNAME}`);
    console.log(`   A: ${DOMAIN} → ${VERCEL_IP}`);
    console.log('\n⏱️  DNS propagation may take 5-30 minutes');
    console.log(`🌐 Access your site at: https://${SUBDOMAIN}.${DOMAIN}`);
    console.log(`🌐 Apex domain at: https://${DOMAIN}`);
    
  } catch (error) {
    console.error('\n❌ DNS configuration failed:', error.message);
    console.log('\n📋 Try manual configuration:');
    getManualDNSInstructions();
    process.exit(1);
  }
}

// Run the script
main();
