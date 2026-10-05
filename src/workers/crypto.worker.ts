/// <reference lib="webworker" />
// ADR-019: Argon2id migration / Security hardening (crypto off-main-thread)

import {
  CRYPTO_ALGORITHM as ALGORITHM,
  decrypt,
  decryptBinary,
  decryptWithSessionKey,
  deriveDbKey,
  encrypt,
  encryptBinary,
  encryptWithSessionKey,
  generateSecureSalt,
  hashString,
  resetSessionKeyCache,
  setVaultKdfSalt,
} from "../utils/crypto-core";
import { logger } from "../utils/logger";

// Re-export types/constants that the worker message handler relies on
export { ALGORITHM };

const OPERATION_TIMEOUT_MS = 30000;

class OperationAbortError extends Error {
  constructor(operation: string) {
    super(`Timeout: ${operation} exceeded ${OPERATION_TIMEOUT_MS}ms`);
    this.name = "OperationAbortError";
  }
}

async function withTimeout<T>(
  promise: Promise<T>,
  operation: string,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new OperationAbortError(operation)),
      OPERATION_TIMEOUT_MS,
    );
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) {clearTimeout(timeoutId);}
  }
}

function resolvePassword(payload: Record<string, unknown>): Uint8Array {
  if (payload.passwordBytes instanceof Uint8Array) {
    const bytes = payload.passwordBytes as Uint8Array;
    delete payload.passwordBytes;
    return bytes;
  }
  if (typeof payload.password === "string") {
    const password = payload.password;
    delete payload.password;
    const encoder = new TextEncoder();
    const bytes = encoder.encode(password);
    // Best-effort clear of the source string reference
    payload.password = "";
    // Cap pathological passwords (longer than 512 chars) so Argon2id and
    // the downstream importKey/deriveKey calls never see a multi-KB buffer.
    // Clear the original full-length encoding before returning the capped
    // copy; otherwise truncation would leave a second sensitive buffer alive.
    if (bytes.length > 512) {
      const capped = bytes.slice(0, 512);
      bytes.fill(0);
      return capped;
    }
    return bytes;
  }
  throw new Error("Missing password or passwordBytes in payload");
}

function zeroPassword(pw: Uint8Array | null): void {
  if (pw) {
    try {
      pw.fill(0);
    } catch {
      /* INTENTIONAL SILENCE: zeroizing a detached password buffer is idempotent. */
    }
  }
}

function clearPayloadPassword(payload: unknown): void {
  if (!payload || typeof payload !== "object") {return;}
  const record = payload as Record<string, unknown>;
  if (record.passwordBytes instanceof Uint8Array) {
    record.passwordBytes.fill(0);
  }
  // Clearing the object reference does not erase the immutable string, but it
  // prevents the worker's queued MessageEvent from retaining that reference.
  if (typeof record.password === "string") {
    record.password = "";
  }
}

function releasePayloadStrings(payload: unknown): void {
  if (!payload || typeof payload !== "object") {return;}
  const record = payload as Record<string, unknown>;
  // sanitizePayload creates a second string reference for the operation. Drop
  // the original MessageEvent references immediately so large plaintexts do
  // not remain duplicated while crypto is running.
  for (const key of ["text", "encryptedBase64", "input", "password"]) {
    if (typeof record[key] === "string") {
      record[key] = "";
    }
  }
}

function sanitizePayload(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const MAX_INPUT_STRING = 50 * 1024 * 1024;
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (typeof value === "string") {
      // Cap every string input, not just `text`: `encryptedBase64`
      // (decrypt) runs base64ToU8a, which allocates ~3/4 of the string
      // length — a corrupted/oversized vault blob in IndexedDB (user-
      // local data) could otherwise force a multi-hundred-MB allocation
      // in the worker with no bound. Legitimate encrypted values in
      // SecureStorage (tokens, chains, quotas) are all far below 50 MB;
      // binary paths (backup exports) travel via `data`, which is NOT
      // capped by design so large exports keep working.
      safe[key] =
        value.length > MAX_INPUT_STRING
          ? value.slice(0, MAX_INPUT_STRING)
          : value;
    } else {
      safe[key] = value;
    }
  }
  return safe;
}

async function handleCryptoMessage(e: MessageEvent): Promise<void> {
  const { id, type, payload } = e.data;
  if (!id || !type) {
    clearPayloadPassword(payload);
    self.postMessage({
      id: id || "unknown",
      error: "Missing required fields: id, type",
    });
    return;
  }

  const safePayload = payload ? sanitizePayload(payload) : {};
  releasePayloadStrings(payload);

  // Unknown message types are rejected before any password check so the
  // worker never leaks a misleading "missing password" error.
  const KNOWN_TYPES = new Set([
    "encrypt",
    "decrypt",
    "encryptBinary",
    "decryptBinary",
    "deriveDbKey",
    "encryptWithSessionKey",
    "decryptWithSessionKey",
    "hash",
    "generateSecureSalt",
    "clearDatabase",
    "reset-session",
    "set-vault-salt",
    "deriveArgon2AesKey",
  ]);
  if (!KNOWN_TYPES.has(type)) {
    clearPayloadPassword(payload);
    clearPayloadPassword(safePayload);
    self.postMessage({ id, error: `Unknown crypto worker type: ${type}` });
    return;
  }

  // Operations that do not encrypt with the user password (session
  // management, hashing, salt generation) run without requiring one. This
  // matches the main-thread fallback in EncryptionService.runOnMainThread.
  if (type === "clearDatabase" || type === "reset-session") {
    clearPayloadPassword(payload);
    clearPayloadPassword(safePayload);
    resetSessionKeyCache();
    self.postMessage({ id, result: "ok" });
    return;
  }
  // A-1: install the per-vault Argon2id salt. Runs without a password (the
  // salt is public metadata) and is ordered ahead of every crypto operation by
  // the worker's FIFO message queue, so a salt set before an encrypt always
  // applies first.
  if (type === "set-vault-salt") {
    clearPayloadPassword(payload);
    clearPayloadPassword(safePayload);
    try {
      const salt = safePayload.salt;
      setVaultKdfSalt(typeof salt === "string" ? salt : null);
      self.postMessage({ id, result: "ok" });
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Crypto operation failed";
      self.postMessage({ id, error: message, code: "OPERATION_FAILED" });
    }
    return;
  }

  if (type === "hash" || type === "generateSecureSalt") {
    clearPayloadPassword(payload);
    clearPayloadPassword(safePayload);
    try {
      const result =
        type === "hash"
          ? await withTimeout(hashString(safePayload.input as string), type)
          : (generateSecureSalt() as unknown as string);
      self.postMessage({ id, result });
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Crypto operation failed";
      self.postMessage({ id, error: message, code: "OPERATION_FAILED" });
    }
    return;
  }

  try {
    let result: string | Uint8Array;
    const pw: Uint8Array | null =
      safePayload.password !== undefined ||
      safePayload.passwordBytes !== undefined
        ? resolvePassword(safePayload)
        : null;

    if (!pw) {
      releasePayloadStrings(safePayload);
      self.postMessage({
        id,
        error: "Missing password or passwordBytes in payload",
      });
      return;
    }
    const passwordBytes = pw;

    try {
      switch (type) {
        case "encrypt":
          result = await withTimeout(
            encrypt(safePayload.text as string, passwordBytes),
            type,
          );
          self.postMessage({ id, result });
          break;
        case "decrypt":
          result = await withTimeout(
            decrypt(safePayload.encryptedBase64 as string, passwordBytes),
            type,
          );
          self.postMessage({ id, result });
          break;
        case "encryptBinary":
          result = await withTimeout(
            encryptBinary(safePayload.data as Uint8Array, passwordBytes),
            type,
          );
          self.postMessage({ id, result }, [(result as Uint8Array).buffer]);
          break;
        case "decryptBinary":
          result = await withTimeout(
            decryptBinary(safePayload.data as Uint8Array, passwordBytes),
            type,
          );
          self.postMessage({ id, result }, [(result as Uint8Array).buffer]);
          break;
        case "deriveDbKey":
          result = await withTimeout(
            deriveDbKey(passwordBytes, safePayload.salt as string),
            type,
          );
          self.postMessage({ id, result });
          break;
        case "encryptWithSessionKey":
          result = await withTimeout(
            encryptWithSessionKey(
              safePayload.data as Uint8Array,
              passwordBytes,
            ),
            type,
          );
          self.postMessage({ id, result }, [(result as Uint8Array).buffer]);
          break;
        case "decryptWithSessionKey":
          result = await withTimeout(
            decryptWithSessionKey(
              safePayload.data as Uint8Array,
              passwordBytes,
            ),
            type,
          );
          self.postMessage({ id, result }, [(result as Uint8Array).buffer]);
          break;
        case "deriveArgon2AesKey": {
          // SECURITY: never export a raw derived key off the worker thread.
          // A derived AES key is non-extractable and must stay inside the
          // worker; callers should use the encrypt/decrypt/encryptWithSessionKey
          // messages instead. This branch is retained only as a guard.
          self.postMessage({
            id,
            error: "Raw key export is disabled for security",
          });
          break;
        }
        default:
          self.postMessage({
            id,
            error: `Unknown crypto worker type: ${type}`,
          });
      }
    } finally {
      zeroPassword(passwordBytes);
      // ADR-044: Always clear the original MessageEvent payload's password
      // bytes on BOTH success and error paths. The success path only zeroed
      // the derived `passwordBytes` from `resolvePassword`, leaving the
      // original `payload.passwordBytes` Uint8Array in the worker's
      // MessageEvent buffer until GC.
      clearPayloadPassword(payload);
      clearPayloadPassword(safePayload);
    }
  } catch (error: unknown) {
    // Covers malformed password payloads that fail inside resolvePassword
    // before the operation-level finally has acquired a Uint8Array.
    clearPayloadPassword(payload);
    clearPayloadPassword(safePayload);
    releasePayloadStrings(safePayload);
    const message =
      error instanceof Error ? error.message : "Crypto operation failed";
    const code =
      error instanceof Error && error.message.startsWith("Timeout")
        ? "TIMEOUT"
        : "OPERATION_FAILED";
    self.postMessage({ id, error: message, code });
  }
}

// Serialize operations in this single worker. In particular, a reset-session
// message must not clear the session-key cache while an async encrypt/decrypt
// operation is still using it.
let cryptoMessageQueue: Promise<void> = Promise.resolve();
let cryptoQueueLength = 0;
const MAX_CRYPTO_QUEUE = 100;
self.onmessage = (e: MessageEvent) => {
  const id = (e.data as { id?: unknown } | undefined)?.id ?? "unknown";
  if (cryptoQueueLength >= MAX_CRYPTO_QUEUE) {
    const payload = (e.data as { payload?: unknown } | undefined)?.payload;
    clearPayloadPassword(payload);
    releasePayloadStrings(payload);
    self.postMessage({
      id,
      error: "Crypto worker queue is full",
      code: "QUEUE_FULL",
    });
    return Promise.resolve();
  }

  cryptoQueueLength += 1;
  cryptoMessageQueue = cryptoMessageQueue
    .then(() => handleCryptoMessage(e))
    .catch((error: unknown) => {
      logger.error("[CryptoWorker] Unhandled message queue error", {
        error: error instanceof Error ? error.message : String(error),
      });
      self.postMessage({
        id,
        error: "Crypto worker message processing failed",
        code: "OPERATION_FAILED",
      });
    })
    .finally(() => {
      cryptoQueueLength -= 1;
    });
  // Returning the queue makes the handler awaitable in deterministic test
  // harnesses while browsers continue to ignore the return value.
  return cryptoMessageQueue;
};
