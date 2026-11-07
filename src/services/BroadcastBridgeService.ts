import { initDB } from "../db/database";
import type { BookmarkDocType } from "../db/schema";
import { securityVault } from "./SecurityVault";
import { logger } from "../utils/logger";
import { generateId } from "../utils/id";
import { hashString } from "../utils/crypto-core";
import { aiManager } from "./ai/ProviderManager";
import { SanitizationService } from "./SanitizationService";
import { SECURE_STORAGE_KEYS } from "./SecurityVault";

/**
 * Protects control messages (SYNC_SETTINGS) against same-origin sources
 * (extensions, iframes, sibling windows). Configuration commands must carry
 * an HMAC derived from an ephemeral vault key; if the vault is locked, the
 * command is rejected (no unauthenticated configuration is accepted). This
 * prevents hijacking the AI API key by a malicious same-origin extension.
 */
const BRIDGE_AUTH_REALM = "bookmarkforge-bridge-v1";

export async function verifyBridgeMessage(
  payload: Record<string, unknown>,
  signature: string,
  nonce: string,
): Promise<boolean> {
  if (securityVault.isLocked()) {return false;}
  const keyMaterial = await securityVault.deriveBridgeKey();
  if (!keyMaterial) {return false;}
  // HMAC-SHA-256 is encoded as exactly 32 bytes / 64 hexadecimal chars.
  // Validate the alphabet and length before parsing so malformed input cannot
  // produce NaN bytes or an unhandled WebCrypto rejection.
  if (!/^[0-9a-f]{64}$/i.test(signature)) {return false;}
  if (typeof nonce !== "string" || nonce.length === 0 || nonce.length > 256) {
    return false;
  }
  if (!payload || typeof payload !== "object") {return false;}

  try {
    const data = JSON.stringify({ ...payload, nonce, realm: BRIDGE_AUTH_REALM });
    const sigBytes = new Uint8Array(
      signature.match(/.{1,2}/g)!.map((h) => parseInt(h, 16)),
    );
    return await globalThis.crypto.subtle.verify(
      "HMAC",
      keyMaterial,
      sigBytes,
      new TextEncoder().encode(data),
    );
  } catch {
    return false;
  }
}

/**
 * BroadcastBridgeService - Enables PWA-to-PWA communication
 * via BroadcastChannel API (no HTTP server needed).
 *
 * External tools or other PWA instances can send bookmarks
 * via BroadcastChannel; this service receives and writes
 * directly to RxDB (IndexedDB).
 *
 * SECURITY: SYNC_SETTINGS commands require an HMAC signature derived from
 * the unlocked vault. Without a valid signature, the command is rejected.
 */

/**
 * BroadcastBridgeService - Enables PWA-to-PWA communication
 * via BroadcastChannel API (no HTTP server needed).
 *
 * External tools or other PWA instances can send bookmarks
 * via BroadcastChannel; this service receives and writes
 * directly to RxDB (IndexedDB).
 */
class BroadcastBridgeService {
  private channel: BroadcastChannel | null = null;
  // SECURITY (F19): replay protection — consumed nonces with TTL. Prevents
  // an attacker from re-broadcasting a captured signed SAVE_BOOKMARK or
  // SYNC_SETTINGS message while the vault remains unlocked.
  private usedNonces = new Map<string, number>();
  private static readonly NONCE_TTL_MS = 5 * 60 * 1000;

  private isReplay(nonce: string): boolean {
    const now = Date.now();
    for (const [n, ts] of this.usedNonces) {
      if (now - ts > BroadcastBridgeService.NONCE_TTL_MS) {
        this.usedNonces.delete(n);
      }
    }
    if (this.usedNonces.has(nonce)) {return true;}
    this.usedNonces.set(nonce, now);
    return false;
  }

  start() {
    if (this.channel) {return;}

    try {
      this.channel = new BroadcastChannel("bmf-channel");
      this.channel.onmessage = async (event) => {
        if (!event) {return;}
        const msg = event.data;

        if (!msg || typeof msg !== "object" || typeof msg.type !== "string") {
          return;
        }

        const VALID_TYPES = ["PING", "SAVE_BOOKMARK", "SYNC_SETTINGS"] as const;
        if (!VALID_TYPES.includes(msg.type as (typeof VALID_TYPES)[number])) {
          return;
        }

        if (msg.type === "PING") {
          this.channel?.postMessage({ type: "PONG", source: "bookmarkforge" });
          return;
        }

        if (msg.type === "SAVE_BOOKMARK") {
          // SECURITY (M2): SAVE_BOOKMARK mutates user data in RxDB, so it
          // requires the same HMAC authentication as SYNC_SETTINGS. An
          // unsigned bookmark from a same-origin extension/iframe is rejected.
          const signature = msg.signature as string | undefined;
          const nonce = msg.nonce as string | undefined;
          if (!signature || !nonce) {
            logger.warn(
              "[BroadcastBridge] Rejected SAVE_BOOKMARK without signature (possible unauthorized origin)",
            );
            return;
          }
          if (securityVault.isLocked()) {
            logger.warn(
              "[BroadcastBridge] Rejected SAVE_BOOKMARK: vault is locked",
            );
            return;
          }
          const valid = await verifyBridgeMessage(
            msg.data as Record<string, unknown>,
            signature,
            nonce,
          );
          if (!valid) {
            logger.warn(
              "[BroadcastBridge] Rejected SAVE_BOOKMARK with invalid signature",
            );
            return;
          }
          if (this.isReplay(nonce)) {
            logger.warn(
              "[BroadcastBridge] Rejected SAVE_BOOKMARK: replayed nonce",
            );
            return;
          }
          await this.handleSaveBookmark(msg.data, msg.messageId);
        }

        if (msg.type === "SYNC_SETTINGS") {
          const signature = msg.signature as string | undefined;
          const nonce = msg.nonce as string | undefined;
          if (!signature || !nonce) {
            logger.warn(
              "[BroadcastBridge] Rejected SYNC_SETTINGS without signature (possible unauthorized origin)",
            );
            return;
          }
          // SYNC_SETTINGS requires an unlocked vault: the HMAC bridge key
          // is derived from the in-memory master password. Without it we
          // MUST reject the command — we never persist the API key in
          // plaintext (SecureStorage is unencrypted IndexedDB).
          if (securityVault.isLocked()) {
            logger.warn(
              "[BroadcastBridge] Rejected SYNC_SETTINGS: vault is locked",
            );
            return;
          }
          const valid = await verifyBridgeMessage(
            msg.data as Record<string, unknown>,
            signature,
            nonce,
          );
          if (!valid) {
            logger.warn(
              "[BroadcastBridge] Rejected SYNC_SETTINGS with invalid signature",
            );
            return;
          }
          if (this.isReplay(nonce)) {
            logger.warn(
              "[BroadcastBridge] Rejected SYNC_SETTINGS: replayed nonce",
            );
            return;
          }
          await this.handleSyncSettings(msg.data);
        }
      };

      logger.info("[BroadcastBridge] Listening for external messages");
    } catch (error) {
      logger.warn("[BroadcastBridge] Failed to initialize", { error });
    }
  }

  stop() {
    if (this.channel) {
      this.channel.close();
      this.channel = null;
    }
    this.usedNonces.clear();
  }

  private sanitizeString(val: unknown, maxLen: number = 4096): string {
    if (typeof val !== "string") {return "";}
    return val.replace(/[<>"'&]/g, "").slice(0, maxLen);
  }

  private async handleSyncSettings(data: Record<string, unknown>) {
    const geminiKey = this.sanitizeString(data.geminiKey);
    if (!geminiKey) {return;}

    // Save encrypted to SecureStorage (never plaintext). The vault must be
    // unlocked (guaranteed by the caller's SYNC_SETTINGS guard) so the key
    // is encrypted with the master password before persistence.
    try {
      if (!securityVault.isLocked()) {
        await securityVault.encryptSecret(geminiKey, SECURE_STORAGE_KEYS.API_KEY);
        logger.info(
          "[BroadcastBridge] API key encrypted and stored in SecureStorage",
        );
      } else {
        logger.warn(
          "[BroadcastBridge] Refused to persist API key: vault is locked (would be plaintext)",
        );
        return;
      }
    } catch (err) {
      logger.error("[BroadcastBridge] Failed to encrypt API key", {
        error: err,
      });
    }

    // Try to save via ProviderManager (requires vault unlocked)
    try {
      await aiManager.setApiKey(geminiKey);
      logger.info("[BroadcastBridge] API key synced from external source");
    } catch (err) {
      logger.warn(
        "[BroadcastBridge] Failed to sync API key via ProviderManager",
        { error: err },
      );
    }
  }

  private async handleSaveBookmark(
    data: Record<string, unknown>,
    messageId: string,
  ) {
    try {
      const db = await initDB();

      const url = typeof data.url === "string" ? data.url : "";
      const title = typeof data.title === "string" ? data.title : "Untitled";
      const content = typeof data.content === "string" ? data.content : "";
      const aiSummary =
        typeof data.aiSummary === "string"
          ? data.aiSummary
          : typeof data.metaDesc === "string"
            ? data.metaDesc
            : "";
      const keywords = Array.isArray(data.keywords)
        ? data.keywords
        : Array.isArray(data.userTags)
          ? data.userTags
          : [];
      const timestamp =
        typeof data.timestamp === "string" ? data.timestamp : undefined;
      const sanitizedUrl = SanitizationService.sanitizeUrl(url);
      const bookmark = {
        id: generateId(),
        url: sanitizedUrl,
        urlHash: await hashString(sanitizedUrl),
        title: SanitizationService.sanitizeText(title),
        content: SanitizationService.sanitizeHtml(content, true),
        summary: SanitizationService.sanitizeHtml(aiSummary, true),
        tags: keywords.map((t: unknown) =>
          SanitizationService.sanitizeText(String(t)),
        ),
        relatedLinks: [],
        embedding: [],
        processed: false,
        isPrivate: false,
        isDeleted: false,
        visitCount: 0,
        createdAt: timestamp || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await db.bookmarks.insert(bookmark as BookmarkDocType);

      logger.info("[BroadcastBridge] Bookmark saved via broadcast", {
        title: bookmark.title,
      });

      this.channel?.postMessage({
        type: "SAVE_BOOKMARK_RESULT",
        messageId,
        success: true,
        id: bookmark.id,
      });
    } catch (error: unknown) {
      logger.error("[BroadcastBridge] Failed to save bookmark", { error });

      // Do not echo internal error details over the broadcast channel
      // (information disclosure to same-origin listeners).
      this.channel?.postMessage({
        type: "SAVE_BOOKMARK_RESULT",
        messageId,
        success: false,
        error: "SAVE_FAILED",
      });
    }
  }
}

export const broadcastBridgeService = new BroadcastBridgeService();
