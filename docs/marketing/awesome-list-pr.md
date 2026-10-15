# Awesome List Pull Request Template

## Suggested PR Title
Add BookmarkForge (local-first encrypted bookmark manager with AI)

## Entry to Add (alphabetical order)
`- [BookmarkForge](https://bookmarkforgeapp.com) - Local-first bookmark manager with AES-256-GCM encryption, Argon2id KDF, and BYOK AI integration; PWA with offline support, no account registration required`

## Justification for Maintainer
BookmarkForge provides a practical implementation of data sovereignty principles in a common use case (bookmark management). The project:

1. **Demonstrates BYOK Architecture**: Stores AI provider keys client-side with encrypted vault storage, showing how to integrate LLMs without exposing keys to intermediaries

2. **Proves No-Signup Feasibility**: Fully functional PWA with local IndexedDB storage and WebRTC sync, proving that common applications can be built without centralized user databases

3. **Documented Cryptographic Implementation**: AES-256-GCM with Argon2id KDF running in Web Workers, with explicit zeroization and key material isolation patterns that other projects can reference

4. **Open Source with MIT License**: The core (bookmarkforge-core) is MIT-licensed, allowing unrestricted study and reuse of the cryptographic patterns

The project contributes actionable examples of client-side encryption, local-first architecture, and BYOK integration to the data sovereignty community.

## Notes
- Entry is purely technical; no marketing language used
- Links point to self-hosted domain and open-source repository
- No third-party SaaS dependencies in core implementation
