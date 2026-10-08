# Privacy Policy — BookmarkForge

**Last updated:** 2026-09-26
**Version:** 1.0.0
**Data Controller:** Leonardo
**Contact:** bookmarkforge@proton.me

---

## Summary

BookmarkForge is a local-first personal knowledge application. **Your data is stored on your device, encrypted, and never leaves it.** This policy explains exactly what data we collect (very little), how we use it, and your rights.

---

## 1. Information We DO NOT Collect

BookmarkForge **DOES NOT collect**:

- ❌ Your vault content (bookmarks, notes, PDFs)
- ❌ Master password or recovery phrase
- ❌ Browsing data or bookmark history
- ❌ Physical location
- ❌ Personal identity (name, email, phone)
- ❌ Banking or payment data (handled by Whop)
- ❌ IP address
- ❌ Any vault data without your explicit consent

---

## 2. Information We Collect

### 2.1 Local Data (Your Device)

This data **remains exclusively on your device**:

| Data | Purpose | Storage |
|------|---------|---------|
| Bookmarks and notes | Core functionality | Encrypted IndexedDB |
| Encryption keys | Vault security | Web Workers / localStorage (encrypted) |
| App settings | User preferences | IndexedDB |
| Session history | UX (undo, redo) | IndexedDB |

### 2.2 Data Transmitted to Server (Voluntary)

When you connect to the BookmarkForge server:

| Data | Purpose | Transmission |
|------|---------|--------------|
| Device ID (hash) | License verification | HTTPS, TLS encrypted |
| License status (pro/free) | Feature activation | HTTPS |
| IP (hashed) | Rate limiting, security | SHA-256 hashed |

**No vault content is transmitted to the server.**

### 2.3 Telemetry (OPT-IN, not default)

If you choose to enable telemetry:

| Data | Purpose | Retention |
|------|---------|-----------|
| Event type (no content) | Aggregate usage analysis | 30 days |
| DAU/WAU/MAU counts | Business metrics | Anonymized |
| App version | Bug detection | Aggregated |
| Country (IP-based) | Geographic distribution | Anonymized |

**You can disable telemetry at any time in Settings → Privacy → Telemetry.**

---

## 3. Cookies and Similar Technologies

The BookmarkForge server uses strictly necessary cookies:

- **Authentication session**: to keep your session active
- **Rate limiting**: to prevent abuse
- **CSP report**: for security (no personal data)

We do not use marketing, advertising, or third-party tracking cookies.

---

## 4. Sharing Data with Third Parties

### 4.1 Whop.com (Payments)

When you purchase a license:
- Whop handles your name, email, and payment method
- BookmarkForge receives only: your Order ID and license status (pro/free)
- Whop is responsible for its own privacy policy

### 4.2 Sentry (Error Reporting)

If error reporting is enabled (opt-in):
- Only technical errors are sent, **without vault content**
- URLs without query parameters
- Secrets redacted
- Hashed IP
- Requires your active consent

### 4.3 Hosting Providers

If you use the self-hosted server:
- The hosting provider (VPS, Docker, etc.) may have temporary connection logs
- These logs **do not** contain vault content
- IPs are hashed on the server

### 4.4 AI Providers (BYO Key)

- AI provider calls are made **directly from your browser**
- Your API key never passes through our servers
- The content you send to providers is your responsibility
- BookmarkForge **does not** see or store your prompt content

---

## 5. Your Rights (GDPR/CCPA)

### 5.1 Right of Access

You can request what personal data we have about you:
- Contact: bookmarkforge@proton.me
- Response time: <30 days

### 5.2 Right of Deletion

- **Local data**: Settings → Privacy → Delete All Data (immediate)
- **Whop data**: Contact Whop directly
- **Server logs**: Connection logs are temporary (7 days)

### 5.3 Right to Portability

- **Export your vault**: Settings → Export (JSON, Markdown, CSV, etc.)
- Your data is in open format

### 5.4 Right to Object to Telemetry

- Disable in Settings → Privacy → Telemetry (immediate)
- No consequences for disabling

### 5.5 Withdrawal of Consent

- You can withdraw any given consent at any time
- Withdrawal does not affect app functionality (only optional telemetry and analytics)

---

## 6. Data Retention

| Data type | Retention | Reason |
|-----------|-----------|--------|
| Local vault | Until you delete it | Functionality |
| Server logs | 7 days | Security, debugging |
| Telemetry | 30 days | Aggregate analysis |
| Backup .bmf | Indefinite (your responsibility) | Recovery |
| License status | While your license is active | Verification |
| Hashed IP | 30 days | Rate limiting |

---

## 7. Security

- **Encryption**: AES-256-GCM for vault
- **KDF**: Argon2id (memory-hard, GPU-resistant)
- **TLS**: All traffic uses HTTPS/WSS
- **CSP**: Strict, with violation reports
- **Zero-knowledge**: Server cannot see your password or content
- **Audit**: Code reviewed and tested (460+ tests)

---

## 8. Contact

**For any questions about this policy:**
- Email: bookmarkforge@proton.me
- GitHub Issues: https://github.com/bookmarkforge/bookmarkforge/issues
- Documentation: https://bookmarkforgeapp.com/docs

**For GDPR requests:**
- Email: bookmarkforge@proton.me
- Response guaranteed in <30 days

---

## 9. Changes to This Policy

- We will notify significant changes by email or in-app
- You can review the current version at any time
- Change history is in the repository

---

## 10. Data Controller

**Leonardo**
**Address:** Castrelos, Vigo, España
**Email:** bookmarkforge@proton.me

This site and application are operated autonomously as an open source project.
