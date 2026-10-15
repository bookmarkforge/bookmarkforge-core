# BookmarkForge Directory Submission

## Technical Summary

BookmarkForge is a local-first, privacy-preserving bookmark manager and AI-powered knowledge vault built as a Progressive Web Application (PWA). The application runs entirely client-side with end-to-end encryption, requiring no account registration and storing all data locally on the user's device.

## Architecture

### Encryption and Key Management
- **Algorithm**: AES-256-GCM for data encryption
- **Key Derivation**: Argon2id (memory-hard KDF) for master password protection
- **Key Format**:
  - V5 (current): `v5:<base64(hkdf_salt+iv+ciphertext)>` - HKDF-SHA256 per operation (~1000× faster than V4)
  - V4 (legacy): `v4:<base64(salt+iv+ciphertext)>` - Argon2id per operation
- **Salt Management**: Per-vault Argon2id salt (32 hex chars) stored in vault metadata, re-provisioned on each unlock
- **Web Worker Isolation**: All KDF and encryption operations run in a dedicated Web Worker to prevent key material exposure on the main thread

### Storage
- **Database**: IndexedDB with RxDB 17 for reactive queries
- **Persistence**: Encrypted vault data stored locally in IndexedDB
- **Session Keys**: HKDF-derived session keys cached per vault session for performance
- **Zeroization**: Double-fill zeroization with XOR guard (fill(0) → XOR 0xAA → fill(0)) to defeat compiler elision

### AI/LLM Integration
- **BYOK (Bring Your Own Key)**: User-managed AI provider keys stored encrypted in the vault
- **Provider Support**: OpenAI-compatible providers, WebLLM for local inference
- **No Server-Side Processing**: AI requests are made directly from the browser to the user's chosen provider; the companion server never sees the keys or the prompts

### Deployment
- **Platform**: Vercel (hosting)
- **Type**: Static PWA with optional Node.js companion server for P2P signaling
- **Authentication**: No external authentication; local-first password-based vault unlock
- **Network**: Offline-capable with background sync (WebRTC) for multi-device synchronization

## Privacy Justification

### Client-Side Encryption
All user data is encrypted on the client before storage. The companion server on Vercel serves only static assets and provides WebRTC signaling for peer-to-peer synchronization. The server:
- Never sees the user's master password
- Never sees the derived encryption keys
- Never processes AI requests or prompts
- Never has access to encrypted vault data

### No-Registration Model
The application requires no account creation. Users set a local password to encrypt their vault, and the entire application state is stored locally in IndexedDB. This eliminates:
- User tracking through account databases
- Centralized data collection
- Dependency on third-party authentication providers

### BYOK for AI
AI provider keys are stored encrypted in the user's local vault. When the application makes AI requests, it:
- Decrypts the provider key locally
- Makes the request directly to the AI provider from the browser
- Never exposes the key to the companion server or any intermediary

### Open Source
The core application is MIT-licensed and available at https://github.com/bookmarkforge/bookmarkforge-core. Users can:
- Audit the source code
- Self-host the application
- Verify the encryption implementation
- Run local builds without telemetry

## Metadata

- **Repository**: https://github.com/bookmarkforge/bookmarkforge-core
- **Website**: https://bookmarkforgeapp.com
- **License**: MIT
- **Technology Stack**: React 19, TypeScript, Vite 8, RxDB 17, IndexedDB, WebCrypto API
- **Platform**: Web PWA (installable on desktop and mobile)
