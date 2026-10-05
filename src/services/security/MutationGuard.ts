// ADR-038: HMAC signature verification compares secret digests with the
// shared constant-time primitive (security-vault/compare) — never ===/!==,
// which leak the longest matching prefix to an attacker who controls one side.
import { securityVault } from "../SecurityVault";
import { constantTimeCompare } from "../security-vault/compare";
import { logger } from "../../utils/logger";
import { zeroPasswordBytes } from "../../utils/crypto-core";

interface SignedMutation<T> {
  key: string;
  value: T;
  timestamp: string;
  signature: string;
  version: number;
}

interface TamperingReport {
  tamperedKeys: string[];
  totalChecked: number;
  timestamp: string;
}

const GUARD_VERSION = 1;

class MutationGuard {
  private static instance: MutationGuard;
  private keyCache = new Map<string, CryptoKey | null>();

  static getInstance(): MutationGuard {
    if (!MutationGuard.instance) {
      MutationGuard.instance = new MutationGuard();
    }
    return MutationGuard.instance;
  }

  async guard<T>(key: string, value: T): Promise<SignedMutation<T>> {
    const timestamp = new Date().toISOString();
    const payload = `${key}|${JSON.stringify(value)}|${timestamp}|${GUARD_VERSION}`;
    const signature = await this.sign(key, payload);

    return { key, value, timestamp, signature, version: GUARD_VERSION };
  }

  async verify<T>(signed: SignedMutation<T>): Promise<boolean> {
    const payload = `${signed.key}|${JSON.stringify(signed.value)}|${signed.timestamp}|${signed.version}`;
    const expectedSig = await this.sign(signed.key, payload);
    // ADR-038: constant-time comparison — === would leak prefix-match length.
    return constantTimeCompare(signed.signature, expectedSig);
  }

  /**
   * Compares a stored signed list against the current values.
   *
   * CONTRACT: both arrays must be in the SAME order (index i is compared
   * against index i). A reorder of otherwise unchanged entries is reported
   * as tampering — deliberately fail-closed (never a false negative), but
   * callers with unstable ordering will see false positives. Sort both
   * inputs by a stable key before calling.
   */
  async detectTampering<T>(
    stored: SignedMutation<T>[],
    current: T[],
  ): Promise<TamperingReport> {
    const tamperedKeys: string[] = [];
    const minLen = Math.min(stored.length, current.length);

    for (let i = 0; i < minLen; i++) {
      const storedSig = stored[i]!;
      const curVal = current[i]!;
      const payload = `${storedSig.key}|${JSON.stringify(curVal)}|${storedSig.timestamp}|${storedSig.version}`;
      const expectedSig = await this.sign(storedSig.key, payload);

      if (!constantTimeCompare(storedSig.signature, expectedSig)) {
        tamperedKeys.push(storedSig.key);
      }
    }

    return {
      tamperedKeys,
      totalChecked: minLen,
      timestamp: new Date().toISOString(),
    };
  }

  private async sign(namespace: string, payload: string): Promise<string> {
    let cached = this.keyCache.get(namespace);
    // If vault is locked, clear cached keys — they may reference a stale master password
    if (cached !== undefined && (await securityVault.isLocked())) {
      logger.debug("[MutationGuard] Vault locked, clearing key cache");
      this.keyCache.clear();
      cached = undefined;
    }
    if (cached === undefined) {
      let resolved: CryptoKey | null = null;
      try {
        await securityVault.withMasterPasswordBytes(
          mutationGuard,
          async (passwordBytes) => {
            if (!passwordBytes) {
              throw new Error("MutationGuard: vault locked (no password bytes)");
            }
            const nsBytes = new TextEncoder().encode(":mutationguard:" + namespace);
            const combined = new Uint8Array(passwordBytes.length + nsBytes.length);
            combined.set(passwordBytes, 0);
            combined.set(nsBytes, passwordBytes.length);
            try {
              const keyMaterial = await crypto.subtle.importKey(
                "raw",
                combined,
                { name: "HMAC", hash: "SHA-256" },
                false,
                ["sign"],
);
               resolved = keyMaterial;
     } finally {
       // Clear both the derived input and the ephemeral password copy
       // returned by withMasterPasswordBytes, including import errors.
       zeroPasswordBytes(combined);
       zeroPasswordBytes(passwordBytes);
     }
   },
     );
      } catch (err) {
        this.keyCache.clear();
        logger.warn(
          "[MutationGuard] Failed to derive HMAC key — vault may be locked",
          { error: err },
        );
      }
      cached = resolved;
      // Do not cache a failed derivation. A temporary lock or storage error
      // must be recoverable after the vault unlocks; caching null would make
      // every later mutation fail until an unrelated caller clears the cache.
      if (cached) {
        this.keyCache.set(namespace, cached);
      } else {
        this.keyCache.delete(namespace);
      }
    }
    if (!cached) {throw new Error("MutationGuard: vault locked");}

    const sig = await crypto.subtle.sign(
      "HMAC",
      cached,
      new TextEncoder().encode(payload),
    );
    return Array.from(new Uint8Array(sig), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");
  }

  clearCache(): void {
    this.keyCache.clear();
  }
}

export const mutationGuard = MutationGuard.getInstance();
securityVault.registerCaller(mutationGuard);

// HMAC keys are derived from the master password and must not survive a vault
// boundary even if no subsequent mutation invokes sign().
securityVault.onLock(() => mutationGuard.clearCache());
securityVault.onUnlock(() => mutationGuard.clearCache());
