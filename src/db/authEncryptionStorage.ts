/* eslint-disable @typescript-eslint/no-explicit-any -- RxDB's RxStorage
 * generics are intentionally opaque; this wrapper mirrors the any-heavy
 * plumbing of rxdb's own encryption-crypto-js plugin. P2 audit follow-up:
 * RxDB's internal types (RxDocumentData, RxStorageBulkWriteRow, etc.) are
 * complex generic chains that are difficult to replicate without breaking
 * compilation. The use of `any` here is constrained to RxDB's public API
 * surface; application data passes through via the schema's `encrypted`
 * array, which is properly typed. */
//
// RxDB's bundled `wrappedKeyEncryptionCryptoJsStorage` encrypts schema
// fields with CryptoJS AES — a deterministic, UNauthenticated cipher. At
// rest it hides plaintext, but a disk/tampering attacker can flip bits
// without any integrity signal (a flip silently corrupts the decrypted
// field or, worse, produces plausible-looking garbage). This wrapper adds
// an authenticated AES-256-GCM envelope (via crypto-core, the same
// Argon2id/HKDF primitives the rest of the vault uses) AROUND the inner
// CryptoJS ciphertext, WITHOUT removing the inner layer:
//
//   raw storage ← outer AES-GCM (authenticated, this file)
//              ← inner CryptoJS AES (RxDB field encryption, unchanged)
//
// Why keep both? The inner layer is what RxDB's schema `encrypted` array
// knows about (it strips those fields into string placeholders); the outer
// layer is invisible to RxDB and only authenticates. Removing the inner
// layer would require re-engineering RxDB's schema handling — the outer
// envelope is the minimal additive change that closes the tamper-detection
// gap.
//
// Legacy compatibility: rows written before this wrapper exist only as
// inner CryptoJS ciphertext (no outer envelope). Writes always apply the
// outer envelope; reads accept BOTH shapes:
//   - values starting with the envelope marker (v4:/v5:/v6:) → decrypt the
//     outer envelope, hand the inner ciphertext to the inner layer
//   - anything else → pass through untouched (legacy inner-only row)
// Collection schema version bumps force RxDB to rewrite every row through
// this storage, migrating legacy rows to the authenticated format.
//
// A wrong password surfaces here as a WebCrypto AES-GCM auth failure
// (OperationError) instead of CryptoJS's silent garbage output — the
// failure is tagged with `code: DB1` so the existing classifyDbError()
// chain maps it to WRONG_PASSWORD just like RxDB's own wrong-password path.

import type { Observable } from "rxjs";
import { mergeMap } from "rxjs";
import type {
  BulkWriteRow,
  RxDocumentData,
  RxStorage,
  RxStorageBulkWriteResponse,
  RxStorageInstance,
  RxStorageInstanceCreationParams,
  RxStorageQueryResult,
  RxStorageWriteError,
} from "rxdb";
import { encrypt, decrypt } from "../utils/crypto-core";
import { logger } from "../utils/logger";

/**
 * Envelope wire markers emitted by crypto-core: v4/v5 (legacy) and v6 (A-1:
 * per-vault Argon2id salt). A v6 payload that is NOT recognised here would be
 * passed through to RxDB as if it were a pre-F-06 inner-only row, surfacing the
 * raw `v6:` envelope as the field value — the multiuser/migration e2e catches
 * exactly that.
 */
const OUTER_MARKER_RE = /^v[456]:/;

/**
 * Prefix applied to non-string encrypted fields so decryptDoc can
 * distinguish "this value was a JSON object/number/boolean" from "this
 * value was a plain string that happens to LOOK like JSON".
 *
 * Without it, a string field whose content is valid JSON (e.g. "123",
 * "true", "null" or a pasted `{"a":1}`) would be silently JSON.parsed
 * into a different TYPE on read — silent content corruption. Only
 * non-string values carry the prefix; plain strings never do, so a user
 * string can never be misparsed, and a non-string value can never be
 * read back as a string.
 */
const JSON_BLOB_PREFIX = "__BF_json__:";
const UNSAFE_PATH_SEGMENTS = new Set(["__proto__", "prototype", "constructor"]);

function assertSafePath(path: string): void {
  if (path.split(".").some((segment) => UNSAFE_PATH_SEGMENTS.has(segment))) {
    throw new Error(`[auth-encryption] unsafe encrypted path: ${path}`);
  }
}

interface AuthStorageParams {
  /** The inner storage (typically wrappedKeyEncryptionCryptoJsStorage). */
  storage: RxStorage<unknown, unknown>;
  /** Stable tag used in logs/errors. */
  name?: string;
}

type AnyDoc = Record<string, unknown>;

/**
 * Wraps `params.storage` so that every field listed in the schema's
 * `encrypted` array is additionally protected by an authenticated
 * AES-256-GCM envelope. The envelope uses the SAME database password as
 * the inner layer (params.password is threaded through by RxDB).
 */
export function authenticatedEncryptionStorage(
  params: AuthStorageParams,
): RxStorage<unknown, unknown> {
  const storage = params.storage;
  const tag = params.name ?? "auth-encryption";
  return Object.assign({}, storage, {
    async createStorageInstance(rawParams: RxStorageInstanceCreationParams<any, any>) {
      const schema = rawParams.schema as RxJsonSchemaLike;
      const encryptedPaths: string[] = Array.isArray(schema?.encrypted)
        ? (schema.encrypted as string[])
        : [];

      const hasEncryption = encryptedPaths.length > 0;

      // No encrypted fields → transparent passthrough (no password needed).
      if (!hasEncryption) {
        return storage.createStorageInstance(rawParams);
      }

      const password: string = rawParams.password as string;
      if (typeof password !== "string" || password.length === 0) {
        throw new Error(
          `${tag}: authenticated encryption requires a non-empty database password`,
        );
      }

      // IMPORTANT: pass the ORIGINAL schema (with the `encrypted` array
      // intact) to the inner storage. RxDB's own encryption plugin detects
      // encryption via `hasEncryption(schema)` and internally strips the
      // encrypted paths into string placeholders before touching the real
      // storage. If we stripped the array here, the inner layer would
      // silently disable encryption and every field would sit in raw
      // storage as our outer ciphertext alone — losing the inner layer.
      const instance = await storage.createStorageInstance(rawParams);

      // ── field walkers ───────────────────────────────────────────────
      function getByPath(obj: AnyDoc, path: string): unknown {
        assertSafePath(path);
        let cur: unknown = obj;
        for (const part of path.split(".")) {
          if (
            cur === null ||
            typeof cur !== "object" ||
            !(part in (cur as AnyDoc))
          ) {
            return undefined;
          }
          cur = (cur as AnyDoc)[part];
        }
        return cur;
      }

      function setByPath(obj: AnyDoc, path: string, value: unknown): void {
        assertSafePath(path);
        const parts = path.split(".");
        let cur = obj;
        for (let i = 0; i < parts.length - 1; i++) {
          const next = cur[parts[i]!];
          if (next === null || typeof next !== "object") {
            return; // malformed/nested path — leave untouched
          }
          cur = next as AnyDoc;
        }
        cur[parts[parts.length - 1]!] = value;
      }

      // ── to-storage: apply the authenticated envelope ────────────────
      async function encryptDoc(docData: unknown): Promise<unknown> {
        if (!docData || typeof docData !== "object") {
          return docData;
        }
        const copy: AnyDoc = { ...(docData as AnyDoc) };
        for (const path of encryptedPaths) {
          const value = getByPath(copy, path);
          if (value === undefined) {
            continue; // absent field — nothing to encrypt
          }
          let plain: string;
          if (typeof value === "string") {
            plain = value;
          } else {
            try {
              // Tag non-string payloads so the read side can restore the
              // exact TYPE. JSON.stringify alone is ambiguous: a plain
              // string field whose content is valid JSON ("123", "true",
              // "null", a pasted object) would be silently parsed into a
              // different type on EVERY read — silent content corruption.
              plain = JSON_BLOB_PREFIX + JSON.stringify(value);
            } catch (err) {
              // P1: Fail closed on non-serializable protected fields.
              // Storing without the authenticated envelope would defeat
              // the purpose of authenticated encryption (audit finding).
              const error = new Error(
                `[${tag}] field "${path}" is not JSON-serializable — cannot store protected field without authenticated envelope`,
                { cause: err },
              );
              logger.error(
                `[${tag}] failed to serialize field "${path}" — aborting write to fail closed`,
                { error: error.message },
              );
              throw error;
            }
          }
          try {
            setByPath(copy, path, await encrypt(plain, password));
          } catch (err) {
            logger.error(
              `[${tag}] failed to encrypt field "${path}" — aborting write to fail closed`,
              { error: err instanceof Error ? err.message : String(err) },
            );
            throw err;
          }
        }
        return copy;
      }

      // ── from-storage: unwrap legacy AND authenticated rows ──────────
      async function decryptDoc(docData: unknown): Promise<unknown> {
        if (!docData || typeof docData !== "object") {
          return docData;
        }
        const copy: AnyDoc = { ...(docData as AnyDoc) };
        for (const path of encryptedPaths) {
          const value = getByPath(copy, path);
          if (value === undefined) {
            continue;
          }
          if (typeof value !== "string" || !OUTER_MARKER_RE.test(value)) {
            // Legacy row: inner CryptoJS ciphertext only. Pass through so
            // the inner layer decrypts it as before.
            continue;
          }
          try {
            const decrypted = await decrypt(value, password);
            let restored: unknown = decrypted;
            if (decrypted.startsWith(JSON_BLOB_PREFIX)) {
              // Non-string value: strip the tag and restore the type.
              // Only tagged values are parsed, so a plain string that
              // happens to be valid JSON is NEVER type-coerced.
              const body = decrypted.slice(JSON_BLOB_PREFIX.length);
              try {
                restored = JSON.parse(body);
              } catch {
                // Corrupt tag payload — surface the raw body rather than
                // losing the data or throwing during a routine read.
                restored = body;
              }
            }
            setByPath(copy, path, restored);
          } catch (err) {
            // AES-GCM auth failure → almost certainly the wrong password.
            const tagged = new Error(
              `${tag}: failed to authenticate encrypted field "${path}" (wrong password or tampered data)`,
              { cause: err },
            );
            tagged.name = "WrongPasswordError";
            (tagged as Error & { code?: string }).code = "DB1";
            throw tagged;
          }
        }
        return copy;
      }

      // ── wrap the instance (self-contained; wrapRxStorageInstance is not
      //    a public RxDB export) ───────────────────────────────────────
      return wrapAuthInstance(
        schema as RxJsonSchemaLike,
        instance,
        encryptDoc,
        decryptDoc,
      );
    },
  });
}

interface RxJsonSchemaLike {
  title?: string;
  version?: number;
  primaryKey?: string;
  type?: string;
  properties?: Record<string, unknown>;
  required?: string[];
  indexes?: unknown[];
  encrypted?: string[];
  attachments?: { encrypted?: boolean };
}

type ModifyFn = (doc: unknown) => Promise<unknown>;

interface WrappedInstance extends RxStorageInstance<any, any, any, any> {
  originalStorageInstance: RxStorageInstance<any, any, any, any>;
}

/**
 * Returns an RxStorageInstance that pipes every in/out document through
 * `encryptDoc` / `decryptDoc`. Implemented locally because RxDB does not
 * export its `wrapRxStorageInstance` helper publicly (it lives in an
 * internal source module that is bundled into each plugin).
 */
function wrapAuthInstance(
  originalSchema: RxJsonSchemaLike,
  instance: RxStorageInstance<any, any, any, any>,
  encryptDoc: ModifyFn,
  decryptDoc: ModifyFn,
): WrappedInstance {
  async function fromStorage(
    docData: RxDocumentData<any> | null | undefined,
  ): Promise<RxDocumentData<any> | null | undefined> {
    if (!docData) {
      return docData;
    }
    return (await decryptDoc(docData)) as RxDocumentData<any>;
  }

  async function errorFromStorage(
    error: RxStorageWriteError<any>,
  ): Promise<RxStorageWriteError<any>> {
    const ret = { ...error, writeRow: { ...error.writeRow } };
    const conflict = ret as RxStorageWriteError<any> & {
      documentInDb?: RxDocumentData<any>;
    };
    if (conflict.documentInDb) {
      conflict.documentInDb = (await fromStorage(
        conflict.documentInDb,
      )) as RxDocumentData<any>;
    }
    if (ret.writeRow.previous) {
      ret.writeRow.previous = (await fromStorage(
        ret.writeRow.previous,
      )) as RxDocumentData<any>;
    }
    ret.writeRow.document = (await fromStorage(
      ret.writeRow.document,
    )) as RxDocumentData<any>;
    return ret;
  }

  const wrapped: WrappedInstance = {
    databaseName: instance.databaseName,
    internals: instance.internals,
    cleanup: instance.cleanup.bind(instance),
    options: instance.options,
    close: instance.close.bind(instance),
    schema: originalSchema as RxJsonSchemaLike & RxDocumentData<any>,
    collectionName: instance.collectionName,
    count: instance.count.bind(instance),
    remove: instance.remove.bind(instance),
    originalStorageInstance: instance,
    bulkWrite: async (
      documentWrites: BulkWriteRow<any>[],
      context: string,
    ) => {
      // ADR-044: Only encrypt `row.document`, NOT `row.previous`. The
      // `previous` field is used by the inner storage for conflict detection
      // only — never persisted directly. Encrypting it causes the conflict
      // error path to double-decrypt and surface as WRONG_PASSWORD.
      const useRows: BulkWriteRow<any>[] = await Promise.all(
        documentWrites.map(async (row) => ({
          previous: row.previous,
          document: await encryptDoc(row.document),
        })),
      );
      const writeResult: RxStorageBulkWriteResponse<any> =
        await instance.bulkWrite(useRows, context);
      const ret: RxStorageBulkWriteResponse<any> = {
        error: await Promise.all(writeResult.error.map((err) => errorFromStorage(err))),
      };
      return ret;
    },
    query: async (
      preparedQuery: any,
    ): Promise<RxStorageQueryResult<any>> => {
      const result = await instance.query(preparedQuery);
      const documents = await Promise.all(
        result.documents.map(async (doc) => (await fromStorage(doc)) as RxDocumentData<any>),
      );
      return { documents };
    },
    getAttachmentData: (
      documentId: string,
      attachmentId: string,
      digest: string,
    ) => instance.getAttachmentData(documentId, attachmentId, digest),
    findDocumentsById: async (ids: string[], withDeleted: boolean) => {
      const found = await instance.findDocumentsById(ids, withDeleted);
      return Promise.all(
        found.map(async (doc) => (await fromStorage(doc)) as RxDocumentData<any>),
      );
    },
    getChangedDocumentsSince: !instance.getChangedDocumentsSince
      ? undefined
      : (limit: number, checkpoint?: any) =>
          instance
            .getChangedDocumentsSince!(limit, checkpoint)
            .then(async (result: any) => ({
              checkpoint: result.checkpoint,
              documents: await Promise.all(
                result.documents.map((d: any) => fromStorage(d)),
              ),
            })),
    changeStream: () =>
      (
        instance.changeStream() as Observable<{
          events: Array<{
            operation: string;
            documentId: string;
            documentData: RxDocumentData<any>;
            previousDocumentData: RxDocumentData<any> | null;
          }>;
          checkpoint: unknown;
          context: string;
          id: string;
        }>
      ).pipe(
        mergeMap(async (eventBulk) => {
          const events = await Promise.all(
            eventBulk.events.map(async (event) => {
              const [documentData, previousDocumentData] = await Promise.all([
                fromStorage(event.documentData),
                fromStorage(event.previousDocumentData),
              ]);
              return {
                operation: event.operation,
                documentId: event.documentId,
                documentData,
                previousDocumentData,
                isLocal: false,
              };
            }),
          );
          return {
            ...eventBulk,
            events,
          };
        }),
      ) as any,
  };

  return wrapped;
}
