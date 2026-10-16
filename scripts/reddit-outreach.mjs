#!/usr/bin/env node

/**
 * Reddit Community Outreach Automation
 *
 * Automates posting to relevant Reddit communities for BookmarkForge.
 * Generates post templates and engagement suggestions.
 *
 * Usage: node scripts/reddit-outreach.mjs
 *
 * Privacy: Only posts content you explicitly provide.
 * Manual posting required to avoid spamming.
 */

import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const MARKETING_DIR = join(__dirname, '..', 'marketing');

/**
 * Reddit communities relevant to BookmarkForge
 */
const REDDIT_COMMUNITIES = {
  privacy: {
    name: 'r/privacy',
    description: 'Discussion about privacy and data sovereignty',
    rules: 'No self-promotion, provide value first',
    postType: 'Discussion post with tech details',
  },
  selfhosted: {
    name: 'r/selfhosted',
    description: 'Self-hosting and DIY tech',
    rules: 'Show your setup, explain architecture',
    postType: 'Show & Tell: Self-hosted BookmarkForge',
  },
  homelab: {
    name: 'r/homelab',
    description: 'Home server and homelab enthusiasts',
    rules: 'Share your homelab setup',
    postType: 'Show & Tell: BookmarkForge in homelab',
  },
  datahoarder: {
    name: 'r/DataHoarder',
    description: 'Data hoarding and archival',
    rules: 'Share how you organize data',
    postType: 'How I organize bookmarks with BookmarkForge',
  },
  privacytools: {
    name: 'r/privacytools',
    description: 'Privacy tools and software',
    rules: 'Review tools, provide objective info',
    postType: 'Tool review: BookmarkForge',
  },
  saas: {
    name: 'r/SaaS',
    description: 'SaaS founders and builders',
    rules: 'Share your journey, metrics, tech stack',
    postType: 'Building BookmarkForge: Local-first SaaS',
  },
  startups: {
    name: 'r/startups',
    description: 'Startup founders and entrepreneurs',
    rules: 'Share your story, lessons learned',
    postType: 'How I built a privacy-first bookmark manager',
  },
  webdev: {
    name: 'r/webdev',
    description: 'Web development',
    rules: 'Show your project, share code',
    postType: 'Open source web app: BookmarkForge',
  },
};

/**
 * Generate Reddit post template
 */
function generateRedditPost(community, postType) {
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
- **30+ languages**: Global support

## Privacy by Design

- Master password never leaves your device
- Encryption keys derived with Argon2id
- Zero-knowledge architecture
- No tracking or analytics
- Optional P2P sync (no cloud required)

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

## Docker Setup

\`\`\`dockerfile
FROM nginx:alpine
COPY dist/ /usr/share/nginx/html/
EXPOSE 80
\`\`\`

\`\`\`yaml
version: '3'
services:
  bookmarkforge:
    image: bookmarkforge
    ports:
      - "80:80"
    volumes:
      - ./config:/etc/nginx/conf.d
\`\`\`

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
    'r/homelab': {
      title: '[Homelab] Added a local-first bookmark manager to my homelab',
      body: `## What I Added

I've been running a homelab for a few years now (TrueNAS, Proxmox, various services). Recently, I needed a better bookmark manager that:
- Keeps my data private
- Works offline
- Can be self-hosted
- Has P2P sync

So I built **BookmarkForge** and added it to my homelab.

## Homelab Setup

### Hardware
- Intel NUC (16GB RAM, 512GB SSD)
- Running Proxmox

### Services
- BookmarkForge (bookmark manager)
- TrueNAS (storage)
- Nginx (reverse proxy)
- Cloudflare (DNS/SSL)

### BookmarkForge Deployment

Docker Compose:
\`\`\`yaml
version: '3'
services:
  bookmarkforge:
    image: nginx:alpine
    volumes:
      - ./bookmarkforge/dist:/usr/share/nginx/html
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.bookmarkforge.rule=Host(\`bookmarks.local\`)"
      - "traefik.http.routers.bookmarkforge.tls=true"
\`\`\`

## Why I Built It

My previous bookmark manager (Raindrop):
- Stored data in cloud
- Required internet
- Had privacy concerns
- Couldn't self-host

BookmarkForge solves all of this.

## Features

- Local-first (data on device)
- End-to-end encryption
- Self-hostable
- Offline support
- P2P sync
- Open source

## Next Steps

- Add backup integration (TrueNAS)
- Automate deployment (Ansible)
- Add monitoring (Prometheus/Grafana)

## Feedback

Any suggestions for my homelab setup? Would love to hear from the community.

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

### Bulk Operations
- Bulk tag
- Bulk move
- Bulk export

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

## Migration

Imported from:
- Raindrop
- Pocket
- Chrome/Firefox bookmarks
- JSON/CSV exports

## Data Hoarding Best Practices

### Backup Strategy
1. Local IndexedDB (encrypted)
2. JSON export (encrypted)
3. TrueNAS backup (daily)
4. Offsite backup (weekly)

### Organization Strategy
- Tag by topic, not hierarchy
- Use AI search for discovery
- Regular cleanup (monthly)
- Export frequently

## Questions

How do you organize your bookmarks? What tools do you use?

Check it out: https://bookmarkforgeapp.com
GitHub: https://github.com/bookmarkforge/bookmarkforge-2026`,
    },
    'r/privacytools': {
      title: '[Tool Review] BookmarkForge - Local-first encrypted bookmark manager',
      body: `## Overview

**BookmarkForge** is a local-first, privacy-preserving bookmark manager.

## Privacy Features

### Encryption
- **Algorithm**: AES-256-GCM
- **Key Derivation**: Argon2id (time=3, mem=64MB, parallelism=4)
- **Salt**: Random per-vault
- **Zeroization**: Password buffers zeroized after use

### Data Storage
- **Location**: IndexedDB (browser-local)
- **Encryption**: Encrypted by default
- **Cloud**: Optional P2P sync (no relay server)
- **Tracking**: None

### Access Control
- **Master Password**: Required for decryption
- **Recovery**: Optional backup phrase (encrypted)
- **Biometrics**: Optional (OS-level, not stored)

## Technical Details

### Architecture
- Local-first: Data stays on device
- Offline: Works without internet
- P2P: Direct device-to-device sync
- Open Source: MIT-licensed core

### Security
- WebCrypto API (native browser crypto)
- Domain-separated keys
- No secrets in localStorage
- No secrets in bundle

### Compliance
- GDPR-friendly (data stays local)
- No data collection
- No third-party analytics
- Open source (auditable)

## Comparison

| Feature | BookmarkForge | Raindrop | Pocket |
|---------|---------------|----------|--------|
| Local Storage | ✅ | ❌ | ❌ |
| Encryption | ✅ AES-256-GCM | ❌ | ❌ |
| Offline | ✅ | ❌ | ❌ |
| Open Source | ✅ | ❌ | ❌ |
| P2P Sync | ✅ | ❌ | ❌ |
| API Keys | Your own | Theirs | Theirs |

## Drawbacks

- Mobile app in development (web only for now)
- AI features require your own API keys
- Initial setup requires password
- No team features (planned)

## Verdict

**Recommended for privacy-conscious users** who:
- Want data to stay local
- Need offline access
- Prefer open source
- Are willing to manage their own API keys

**Not recommended if you:**
- Need mobile app
- Want cloud sync only
- Don't want to manage passwords
- Need team collaboration

## Links

- Website: https://bookmarkforgeapp.com
- GitHub: https://github.com/bookmarkforge/bookmarkforge-2026
- Privacy Policy: https://bookmarkforgeapp.com/privacy

## Questions

What privacy features are most important to you? Any concerns I should address?`,
    },
    'r/SaaS': {
      title: 'Building a local-first SaaS: Lessons from BookmarkForge',
      body: `## The Pitch

I'm building **BookmarkForge** - a local-first bookmark manager. Here's what I've learned building a local-first SaaS.

## What is Local-First?

Traditional SaaS:
- Data in cloud
- Requires internet
- Vendor lock-in
- Monthly subscription

Local-first SaaS:
- Data on device
- Works offline
- Open source
- One-time purchase (or optional sub)

## Why Local-First?

### Privacy
- GDPR-friendly
- No data collection
- User owns data
- Zero-knowledge architecture

### Economics
- Lower infrastructure costs
- No server scaling issues
- Optional subscription (Pro features)
- Customer lifetime value

### UX
- Instant (no network latency)
- Works offline
- Data ownership
- Portability

## Challenges

### Onboarding
- User must set password
- No "forgot password" (security tradeoff)
- Sync requires both devices online
- More complex than cloud-only

### Monetization
- Harder to sell recurring revenue
- Need compelling Pro features
- Open source competition
- Customer acquisition

### Support
- Can't access user data for debugging
- Debugging across devices
- Version compatibility
- Backup recovery

## Tech Stack

- **Frontend**: React 19 + TypeScript
- **Database**: RxDB 17 (IndexedDB)
- **Encryption**: WebCrypto (AES-256-GCM + Argon2id)
- **Sync**: WebRTC (P2P)
- **Build**: Vite 8

## Metrics

- **Active Users**: [Number]
- **Conversion Rate**: [Percentage]
- **Churn Rate**: [Percentage]
- **CAC**: [Cost]
- **LTV**: [Value]

## Pro Features

- Advanced AI search
- Custom themes
- Team collaboration
- Priority support
- API access

## Lessons Learned

1. **Privacy is a feature** - Users pay for privacy
2. **Open source builds trust** - More contributions, better software
3. **Offline is premium** - Instant access matters
4. **P2P is complex** - But worth it for privacy
5. **Educate users** - Local-first is new to many

## Future

- Mobile apps (React Native)
- Desktop apps (Electron/Tauri)
- More Pro features
- Enterprise version

## Questions

Any advice for local-first SaaS? What would you add?`,
    },
    'r/startups': {
      title: 'How I built a privacy-first bookmark manager with $0 in marketing',
      body: `## The Story

I built BookmarkForge - a local-first, encrypted bookmark manager. Here's how I did it with $0 marketing budget.

## The Problem

I was frustrated with bookmark managers:
- Raindrop stores data in cloud
- Pocket requires internet
- No encryption
- Privacy concerns

So I built my own.

## The Build

### Timeline
- **Month 1**: MVP (React + IndexedDB)
- **Month 2**: Encryption (WebCrypto)
- **Month 3**: P2P sync (WebRTC)
- **Month 4**: Launch

### Tech Stack
- React 19 + TypeScript
- RxDB 17
- WebCrypto
- WebRTC
- Vite 8

### Costs
- Hosting: $0 (Vercel/Netlify free tier)
- Domain: $12/year
- No other costs

## The Launch

### Day 1
- Posted to Product Hunt
- Shared on r/privacy
- Tweeted about it

### Day 1-7
- Answered comments
- Fixed bugs
- Added features

### Week 1 Results
- **Signups**: [Number]
- **Stars**: [Number]
- **Feedback**: Positive
- **Revenue**: $0 (free tier only)

## Growth (Zero Marketing)

### Organic Channels
- GitHub stars (open source)
- Reddit posts (communities)
- Dev.to articles (technical content)
- Hacker News discussions
- Word of mouth

### Content Strategy
- Write technical articles (Dev.to, Hashnode)
- Share on Reddit (relevant communities)
- Engage on Hacker News
- Build in public (Twitter/X)

### SEO
- Generate structured data (JSON-LD)
- Optimize landing pages
- Build backlinks
- Target long-tail keywords

## Monetization

### Strategy
- Free tier: Basic features
- Pro tier: Advanced features
- Open source: MIT-licensed core

### Pro Features
- AI search (local LLMs or your API keys)
- Team collaboration
- Custom themes
- Priority support
- API access

### Pricing
- Free: $0 (forever)
- Pro: $5/month or $50/year
- Team: $10/user/month

## Revenue

- **Month 1**: $0
- **Month 2**: $[Amount]
- **Month 3**: $[Amount]
- **Goal**: $[Amount]/month

## Lessons

1. **Open source helps** - More visibility, contributions
2. **Privacy sells** - People pay for privacy
3. **Community matters** - Engage authentically
4. **Quality over quantity** - Better to have fewer, dedicated users
5. **Patience** - Organic growth takes time

## Next Steps

- Mobile apps
- More Pro features
- Content marketing
- Partnerships

## Questions

What would you do differently? Any advice for zero-budget marketing?`,
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

### Architecture
- **Local-first** - Data stays on device
- **Offline** - Works without internet
- **PWA** - Installable
- **30+ languages** - i18n support

## Key Features

### 1. Local Database with RxDB

\`\`\`typescript
const db = await createRxDatabase({
  name: 'bookmarkforge',
  storage: getRxStorageIndexedDB(),
});

const bookmarks = await db.addCollections({
  bookmarks: {
    schema: bookmarkSchema,
  },
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

### 4. Offline Support

RxDB handles offline automatically:
- Queues operations when offline
- Syncs when connection returns
- Conflict resolution built-in

## Performance

- **Bundle size**: ~500KB (gzipped)
- **First paint**: <1s
- **TTI**: <2s
- **Lighthouse score**: 95+

## Open Source

- **License**: MIT (core)
- **GitHub**: bookmarkforge/bookmarkforge-2026
- **Contributions**: Welcome
- **Issues**: Open

## Challenges

1. **Browser crypto** - WebCrypto has limitations
2. **P2P sync** - NAT traversal issues
3. **Offline** - Cache invalidation
4. **Security** - Password buffer zeroization

## What I Learned

- Local-first is complex but worth it
- RxDB is powerful but has learning curve
- WebCrypto is mature but has quirks
- P2P sync requires fallback strategy

## Future Plans

- Mobile apps (React Native)
- Desktop apps (Electron/Tauri)
- More integrations
- Better performance

## Feedback

I'd love feedback from the webdev community:
- Architecture choices
- Code quality
- Performance
- Security

Check it out: https://bookmarkforgeapp.com
GitHub: https://github.com/bookmarkforge/bookmarkforge-2026`,
    },
  };

  return templates[community] || templates['r/privacy'];
}

/**
 * Save post to file
 */
function savePost(post, filename) {
  if (!existsSync(MARKETING_DIR)) {
    mkdirSync(MARKETING_DIR, { recursive: true });
  }

  const postFile = join(MARKETING_DIR, filename);
  writeFileSync(postFile, JSON.stringify(post, null, 2), 'utf-8');
  return postFile;
}

/**
 * Main execution
 */
function main() {
  try {
    console.log('=== Reddit Outreach Generator ===\n');

    const posts = [];

    // Generate posts for each community
    for (const [key, community] of Object.entries(REDDIT_COMMUNITIES)) {
      const post = generateRedditPost(community.name);
      posts.push({
        community: community.name,
        description: community.description,
        rules: community.rules,
        postType: community.postType,
        title: post.title,
        body: post.body,
      });

      const filename = `reddit-${key.replace('r/', '')}.json`;
      const postFile = savePost(post, filename);
      console.log(`✅ Saved post for ${community.name}: ${postFile}`);
    }

    console.log('\n=== Communities Targeted ===\n');
    Object.entries(REDDIT_COMMUNITIES).forEach(([key, community]) => {
      console.log(`- ${community.name}: ${community.description}`);
    });

    console.log('\n=== How to Post ===\n');
    console.log('1. Review each community\'s rules before posting');
    console.log('2. Customize the post for each community');
    console.log('3. Post manually (not automated to avoid spamming)');
    console.log('4. Engage with comments after posting');
    console.log('5. Follow up on feedback');

    console.log('\n⚠️  IMPORTANT:');
    console.log('  - DO NOT spam communities');
    console.log('  - Post manually, not automated');
    console.log('  - Follow each community\'s rules');
    console.log('  - Provide value, don\'t just self-promote');
    console.log('  - Engage authentically with comments');

    console.log('\n💡 Reddit Best Practices:');
    console.log('  - Post at optimal times (morning US time)');
    console.log('  - Respond to all comments');
    console.log('  - Be humble and open to feedback');
    console.log('  - Don\'t post to too many communities at once');
    console.log('  - Use flairs when available');

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

export { main, generateRedditPost, REDDIT_COMMUNITIES };
