# Crypto Patterns Maintenance Guide

## Overview

BookmarkForge uses advanced cryptographic patterns to secure user data. This guide explains the key cryptographic concepts and patterns used in the codebase to help developers maintain and extend the security implementation.

## Core Cryptographic Stack

### Encryption Format Evolution

The project has evolved through several encryption formats:

- **v2**: PBKDF2 (legacy, read-only)
- **v4**: Argon2id per operation (stored data, legacy read-only)
- **v5**: Argon2id-once + HKDF per operation with fixed bundle-wide salt (legacy read-only)
- **v6**: Argon2id-once + HKDF per operation with per-vault random salt (current standard)

### Current Format (v6)

**Wire format**: `v6:<base64(vault_salt(16) || hkdf_salt(16) || iv(12) || ciphertext)>`

- `vault_salt`: 16 bytes random per-vault salt (embedded in payload)
- `hkdf_salt`: 16 bytes per-operation salt
- `iv`: 12 bytes AES-GCM initialization vector
- `ciphertext`: encrypted data

### Key Derivation Chain

```
master_password (bytes)
    ↓
Argon2id (v6: per-vault salt, 128 MiB, t=3, p=4)
    ↓
master_key (AES-256)
    ↓
HKDF-SHA256 (per-operation salt)
    ↓
session_key (AES-256)
    ↓
AES-GCM encryption/decryption
```

## Critical Security Patterns

### 1. Password Buffer Ownership & Zeroization

**Pattern**: Passwords are handled as `Uint8Array` bytes and must be zeroized after use.

**Implementation**:
```typescript
// CONSUMES password buffer - do not reuse after calling
encrypt(passwordBytes: Uint8Array, plaintext: string): string {
  const masterKey = deriveDbKey(passwordBytes);
  zeroPasswordBytes(passwordBytes); // Immediate zeroization
  // ... encryption logic
}
```

**Rules**:
- Always pass fresh password copies to crypto functions
- Never decode secrets into immutable JS strings
- Use `zeroPasswordBytes()` after deriving keys
- Callers must `fill(0)` password bytes in `finally` blocks

### 2. Per-Vault Salt Strategy

**Pattern**: Each vault uses a unique random salt to prevent cross-vault attacks.

**Implementation**:
```typescript
// In crypto-core.ts
let vaultKdfSalt: Uint8Array | null = null;

export function setVaultKdfSalt(salt: Uint8Array): void {
  vaultKdfSalt = salt;
  // Notify crypto worker of new salt
}

// Salt is embedded in v6 payloads
const payload = vault_salt + hkdf_salt + iv + ciphertext;
```

**Benefits**:
- Prevents rainbow table attacks across vaults
- Isolates compromise to individual vaults
- Enables secure backup/restore without salt dependency

### 3. Session Key Caching

**Pattern**: Cache derived master keys to avoid expensive Argon2id recomputation.

**Implementation**:
```typescript
const masterKeyCache = new Map<string, CachedMasterKey>();

interface CachedMasterKey {
  passwordTag: Uint8Array;
  key: CryptoKey;
  expiresAt: number;
}

const SESSION_KEY_CACHE_TTL_MS = 5 * 60_000; // 5 minutes
```

**Rules**:
- Cache is cleared on vault lock
- Entries expire after 5 minutes
- Maximum 8 cached entries to prevent memory bloat
- Keys are keyed by `purpose:saltTag` for multi-salt support

### 4. Web Worker Isolation

**Pattern**: All crypto operations run in Web Workers to keep keys off main thread.

**Implementation**:
```typescript
// In EncryptionService.ts
private worker: Worker | null = null;

private initWorker() {
  this.worker = new Worker(
    new URL("../workers/crypto.worker.ts", import.meta.url),
    { type: "module" }
  );
}
```

**Benefits**:
- Keys never materialized on main thread
- Better performance for batch operations
- Isolated crypto context

### 5. Device Key Separation

**Pattern**: Device keys are split between localStorage (JWK) and IndexedDB (wrapped ciphertext).

**Implementation**:
```typescript
// Device key JWK in localStorage
const deviceKeyJWK = localStorage.getItem("device_key");

// Wrapped ciphertext in IndexedDB
const wrappedDeviceKey = await secureStorage.get("wrapped_device_key");

// Both required for decryption
const deviceKey = await unwrapDeviceKey(wrappedDeviceKey, masterPassword);
```

**Benefits**:
- Requires both surfaces for decryption
- Prevents single-point compromise
- Enables secure device key rotation

## File Architecture

### Core Crypto Files

- `src/utils/crypto-core.ts`: Pure crypto primitives (no worker dependencies)
- `src/utils/argon2-kdf.ts`: Argon2id key derivation
- `src/services/EncryptionService.ts`: Encryption service with worker management
- `src/workers/crypto.worker.ts`: Web worker for crypto operations
- `src/services/SecurityVault.ts`: Master password and secret management
- `src/services/security-vault/`: Modular security vault components

### Security Vault Modules

- `auth.ts`: Password verification with constant-time comparison
- `secrets.ts`: Secret encryption/decryption
- `kdf-salt.ts`: Per-vault salt management
- `integrity.ts`: Verification token integrity (HMAC)
- `share.ts`: Share credential derivation for vault sharing
- `rotation.ts`: Master password rotation
- `compare.ts`: Constant-time comparison utilities

## Maintenance Guidelines

### Adding New Encryption Operations

1. **Determine the encryption format**: Use v6 for new features
2. **Add salt management**: Ensure per-vault salt is provisioned
3. **Implement in crypto-core.ts**: Add pure crypto primitives
4. **Update EncryptionService**: Add worker communication
5. **Add tests**: Include regression tests with audit anchors
6. **Update documentation**: Add ADR for significant changes

### Rotating Encryption Formats

1. **Read legacy formats**: Support v4/v5 for migration
2. **Re-encrypt on unlock**: Automatically upgrade to v6
3. **Validate migration**: Ensure data integrity
4. **Monitor performance**: Check for degradation
5. **Update ADR**: Document format evolution

### Debugging Crypto Issues

1. **Check worker initialization**: Verify worker is created
2. **Validate salt presence**: Ensure vault salt is set
3. **Test cache state**: Check session key cache
4. **Verify key material**: Ensure keys are properly derived
5. **Monitor zeroization**: Confirm password cleanup

## Security Considerations

### Never Do

- Store passwords as strings
- Cache keys indefinitely
- Skip zeroization
- Use fixed salts across vaults
- Log key material or secrets
- Disable Web Worker isolation in production

### Always Do

- Use per-vault random salts
- Zeroize password buffers immediately
- Clear session keys on lock
- Validate all crypto operations
- Test with adversarial inputs
- Run security regression tests

## Testing Guidelines

### Unit Tests

- Test pure crypto primitives in isolation
- Mock Web Worker for service tests
- Include error paths and edge cases
- Test with adversarial inputs

### Integration Tests

- Test full encryption/decryption flows
- Verify worker communication
- Test cache invalidation
- Validate salt management

### Regression Tests

- Pin security fixes with audit anchors
- Test against known vulnerabilities
- Verify format migrations
- Test device key separation

## Performance Considerations

### Argon2id Parameters

- **Production**: 128 MiB, t=3, p=4 (desktop)
- **Test**: 8 MiB, t=1, p=2 (faster for CI)
- **Mobile**: 64 MiB, t=2, p=2 (balanced)

### Session Key Caching

- Cache TTL: 5 minutes
- Max entries: 8
- Clear on: vault lock, password change

### Batch Operations

- Use worker for parallel processing
- Limit concurrent operations
- Monitor memory usage

## Common Pitfalls

### 1. Reusing Password Buffers

**Problem**: Passing consumed password buffer to another function.

**Solution**: Always create fresh copies before crypto operations.

### 2. Missing Salt Updates

**Problem**: Not updating per-vault salt after rotation.

**Solution**: Call `setVaultKdfSalt()` after salt changes.

### 3. Cache Not Cleared

**Problem**: Session keys persist after vault lock.

**Solution**: Call `resetSessionKeyCache()` on lock.

### 4. String Conversion

**Problem**: Converting secrets to strings for logging.

**Solution**: Use `redactSecrets()` from logger.

## Audit References

Security changes are tracked with audit codes:
- `ADR-019`: Argon2id migration
- `S1/R3`: Security audit round 1, recommendation 3
- `P92`: Privacy audit item 92
- `H5`: Hygiene audit item 5
- `B28`: Business logic audit item 28

## Emergency Procedures

### If Crypto Worker Fails

1. Check worker initialization logs
2. Verify worker file exists
3. Test with main-thread fallback
4. Monitor memory usage

### If Vault Won't Unlock

1. Verify password is correct
2. Check per-vault salt exists
3. Validate device key separation
4. Test with backup recovery

### If Encryption Fails

1. Check format version compatibility
2. Verify salt presence
3. Test key derivation chain
4. Validate data integrity

## Resources

- [Web Crypto API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API)
- [Argon2id Specification](https://datatracker.ietf.org/doc/html/rfc9106)
- [AES-GCM](https://tools.ietf.org/html/rfc5116)
- [HKDF](https://tools.ietf.org/html/rfc5869)

## Contact

For crypto security questions or concerns, consult the security audit reports in `docs/audit.md` and the engineering conventions in `AGENTS.md`.