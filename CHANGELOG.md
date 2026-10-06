# Changelog

All notable changes to BookmarkForge Core will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Open Core MIT export from private repository
- MIT-licensed Core with essential features
- Placeholder files for Pro modules (WebRTC, PDF, Backup, AI Pro)

### Changed
- Removed Pro code and proprietary components
- Removed audit and monitoring scripts
- Removed security regression tests
- Removed human-like testing suite
- Simplified CI workflow for Core-only functionality

### Removed
- Pro services: WebRTCSyncService, pdfService, BackupService, DiskBackupService
- Pro AI services: FlashcardService, GlobalRAGService, SpecializedAgentsService, WebLLMService
- Audit and monitoring scripts and services
- Production monitoring and proxy utilities
- Private documentation (SECURITY_CHAMPIONS.md, security.md)
- SAST workflow (disabled - requires GitHub Pro)

### Security
- Core contains only MIT-licensed code
- No proprietary code in public repository
- All security checks focus on Core functionality

## [1.0.0] - 2026-10-06

### Added
- Initial public Core MIT release
- Local-first encrypted knowledge vault
- End-to-end encryption (AES-GCM + Argon2id)
- Multi-provider AI integration (BYOK)
- PWA support with browser extensions
- 30 language support
- Smart search with Fuse.js + semantic embeddings
- Core bookmark and note management

### Security
- Zero-knowledge vault design
- Client-side cryptography in Web Workers
- Encrypted backup support (Core API)
- BYO AI keys (provider keys stored encrypted in vault)

### Architecture
- React 19 + TypeScript + Vite 8
- RxDB 17 for IndexedDB persistence
- WebCrypto for cryptographic operations
- Progressive Web App with Service Worker
- Companion server for licensing and signaling (Pro)

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
