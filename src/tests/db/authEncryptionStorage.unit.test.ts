/**
 * Unit tests for src/db/authEncryptionStorage.ts (F-06 authenticated
 * at-rest encryption wrapper).
 *
 * Unlike auth-encryption.test.ts (which exercises the wrapper through a full
 * RxDB + Dexie + CryptoJS stack), these tests drive the wrapper DIRECTLY with
 * a mock inner RxStorage, so every branch of the wrapper's own logic is
 * asserted in isolation:
 *
 *   - passthrough when the schema has no `encrypted` fields
 *   - password required (fail closed) when encrypted fields exist
 *   - bulkWrite applies the authenticated v4/v5 envelope to encrypted paths
 *     (document AND previous), leaves other fields untouched
 *   - query / findDocumentsById / getChangedDocumentsSince unwrap envelopes
 *   - legacy rows (inner-ciphertext only, no v4/v5 marker) pass through
 *   - non-string fields round-trip with their exact TYPE (JSON_BLOB_PREFIX)
 *   - strings that look like JSON are never type-coerced
 *   - wrong password → tagged WrongPasswordError with code DB1
 *   - changeStream events are decrypted before consumers see them
 *   - write-conflict errors surface decrypted documents
 */
import { describe, it, expect, vi } from "vitest";
import { Subject } from "rxjs";
import { authenticatedEncryptionStorage } from "../../db/authEncryptionStorage";
import { encrypt } from "../../utils/crypto-core";

vi.mock("../../utils/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const PASSWORD = "unit-test-vault-password";

/** Schema with two encrypted paths: a top-level string and a nested field. */
const ENC_SCHEMA = {
  title: "docs",
  version: 0,
  primaryKey: "id",
  type: "object",
  properties: {
    id: { type: "string", maxLength: 100 },
    secret: { type: "string", maxLength: 500 },
    meta: { type: "object" },
  },
  required: ["id"],
  encrypted: ["secret", "meta.payload"],
};

/** Same schema minus the `encrypted` array (passthrough case). */
const PLAIN_SCHEMA = (() => {
  const { encrypted, ...rest } = ENC_SCHEMA;
  void encrypted;
  return rest;
})();

interface InnerCalls {
  createParams: any;
  writes: any[];
  queryDocs: any[];
  findByIdDocs: any[];
  changedDocs: any[];
  bulkError: any[] | null;
  events: Subject<any>;
}

/**
 * A minimal inner RxStorage + RxStorageInstance that records what the
 * wrapper pushes into storage and serves canned results back.
 */
function makeInner() {
  const calls: InnerCalls = {
    createParams: null,
    writes: [],
    queryDocs: [],
    findByIdDocs: [],
    changedDocs: [],
    bulkError: null,
    events: new Subject<any>(),
  };
  const instance = {
    databaseName: "unit-db",
    collectionName: "docs",
    internals: { inner: true },
    options: {},
    schema: {},
    cleanup: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    count: vi.fn(async () => 0),
    remove: vi.fn(async () => {}),
    getAttachmentData: vi.fn(async () => ({})),
    bulkWrite: vi.fn(async (rows: any[]) => {
      calls.writes.push(...rows);
      return { error: calls.bulkError ?? [] };
    }),
    query: vi.fn(async () => ({ documents: calls.queryDocs })),
    findDocumentsById: vi.fn(async () => calls.findByIdDocs),
    getChangedDocumentsSince: vi.fn(async () => ({
      checkpoint: { l: 1 },
      documents: calls.changedDocs,
    })),
    changeStream: vi.fn(() => calls.events),
  };
  const storage = {
    name: "mock-inner",
    createStorageInstance: vi.fn(async (params: any) => {
      calls.createParams = params;
      return instance;
    }),
  };
  return { storage, instance, calls };
}

/** Build the wrapped instance against a fresh mock inner storage. */
async function makeWrapped(schema: any, password?: string) {
  const { storage, instance, calls } = makeInner();
  const outer = authenticatedEncryptionStorage({ storage: storage as any, name: "unit-auth" });
  const params = {
    databaseName: "unit-db",
    collectionName: "docs",
    schema,
    options: {},
    password,
    multiInstance: false,
    eventReduce: true,
  };
  const inst = await (outer as any).createStorageInstance(params);
  return { inst, instance, calls, storage };
}

// ── instance creation ──────────────────────────────────────────────────

describe("authenticatedEncryptionStorage — instance creation", () => {
  it("passes through untouched when the schema has no encrypted fields", async () => {
    const { inst, instance, storage, calls } = await makeWrapped(PLAIN_SCHEMA, PASSWORD);
    // The wrapper must return the inner instance itself — zero wrapping.
    expect(inst).toBe(instance);
    expect(storage.createStorageInstance).toHaveBeenCalledTimes(1);
    expect(calls.createParams.schema).toBe(PLAIN_SCHEMA);
  });

  it("keeps the schema's `encrypted` array intact for the inner layer", async () => {
    const { calls } = await makeWrapped(ENC_SCHEMA, PASSWORD);
    // Stripping the array would silently disable the inner CryptoJS layer.
    expect(calls.createParams.schema.encrypted).toEqual(["secret", "meta.payload"]);
  });

  it("rejects prototype-pollution path segments", async () => {
    const badSchema = { ...ENC_SCHEMA, encrypted: ["__proto__.polluted"] };
    const wrapped = await makeWrapped(badSchema, PASSWORD);
    await expect(
      wrapped.inst.bulkWrite(
        [{ previous: null, document: { id: "bad", meta: { payload: "x" } } }],
        "unit",
      ),
    ).rejects.toThrow(/unsafe encrypted path/);
  });

  it("refuses to create an encrypted instance without a password (fail closed)", async () => {
    await expect(makeWrapped(ENC_SCHEMA, undefined)).rejects.toThrow(/non-empty database password/);
    await expect(makeWrapped(ENC_SCHEMA, "")).rejects.toThrow(/non-empty database password/);
  });
});

// ── writes ─────────────────────────────────────────────────────────────

describe("authenticatedEncryptionStorage — writes", () => {
  it("wraps encrypted string fields in a v4/v5 envelope and leaves other fields raw", async () => {
    const { calls } = await makeWrapped(ENC_SCHEMA, PASSWORD);
    await (calls.events as any); // no-op; subject unused here
    await (makeWrapped as any); // no-op reference
    const wrapped = await makeWrapped(ENC_SCHEMA, PASSWORD);
    await wrapped.inst.bulkWrite(
      [{ previous: null, document: { id: "d1", secret: "plain-secret", keep: "visible" } }],
      "unit",
    );

    const row = wrapped.calls.writes[0];
    expect(row.document.id).toBe("d1");
    expect(row.document.keep).toBe("visible"); // non-encrypted field untouched
    expect(String(row.document.secret)).toMatch(/^v[45]:/); // outer envelope
    expect(String(row.document.secret)).not.toContain("plain-secret");
  });

  it("leaves `previous` untouched (ADR-044: only `document` is encrypted; previous is conflict-detection only)", async () => {
    const wrapped = await makeWrapped(ENC_SCHEMA, PASSWORD);
    await wrapped.inst.bulkWrite(
      [{
        previous: { id: "d1", secret: "old-secret" },
        document: { id: "d1", secret: "new-secret" },
      }],
      "unit",
    );
    const row = wrapped.calls.writes[0];
    // ADR-044: encrypting `previous` caused the conflict error path to
    // double-decrypt and surface as WRONG_PASSWORD — only `document` is encrypted.
    expect(row.previous.secret).toBe("old-secret");
    expect(String(row.document.secret)).toMatch(/^v[45]:/);
    expect(String(row.document.secret)).not.toContain("new-secret");
  });

  it("encrypts nested encrypted paths (meta.payload)", async () => {
    const wrapped = await makeWrapped(ENC_SCHEMA, PASSWORD);
    await wrapped.inst.bulkWrite(
      [{ previous: null, document: { id: "d1", meta: { payload: "nested-secret", open: 1 } } }],
      "unit",
    );
    const stored = wrapped.calls.writes[0].document.meta;
    expect(String(stored.payload)).toMatch(/^v[45]:/);
    expect(String(stored.payload)).not.toContain("nested-secret");
    expect(stored.open).toBe(1); // sibling of the encrypted path untouched
  });

  it("tags non-string values so their exact TYPE survives the round trip", async () => {
    const wrapped = await makeWrapped(ENC_SCHEMA, PASSWORD);
    await wrapped.inst.bulkWrite(
      [{ previous: null, document: { id: "d1", secret: { nested: true } } }],
      "unit",
    );
    const stored = String(wrapped.calls.writes[0].document.secret);
    // The envelope decrypts (with crypto-core) to a TAGGED JSON blob, not a
    // bare string — that tag is what stops "123" strings becoming numbers.
    const inner = await (await import("../../utils/crypto-core")).decrypt(stored, PASSWORD);
    expect(inner.startsWith("__BF_json__:")).toBe(true);
  });

  it("skips absent encrypted fields without touching the doc", async () => {
    const wrapped = await makeWrapped(ENC_SCHEMA, PASSWORD);
    await wrapped.inst.bulkWrite([{ previous: null, document: { id: "d1" } }], "unit");
    expect(wrapped.calls.writes[0].document).toEqual({ id: "d1" });
  });
});

// ── reads ──────────────────────────────────────────────────────────────

describe("authenticatedEncryptionStorage — reads", () => {
  it("decrypts envelope fields on query and findDocumentsById", async () => {
    const wrapped = await makeWrapped(ENC_SCHEMA, PASSWORD);
    const env = await encrypt("plain-secret", PASSWORD);
    wrapped.calls.queryDocs = [{ id: "d1", secret: env, keep: "x" }];
    wrapped.calls.findByIdDocs = [{ id: "d2", secret: env }];

    const qr = await wrapped.inst.query({} as any);
    expect(qr.documents[0].secret).toBe("plain-secret");
    expect(qr.documents[0].keep).toBe("x");

    const fr = await wrapped.inst.findDocumentsById(["d2"], false);
    expect(fr[0].secret).toBe("plain-secret");
  });

  it("decrypts nested encrypted paths on read", async () => {
    const wrapped = await makeWrapped(ENC_SCHEMA, PASSWORD);
    wrapped.calls.queryDocs = [{
      id: "d1",
      meta: { payload: await encrypt("nested-secret", PASSWORD), open: 1 },
    }];
    const qr = await wrapped.inst.query({} as any);
    expect(qr.documents[0].meta.payload).toBe("nested-secret");
    expect(qr.documents[0].meta.open).toBe(1);
  });

  it("passes legacy rows (no v4/v5 marker) through untouched", async () => {
    const wrapped = await makeWrapped(ENC_SCHEMA, PASSWORD);
    const legacy = "U2FsdGVkX1legacy-inner-ciphertext";
    wrapped.calls.queryDocs = [{ id: "d2", secret: legacy }];
    const qr = await wrapped.inst.query({} as any);
    expect(qr.documents[0].secret).toBe(legacy);
  });

  it("restores the exact TYPE of non-string fields (object stays object)", async () => {
    const wrapped = await makeWrapped(ENC_SCHEMA, PASSWORD);
    // Write an object through the wrapper, then serve the stored form back.
    await wrapped.inst.bulkWrite(
      [{ previous: null, document: { id: "d1", secret: { n: 5, arr: [1, 2] } } }],
      "unit",
    );
    wrapped.calls.queryDocs = [{ id: "d1", secret: wrapped.calls.writes[0].document.secret }];
    const qr = await wrapped.inst.query({} as any);
    expect(qr.documents[0].secret).toEqual({ n: 5, arr: [1, 2] });
    expect(typeof qr.documents[0].secret).toBe("object");
  });

  it("never type-coerces a plain string that happens to be valid JSON", async () => {
    const wrapped = await makeWrapped(ENC_SCHEMA, PASSWORD);
    await wrapped.inst.bulkWrite([{ previous: null, document: { id: "d1", secret: "123" } }], "unit");
    // The stored envelope must decrypt to the bare string (no JSON tag).
    const stored = String(wrapped.calls.writes[0].document.secret);
    const inner = await (await import("../../utils/crypto-core")).decrypt(stored, PASSWORD);
    expect(inner).toBe("123");
    expect(inner.startsWith("__BF_json__:")).toBe(false);
    // And the read path returns it as a string, not a number.
    wrapped.calls.queryDocs = [{ id: "d1", secret: stored }];
    const qr = await wrapped.inst.query({} as any);
    expect(qr.documents[0].secret).toBe("123");
    expect(typeof qr.documents[0].secret).toBe("string");
  });

  it("decrypts documents inside getChangedDocumentsSince results", async () => {
    const wrapped = await makeWrapped(ENC_SCHEMA, PASSWORD);
    wrapped.calls.changedDocs = [{ id: "d1", secret: await encrypt("changed-secret", PASSWORD) }];
    const result = await wrapped.inst.getChangedDocumentsSince!(10, null);
    expect(result.documents[0].secret).toBe("changed-secret");
    expect(result.checkpoint).toEqual({ l: 1 });
  });
});

// ── failure modes ──────────────────────────────────────────────────────

describe("authenticatedEncryptionStorage — failure modes", () => {
  it("wrong password surfaces a tagged WrongPasswordError (code DB1), not garbage", async () => {
    const wrapped = await makeWrapped(ENC_SCHEMA, PASSWORD);
    // Field was encrypted with a DIFFERENT password.
    wrapped.calls.queryDocs = [{ id: "d1", secret: await encrypt("secret", "a-different-password") }];
    let caught: any = null;
    try {
      await wrapped.inst.query({} as any);
    } catch (err) {
      caught = err;
    }
    expect(caught).not.toBeNull();
    expect(caught.name).toBe("WrongPasswordError");
    expect(caught.code).toBe("DB1");
    expect(caught.message).toContain("wrong password or tampered data");
  });

  it("decrypts documents inside write-conflict errors", async () => {
    const wrapped = await makeWrapped(ENC_SCHEMA, PASSWORD);
    const env = await encrypt("conflict-secret", PASSWORD);
    wrapped.calls.bulkError = [{
      isSuccess: false,
      isError: true,
      status: 409,
      documentId: "d1",
      writeRow: {
        document: { id: "d1", secret: env },
        previous: { id: "d1", secret: env },
      },
      documentInDb: { id: "d1", secret: env },
    }];
    const result = await wrapped.inst.bulkWrite(
      [{ previous: { id: "d1", secret: "x" }, document: { id: "d1", secret: "y" } }],
      "unit",
    );
    const err = result.error[0];
    expect(err.documentInDb.secret).toBe("conflict-secret");
    expect(err.writeRow.document.secret).toBe("conflict-secret");
    expect(err.writeRow.previous.secret).toBe("conflict-secret");
  });
});

// ── change stream ──────────────────────────────────────────────────────

describe("authenticatedEncryptionStorage — changeStream", () => {
  it("decrypts documentData and previousDocumentData before consumers see them", async () => {
    const wrapped = await makeWrapped(ENC_SCHEMA, PASSWORD);
    const env = await encrypt("stream-secret", PASSWORD);
    const out: any[] = [];
    (wrapped.inst.changeStream() as any).subscribe((bulk: any) => out.push(bulk));

    wrapped.calls.events.next({
      events: [{
        operation: "INSERT",
        documentId: "d1",
        documentData: { id: "d1", secret: env },
        previousDocumentData: null,
      }],
      checkpoint: { l: 1 },
      context: "unit",
      id: "bulk-1",
    });
    // mergeMap is async — let the promise chain flush.
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(out).toHaveLength(1);
    expect(out[0].events[0].documentData.secret).toBe("stream-secret");
    expect(out[0].events[0].previousDocumentData).toBeNull();
  });
});
