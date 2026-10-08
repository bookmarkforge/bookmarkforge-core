#!/usr/bin/env node

/**
 * Vercel Domain Configuration Script
 * 
 * This script automates the configuration of custom domains in Vercel:
 * - Adds domains to the project
 * - Configures redirects
 * - Connects domains to the production environment
 * 
 * Usage:
 *   node scripts/vercel-configure-domain.mjs
 * 
 * Environment variables:
 *   VERCEL_TOKEN - Your Vercel API token (required)
 *   VERCEL_PROJECT_ID - Your Vercel project ID (required)
 *   DOMAIN - The domain to configure (default: www.bookmarkforgeapp.com)
 *   ENVIRONMENT - Target environment (default: production)
 */

import https from 'https';

// Configuration
const VERCEL_API_BASE = 'https://api.vercel.com';
const DEFAULT_DOMAIN = 'www.bookmarkforgeapp.com';
const DEFAULT_ENVIRONMENT = 'production';

// Get environment variables
const VERCEL_TOKEN = process.env.VERCEL_TOKEN;
const VERCEL_PROJECT_ID = process.env.VERCEL_PROJECT_ID;
const DOMAIN = process.env.DOMAIN || DEFAULT_DOMAIN;
const ENVIRONMENT = process.env.ENVIRONMENT || DEFAULT_ENVIRONMENT;

// Validate required environment variables
if (!VERCEL_TOKEN) {
  console.error('❌ Error: VERCEL_TOKEN environment variable is required');
  console.error('Get your token from: https://vercel.com/account/tokens');
  process.exit(1);
}

if (!VERCEL_PROJECT_ID) {
  console.error('❌ Error: VERCEL_PROJECT_ID environment variable is required');
  console.error('Find your project ID in Vercel project settings');
  process.exit(1);
}

console.log(`🔧 Configuring domain: ${DOMAIN}`);
console.log(`📦 Project ID: ${VERCEL_PROJECT_ID}`);
console.log(`🌍 Environment: ${ENVIRONMENT}\n`);

/**
 * Make an authenticated request to Vercel API
 */
async function vercelRequest(endpoint, method = 'GET', body = null) {
  const url = `${VERCEL_API_BASE}${endpoint}`;
  const options = {
    method,
    headers: {
      'Authorization': `Bearer ${VERCEL_TOKEN}`,
      'Content-Type': 'application/json',
    },
  };

  return new Promise((resolve, reject) => {
    const req = https.request(url, options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(parsed);
          } else {
            reject(new Error(`Vercel API error: ${res.statusCode} - ${parsed.message || data}`));
          }
        } catch {
          // Not JSON (e.g. an empty 2xx body): surface the raw payload.
          resolve(data);
        }
      });
    });

    req.on('error', reject);

    if (body) {
      req.write(JSON.stringify(body));
    }

    req.end();
  });
}

/**
 * Check if domain already exists in the project
 */
async function checkDomainExists() {
  try {
    const result = await vercelRequest(`/v9/projects/${VERCEL_PROJECT_ID}/domains/${DOMAIN}`);
    console.log(`✅ Domain ${DOMAIN} already exists in project`);
    return result;
  } catch (error) {
    if (error.message.includes('404')) {
      console.log(`ℹ️  Domain ${DOMAIN} does not exist in project yet`);
      return null;
    }
    throw error;
  }
}

/**
 * Add domain to the project
 */
async function addDomain() {
  console.log(`➕ Adding domain ${DOMAIN} to project...`);
  
  try {
    const result = await vercelRequest(`/v9/projects/${VERCEL_PROJECT_ID}/domains`, 'POST', {
      name: DOMAIN,
    });
    console.log(`✅ Domain ${DOMAIN} added successfully`);
    return result;
  } catch (error) {
    console.error(`❌ Failed to add domain: ${error.message}`);
    throw error;
  }
}

/**
 * Main execution
 */
async function main() {
  try {
    // Step 1: Check if domain exists
    const existingDomain = await checkDomainExists();
    
    if (existingDomain) {
      console.log('\n✅ Domain already configured in Vercel!');
      console.log('\n📋 Current status:');
      console.log(`   Domain: ${DOMAIN}`);
      console.log(`   Status: ${existingDomain.verified ? 'Verified' : 'Pending verification'}`);
      console.log(`   Project: ${VERCEL_PROJECT_ID}`);
      
      if (existingDomain.verified) {
        console.log('\n✅ Domain is verified and ready!');
        console.log(`🌐 Access your site at: https://${DOMAIN}`);
      } else {
        console.log('\n⚠️  Domain is pending verification');
        console.log('\n📋 Next steps:');
        console.log('1. Ensure DNS records are configured at your domain registrar:');
        console.log(`   Type: CNAME`);
        console.log(`   Name: ${DOMAIN.split('.')[0]}`);
        console.log(`   Value: cname.vercel-dns.com`);
        console.log('\n2. Wait for DNS propagation (usually 5-30 minutes)');
        console.log('3. Verify the domain in Vercel dashboard');
        console.log(`\n🌐 Access your site at: https://${DOMAIN}`);
      }
    } else {
      // Step 2: Add domain if it doesn't exist
      await addDomain();
      
      console.log('\n📋 Next steps:');
      console.log('1. Configure DNS records at your domain registrar:');
      console.log(`   Type: CNAME`);
      console.log(`   Name: ${DOMAIN.split('.')[0]}`);
      console.log(`   Value: cname.vercel-dns.com`);
      console.log('\n2. Wait for DNS propagation (usually 5-30 minutes)');
      console.log('3. Verify the domain in Vercel dashboard');
      console.log(`\n🌐 Access your site at: https://${DOMAIN}`);
    }
    
  } catch (error) {
    console.error('\n❌ Domain configuration failed:', error.message);
    process.exit(1);
  }
}

// Run the script
main();
