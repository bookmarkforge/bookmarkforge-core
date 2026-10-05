// ADR-019: Argon2id migration / Security hardening (attestation chain storage)
// ADR-038: chain verification compares secret digests in constant time.
import { securityVault } from "../SecurityVault";
import { secureStorage } from "../SecureStorage";
import { logRateLimited } from "../../utils/boundedLog";
import { constantTimeCompare } from "../security-vault/compare";
import { zeroPasswordBytes } from "../../utils/crypto-core";

interface AttestedEntry {
  index: number;
  prevHash: string;
  data: string;
  timestamp: string;
  signature: string;
}

interface AttestationProof {
  chain: AttestedEntry[];
  startIndex: number;
  endIndex: number;
  rootHash: string;
}

const STORAGE_KEY = "attestation_chain";
const MAX_CHAIN_LENGTH = 1000;

class AttestationChain {
  private chain: AttestedEntry[] = [];
  private initialized = false;

  async init(): Promise<void> {
    if (this.initialized) {return;}
    try {
      const stored = await secureStorage.getSecret(STORAGE_KEY);
      if (stored) {
        this.chain = JSON.parse(stored);
      }
      this.initialized = true;
    } catch (_err) {
      this.chain = [];
      this.initialized = true;
    }
  }

  async append(
    action: string,
    target: string,
    context?: Record<string, string>,
  ): Promise<AttestedEntry> {
    await this.init();
    const index = this.chain.length;
    const prevHash = index === 0 ? "genesis" : this.chain[index - 1]!.signature;
    const data = JSON.stringify({ action, target, context, index });
    const timestamp = new Date().toISOString();
    const payload = `${prevHash}|${data}|${timestamp}`;
    const signature = await this.sign(payload);

    const entry: AttestedEntry = {
      index,
      prevHash,
      data,
      timestamp,
      signature,
    };
    this.chain.push(entry);

    if (this.chain.length > MAX_CHAIN_LENGTH) {
      this.chain = this.chain.slice(-MAX_CHAIN_LENGTH);
    }

    try {
      await secureStorage.setSecret(STORAGE_KEY, JSON.stringify(this.chain));
    } catch (error) {
      // The signed entry remains in memory and is retried on the next append,
      // but persistence failure must remain diagnosable without log spam.
      logRateLimited(
        "warn",
        "attestation-chain-persist",
        "Failed to persist audit attestation chain; keeping in-memory chain",
        { error: error instanceof Error ? error.message : String(error) },
      );
    }

    return entry;
  }

  async verifyChain(): Promise<{ valid: boolean; brokenAt: number | null }> {
    await this.init();
    for (let i = 1; i < this.chain.length; i++) {
      const prev = this.chain[i - 1]!;
      const curr = this.chain[i]!;
      // ADR-038: prevHash carries the previous entry's secret HMAC — same
      // prefix-oracle risk as the signature itself, so constant-time here too.
      if (!constantTimeCompare(curr.prevHash, prev.signature)) {
        return { valid: false, brokenAt: i };
      }
      const payload = `${curr.prevHash}|${curr.data}|${curr.timestamp}`;
      const expectedSig = await this.sign(payload);
      if (!constantTimeCompare(curr.signature, expectedSig)) {
        return { valid: false, brokenAt: i };
      }
    }
    return { valid: true, brokenAt: null };
  }

  /**
   * Re-signs every entry with the CURRENT in-memory master password.
   *
   * The chain is HMAC-signed with the master-password-derived key, so after
   * a password rotation `verifyChain()` would fail for every pre-rotation
   * entry (false tamper alarm). Must run while the vault is unlocked with
   * the new password (SecurityVault calls this right after rotation
   * commits). Signatures cascade: re-signing entry i updates entry i+1's
   * prevHash, so the loop processes the chain in order.
   */
  async reSignAll(): Promise<void> {
    await this.init();
    for (let i = 0; i < this.chain.length; i++) {
      const entry = this.chain[i]!;
      const payload = `${entry.prevHash}|${entry.data}|${entry.timestamp}`;
      entry.signature = await this.sign(payload);
      const next = this.chain[i + 1];
      if (next) {
        next.prevHash = entry.signature;
      }
    }
    try {
      await secureStorage.setSecret(STORAGE_KEY, JSON.stringify(this.chain));
    } catch (error) {
      // Re-signing is still valid for the active session; the next append
      // retries persistence. Keep this degradation visible and bounded.
      logRateLimited(
        "warn",
        "attestation-chain-resign-persist",
        "Failed to persist re-signed audit attestation chain",
        { error: error instanceof Error ? error.message : String(error) },
      );
    }
  }

  exportProof(fromIndex: number, toIndex: number): AttestationProof | null {
    if (fromIndex < 0 || toIndex >= this.chain.length || fromIndex > toIndex) {
      return null;
    }
    const chain = this.chain.slice(fromIndex, toIndex + 1);
    return {
      chain,
      startIndex: fromIndex,
      endIndex: toIndex,
      rootHash: chain[chain.length - 1]!.signature,
    };
  }

  getLength(): number {
    return this.chain.length;
  }

  clear(): void {
    this.chain = [];
    secureStorage.deleteSecret(STORAGE_KEY).catch(() => undefined);
  }

  private async sign(payload: string): Promise<string> {
    // M1 fix: use the bytes-based API so the master password is never decoded
    // into an immutable JS string on the heap. The domain-separated key
    // material is built in a single contiguous buffer (NOT a spread into a
    // JS number array, which would keep an un-zeroizable copy of the secret
    // on the heap) and zeroized right after importKey copies it.
    const key = await securityVault.withMasterPasswordBytes(
      attestationChain,
      async (passwordBytes) => {
        if (!passwordBytes) {return null;}
        const nsBytes = new TextEncoder().encode(":attestation");
        const combined = new Uint8Array(
          passwordBytes.length + nsBytes.length,
        );
        combined.set(passwordBytes, 0);
        combined.set(nsBytes, passwordBytes.length);
        try {
          return await crypto.subtle.importKey(
            "raw",
            combined,
            { name: "HMAC", hash: "SHA-256" },
            false,
            ["sign"],
);
     } finally {
       // withMasterPasswordBytes returns a caller-owned copy. Clear both
       // the domain-separated key material and the original password copy
       // even when importKey rejects before copying it.
       zeroPasswordBytes(combined);
       zeroPasswordBytes(passwordBytes);
     }
   },
     );
    if (!key) {throw new Error("AttestationChain: vault locked");}
    const sig = await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(payload),
    );
    return Array.from(new Uint8Array(sig), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");
  }
}

export const attestationChain = new AttestationChain();
securityVault.registerCaller(attestationChain);
