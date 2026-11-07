/**
 * src/utils/envelope-purposes.ts
 *
 * Logical identities bound as AES-GCM additional data (AAD) in v7 payloads
 * (M-02). The purpose is not secret — it is the name of the slot the plaintext
 * belongs to — but it IS authenticated: a ciphertext moved from one slot to
 * another fails to decrypt instead of yielding a plausible-but-wrong secret.
 *
 * Why a module: the writer, the reader, the password-rotation path and the
 * salt migration path all have to produce the SAME string. A purpose that
 * differs by one character turns a correct password into an authentication
 * failure, so the derivation lives in one place instead of being repeated at
 * every call site.
 *
 * Everything stored through SecureStorage follows one rule — the purpose is
 * derived from the storage key — which is what keeps rotation and migration
 * aligned with the readers that never see the key.
 */

/** Purpose of a secret stored through `SecureStorage` under `key`. */
export function secureStoragePurpose(key: string): string {
  return `secure-storage:${key}`;
}

/** Purpose of an encrypted document field (`encrypted` array of a schema). */
export function rowFieldPurpose(collectionName: string, path: string): string {
  return `row:${collectionName}:${path}`;
}

/** Purposes that are not derived from a storage key or a row field. */
export const ENVELOPE_PURPOSE = {
  /** Master password wrapped with a recovery phrase (RecoveryService). */
  recoveryMasterPassword: "vault:recovery-master-password",
  /** Share bootstrap payload: share secret + its KDF salt. */
  sharePayload: "collaboration:share-payload",
} as const;
