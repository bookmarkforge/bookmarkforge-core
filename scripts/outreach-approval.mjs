#!/usr/bin/env node

/**
 * Outreach Approval System
 *
 * Semi-automated outreach with human approval.
 * Generates content, shows preview, requires manual confirmation.
 * Never sends automatically - user must approve and send manually.
 *
 * Usage: node scripts/outreach-approval.mjs
 *
 * Privacy: Only generates content, no automated sending.
 */

import { writeFileSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import * as readline from 'readline';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const MARKETING_DIR = join(__dirname, '..', 'marketing');

// Track outreach state
const OUTREACH_STATE_FILE = join(MARKETING_DIR, 'outreach-state.json');

/**
 * Create readline interface for user input
 */
function createReadline() {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

/**
 * Ask user for confirmation
 */
function askConfirmation(rl, question) {
  return new Promise((resolve) => {
    rl.question(`${question} (y/n): `, (answer) => {
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    });
  });
}

/**
 * Ask user for input
 */
function askInput(rl, question) {
  return new Promise((resolve) => {
    rl.question(`${question}: `, (answer) => {
      resolve(answer);
    });
  });
}

/**
 * Load outreach state
 */
function loadOutreachState() {
  if (!existsSync(OUTREACH_STATE_FILE)) {
    return {
      sent: [],
      pending: [],
      responded: [],
    };
  }
  return JSON.parse(readFileSync(OUTREACH_STATE_FILE, 'utf-8'));
}

/**
 * Save outreach state
 */
function saveOutreachState(state) {
  writeFileSync(OUTREACH_STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
}

/**
 * Generate outreach content
 */
function generateOutreachContent(platform, target, template) {
  const templates = {
    'dev.to': {
      type: 'article',
      template: `# ${template.title}

${template.content}

---

Check out BookmarkForge: https://bookmarkforgeapp.com
GitHub: https://github.com/bookmarkforge/bookmarkforge-2026

#webdev #javascript #privacy #tutorial`,
    },
    'reddit': {
      type: 'post',
      template: `${template.title}

${template.body}

---

Check it out: https://bookmarkforgeapp.com
GitHub: https://github.com/bookmarkforge/bookmarkforge-2026`,
    },
    'email': {
      type: 'email',
      template: `Subject: ${template.subject}

${template.body}

---

Best regards,
[Your Name]
BookmarkForge - https://bookmarkforgeapp.com`,
    },
  };

  return templates[platform]?.template || template;
}

/**
 * Preview content
 */
function previewContent(content) {
  console.log('\n' + '='.repeat(60));
  console.log('CONTENT PREVIEW');
  console.log('='.repeat(60));
  console.log(content);
  console.log('='.repeat(60) + '\n');
}

/**
 * Process Dev.to article
 */
async function processDevToArticle(rl, state) {
  console.log('\n=== Dev.to Article ===\n');

  const title = await askInput(rl, 'Article title (or press Enter for default: "End-to-End Encryption in the Browser")');
  const finalTitle = title || 'End-to-End Encryption in the Browser';

  const content = `# ${finalTitle}

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

#webdev #javascript #security #tutorial`;

  previewContent(content);

  const approved = await askConfirmation(rl, 'Approve this article?');

  if (approved) {
    const article = {
      platform: 'dev.to',
      type: 'article',
      title: finalTitle,
      content,
      status: 'ready-to-publish',
      createdAt: new Date().toISOString(),
    };

    state.pending.push(article);
    saveOutreachState(state);

    console.log('✅ Article marked as ready to publish');
    console.log('📝 Saved to: marketing/outreach-state.json');
    console.log('🌐 Publish manually at: https://dev.to/new');
  } else {
    console.log('❌ Article rejected. You can try again.');
  }
}

/**
 * Process Reddit post
 */
async function processRedditPost(rl, state) {
  console.log('\n=== Reddit Post ===\n');

  const communities = [
    'r/privacy',
    'r/selfhosted',
    'r/webdev',
    'r/DataHoarder',
  ];

  console.log('Available communities:');
  communities.forEach((c, i) => console.log(`  ${i + 1}. ${c}`));

  const choice = await askInput(rl, 'Select community (1-4)');
  const community = communities[parseInt(choice) - 1];

  if (!community) {
    console.log('❌ Invalid choice');
    return;
  }

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
    console.log('❌ No template for this community yet');
    return;
  }

  const content = `${template.title}

${template.body}

---

Check it out: https://bookmarkforgeapp.com
GitHub: https://github.com/bookmarkforge/bookmarkforge-2026`;

  previewContent(content);

  const approved = await askConfirmation(rl, 'Approve this post?');

  if (approved) {
    const post = {
      platform: 'reddit',
      community,
      type: 'post',
      title: template.title,
      content,
      status: 'ready-to-post',
      createdAt: new Date().toISOString(),
    };

    state.pending.push(post);
    saveOutreachState(state);

    console.log('✅ Post marked as ready to post');
    console.log('📝 Saved to: marketing/outreach-state.json');
    console.log('🌐 Post manually at: https://reddit.com/r/submit');
  } else {
    console.log('❌ Post rejected. You can try again.');
  }
}

/**
 * Process email outreach
 */
async function processEmailOutreach(rl, state) {
  console.log('\n=== Email Outreach ===\n');

  const recipient = await askInput(rl, 'Recipient name');
  const email = await askInput(rl, 'Recipient email');

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

  console.log('\nAvailable templates:');
  console.log('  1. Privacy Influencer');
  console.log('  2. Open Source Maintainer');

  const choice = await askInput(rl, 'Select template (1-2)');
  const templateKeys = ['privacyInfluencer', 'openSourceMaintainer'];
  const template = templates[templateKeys[parseInt(choice) - 1]];

  if (!template) {
    console.log('❌ Invalid choice');
    return;
  }

  const content = `Subject: ${template.subject}

${template.body}`;

  previewContent(content);

  const approved = await askConfirmation(rl, 'Approve this email?');

  if (approved) {
    const emailObj = {
      platform: 'email',
      type: 'outreach',
      recipient,
      email,
      subject: template.subject,
      content,
      status: 'ready-to-send',
      createdAt: new Date().toISOString(),
    };

    state.pending.push(emailObj);
    saveOutreachState(state);

    console.log('✅ Email marked as ready to send');
    console.log('📝 Saved to: marketing/outreach-state.json');
    console.log('📧 Send manually using your email client');
  } else {
    console.log('❌ Email rejected. You can try again.');
  }
}

/**
 * Show outreach state
 */
function showOutreachState(state) {
  console.log('\n=== Outreach State ===\n');

  console.log(`Pending (${state.pending.length}):`);
  state.pending.forEach((item, i) => {
    console.log(`  ${i + 1}. ${item.platform} - ${item.status}`);
    if (item.community) console.log(`     Community: ${item.community}`);
    if (item.title) console.log(`     Title: ${item.title}`);
    if (item.recipient) console.log(`     To: ${item.recipient}`);
  });

  console.log(`\nSent (${state.sent.length}):`);
  state.sent.forEach((item, i) => {
    console.log(`  ${i + 1}. ${item.platform} - ${item.status}`);
    if (item.community) console.log(`     Community: ${item.community}`);
  });

  console.log(`\nResponded (${state.responded.length}):`);
  state.responded.forEach((item, i) => {
    console.log(`  ${i + 1}. ${item.platform} - ${item.status}`);
  });
}

/**
 * Main execution
 */
async function main() {
  const rl = createReadline();

  try {
    console.log('=== Outreach Approval System ===\n');
    console.log('This system generates content with your approval.');
    console.log('Nothing is sent automatically - you must approve and send manually.\n');

    const state = loadOutreachState();

    while (true) {
      console.log('\n=== Menu ===\n');
      console.log('1. Create Dev.to article');
      console.log('2. Create Reddit post');
      console.log('3. Create email outreach');
      console.log('4. Show outreach state');
      console.log('5. Exit');

      const choice = await askInput(rl, 'Select option (1-5)');

      switch (choice) {
        case '1':
          await processDevToArticle(rl, state);
          break;
        case '2':
          await processRedditPost(rl, state);
          break;
        case '3':
          await processEmailOutreach(rl, state);
          break;
        case '4':
          showOutreachState(state);
          break;
        case '5':
          console.log('\n👋 Goodbye!');
          rl.close();
          return;
        default:
          console.log('❌ Invalid choice');
      }
    }
  } catch (error) {
    console.error('❌ Error:', error);
    console.error('Error stack:', error.stack);
    rl.close();
    process.exit(1);
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { main, generateOutreachContent, loadOutreachState, saveOutreachState };
