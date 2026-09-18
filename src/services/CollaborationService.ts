import { encryptionService } from "./EncryptionService";
import { RxDatabase } from "rxdb";
import { securityVault } from "./SecurityVault";
import { useSecurityStore } from "../hooks/useSecurityStore";
import { logger } from "../utils/logger";
import { zeroPasswordBytes } from "../utils/crypto-core";
import { syncService } from "./SyncService";

const SHARE_PAYLOAD_VERSION = 2;
const SHARE_INFO = "bookmarkforge-share";

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) {return;}
  const error = new Error("Collaboration operation cancelled");
  error.name = "AbortError";
  throw error;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

interface SharedVaultPayload {
  version: 1 | typeof SHARE_PAYLOAD_VERSION;
  encryptedKey: string;
  salt: number[];
}

function parseSharedVaultPayload(value: unknown): SharedVaultPayload | null {
  if (!value || typeof value !== "object") {return null;}
  const candidate = value as Record<string, unknown>;
  const version =
    candidate.version === SHARE_PAYLOAD_VERSION || candidate.version === 1
      ? candidate.version
      : candidate.version === undefined
        ? 1
        : null;
  if (
    version === null ||
    typeof candidate.encryptedKey !== "string" ||
    candidate.encryptedKey.length === 0 ||
    !Array.isArray(candidate.salt) ||
    candidate.salt.length < 16 ||
    candidate.salt.length > 64 ||
    !candidate.salt.every(
      (byte) =>
        typeof byte === "number" &&
        Number.isInteger(byte) &&
        byte >= 0 &&
        byte <= 255,
    )
  ) {
    return null;
  }
  return {
    version,
    encryptedKey: candidate.encryptedKey,
    salt: candidate.salt,
  };
}

/**
 * CollaborationService handles sharing vault keys and managing shared sessions.
 */
class CollaborationService {
  private sharedImportInFlight = false;

  /**
   * Generates a secure share payload for a vault.
   * Uses HKDF to derive a temporary sharing key from the master password,
   * NEVER exposing the session token as a password substitute.
   * @param sharePassword A temporary password to encrypt the share payload.
   */
  async generateSharePayload(
    sharePassword: string,
    signal?: AbortSignal,
  ): Promise<string | null> {
    if (typeof sharePassword !== "string" || !sharePassword) {return null;}
    throwIfAborted(signal);

    const masterPw = await securityVault.withMasterPasswordBytes(
      CollaborationService,
      (pw) => pw,
    );
    if (!masterPw) {return null;}

    try {
      throwIfAborted(signal);
      // Derive a temporary sharing credential using HKDF. The source master
      // password never leaves this device and the session token is never
      // placed in the payload.
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const baseKey = await crypto.subtle.importKey(
        "raw",
        masterPw as Uint8Array<ArrayBuffer>,
        { name: "HKDF" },
        false,
        ["deriveBits"],
      );
      throwIfAborted(signal);
      // Keep the derived credential in a mutable buffer until it has been
      // converted to the authenticated envelope. Unlike a CryptoKey, this
      // ArrayBuffer is caller-owned material and must not survive the share
      // operation in readable form.
      const derivedBits = new Uint8Array(
        await crypto.subtle.deriveBits(
          {
            name: "HKDF",
            salt,
            info: new TextEncoder().encode(SHARE_INFO),
            hash: "SHA-256",
          },
          baseKey,
          256,
        ),
      );
throwIfAborted(signal);
       try {
         const shareSecret = Array.from(derivedBits, (b) =>
           b.toString(16).padStart(2, "0"),
         ).join("");

         // Authenticate the secret and its KCF salt together. The destination
         // can then derive a fresh in-memory credential without the source
         // master password, while an attacker cannot alter the public salt
         // without failing AES-GCM authentication.
         const encryptedKey = await encryptionService.encrypt(
           JSON.stringify({ shareSecret, salt: Array.from(salt) }),
           sharePassword,
         );
         throwIfAborted(signal);

         // Do not export the source RxDB key. WebRTC sync transfers validated,
         // decrypted records and encrypts them with the destination's local key;
         // sharing the source key would couple devices and make a later local
         // password change unsafe. The authenticated share secret is therefore
         // session bootstrap material, not a replacement database password.
         const payload: SharedVaultPayload = {
           version: SHARE_PAYLOAD_VERSION,
           encryptedKey,
           salt: Array.from(salt),
         };
return btoa(JSON.stringify(payload));
       } finally {
         zeroPasswordBytes(derivedBits);
       }
     } finally {
// withMasterPasswordBytes returns an ephemeral copy for callers. Do
      // not leave the source password copy alive after HKDF completes.
      if (masterPw) {
        zeroPasswordBytes(masterPw);
      }
    }
  }

  /**
   * Imports a shared vault using a share payload and password.
   *
   * Decrypting `encryptedKey` authenticates the payload with the temporary
   * share password. SecurityVault then either verifies the share against the
   * existing local master password, or derives an ephemeral credential from
   * the authenticated payload on a fresh device. The latter never replaces
   * or persists a local master password.
   *
   * @param payload The base64 share payload.
   * @param sharePassword The temporary password used to encrypt the payload.
   * @param _db The current RxDatabase instance (kept for API compatibility).
   */
  async importSharedVault(
    payload: string,
    sharePassword: string,
    _db: RxDatabase,
    signal?: AbortSignal,
  ): Promise<boolean> {
    if (this.sharedImportInFlight) {return false;}
    this.sharedImportInFlight = true;
    try {
      throwIfAborted(signal);
      if (typeof payload !== "string" || typeof sharePassword !== "string" || !sharePassword) {
        return false;
      }
      const decoded = parseSharedVaultPayload(JSON.parse(atob(payload)));
      if (!decoded) {return false;}
      throwIfAborted(signal);

      // AES-GCM decryption authenticates the share secret. A fresh device
      // does not need (and must not be asked for) the source master password.
      // RL-2: the decrypt runs inside SecurityVault's rate-limit gate so a
      // wrong share password cannot be brute-forced without tripping the same
      // lockout as unlock().
      const decryptedShare = await securityVault.decryptShareWithRateLimit(
        decoded.encryptedKey,
        sharePassword,
      );
      // Rate-limited or failed decrypt (wrong share password) yields null.
      if (decryptedShare === null) {return false;}
      throwIfAborted(signal);
      const shareSecret = this.parseAuthenticatedShareSecret(
        decryptedShare,
        decoded,
      );
      if (!shareSecret) {return false;}

      const emptyLocalDatabase = await this.isDatabaseEmpty(_db);
      throwIfAborted(signal);
      const unlocked = await securityVault.unlockFromShare(
        shareSecret,
        JSON.stringify(decoded.salt),
        {
          allowFreshDevice: decoded.version === SHARE_PAYLOAD_VERSION,
          emptyLocalDatabase,
        },
      );
      // unlockFromShare commits the vault's security state. Once that
      // irreversible step succeeds, finish the local store transition even if
      // the UI that initiated the request has already gone away; otherwise the
      // vault and the global lock state would disagree.
      if (!unlocked) {
        throw new Error("Failed to unlock vault with shared credential");
      }

      useSecurityStore.getState().unlock();

      return true;
    } catch (e) {
      if (!isAbortError(e)) {
        logger.error("[CollaborationService] Error importing shared vault:", e);
      }
      return false;
    } finally {
      this.sharedImportInFlight = false;
    }
  }

  private parseAuthenticatedShareSecret(
    decryptedShare: string,
    payload: SharedVaultPayload,
  ): string | null {
    if (payload.version !== SHARE_PAYLOAD_VERSION) {
      return /^[0-9a-f]{64}$/i.test(decryptedShare) ? decryptedShare : null;
    }

    try {
      const parsed: unknown = JSON.parse(decryptedShare);
      if (!parsed || typeof parsed !== "object") {return null;}
      const candidate = parsed as Record<string, unknown>;
      const authenticatedSalt = candidate.salt;
      const saltMatches =
        Array.isArray(authenticatedSalt) &&
        authenticatedSalt.length === payload.salt.length &&
        authenticatedSalt.every(
          (byte, index) => byte === payload.salt[index],
        );
      const candidateSecret = candidate.shareSecret;
      return saltMatches &&
        typeof candidateSecret === "string" &&
        /^[0-9a-f]{64}$/i.test(candidateSecret)
        ? candidateSecret
        : null;
    } catch {
      return null;
    }
  }

  /**
   * A shared session may bootstrap only an empty destination. The database
   * instance is already open when this UI is rendered, so replacing its
   * encryption key here would make future writes unreadable after reload.
   * WebRTC sync intentionally re-encrypts received records locally instead.
   */
  private async isDatabaseEmpty(db: RxDatabase): Promise<boolean> {
    const collectionMap = (db as RxDatabase & {
      collections?: Record<
        string,
        { count?: () => { exec: () => Promise<number> } }
      >;
    }).collections;
    const collections = collectionMap
      ? (Object.values(collectionMap) as Array<{
          count?: () => { exec: () => Promise<number> };
        }>)
      : [];
    // Unknown/mock database shapes fail closed. A share must never bootstrap
    // over a destination whose contents we could not inspect.
    if (collections.length === 0) {return false;}
    for (const collection of collections) {
      if (typeof collection.count !== "function") {
        return false;
      }
      if ((await collection.count().exec()) > 0) {
        return false;
      }
    }
    return true;
  }

  /**
   * Start P2P Synchronization (Pilot Auto Mode)
   */
  async start(
    db: RxDatabase,
    roomId: string,
    roomSecret?: string,
    signal?: AbortSignal,
  ): Promise<string | null> {
    throwIfAborted(signal);
    logger.info("[CollaborationService] P2P Sync Started", { roomId });
    // An abort arriving WHILE startP2PSync is in flight (initDB, firewall
    // probe, replicateWebRTC per collection) must tear the session down
    // immediately: stopAll() bumps the session generation, so the in-flight
    // startup self-cancels at its next checkpoint instead of establishing a
    // live P2P session the caller believes was cancelled. Without this
    // listener the abort is only observed after the (possibly hanging)
    // startup completes — leaving the vault actively syncing meanwhile.
    const onAbort = () => {
      syncService.stopAll();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      if (roomSecret === undefined) {
        await syncService.startP2PSync(db, roomId);
      } else {
        await syncService.startP2PSync(db, roomId, roomSecret);
      }
    } finally {
      signal?.removeEventListener("abort", onAbort);
    }
    if (signal?.aborted) {
      await this.stop();
      throwIfAborted(signal);
    }
    const getRoomSecret = (syncService as unknown as {
      getRoomSecret?: () => string | null;
    }).getRoomSecret;
    return typeof getRoomSecret === "function" ? getRoomSecret() : null;
  }

  /**
   * Stop P2P Synchronization
   */
  async stop(): Promise<void> {
    logger.info("[CollaborationService] P2P Sync Stopped");
    syncService.stopAll();
  }
}

securityVault.registerCaller(CollaborationService);
export const collaborationService = new CollaborationService();
