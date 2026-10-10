/**
 * src/services/security-vault/kdf-salt-sync.ts
 *
 * A-1 / ADR-046: cross-tab propagation of a vault KDF-salt change.
 *
 * The problem this file solves: the per-vault Argon2id salt is installed in
 * MODULE state (crypto-core's `vaultKdfSalt`), so a rotation performed in one
 * tab never reaches a sibling tab that is already open. That tab keeps writing
 * `v6:` payloads under the salt the vault has just retired — the harvested
 * corpus keeps growing under a salt whose precomputation an attacker has
 * already paid for — and the vault has two live salts until that tab reloads.
 *
 * The fix is a notification with NO PAYLOAD. The message says "re-read your
 * salt", and the receiving tab installs the value `rotateVaultKdfSalt` already
 * persisted (`adoptVaultKdfSaltFromStorage`). Two consequences, both deliberate:
 *
 *   - Forgery is inert. Any script on the origin can post on a BroadcastChannel
 *     (`BroadcastBridgeService` guards its own channel with an HMAC for exactly
 *     that reason), and no HMAC is available here: after a rotation the two tabs
 *     hold DIFFERENT passwords, so there is no shared key to sign with. Storage
 *     is the authority instead — a forged message can only cause a re-read of
 *     the same salt, never the installation of an attacker-chosen one (which is
 *     the downgrade that matters: an attacker-chosen salt makes one dictionary
 *     reusable across vaults again).
 *   - It is idempotent and late-delivery safe. Every handler re-reads the
 *     CURRENT stored salt, so a duplicate, reordered, or stale notification
 *     converges on the same value, and a message that arrives after a rollback
 *     finds the restored salt instead of resurrecting the uncommitted one.
 *
 * The notification is sent only once a rotation has COMMITTED (never while it is
 * still undoable), which is what keeps the trigger honest: if the rotation rolls
 * back, nothing is announced, the stored salt goes back to the previous one, and
 * sibling tabs — which never moved — stay consistent with it.
 *
 * Lifecycle: `startVaultKdfSaltSync()` while the vault is unlocked (reading the
 * stored salt needs the device key), `stopVaultKdfSaltSync()` on lock. A locked
 * tab needs neither: it cannot read the salt and cannot write with it, and the
 * next unlock provisions the current one.
 */

import { logger } from "../../utils/logger";
import { adoptVaultKdfSaltFromStorage } from "./kdf-salt";

/**
 * Same-origin channel for vault-lifecycle notifications. Distinct from
 * `bmf-channel` (external PWA/bookmarklet traffic, HMAC-guarded) so an internal
 * notification can never be confused with an externally supplied command.
 */
export const KDF_SALT_SYNC_CHANNEL = "bmf-vault-kdf-salt";

/** The only message type this channel carries. */
export const KDF_SALT_CHANGED_MESSAGE = "VAULT_KDF_SALT_CHANGED";

let channel: BroadcastChannel | null = null;
let listening = false;
let adoptionHandler: ((result: Awaited<ReturnType<typeof adoptVaultKdfSaltFromStorage>>) => void | Promise<void>) | null = null;
// BroadcastChannel can deliver duplicate notifications while a rotation is
// followed immediately by another one. Serialize storage reads and crypto
// installs so a slower, older read cannot finish after a newer one and
// re-install a retired salt.
let adoptionQueue: Promise<void> = Promise.resolve();
let syncGeneration = 0;

function ensureChannel(): BroadcastChannel | null {
  if (channel) {
    return channel;
  }
  if (typeof BroadcastChannel === "undefined") {
    // SSR, a Web Worker, or a browser in private mode without the API: sibling
    // tabs keep their salt until they reload, which is the pre-change behavior.
    return null;
  }
  try {
    channel = new BroadcastChannel(KDF_SALT_SYNC_CHANNEL);
  } catch (error) {
    logger.warn("[SecurityVault] KDF salt sync channel unavailable", {
      error: error instanceof Error ? error.message : String(error),
    });
    channel = null;
  }
  return channel;
}

function onMessage(event: MessageEvent): void {
  const data: unknown = event?.data;
  if (!data || typeof data !== "object") {
    return;
  }
  // Everything except the type is ignored on purpose: the value a sender might
  // attach is never read, so there is nothing here to forge.
  if ((data as { type?: unknown }).type !== KDF_SALT_CHANGED_MESSAGE) {
    return;
  }
  const messageGeneration = syncGeneration;
  adoptionQueue = adoptionQueue
    .then(async () => {
      if (!listening || messageGeneration !== syncGeneration) {
        return;
      }
      const result = await adoptVaultKdfSaltFromStorage();
      logger.info("[SecurityVault] Cross-tab KDF salt notification handled", {
        status: result.status,
      });
      if (result.status === "adopted") {
        await adoptionHandler?.(result);
      }
    })
    .catch((error: unknown) => {
      // The adoption path returns statuses instead of throwing; this is the
      // last resort so a hostile/racy message can never produce an unhandled
      // rejection from a BroadcastChannel event.
      logger.error("[SecurityVault] Cross-tab KDF salt adoption failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
}

/**
 * Tells the sibling tabs that the vault's KDF salt changed. Called by the tab
 * that persisted the change, once it is committed.
 *
 * Best-effort: no notification, no cross-tab convergence — but never a failure
 * of the operation that triggered it.
 */
export function announceVaultKdfSaltChange(): void {
  const target = ensureChannel();
  if (!target) {
    logger.warn(
      "[SecurityVault] No cross-tab channel for the rotated KDF salt — the other tabs keep the previous salt until they reload",
    );
    return;
  }
  try {
    target.postMessage({ type: KDF_SALT_CHANGED_MESSAGE });
  } catch (error) {
    logger.warn("[SecurityVault] Could not announce the rotated KDF salt", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Starts listening for salt changes from sibling tabs. Idempotent. */
export function startVaultKdfSaltSync(
  onAdopted?: (result: Awaited<ReturnType<typeof adoptVaultKdfSaltFromStorage>>) => void | Promise<void>,
): void {
  if (listening) {
    adoptionHandler = onAdopted ?? adoptionHandler;
    return;
  }
  adoptionHandler = onAdopted ?? null;
  const target = ensureChannel();
  if (!target) {
    logger.warn(
      "[SecurityVault] BroadcastChannel unavailable — cross-tab KDF salt sync disabled",
    );
    return;
  }
  listening = true;
  syncGeneration += 1;
  target.onmessage = onMessage;
  logger.info(
    "[SecurityVault] Listening for KDF salt changes from other tabs (A-1)",
  );
}

/** Stops listening and releases the channel. Idempotent. */
export function stopVaultKdfSaltSync(): void {
  listening = false;
  syncGeneration += 1;
  adoptionHandler = null;
  if (!channel) {
    return;
  }
  channel.onmessage = null;
  channel.close();
  channel = null;
}
