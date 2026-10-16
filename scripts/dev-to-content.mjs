#!/usr/bin/env node

/**
 * Dev.to Content Automation
 *
 * Automates content publishing to Dev.to for developer engagement.
 * Uses Dev.to API for publishing articles about BookmarkForge.
 *
 * Usage: node scripts/dev-to-content.mjs
 *
 * Privacy: Only posts content you explicitly provide.
 * Requires DEV_API_KEY in environment.
 */

import { writeFileSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const MARKETING_DIR = join(__dirname, '..', 'marketing');

/**
 * Dev.to article template
 */
function generateDevToArticle(articleData) {
  const {
    title,
    description,
    content,
    tags,
    coverImage,
    published = false,
  } = articleData;

  return {
    platform: 'Dev.to',
    title,
    description,
    content,
    tags,
    coverImage,
    published,
    publishedAt: published ? new Date().toISOString() : null,
  };
}

/**
 * Generate technical article about BookmarkForge
 */
function generateTechnicalArticle(topic) {
  const articles = {
    'local-first-architecture': {
      title: 'Building a Local-First Bookmark Manager with React and RxDB',
      description: 'How we built BookmarkForge with local-first architecture, end-to-end encryption, and offline support.',
      tags: ['react', 'local-first', 'rxdb', 'web-development', 'privacy'],
      content: `# Building a Local-First Bookmark Manager with React and RxDB

## Introduction

BookmarkForge is a privacy-first bookmark manager that keeps your data encrypted and local. In this article, I'll share how we built it using local-first architecture.

## Why Local-First?

Traditional bookmark managers store your data in the cloud. This means:
- Your data is vulnerable to breaches
- You depend on internet connectivity
- You don't control your data

Local-first architecture flips this:
- Your data stays on your device
- Works offline
- You own your data
- Optional cloud sync with encryption

## Tech Stack

- **React 19** - UI framework
- **RxDB 17** - Local database with sync
- **IndexedDB** - Browser storage
- **WebCrypto** - Encryption (AES-256-GCM + Argon2id)
- **WebRTC** - P2P sync

## Implementation

### 1. Local Database with RxDB

\`\`\`typescript
const db = await createRxDatabase({
  name: 'bookmarkforge',
  storage: getRxStorageIndexedDB(),
});

const bookmarksCollection = await db.addCollections({
  bookmarks: {
    schema: bookmarkSchema,
  },
});
\`\`\`

### 2. End-to-End Encryption

\`\`\`typescript
async function encryptBookmark(bookmark, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(password, salt);
  const encrypted = await encryptWithAES(bookmark, key);
  return { salt, encrypted };
}
\`\`\`

### 3. Offline Support

RxDB handles offline automatically:
- Queues operations when offline
- Syncs when connection returns
- Conflict resolution built-in

## Privacy by Design

- Master password never leaves your device
- Encryption keys derived with Argon2id
- Zero-knowledge architecture
- No tracking or analytics

## Conclusion

Local-first architecture is the future of privacy-conscious applications. Start building today!

## Resources

- [BookmarkForge GitHub](https://github.com/bookmarkforge/bookmarkforge-2026)
- [Try BookmarkForge](https://bookmarkforgeapp.com)
- [RxDB Documentation](https://rxdb.info/)
`,
    },
    'privacy-encryption': {
      title: 'End-to-End Encryption in the Browser: A Practical Guide',
      description: 'How to implement secure encryption in web applications using WebCrypto API.',
      tags: ['websecurity', 'cryptography', 'javascript', 'privacy', 'webdev'],
      content: `# End-to-End Encryption in the Browser: A Practical Guide

## Introduction

Building privacy-focused web applications requires proper encryption. In this guide, I'll show you how to implement end-to-end encryption using the WebCrypto API.

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

Argon2id is the recommended key derivation function:

\`\`\`javascript
async function deriveKey(password, salt) {
  // Use WebAssembly Argon2id implementation
  const hash = await argon2id.hash({
    pass: password,
    salt: salt,
    hashLen: 32,
    time: 3,
    mem: 65536,
    parallelism: 4,
  });
  return crypto.subtle.importKey(
    'raw',
    hash,
    'AES-GCM',
    false,
    ['encrypt', 'decrypt']
  );
}
\`\`\`

## Password Buffer Zeroization

Never leave password strings in memory:

\`\`\`javascript
function zeroPasswordBuffer(buffer) {
  buffer.fill(0);
  for (let i = 0; i < buffer.length; i++) {
    buffer[i] ^= 0xAA;
  }
  buffer.fill(0);
}
\`\`\`

## Putting It Together

1. User enters password (as bytes)
2. Derive encryption key with Argon2id
3. Encrypt data with AES-256-GCM
4. Zeroize password buffer
5. Store encrypted data locally

## Security Best Practices

- Never log passwords
- Zeroize sensitive buffers
- Use random IVs
- Use authenticated encryption (GCM)
- Verify authentication tags

## Conclusion

Browser encryption is powerful but requires careful implementation. Follow these guidelines to build secure applications.

## Resources

- [WebCrypto API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API)
- [BookmarkForge](https://bookmarkforgeapp.com)
`,
    },
    'p2p-sync': {
      title: 'Building P2P Sync Without Cloud Storage',
      description: 'How to implement peer-to-peer synchronization using WebRTC without relying on cloud servers.',
      tags: ['webrtc', 'p2p', 'sync', 'web-development', 'privacy'],
      content: `# Building P2P Sync Without Cloud Storage

## Introduction

Traditional sync requires cloud servers. What if we could sync directly between devices? WebRTC makes this possible.

## WebRTC for P2P Sync

WebRTC provides:
- Direct device-to-device communication
- Encrypted data channels
- NAT traversal (ICE)
- Browser support

## Implementation

### 1. Signaling Server

\`\`\`javascript
// Minimal signaling for connection establishment
const signaling = new WebSocket('wss://your-signaling-server');

signaling.onmessage = async (event) => {
  const { type, data } = JSON.parse(event.data);
  if (type === 'offer') {
    await peerConnection.setRemoteDescription(data);
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    signaling.send(JSON.stringify({ type: 'answer', data: answer }));
  }
};
\`\`\`

### 2. Data Channel

\`\`\`javascript
const dataChannel = peerConnection.createDataChannel('sync');

dataChannel.onmessage = (event) => {
  const syncData = JSON.parse(event.data);
  applySyncData(syncData);
};

function sendSyncData(data) {
  dataChannel.send(JSON.stringify(data));
}
\`\`\`

### 3. Conflict Resolution

\`\`\`javascript
function resolveConflicts(local, remote) {
  // Last-write-wins with timestamp
  if (remote.timestamp > local.timestamp) {
    return remote;
  }
  return local;
}
\`\`\`

## Benefits

- No cloud dependency
- Lower latency
- Privacy (data doesn't transit through servers)
- Cost savings

## Challenges

- Both devices must be online
- NAT traversal can fail
- Requires signaling server (minimal)
- More complex than cloud sync

## Real-World Use Case

BookmarkForge uses P2P sync for:
- Bookmark synchronization
- Settings sync
- Encryption key sharing

## Conclusion

P2P sync is feasible with WebRTC. It's ideal for privacy-focused applications.

## Resources

- [WebRTC Guide](https://webrtc.org/)
- [BookmarkForge](https://bookmarkforgeapp.com)
`,
    },
  };

  return articles[topic] || articles['local-first-architecture'];
}

/**
 * Save article to file
 */
function saveArticle(article, filename) {
  if (!existsSync(MARKETING_DIR)) {
    mkdirSync(MARKETING_DIR, { recursive: true });
  }

  const articleFile = join(MARKETING_DIR, filename);
  writeFileSync(articleFile, JSON.stringify(article, null, 2), 'utf-8');
  return articleFile;
}

/**
 * Main execution
 */
function main() {
  try {
    console.log('=== Dev.to Content Generator ===\n');

    // Generate example articles
    const localFirstArticle = generateTechnicalArticle('local-first-architecture');
    console.log('Generated article:', localFirstArticle.title);

    const encryptionArticle = generateTechnicalArticle('privacy-encryption');
    console.log('Generated article:', encryptionArticle.title);

    const p2pArticle = generateTechnicalArticle('p2p-sync');
    console.log('Generated article:', p2pArticle.title);

    // Save articles
    const localFirstFile = saveArticle(localFirstArticle, 'dev-to-local-first.json');
    console.log(`✅ Saved article: ${localFirstFile}`);

    const encryptionFile = saveArticle(encryptionArticle, 'dev-to-encryption.json');
    console.log(`✅ Saved article: ${encryptionFile}`);

    const p2pFile = saveArticle(p2pArticle, 'dev-to-p2p-sync.json');
    console.log(`✅ Saved article: ${p2pFile}`);

    console.log('\n=== Available Articles ===\n');
    console.log('1. local-first-architecture: Local-first architecture with RxDB');
    console.log('2. privacy-encryption: End-to-end encryption with WebCrypto');
    console.log('3. p2p-sync: P2P sync with WebRTC');

    console.log('\n=== How to Publish ===\n');
    console.log('1. Get DEV_API_KEY from https://dev.to/settings/account');
    console.log('2. Set environment variable: export DEV_API_KEY=your_key');
    console.log('3. Edit the generated JSON files to customize');
    console.log('4. Use the content-syndication script to publish');
    console.log('   npm run marketing:syndicate');

    console.log('\n⚠️  IMPORTANT:');
    console.log('  - Customize articles before publishing');
    console.log('  - Add your personal experience and insights');
    console.log('  - Include code examples specific to your use case');
    console.log('  - Respond to comments after publishing');

    console.log('\n💡 Tips for Dev.to:');
    console.log('  - Post on weekday mornings for visibility');
    console.log('  - Use relevant tags (max 4)');
    console.log('  - Include code blocks with syntax highlighting');
    console.log('  - Add cover image (1280x720 minimum)');
    console.log('  - Engage with comments quickly');

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

export { main, generateDevToArticle, generateTechnicalArticle };
