import { Voy, EmbeddedResource } from "voy-search";
import type {
  QuantizationMode,
  QuantizedVector,
} from "../services/ai/QuantizationService";
import { deriveArgon2idAesKey } from "../utils/argon2-kdf";
import { logger } from "../utils/logger";

interface IndexedDocument {
  id: string;
  title: string;
  url: string;
  // The public service historically used `embeddings` while the worker's
  // internal buffer used `embedding`; accept both at the boundary and
  // normalize during commit.
  embedding?: number[];
  embeddings?: number[];
}

let voy: Voy | null = null;
let documents: EmbeddedResource[] = [];
let quantizedDocuments: QuantizedVector[] = [];
let uncommittedDocuments: IndexedDocument[] = [];
let mode: QuantizationMode = "none";
let rotationMatrix: Float32Array | null = null;
let cachedMemoryUsage = 0;
// MEDIUM #8 (third-pass review): track in-flight searches so SET_KEY
// doesn't drop `voy` underneath a mid-await. We reject SET_KEY with a
// typed error if searches are pending, forcing the caller to flush.
let pendingSearches = 0;
let workerFatal = false;
// Tracks committed-but-unpersisted documents: SET_KEY must not wipe state
// that has not been persisted to IndexedDB yet, otherwise the data is lost
// (no LOAD_INDEX can rehydrate what was never saved).
let isDirty = false;

function isOperationTimeout(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.startsWith("Timeout:")
  );
}

// ──────────────────────────────────────────────────────────────
// S2/R2 (post-audit): At-rest encryption for the HNSW index.
// The worker receives a derived AES-GCM key from SecurityVault via
// SET_KEY postMessage. All SAVE_INDEX payloads are encrypted before
// being written to IndexedDB, and LOAD_INDEX payloads are decrypted
// before re-hydrating the in-memory Voy search engine.
// ──────────────────────────────────────────────────────────────
let derivedAesKey: CryptoKey | null = null;
// Per-session random key id so legacy plaintext indexes (pre-S2) are
// detected and re-encrypted transparently after first successful decrypt.
let currentKeyId: string | null = null;

/**
 * IndexedDB request success is not the same as transaction commit. Keep the
 * worker's SAVE_INDEX/CLEAR acknowledgements durable so callers never receive
 * SUCCESS before a quota or transaction abort has been observed.
 */
function waitForIdbCommit(
  transaction: IDBTransaction,
  request: IDBRequest,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (error: unknown) => {
      if (settled) {return;}
      settled = true;
      reject(error instanceof Error ? error : new Error(String(error)));
    };
    request.onerror = () =>
      fail(request.error ?? new Error("Voy index write request failed"));
    transaction.onerror = () =>
      fail(transaction.error ?? new Error("Voy index transaction failed"));
    transaction.onabort = () =>
      fail(transaction.error ?? new Error("Voy index transaction aborted"));
    transaction.oncomplete = () => {
      if (settled) {return;}
      settled = true;
      resolve();
    };
  });
}

const idb = {
  db: null as IDBDatabase | null,
  initPromise: null as Promise<void> | null,
  async init(): Promise<void> {
    if (this.db) {return;}
    if (this.initPromise) {
      return this.initPromise;
    }
    const operation = new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("VoyIndexDB", 1);
      request.onupgradeneeded = (e) => {
        const db = (e.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains("index")) {
          db.createObjectStore("index");
        }
      };
      request.onsuccess = (e) => {
        this.db = (e.target as IDBOpenDBRequest).result;
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
    this.initPromise = operation;
    try {
      await operation;
    } finally {
      if (this.initPromise === operation) {
        this.initPromise = null;
      }
    }
  },
  async get(key: string): Promise<unknown> {
    await this.init();
    return new Promise<unknown>((resolve, reject) => {
      const tx = this.db!.transaction("index", "readonly");
      const store = tx.objectStore("index");
      const request = store.get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  },
  async set(key: string, value: unknown): Promise<void> {
    await this.init();
    const tx = this.db!.transaction("index", "readwrite");
    const store = tx.objectStore("index");
    const request = store.put(value, key);
    await waitForIdbCommit(tx, request);
  },
  async clear(): Promise<void> {
    await this.init();
    const tx = this.db!.transaction("index", "readwrite");
    const store = tx.objectStore("index");
    const request = store.clear();
    await waitForIdbCommit(tx, request);
  },
};

interface SerializedIndexData {
  mode: string;
  documents: SerializedDocument[];
  quantizedDocuments: SerializedQuantizedVector[];
  rotationMatrix: number[] | null;
}

interface SerializedDocument {
  id: string;
  title: string;
  url: string;
  embeddings: number[];
  data?: number[];
  scale?: number;
}

interface SerializedQuantizedVector {
  id: string;
  title: string;
  url: string;
  data: number[];
  scale?: number;
}

interface EncryptedIndexEnvelope {
  // v = envelope version. "1" = first iteration (post-S2 of the audit).
  v: "1";
  // Unique key id (per vault unlock). Used to detect password rotations
  // and to gracefully migrate from pre-S2 plaintext indexes.
  k: string;
  // AES-GCM IV (12 bytes raw).
  iv: number[];
  // Ciphertext (bytes for serialized JSON of SerializedIndexData).
  ct: number[];
}

function hasValidEmbeddings(values: number[]): boolean {
  return values.length > 0 && values.every((v) => Number.isFinite(v));
}

function convertToEmbeddedResource(
  doc: SerializedDocument,
): EmbeddedResource | null {
  if (!hasValidEmbeddings(doc.embeddings)) {
    logger.warn(
      `[VoyWorker] Skipping document ${doc.id} due to non-finite embedding values`,
    );
    return null;
  }
  return {
    id: doc.id,
    title: doc.title,
    url: doc.url,
    embeddings: doc.embeddings,
  };
}

function convertToQuantizedVector(
  sv: SerializedQuantizedVector,
): QuantizedVector | null {
  if (sv.data.length > 0 && !sv.data.every((v) => Number.isFinite(v))) {
    logger.warn(
      `[VoyWorker] Skipping quantized document ${sv.id} due to non-finite data values`,
    );
    return null;
  }
  return {
    id: sv.id,
    title: sv.title,
    url: sv.url,
    data: new Uint8Array(sv.data),
    scale: sv.scale,
  };
}

function processEmbedding(
  id: string,
  title: string,
  url: string,
  embedding: number[],
): EmbeddedResource {
  cachedMemoryUsage += embedding.length * 4;
  return { id, title, url, embeddings: embedding };
}

function getIndexedDocumentCount(): number {
  return (
    documents.length + quantizedDocuments.length + uncommittedDocuments.length
  );
}

function releaseSerializedIndex(data: SerializedIndexData): void {
  data.mode = "";
  for (const document of data.documents) {
    document.id = "";
    document.title = "";
    document.url = "";
    document.embeddings.fill(0);
    document.embeddings.length = 0;
  }
  for (const vector of data.quantizedDocuments) {
    vector.id = "";
    vector.title = "";
    vector.url = "";
    vector.data.fill(0);
    vector.data.length = 0;
  }
  if (data.rotationMatrix) {
    data.rotationMatrix.fill(0);
    data.rotationMatrix.length = 0;
  }
  data.documents.length = 0;
  data.quantizedDocuments.length = 0;
  data.rotationMatrix = null;
}

function commitBuffer() {
  if (uncommittedDocuments.length === 0) {return;}

  // Validate and normalize the whole batch before mutating the committed
  // index. This prevents a malformed item halfway through a batch from
  // deleting an existing document and leaving the buffer partially applied.
  const prepared = uncommittedDocuments
    .map((item) => ({
      item,
      embedding: item.embedding ?? item.embeddings,
    }))
    .filter(({ item, embedding }) =>
      item.id &&
      item.title &&
      item.url &&
      Array.isArray(embedding) &&
      embedding.length > 0 &&
      embedding.length <= MAX_EMBEDDING_SIZE &&
      embedding.every((value) => Number.isFinite(value)),
    );

  if (prepared.length === 0) {
    // All items were invalid — clear the buffer to prevent an infinite
    // crash loop where the same bad batch is retried on every operation.
    uncommittedDocuments = [];
    return;
  }

  const incomingIds = new Set(prepared.map(({ item }) => item.id));
  const replacedMemory = documents
    .filter((document) => incomingIds.has(document.id))
    .reduce(
      (total, document) => total + (document.embeddings?.length ?? 0) * 4,
      0,
    );
  cachedMemoryUsage = Math.max(0, cachedMemoryUsage - replacedMemory);
  const previousDocuments = documents;
  const previousVoy = voy;
  documents = documents.filter((d) => !incomingIds.has(d.id));
  if (quantizedDocuments.length > 0) {
    quantizedDocuments = quantizedDocuments.filter(
      (d) => !incomingIds.has(d.id),
    );
  }

  for (const { item, embedding } of prepared) {
    const processed = processEmbedding(item.id, item.title, item.url, embedding!);
    documents.push(processed);
  }
  try {
    voy = new Voy({ embeddings: documents });
  } catch (voyError) {
    // Roll back the mutated documents array and restore the previous
    // Voy instance so the worker stays usable. Keep uncommittedDocuments
    // intact so the caller can retry or flush — and prevent an infinite
    // retry loop by setting workerFatal.
    documents = previousDocuments;
    voy = previousVoy;
    cachedMemoryUsage = Math.max(0, cachedMemoryUsage - replacedMemory);
    workerFatal = true;
    logger.error("[VoyWorker] commitBuffer: Voy construction failed — worker disabled", {
      error: voyError instanceof Error ? voyError.message : String(voyError),
    });
    throw voyError;
  }
  uncommittedDocuments = [];
  // Documents are now committed in memory but not yet persisted to IndexedDB.
  // SET_KEY must refuse to wipe state while this flag is set.
  isDirty = true;
}

const OPERATION_TIMEOUT_MS = 15000;
const MAX_DOCUMENTS = 50000;
const MAX_EMBEDDING_SIZE = 4096;

export function exceedsDocumentLimit(
  currentCount: number,
  incomingCount: number,
  limit = MAX_DOCUMENTS,
): boolean {
  return currentCount + incomingCount > limit;
}

function validateEmbedding(value: unknown): string | null {
  if (!Array.isArray(value)) {return "Embedding must be an array";}
  if (value.length === 0 || value.length > MAX_EMBEDDING_SIZE) {
    return `Embedding size must be between 1 and ${MAX_EMBEDDING_SIZE}`;
  }
  if (
    !value.every(
      (entry) => typeof entry === "number" && Number.isFinite(entry),
    )
  ) {
    return "Embedding must contain only finite numbers";
  }
  return null;
}

function clearPasswordBytes(payload: unknown): void {
  if (typeof payload !== "object" || payload === null) {return;}
  const passwordBytes = (payload as Record<string, unknown>).passwordBytes;
  if (passwordBytes instanceof Uint8Array) {
    passwordBytes.fill(0);
  }
}

function validatePayload(
  type: string,
  payload: Record<string, unknown>,
): string | null {
  switch (type) {
    case "INIT": {
      if (!Array.isArray(payload.embeddings)) {
        return "INIT requires embeddings array";
      }
      if (payload.embeddings.length > MAX_DOCUMENTS) {
        return `Exceeded max documents: ${payload.embeddings.length} > ${MAX_DOCUMENTS}`;
      }
      for (const item of payload.embeddings) {
        if (typeof item !== "object" || item === null) {
          return "INIT contains an invalid document";
        }
        const document = item as Record<string, unknown>;
        if (
          typeof document.id !== "string" ||
          typeof document.title !== "string" ||
          typeof document.url !== "string"
        ) {
          return "INIT requires id, title, and url strings";
        }
        const embeddingError = validateEmbedding(document.embeddings);
        if (embeddingError) {return embeddingError;}
      }
      break;
    }
    case "ADD": {
      const embedding = payload.embedding ?? payload.embeddings;
      const embeddingError = validateEmbedding(embedding);
      if (embeddingError) {return embeddingError;}
      if (
        typeof payload.id !== "string" ||
        typeof payload.title !== "string" ||
        typeof payload.url !== "string"
      ) {
        return "ADD requires id, title, and url strings";
      }
      break;
    }
    case "BATCH_ADD":
    case "REPLACE": {
      if (!Array.isArray(payload.items)) {
        return `${type} requires items array`;
      }
      if (payload.items.length > MAX_DOCUMENTS) {
        return `Exceeded max batch size: ${payload.items.length} > ${MAX_DOCUMENTS}`;
      }
      if (
        type === "REPLACE" &&
        (!Array.isArray(payload.removeIds) ||
          !payload.removeIds.every((value: unknown) => typeof value === "string"))
      ) {
        return "REPLACE requires removeIds string array";
      }
      for (const item of payload.items) {
        if (typeof item !== "object" || item === null) {
          return `${type} contains an invalid document`;
        }
        const document = item as Record<string, unknown>;
        if (
          typeof document.id !== "string" ||
          typeof document.title !== "string" ||
          typeof document.url !== "string"
        ) {
          return `${type} requires id, title, and url strings`;
        }
        const embeddingError = validateEmbedding(
          document.embedding ?? document.embeddings,
        );
        if (embeddingError) {return embeddingError;}
      }
      break;
    }
    case "SEARCH": {
      const embeddingError = validateEmbedding(payload.embedding);
      if (embeddingError) {return embeddingError;}
      const rawTopK = payload.topK;
      if (
        rawTopK !== undefined &&
        rawTopK !== null &&
        (typeof rawTopK !== "number" ||
          !Number.isInteger(rawTopK) ||
          rawTopK < 1 ||
          rawTopK > 100)
      ) {
        return "topK must be an integer between 1 and 100";
      }
      break;
    }
    case "SET_KEY":
      if (
        !payload.passwordBytes ||
        !(payload.passwordBytes instanceof Uint8Array)
      ) {
        return "SET_KEY requires passwordBytes Uint8Array";
      }
      if (typeof payload.vaultSalt !== "string") {
        return "SET_KEY requires vaultSalt string";
      }
      break;
  }
  return null;
}

async function withTimeout<T>(
  promise: Promise<T>,
  operation: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new Error(`Timeout: ${operation} exceeded ${OPERATION_TIMEOUT_MS}ms`),
        ),
      OPERATION_TIMEOUT_MS,
    );
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

// S2/R2 + S1/R3: derive an AES-GCM key from master password bytes
// using Argon2id (V4 — the ONLY supported KDF).
// The key is ephemeral (lifetime = vault unlock).
// ADR-046 parity (voy index): the salt is the vault's OWN 16-byte per-vault
// KDF salt, sent by the main thread and validated hex — never a bundle-wide
// constant. A shared salt would let one Argon2id pass over a candidate
// password attack every vault's persisted index at once (RFC 9106 requires a
// unique salt per password). The salt is public metadata; only its
// uniqueness matters, exactly like the master-key corpus.

/** 16 random bytes, lowercase hex — same shape as crypto-core's salt. */
const VOY_VAULT_SALT_HEX_RE = /^[0-9a-f]{32}$/;

async function deriveIndexKey(
  passwordBytes: Uint8Array,
  vaultSaltHex: string,
): Promise<CryptoKey> {
  const salt = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    salt[i] = parseInt(vaultSaltHex.slice(i * 2, i * 2 + 2), 16)!;
  }
  const key = await deriveArgon2idAesKey(passwordBytes, salt);
  if (!key)
    {throw new Error("Argon2id unavailable for Voy index key derivation");}
  return key;
}

async function encryptSerializedIndex(
  data: SerializedIndexData,
  key: CryptoKey,
): Promise<EncryptedIndexEnvelope> {
  const plaintext = new TextEncoder().encode(JSON.stringify(data));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  let ct: Uint8Array;
  try {
    ct = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        key,
        plaintext as Uint8Array<ArrayBuffer>,
      ),
    );
  } finally {
    // The encrypted envelope is rebuilt from `ct`; plaintext is no longer
    // needed after Web Crypto has copied it into the AES-GCM operation.
    plaintext.fill(0);
  }
  return {
    v: "1",
    k: currentKeyId ?? "unknown",
    iv: Array.from(iv),
    ct: Array.from(ct),
  };
}

async function decryptIndexEnvelope(
  envelope: EncryptedIndexEnvelope,
  key: CryptoKey,
): Promise<SerializedIndexData> {
  if (envelope.v !== "1") {
    throw new Error(`Unsupported index envelope version: ${envelope.v}`);
  }
  const iv = new Uint8Array(envelope.iv);
  const ct = new Uint8Array(envelope.ct);
  const buf = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv as Uint8Array<ArrayBuffer> },
    key,
    ct as Uint8Array<ArrayBuffer>,
  );
  try {
    const json = new TextDecoder().decode(buf);
    return JSON.parse(json) as SerializedIndexData;
  } finally {
    // Parsed documents are copied into the index; do not retain the decrypted
    // ArrayBuffer after hydration, including when JSON.parse fails.
    new Uint8Array(buf).fill(0);
  }
}

async function handleWorkerMessage(e: MessageEvent): Promise<void> {
  if (workerFatal) {
    const data = e.data as Record<string, unknown>;
    const id = data.id ?? "unknown";
    self.postMessage({
      id,
      type: "ERROR",
      error: "Voy worker unavailable after fatal timeout",
      fatal: true,
    });
    clearPasswordBytes(data.payload);
    return;
  }

  const { type, payload, id } = e.data;

  if (!id || !type) {
    self.postMessage({
      id: id || "unknown",
      type: "ERROR",
      error: "Missing required fields: id, type",
    });
    return;
  }

  const validationError = payload
    ? validatePayload(type, payload as Record<string, unknown>)
    : null;
  if (validationError) {
    // Validation can reject a SET_KEY before its operation-level finally runs
    // (for example when userId is missing). Clear any cloned password bytes
    // before returning the validation error.
    clearPasswordBytes(payload);
    self.postMessage({ id, type: "ERROR", error: validationError });
    return;
  }

  try {
    switch (type) {
      // ── S2/R2: receive derived index key from main thread ───────
      case "SET_KEY": {
        // Payload validation guarantees this is a Uint8Array. Take ownership
        // before any guard can return early so rejected key replacements also
        // clear the worker's cloned password bytes.
        const bytes = payload.passwordBytes as Uint8Array;
        try {
          // HIGH-severity fix (post-review): refuse SET_KEY if there are
          // uncommitted documents — wiping in-memory state would lose data
          // that the caller has not yet persisted.
        if (uncommittedDocuments.length > 0) {
          self.postMessage({
            id,
            type: "ERROR",
            error:
              "REFUSE_KEY_REPLACE_UNCOMMITTED: " +
              `commit or clear ${uncommittedDocuments.length} pending documents first.`,
          });
          return;
        }
        // HIGH-severity fix: refuse SET_KEY when committed documents have
        // not been persisted to IndexedDB yet. Without this guard, SET_KEY
        // wipes the in-memory index and the next LOAD_INDEX finds nothing
        // because SAVE_INDEX was never called — the data is permanently lost.
        if (isDirty) {
          self.postMessage({
            id,
            type: "ERROR",
            error:
              "REFUSE_KEY_REPLACE_DIRTY: " +
              "SAVE_INDEX first — committed documents are not yet persisted.",
          });
          return;
        }
        // MEDIUM #8 (third review pass): guard against in-flight searches
        // so we don't null out `voy` mid-await.
        if (pendingSearches > 0) {
          self.postMessage({
            id,
            type: "ERROR",
            error:
              "REFUSE_KEY_DURING_SEARCH: " +
              `${pendingSearches} search(es) in flight \u2014 retry after they complete.`,
          });
          return;
        }
        const vaultSaltHex = payload.vaultSalt as string;
        if (!VOY_VAULT_SALT_HEX_RE.test(vaultSaltHex)) {
          self.postMessage({
            id,
            type: "ERROR",
            error:
              "SET_KEY requires vaultSalt: 32 lowercase hex chars (the vault's per-vault KDF salt, ADR-046).",
          });
          return;
        }
        derivedAesKey = await deriveIndexKey(bytes, vaultSaltHex);
        currentKeyId = (payload.keyId as string) ?? null;
        // After a successful key set, the in-memory Voy state must be wiped
        // so the next LOAD_INDEX inside this vault session rehydrates fresh.
        documents = [];
        quantizedDocuments = [];
        uncommittedDocuments = [];
        voy = null;
        cachedMemoryUsage = 0;
        self.postMessage({ id, type: "SUCCESS" });
          break;
        } finally {
          bytes.fill(0);
        }
      }
      case "CLEAR_KEY": {
        derivedAesKey = null;
        currentKeyId = null;
        documents = [];
        quantizedDocuments = [];
        uncommittedDocuments = [];
        voy = null;
        cachedMemoryUsage = 0;
        self.postMessage({ id, type: "SUCCESS" });
        break;
      }

      case "INIT": {
        mode = payload.quantizationMode || "none";
        documents = [];
        quantizedDocuments = [];
        uncommittedDocuments = [];
        voy = null;
        cachedMemoryUsage = 0;
        isDirty = false;

        const embeddings = payload.embeddings || [];
        for (const item of embeddings) {
          documents.push(
            processEmbedding(item.id, item.title, item.url, item.embeddings),
          );
        }
        // The committed documents retain only the normalized fields. Drop the
        // original message array and item objects after indexing to avoid
        // keeping a second large metadata graph alive in the worker.
        payload.embeddings = [];

        voy = new Voy({ embeddings: documents as unknown as EmbeddedResource[] });
        self.postMessage({ id, type: "SUCCESS" });
        break;
      }

      case "ADD": {
        const existingIdx = uncommittedDocuments.findIndex(
          (d) => d.id === payload.id,
        );
        const replacesCommittedDocument = documents.some(
          (d) => d.id === payload.id,
        );
        const currentCount =
          documents.length +
          quantizedDocuments.length +
          uncommittedDocuments.length;
        if (
          !replacesCommittedDocument &&
          existingIdx < 0 &&
          exceedsDocumentLimit(currentCount, 1)
        ) {
          self.postMessage({
            id,
            type: "ERROR",
            error: `Max documents (${MAX_DOCUMENTS}) reached`,
          });
          break;
        }
        if (existingIdx >= 0) {
          uncommittedDocuments[existingIdx] = payload;
        } else {
          uncommittedDocuments.push(payload);
        }
        if (uncommittedDocuments.length >= 50) {
          commitBuffer();
        }
        self.postMessage({ id, type: "SUCCESS" });
        break;
      }

      case "REPLACE": {
        const previousDocuments = documents;
        const previousQuantizedDocuments = quantizedDocuments;
        const previousUncommittedDocuments = uncommittedDocuments;
        const previousVoy = voy;
        const previousMemoryUsage = cachedMemoryUsage;
        const removeIds = new Set<string>(payload.removeIds);
        const replacementIds = new Set<string>(
          payload.items.map((item: { id: string }) => item.id),
        );
        const existingIds = new Set([
          ...documents
            .filter((document) => !removeIds.has(document.id))
            .map((document) => document.id),
          ...uncommittedDocuments
            .filter((document) => !removeIds.has(document.id))
            .map((document) => document.id),
        ]);
        const newDocumentCount = [...replacementIds].filter(
          (itemId) => !existingIds.has(itemId),
        ).length;
        const remainingCount =
          documents.filter((document) => !removeIds.has(document.id)).length +
          quantizedDocuments.filter((document) => !removeIds.has(document.id)).length +
          uncommittedDocuments.filter((document) => !removeIds.has(document.id)).length;
        if (exceedsDocumentLimit(remainingCount, newDocumentCount)) {
          self.postMessage({
            id,
            type: "ERROR",
            error: `Max documents (${MAX_DOCUMENTS}) reached`,
          });
          break;
        }
        const removedMemory = documents
          .filter((document) => removeIds.has(document.id))
          .reduce(
            (total, document) => total + (document.embeddings?.length ?? 0) * 4,
            0,
          );
        cachedMemoryUsage = Math.max(0, cachedMemoryUsage - removedMemory);
        documents = documents.filter((document) => !removeIds.has(document.id));
        quantizedDocuments = quantizedDocuments.filter(
          (document) => !removeIds.has(document.id),
        );
        uncommittedDocuments = uncommittedDocuments.filter(
          (document) => !removeIds.has(document.id),
        );
        try {
          uncommittedDocuments.push(...payload.items);
          commitBuffer();
          payload.items = [];
          payload.removeIds = [];
          self.postMessage({ id, type: "SUCCESS" });
        } catch (error) {
          documents = previousDocuments;
          quantizedDocuments = previousQuantizedDocuments;
          uncommittedDocuments = previousUncommittedDocuments;
          voy = previousVoy;
          cachedMemoryUsage = previousMemoryUsage;
          throw error;
        }
        break;
      }

      case "BATCH_ADD": {
        const batchMap = new Map<string, (typeof payload)["items"][0]>();
        for (const item of payload.items) {
          batchMap.set(item.id, item);
        }
        const existingIds = new Set([
          ...documents.map((document) => document.id),
          ...uncommittedDocuments.map((document) => document.id),
        ]);
        const newDocumentCount = [...batchMap.keys()].filter(
          (itemId) => !existingIds.has(itemId),
        ).length;
        const currentCount =
          documents.length +
          quantizedDocuments.length +
          uncommittedDocuments.length;
        if (exceedsDocumentLimit(currentCount, newDocumentCount)) {
          self.postMessage({
            id,
            type: "ERROR",
            error: `Max documents (${MAX_DOCUMENTS}) reached`,
          });
          break;
        }
        const uncommittedIds = new Set(uncommittedDocuments.map((d) => d.id));
        for (const item of batchMap.values()) {
          if (uncommittedIds.has(item.id)) {
            const idx = uncommittedDocuments.findIndex((d) => d.id === item.id);
            uncommittedDocuments[idx] = item;
          } else {
            uncommittedDocuments.push(item);
          }
        }
        commitBuffer();
        // commitBuffer has copied the normalized fields into `documents` and
        // cleared its pending object list; release the original batch array.
        payload.items = [];
        self.postMessage({ id, type: "SUCCESS" });
        break;
      }

      case "COMMIT":
        commitBuffer();
        self.postMessage({ id, type: "SUCCESS" });
        break;

      case "SEARCH": {
        commitBuffer();
        if (!voy) {
          self.postMessage({
            id,
            type: "ERROR",
            error: "Voy index not initialized. Send INIT first.",
          });
          break;
        }
        const queryEmbedding = payload.embedding;
        const topK = payload.topK || 5;

        // MEDIUM #8 (third review pass): track in-flight count so SET_KEY
        // cannot drop `voy` mid-search.
        pendingSearches += 1;
        try {
          const results = await withTimeout(
            Promise.resolve().then(() =>
              voy!.search(new Float32Array(queryEmbedding), topK),
            ),
            type,
          );
          self.postMessage({ id, type: "SUCCESS", payload: results });
        } catch (error) {
          if (!isOperationTimeout(error)) {throw error;}
          // Promise.race cannot cancel Voy.search. Poison the worker so the
          // main service retires it instead of allowing a late search to race
          // with SET_KEY, CLEAR, or another SEARCH operation.
          workerFatal = true;
          self.postMessage({
            id,
            type: "ERROR",
            error: error instanceof Error ? error.message : String(error),
            fatal: true,
          });
        } finally {
          pendingSearches -= 1;
        }
        break;
      }

      case "CLEAR":
        documents = [];
        quantizedDocuments = [];
        uncommittedDocuments = [];
        voy = null;
        cachedMemoryUsage = 0;
        await idb.clear();
        self.postMessage({ id, type: "SUCCESS" });
        break;

      case "CLEAR_MEMORY":
        documents = [];
        quantizedDocuments = [];
        uncommittedDocuments = [];
        voy = null;
        rotationMatrix = null;
        cachedMemoryUsage = 0;
        isDirty = false;
        self.postMessage({ id, type: "SUCCESS" });
        break;

      // ── S2/R2: SAVE_INDEX now encrypts the payload ───────────────
      case "SAVE_INDEX": {
        commitBuffer();
        const serialized: SerializedIndexData = {
          mode,
          documents: documents.map((d) => ({
            id: d.id,
            title: d.title,
            url: d.url,
            embeddings: Array.from(d.embeddings ?? []),
          })),
          quantizedDocuments: quantizedDocuments.map((q) => ({
            id: q.id,
            title: q.title,
            url: q.url,
            data: Array.from(q.data),
            scale: q.scale,
          })),
          rotationMatrix: rotationMatrix ? Array.from(rotationMatrix) : null,
        };
        try {
          if (!derivedAesKey) {
            // Fail closed: the index contains document metadata and embeddings,
            // so it must never be persisted without an active vault key. Do not
            // clear an existing encrypted record here — a locked session may be
            // rebuilding only because it cannot decrypt that record yet.
            logger.warn(
              "[VoyWorker] SAVE_INDEX: vault key unavailable — refusing plaintext persistence",
            );
            self.postMessage({
              id,
              type: "SUCCESS",
              payload: { encrypted: false, persisted: false },
            });
            break;
          }
          const envelope = await encryptSerializedIndex(
            serialized,
            derivedAesKey,
          );
          await idb.set("indexData", envelope);
          // Documents are now persisted — SET_KEY can safely proceed.
          isDirty = false;
          self.postMessage({
            id,
            type: "SUCCESS",
            payload: { encrypted: true },
          });
          break;
        } finally {
          // The encrypted envelope is independent from this serialization.
          // Clear its strings and numeric arrays on both success and failure
          // to reduce the peak lifetime of large index snapshots.
          releaseSerializedIndex(serialized);
        }
      }

      // ── S2/R2: LOAD_INDEX decrypts before re-hydrating ─────────
      case "LOAD_INDEX": {
        const data = (await idb.get("indexData")) as
          SerializedIndexData | EncryptedIndexEnvelope | null;
        if (!data) {
          self.postMessage({ id, type: "SUCCESS", payload: { loaded: false } });
          break;
        }
        // Detect envelope: encrypted saves carry {v, k, iv, ct} with v === "1".
        // Also checks k is a string and iv/ct contain only numbers to avoid
        // false positives on legacy plaintext documents with similarly named fields.
        const d = data as unknown as Record<string, unknown>;
        const isEnvelope =
          typeof data === "object" &&
          data !== null &&
          d?.v === "1" &&
          typeof d.k === "string" &&
          Array.isArray(d.iv) &&
          d.iv.length > 0 &&
          (d.iv as unknown[]).every((x) => typeof x === "number") &&
          Array.isArray(d.ct) &&
          d.ct.length > 0 &&
          (d.ct as unknown[]).every((x) => typeof x === "number") &&
          !d.__legacyNoKey;
        let restored: SerializedIndexData;
        if (isEnvelope) {
          if (!derivedAesKey) {
            // No key loaded (vault locked or new device): we cannot decrypt.
            // We expose the count only if envelope.k matches a known stale
            // session — otherwise refuse.
            logger.warn(
              "[VoyWorker] LOAD_INDEX: encrypted envelope found but no key set",
            );
            self.postMessage({
              id,
              type: "ERROR",
              error:
                "Encrypted index present but vault is locked or new session — re-unlock to decrypt.",
            });
            break;
          }
          try {
            restored = await decryptIndexEnvelope(
              data as EncryptedIndexEnvelope,
              derivedAesKey,
            );
          } catch (e: unknown) {
            // Could be a previous-master-password mismatch → user changed password.
            // We surface a typed error so the caller can trigger nuclearForget if appropriate.
            self.postMessage({
              id,
              type: "ERROR",
              error: `INDEX_DECRYPT_FAILED: ${e instanceof Error ? e.message : String(e)}`,
            });
            break;
          }
        } else {
          // Legacy/plaintext records are not migrated by loading them into
          // memory: doing so would expose private embeddings after a vault
          // transition and would keep sensitive data at rest. Purge the
          // record and rebuild from the encrypted source collections instead.
          await idb.clear();
          logger.warn(
            "[VoyWorker] LOAD_INDEX: plaintext or malformed index purged; rebuilding without persistence",
          );
          self.postMessage({
            id,
            type: "SUCCESS",
            payload: { loaded: false, legacyPurged: true },
          });
          break;
        }
        const restoredDocuments = restored.documents || [];
        const hasMalformedDocument = restoredDocuments.some(
          (document) =>
            !document ||
            typeof document.id !== "string" ||
            typeof document.title !== "string" ||
            typeof document.url !== "string",
        );
        if (hasMalformedDocument) {
          // Do not partially hydrate or overwrite a damaged encrypted index.
          // The main service will rebuild from the authoritative RxDB sources.
          logger.warn("[VoyWorker] LOAD_INDEX: malformed document metadata; rebuilding");
          self.postMessage({
            id,
            type: "SUCCESS",
            payload: { loaded: false, malformed: true },
          });
          break;
        }
        mode = restored.mode as QuantizationMode;
        let legacyNormalized = false;
        const normalizedDocuments = new Map<string, SerializedDocument>();
        for (const document of restored.documents || []) {
          const isChunkSource =
            document.url === "document" || document.url === "bookmark";
          const normalizedId =
            isChunkSource &&
            !document.id.startsWith("chunk:") &&
            !document.id.startsWith("atom:")
              ? `chunk:${document.id}`
              : document.id;
          if (normalizedId !== document.id) {
            legacyNormalized = true;
          }
          const normalized = { ...document, id: normalizedId };
          if (normalizedDocuments.has(normalizedId)) {
            // Prefer an already-normalized record when a legacy index contains
            // both `id` and `chunk:id` for the same source.
            legacyNormalized = true;
            if (document.id === normalizedId) {
              normalizedDocuments.set(normalizedId, normalized);
            }
          } else {
            normalizedDocuments.set(normalizedId, normalized);
          }
        }
        if (normalizedDocuments.size !== (restored.documents || []).length) {
          legacyNormalized = true;
        }
        documents = [...normalizedDocuments.values()]
          .map(convertToEmbeddedResource)
          .filter((d): d is EmbeddedResource => d !== null);
        quantizedDocuments = (restored.quantizedDocuments || [])
          .map(convertToQuantizedVector)
          .filter((d): d is QuantizedVector => d !== null);
        cachedMemoryUsage =
          documents.reduce(
            (total, document) =>
              total + (document.embeddings?.length ?? 0) * 4,
            0,
          ) +
          quantizedDocuments.reduce((total, vector) => total + vector.data.byteLength, 0);
        rotationMatrix = restored.rotationMatrix
          ? new Float32Array(restored.rotationMatrix)
          : null;
        if (documents.length > 0) {
          voy = new Voy({ embeddings: documents });
        }
        self.postMessage({
          id,
          type: "SUCCESS",
          payload: {
            loaded: true,
            mode,
            count: getIndexedDocumentCount(),
            legacyNormalized,
          },
        });
        break;
      }

      case "GET_STATS":
        self.postMessage({
          id,
          type: "SUCCESS",
          payload: {
            count: getIndexedDocumentCount(),
            mode,
            memoryUsageBytes: cachedMemoryUsage,
            isHealthy: true,
            encryptedAtRest: Boolean(derivedAesKey),
          },
        });
        break;

      default:
        self.postMessage({
          id,
          type: "ERROR",
          error: `Unknown message type: ${type}`,
        });
    }
  } catch (error: unknown) {
    // Some libraries reject with plain objects or strings. Never assume an
    // Error shape here: the error handler itself must not throw while trying
    // to sanitize the original failure, otherwise the main thread only sees
    // an opaque `[object Object]` worker failure.
    const rawMessage =
      error instanceof Error
        ? error.message
        : typeof error === "string"
          ? error
          : (() => {
              try {
                return JSON.stringify(error);
              } catch {
                return "Unknown worker error";
              }
            })();
    const message = rawMessage || "Unknown worker error";
    logger.error("[VoyWorker] Error:", { error: message, type });
    // Sanitize error message: only expose a generic description to the
    // main thread; internal details (stack, paths) stay in the worker log.
    const sanitized =
      message.length > 200
        ? "Internal worker error"
        : message.replace(/\/.*?\/[^:]*/g, "[path]").substring(0, 200);
    self.postMessage({ id, type: "ERROR", error: sanitized });
    // Mark the worker as fatal for non-transient errors (not validation
    // or timeout) so subsequent messages are rejected immediately instead
    // of failing repeatedly and filling the error log.
    if (
      !message.includes("Validation failed") &&
      !message.startsWith("Timeout:")
    ) {
      workerFatal = true;
    }
  }
}

// Web Workers can receive another message while an async handler is awaiting
// Argon2id, IndexedDB, or Voy search. Serialize the protocol so SET_KEY,
// CLEAR, SAVE_INDEX and SEARCH cannot observe or mutate partially updated
// state. The cap prevents a burst of messages from retaining an unbounded
// chain of payloads (including sensitive password buffers) in closures.
const MAX_QUEUED_MESSAGES = 256;
let queuedMessages = 0;
let messageQueue: Promise<void> = Promise.resolve();
self.onmessage = (e: MessageEvent) => {
  if (e.origin && e.origin !== self.location.origin) {
    clearPasswordBytes((e.data as { payload?: unknown } | undefined)?.payload);
    return Promise.resolve();
  }
  if (queuedMessages >= MAX_QUEUED_MESSAGES) {
    clearPasswordBytes((e.data as { payload?: unknown } | undefined)?.payload);
    const id = (e.data as { id?: unknown } | undefined)?.id ?? "unknown";
    self.postMessage({
      id,
      type: "ERROR",
      error: "Worker message queue capacity exceeded; retry later",
    });
    return Promise.resolve();
  }

  queuedMessages += 1;
  messageQueue = messageQueue
    .then(() => handleWorkerMessage(e))
    .catch((error: unknown) => {
      logger.error("[VoyWorker] Unhandled message queue error", { error });
      const id = (e.data as { id?: unknown } | undefined)?.id ?? "unknown";
      self.postMessage({
        id,
        type: "ERROR",
        error: "Worker message processing failed",
      });
    })
    .finally(() => {
      queuedMessages -= 1;
    });
  // Returning the queue is ignored by the browser Worker API, but makes the
  // handler awaitable in deterministic test harnesses and prevents teardown
  // from racing an in-flight queued message.
  return messageQueue;
};
