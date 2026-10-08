# User Manual — BookmarkForge v1

**Version:** 1.0.0 · **Last updated:** September 2026 · **License:** MIT

---

## 1. Introduction

BookmarkForge is a **local-first** personal knowledge application that lets you save bookmarks, take notes, organize your knowledge with interactive graphs, use AI directly in your browser, and sync between devices without relying on central servers.

**What makes BookmarkForge unique:**

- **Your bookmarks, notes, and documents live in your browser** (IndexedDB/RxDB). Vault content is not sent to BookmarkForge; if you use an external AI provider, it receives only what you explicitly send through that feature.
- **End-to-end encryption** with AES-GCM and Argon2id. Not even developers can read your vault.
- **Local AI** that works offline and without sending your data to third parties.
- **P2P sync** between your devices without central servers.
- **No subscription.** Pay once and it's yours forever.

---

## 2. Getting Started

### 2.1 Requirements

- Modern browser: Chrome, Edge, Firefox, Safari (16+)
- 8 GB RAM recommended
- Basic GPU for local AI (WebGPU)
- Internet connection (for initial setup and sync; optional for offline use)

### 2.2 Installation

1. Open [bookmarkforgeapp.com](https://bookmarkforgeapp.com)
2. Click **"Install App"** or **"Add to Home Screen"**
3. The app installs as a PWA (Progressive Web App)
4. You can also use it as a browser extension

### 2.3 Initial Setup

1. **Master password:** Minimum 12 characters. A passphrase is recommended.
   - Derives your AES-GCM key with Argon2id (KDF mandatory since ADR-019)
   - **Your password is the ONLY key.** If you lose it, there is no recovery.
2. **Recovery phrase:** Save the 24 words in a secure place.
3. **Device ID:** Generated automatically. Used to activate Pro licenses.

### 2.4 The Bookmarklet

Drag the **"Save to Forge"** button to your browser's bookmark bar. Whenever you're on a web page, click it to save it as a bookmark.

---

## 3. Core Features

### 3.1 Bookmarks

- **Virtualized list** handling 100,000+ items without lag
- **Deep Search:** searches the full text of saved pages
- **Smart Collections:** auto-organize by tag
- **Import/Export:** from Notion, Evernote, Chrome, or export as .bmf, Markdown, PDF
- **Free:** 2,500 bookmarks, smart search included, and no device cap. At 2,500 your vault remains available for reading, search, and export; only new saves pause. **Pro:** Unlimited bookmarks.

### 3.2 Note Editor

Block-based editor with:
- `/` commands for quick block insertion
- Drag and drop
- LaTeX for math
- Mermaid diagrams for charts
- Syntax highlighting for 50+ languages
- **AI Copilot** for real-time assistance

### 3.3 Knowledge Graph

Interactive 3D/2D visualization of your notes:
- Filter by tag, date, or "Connection Strength"
- Visualize semantic similarities between unrelated notes
- Explore how your ideas connect over time

### 3.4 Flashcards

- Modified Anki-style **Spaced Repetition (SRK)** algorithm
- Tracks your "forgetting curve" to show cards at the perfect moment
- Supports image occlusion and text deletion
- **Pro only**

### 3.5 Voice Commands

Voice-to-Action engine:
- Say "Hey BMF, find my Biology notes"
- Say "Save this page"
- Works 100% offline via the Web Speech API

### 3.6 Omnibar (Ctrl+K)

The brain of the application:
- Math, unit conversion
- Simultaneous bookmark and note search
- Type `>` for system commands

---

## 4. AI in BookmarkForge

### 4.1 AI with Your Own API Key (Free)

- Uses Gemini, OpenAI, Anthropic, or any compatible provider
- You pay for tokens directly to your provider
- The app dynamically routes requests to the optimal model
- **Semantic Local Cache:** similar questions use 0 API tokens

### 4.2 Local AI — WebLLM/Ollama (Pro)

- Runs complete AI models (like Llama 3.2, Qwen 2.5) directly in your browser
- Uses your GPU (WebGPU)
- **No internet connection** required
- 4-bit quantization (q4f16) runs on modest hardware
- **No token costs** and no data sent to third parties

### 4.3 RAG Chat Over Your Data (Pro)

- The AI "reads" your local notes before responding
- Answers based on your specific knowledge
- Hybrid architecture with local semantic cache
- Similar questions use 0 tokens and 0 API calls

### 4.4 Expert Agents (Pro)

- Specialized agents for different domains
- Automate complex analysis tasks

---

## 5. P2P Sync

### 5.1 Requirements

- Both devices on the same Wi-Fi network
- Firewall must allow WebRTC
- Matching sync IDs

### 5.2 Setup

1. Go to **Settings > Sync**
2. Enable "Enable P2P Sync"
3. Make sure both devices are on the same network
4. Confirm sync IDs match

### 5.3 Troubleshooting

| Problem | Solution |
|---|---|
| Sync failing | Verify both devices are on the same Wi-Fi |
| Firewall blocking WebRTC | Configure firewall to allow WebRTC |
| Sync IDs don't match | Restart the Sync Room |
| Slow connection | Check network latency |

---

## 6. Security and Privacy

### 6.1 Encryption

- **AES-GCM** with keys derived by **Argon2id** (version 4)
- Keys are never stored in plain text
- Derived on-the-fly and exist only in memory (RAM)
- Uses the native SubtleCrypto API of the browser

### 6.2 Master Password

- Minimum 12 characters
- No "Forgot password" feature exists
- Your password is the ONLY key
- If you lose it, **we cannot help you**
- Always save a .bmf backup in a secure location

### 6.3 Recovery

- Export your vault as a `.bmf` file at any time
- Format: Encrypted JSON with your master key
- Store it securely (USB, external drive, encrypted cloud)
- To restore: go to **Settings > Restore** and select your .bmf file
- Restoration requires your master password

### 6.4 Privacy Policy

- **Zero-knowledge:** developers have zero knowledge of your keys or data
- No Google Analytics, no telemetry, no tracking pixels
- No central servers storing your data
- GDPR by design
- The license server validates your license without accessing your vault

### 6.5 License Validation

- Pro license is validated locally after an initial handshake
- No constant tracking
- License proof signed with RSA-PSS (SHA-256, salt 32)
- Re-validation every 48 hours when connected
- Proofs older than 30 days are rejected by the entitlement server

---

## 7. Free vs Pro

### 7.1 Feature Comparison

| Feature | Free | Pro |
|---|---|--- |
| Price | $0 | $79 (lifetime) |
| Bookmarks | 2,500 | Unlimited |
| Devices | No cap (each device has its own vault) | Up to 5 + P2P sync |
| AI with own API key | ✅ | ✅ |
| Local AI (WebLLM/Ollama) | ❌ | ✅ |
| RAG chat over your data | ❌ | ✅ |
| Flashcards + PDF/OCR | ❌ | ✅ |
| Advanced export (10+ formats) | ❌ | ✅ |
| Local vault encryption (AES-GCM) | ✅ | ✅ |
| Support | Community | Email 48h |
| v2/v3 discounts | ❌ | 60% off |

### 7.2 How to Upgrade to Pro

1. Go to **Settings > Subscription**
2. Click **"Get Pro Lifetime"**
3. You'll be redirected to Whop for payment
4. After purchase, the app activates automatically
5. The license is validated by the server and signed locally

**Early Bird:** First 200 buyers pay $59 (sold out or until 2026-12-31). Regular price is $79.

### 7.3 Future Updates (v2, v3)

- v1 owners pay a **60% discount** on future major versions
- v2 for new customers: $89. v2 for v1 owners: $35
- v3 for new customers: $99. v3 for v1 owners: $39
- v1 owners **keep v1 functional forever**

---

## 8. Import and Export

### Pocket migration

Pocket HTML exports (`ril_export.html`) and Pocket-shaped CSV files are detected automatically. Before committing, the app previews links, dates, and tags. Read/archive status is preserved; if Free reaches its limit, the result reports how many items were imported and that the limit was reached instead of counting the remainder as skipped.


### 8.1 Import

Go to **Settings > Import**:
- **HTML/JSON from Notion or Evernote**
- **Chrome bookmark export**
- **.bmf backup**

### 8.2 Export

- **.bmf:** Complete encrypted backup
- **Markdown:** Notes in readable format
- **PDF:** Export notes as PDF documents
- **JSON:** Structured data

### 8.3 Backup and Restore

- Regularly export your vault as .bmf
- Store it in a secure location
- To restore: go to **Settings > Restore** and select your .bmf file
- Restoration requires your master password

---

## 9. Troubleshooting

### 9.1 App Won't Load

1. Clear browser cache
2. Update Chrome/Edge to the latest version
3. Check if your disk is full
4. Disable conflicting extensions (ad blockers sometimes block IndexedDB)

### 9.2 Sync Failing

1. Verify both devices are on the same Wi-Fi
2. Check that the firewall allows WebRTC
3. Confirm sync IDs match
4. Restart the Sync Room if needed

### 9.3 AI Hallucinates

1. AI can make mistakes — use the "Sources" links in Chat to verify
2. Adjust "Temperature" in AI Settings
3. If using local AI, verify the model is loaded correctly

### 9.4 Extensions Not Saving

1. Update the page you're trying to save
2. Make sure you're logged into BookmarkForge in another tab
3. Reinstall the bookmarklet

### 9.5 Slow Performance

1. Go to Settings > Advanced and run "Database Optimization"
2. Check System Diagnostics for CPU usage
3. Virtualization handles large lists, but heavy notes can affect RAM

### 9.6 Database Corrupted

1. Use "System Diagnostics" to check integrity
2. If corrupted, restore from your last .bmf backup

### 9.7 Pro License Not Working

1. Verify your internet connection works (periodic validation needed)
2. Try re-validating in **Settings > License > Re-validate**
3. If the problem persists, contact **bookmarkforge@proton.me**
4. Refundable within 30 days via Whop

### 9.8 License Error: SIGNING_KEY_INVALID

This indicates the server is not properly configured. It's not a user issue. Contact support.

---

## 10. Advanced Configuration

For advanced deployment, self-hosting, and server API configuration,
refer to internal documentation or contact support.

> License validation is performed exclusively on the server.
> BookmarkForge requires a valid license to access Pro features.

---

## 11. FAQ

**Is it free?**
The main application is local-first and free. Advanced AI features and P2P sync require a Pro license.

**Can I use it on mobile?**
Yes. Install it as a PWA via Chrome (Android) or Safari (iOS). Supports offline access and push notifications.

**Where are my files?**
Inside browser storage (IndexedDB). You can export them as .bmf, Markdown, or PDF at any time.

**Does it work offline?**
100%. All features (Editor, Bookmarks, Graph, Local AI, Search) work without internet.

**Does it consume many API tokens?**
No. The app uses a Semantic Local Cache. If you ask variations of the same question, it uses 0 API tokens.

**Battery consumption?**
Local AI uses WebGPU. On laptops, it may consume battery faster. Disable local AI in settings to conserve battery.

---

## 12. Support

| Tier | Channel | Response Time |
|---|---|---|
| **Free** | Community — Docs + /help + GitHub Discussions | Best effort |
| **Pro** | Email — bookmarkforge@proton.me | 48h (business days) |

**Security note:** Your vault is encrypted. We cannot see your data. Lost password = lost data. Support will never ask for your password or recovery phrase.

---

## 13. Legal

- **Code license:** MIT-or-later
- **Trademark:** BookmarkForge and its marks are protected (see `TRADEMARKS.md`)
- **Pricing:** Frozen in `docs/pricing-decision.md`. All prices are lifetime version 1.
- **Refunds:** 30 days via Whop. Full refund policy.
- **Privacy:** See `docs/ROPA.md` for the personal data processing record under GDPR.

---

*Last updated: September 2026 · Version 1.0.0*