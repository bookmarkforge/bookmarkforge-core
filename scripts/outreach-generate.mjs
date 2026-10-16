#!/usr/bin/env node

/**
 * Outreach Content Generator (Non-Interactive)
 *
 * Generates outreach content without requiring interactive input.
 * Saves all content to files for manual review and sending.
 *
 * Usage: node scripts/outreach-generate.mjs
 *
 * Privacy: Only generates content, no automated sending.
 */

import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const MARKETING_DIR = join(__dirname, '..', 'marketing');

/**
 * Generate Dev.to article
 */
function generateDevToArticle() {
  return {
    platform: 'dev.to',
    type: 'article',
    title: 'End-to-End Encryption in the Browser: A Practical Guide',
    content: `# End-to-End Encryption in the Browser: A Practical Guide

## Introduction

Building privacy-focused web applications requires proper encryption. In this guide, I'll show you how to implement end-to-end encryption using the WebCrypto API with BookmarkForge as an example.

## WebCrypto API

The WebCrypto API provides:
- AES-GCM encryption
- RSA encryption
- Key derivation
- Hash functions

## AES-256-GCM Encryption

\`\`\`javascript
async function encrypt(data, key) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const algorithm = { name: 'AES-GCM', iv };
  const encrypted = await crypto.subtle.encrypt(
    algorithm,
    key,
    data
  );
  return { iv, encrypted };
}
\`\`\`

## Key Derivation with Argon2id

Argon2id is the recommended key derivation function for passwords.

## Password Buffer Zeroization

Never leave password strings in memory. Always zeroize buffers after use.

## Conclusion

Browser encryption is powerful but requires careful implementation. Follow these guidelines to build secure applications.

## Resources

- [WebCrypto API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API)
- [BookmarkForge](https://bookmarkforgeapp.com)
- [GitHub](https://github.com/bookmarkforge/bookmarkforge-2026)

---

Check out BookmarkForge: https://bookmarkforgeapp.com
GitHub: https://github.com/bookmarkforge/bookmarkforge-2026

#webdev #javascript #security #tutorial`,
    tags: ['webdev', 'javascript', 'security', 'tutorial'],
    publishUrl: 'https://dev.to/new',
    status: 'ready-to-publish',
    createdAt: new Date().toISOString(),
  };
}

/**
 * Generate Reddit post
 */
function generateRedditPost(community) {
  const templates = {
    'r/privacy': {
      title: 'I built a local-first bookmark manager with end-to-end encryption',
      body: `## Introduction

I've been frustrated with cloud-based bookmark managers. They store your data on servers, require internet, and most don't encrypt your bookmarks.

So I built **BookmarkForge** - a local-first, privacy-preserving bookmark manager.

## Features

- **Local-first**: Your data stays on your device
- **End-to-end encryption**: AES-256-GCM + Argon2id
- **Open source**: MIT-licensed core
- **Offline support**: Works without internet
- **P2P sync**: Direct device-to-device synchronization

## Privacy by Design

- Master password never leaves your device
- Encryption keys derived with Argon2id
- Zero-knowledge architecture
- No tracking or analytics

## Tech Stack

- React 19 + TypeScript
- RxDB 17 (local database)
- IndexedDB (browser storage)
- WebCrypto (encryption)
- WebRTC (P2P sync)

## Why It Matters

Most bookmark managers store your data in plaintext on cloud servers. This is a privacy risk:
- Data breaches
- Data mining
- Government requests
- Vendor lock-in

BookmarkForge flips this: your data is encrypted and stays on your device.

## Feedback Welcome

I'd love feedback from this community:
- Is this something you'd use?
- What privacy features are most important?
- Any security concerns?

Check it out: https://bookmarkforgeapp.com
GitHub: https://github.com/bookmarkforge/bookmarkforge-2026`,
    },
    'r/selfhosted': {
      title: '[Show & Tell] Self-hosted local-first bookmark manager (BookmarkForge)',
      body: `## Overview

I built a self-hostable bookmark manager that keeps data encrypted and local. It can run entirely on your own infrastructure.

## Self-Hosting Setup

BookmarkForge is a Progressive Web App (PWA):
- Runs on any web server (Nginx, Apache, Caddy)
- No backend required (client-side encryption)
- Uses IndexedDB for storage
- Optional companion server for P2P signaling

## Architecture

- **Client**: React 19 SPA
- **Storage**: IndexedDB (encrypted)
- **Sync**: WebRTC P2P (optional)
- **Signaling**: Minimal WebSocket server (optional)

## Privacy Features

- All data encrypted on device
- Master password never leaves device
- No cloud dependency
- Works offline
- P2P sync without cloud relay

## Tech Stack

- React 19 + TypeScript
- RxDB 17 (local database)
- WebCrypto (AES-256-GCM + Argon2id)
- WebRTC (P2P sync)

## Questions for the Community

- Would you self-host this?
- What would you add for self-hosting?
- Any security concerns?

Check it out: https://bookmarkforgeapp.com
GitHub: https://github.com/bookmarkforge/bookmarkforge-2026`,
    },
    'r/webdev': {
      title: '[Open Source] I built a local-first bookmark manager with React 19 and RxDB',
      body: `## The Project

I built **BookmarkForge** - a local-first, encrypted bookmark manager using modern web technologies.

## Tech Stack

### Frontend
- **React 19** - Latest React with concurrent features
- **TypeScript** - Type safety
- **Vite 8** - Fast build tool
- **Tailwind CSS** - Styling

### Database
- **RxDB 17** - Local database with sync
- **IndexedDB** - Browser storage
- **Replication** - P2P sync via WebRTC

### Security
- **WebCrypto API** - Native browser crypto
- **AES-256-GCM** - Encryption algorithm
- **Argon2id** - Key derivation
- **Zeroization** - Password buffer cleanup

## Key Features

### 1. Local Database with RxDB

\`\`\`typescript
const db = await createRxDatabase({
  name: 'bookmarkforge',
  storage: getRxStorageIndexedDB(),
});
\`\`\`

### 2. End-to-End Encryption

\`\`\`typescript
async function encrypt(data, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(password, salt);
  const encrypted = await encryptWithAES(data, key);
  return { salt, encrypted };
}
\`\`\`

### 3. P2P Sync with WebRTC

\`\`\`typescript
const dataChannel = peerConnection.createDataChannel('sync');
dataChannel.onmessage = (event) => {
  const syncData = JSON.parse(event.data);
  applySyncData(syncData);
};
\`\`\`

## Open Source

- **License**: MIT (core)
- **GitHub**: bookmarkforge/bookmarkforge-2026
- **Contributions**: Welcome
- **Issues**: Open

## Feedback

I'd love feedback from the webdev community:
- Architecture choices
- Code quality
- Performance
- Security

Check it out: https://bookmarkforgeapp.com
GitHub: https://github.com/bookmarkforge/bookmarkforge-2026`,
    },
    'r/DataHoarder': {
      title: 'How I organize my bookmarks with a local-first encrypted manager',
      body: `## The Problem

As a data hoarder, I have thousands of bookmarks. My previous bookmark manager:
- Stored data in cloud (privacy risk)
- Had terrible organization tools
- No encryption
- Required internet

## The Solution

I built **BookmarkForge** - a local-first, encrypted bookmark manager.

## Organization Features

### Tagging System
- Multi-tag support
- Tag hierarchies
- Smart tags (auto-tag based on URL domain)

### Folders
- Nested folders
- Drag-and-drop organization
- Search across folders

### AI Search
- Semantic search across bookmarks
- Natural language queries
- Powered by local LLMs (Ollama) or your own API keys

## Encryption & Privacy

- AES-256-GCM encryption
- Argon2id key derivation
- Master password never leaves device
- Zero-knowledge architecture

## Storage

- IndexedDB (browser storage)
- Encrypted by default
- Export as JSON backup
- Import from other managers

## Questions

How do you organize your bookmarks? What tools do you use?

Check it out: https://bookmarkforgeapp.com
GitHub: https://github.com/bookmarkforge/bookmarkforge-2026`,
    },
  };

  const template = templates[community];
  if (!template) {
    return null;
  }

  return {
    platform: 'reddit',
    community,
    type: 'post',
    title: template.title,
    body: template.body,
    publishUrl: `https://reddit.com/r/${community.replace('r/', '')}/submit`,
    status: 'ready-to-post',
    createdAt: new Date().toISOString(),
  };
}

/**
 * Generate email outreach
 */
function generateEmailOutreach(type, recipient = '[Name]') {
  const templates = {
    privacyInfluencer: {
      subject: 'Free Pro License: Privacy-First Bookmark Manager for Your Audience',
      body: `Hi ${recipient},

I've been following your content on privacy and data sovereignty. I think your audience would be interested in BookmarkForge, a local-first, privacy-preserving bookmark manager I've been working on.

**What is BookmarkForge?**
- Local-first: Your data stays on your device
- End-to-end encryption: AES-256-GCM + Argon2id
- Open source: MIT-licensed core
- No account required: Works offline

I'd love to send you a free Pro license to try it out. Would you be interested in reviewing it or mentioning it in your content?

Best regards,
[Your Name]
Creator of BookmarkForge
https://bookmarkforgeapp.com`,
    },
    openSourceMaintainer: {
      subject: 'Potential Collaboration: Local-First Bookmark Manager',
      body: `Hi ${recipient},

I'm the maintainer of BookmarkForge, a local-first bookmark manager with end-to-end encryption. I've been following your work and think there might be synergy between our projects.

**Potential collaboration:**
- Cross-promotion: Mention each other's projects
- Integration ideas
- Shared users: Our communities overlap significantly

Would you be open to discussing a collaboration? I'm happy to provide details about our architecture and design decisions.

Best regards,
[Your Name]
Creator of BookmarkForge
https://bookmarkforgeapp.com`,
    },
  };

  const template = templates[type];
  if (!template) {
    return null;
  }

  return {
    platform: 'email',
    type: 'outreach',
    templateType: type,
    recipient,
    subject: template.subject,
    body: template.body,
    status: 'ready-to-send',
    createdAt: new Date().toISOString(),
  };
}

/**
 * Save content to file
 */
function saveContent(content, filename) {
  if (!existsSync(MARKETING_DIR)) {
    mkdirSync(MARKETING_DIR, { recursive: true });
  }

  const file = join(MARKETING_DIR, filename);
  writeFileSync(file, JSON.stringify(content, null, 2), 'utf-8');
  return file;
}

/**
 * Main execution
 */
function main() {
  try {
    console.log('=== Outreach Content Generator (Non-Interactive) ===\n');
    console.log('Marketing directory:', MARKETING_DIR);
    console.log('Directory exists:', existsSync(MARKETING_DIR));

    // Generate Dev.to article
    const devToArticle = generateDevToArticle();
    const devToFile = saveContent(devToArticle, 'outreach-dev-to.json');
    console.log(`✅ Generated Dev.to article: ${devToFile}`);
    console.log(`   Title: ${devToArticle.title}`);
    console.log(`   Publish at: ${devToArticle.publishUrl}\n`);

    // Generate Reddit posts
    const redditCommunities = ['r/privacy', 'r/selfhosted', 'r/webdev', 'r/DataHoarder'];
    redditCommunities.forEach(community => {
      const redditPost = generateRedditPost(community);
      if (redditPost) {
        const redditFile = saveContent(redditPost, `outreach-reddit-${community.replace('r/', '')}.json`);
        console.log(`✅ Generated Reddit post for ${community}: ${redditFile}`);
        console.log(`   Title: ${redditPost.title}`);
        console.log(`   Publish at: ${redditPost.publishUrl}\n`);
      }
    });

    // Generate email templates
    const privacyEmail = generateEmailOutreach('privacyInfluencer');
    const privacyEmailFile = saveContent(privacyEmail, 'outreach-email-privacy-influencer.json');
    console.log(`✅ Generated email template (Privacy Influencer): ${privacyEmailFile}`);
    console.log(`   Subject: ${privacyEmail.subject}\n`);

    const osEmail = generateEmailOutreach('openSourceMaintainer');
    const osEmailFile = saveContent(osEmail, 'outreach-email-opensource-maintainer.json');
    console.log(`✅ Generated email template (Open Source Maintainer): ${osEmailFile}`);
    console.log(`   Subject: ${osEmail.subject}\n`);

    console.log('=== Next Steps ===\n');
    console.log('1. Review the generated files in marketing/');
    console.log('2. Customize content before sending');
    console.log('3. Publish/send manually using the URLs provided');
    console.log('4. Update status in files after sending');

    console.log('\n⚠️  IMPORTANT:');
    console.log('  - Review all content before sending');
    console.log('  - Customize with recipient names and personal touches');
    console.log('  - Publish/send manually (this script only generates)');
    console.log('  - Update status from "ready-to-" to "sent" after sending');

    console.log('\n💡 Tips:');
    console.log('  - Dev.to: Post on weekday mornings, use relevant tags');
    console.log('  - Reddit: Follow community rules, engage with comments');
    console.log('  - Email: Personalize further, follow up after 1-2 weeks');

  } catch (error) {
    console.error('❌ Error:', error);
    console.error('Error stack:', error.stack);
    process.exit(1);
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { main, generateDevToArticle, generateRedditPost, generateEmailOutreach, main as default };
