import {
  describe,
  it,
  expect,
  vi,
  afterEach,
  beforeAll,
  beforeEach,
} from "vitest";

// ========== MOCKS ==========

// Factory that returns a fresh DB instance per test to avoid order dependency
// The mock is intentionally typed as `any` so that dynamically-added
// collection properties (e.g. `mockDbInstanceBase.bookmarks = {}`) do not
// trigger TS2339 in the test body. The mock's runtime shape is verified by
// the production database.ts contract downstream.
let mockDbInstanceBase: any;

function createMockDbInstance(): any {
  return {
    destroy: vi.fn().mockResolvedValue({}),
    addCollections: vi.fn().mockResolvedValue({}),
  };
}

mockDbInstanceBase = createMockDbInstance();

const mockAddRxPlugin = vi.fn();
const mockCreateRxDatabase = vi
  .fn()
  .mockImplementation(() => mockDbInstanceBase);

vi.mock("rxdb", () => ({
  createRxDatabase: mockCreateRxDatabase,
  addRxPlugin: mockAddRxPlugin,
}));

vi.mock("rxdb/plugins/storage-dexie", () => ({
  getRxStorageDexie: vi.fn().mockReturnValue({}),
}));

vi.mock("rxdb/plugins/storage-memory", () => ({
  getRxStorageMemory: vi.fn().mockReturnValue({}),
}));

vi.mock("rxdb/plugins/query-builder", () => ({ RxDBQueryBuilderPlugin: {} }));
vi.mock("rxdb/plugins/migration-schema", () => ({
  RxDBMigrationSchemaPlugin: {},
}));
vi.mock("rxdb/plugins/cleanup", () => ({ RxDBCleanupPlugin: {} }));
vi.mock("rxdb/plugins/leader-election", () => ({
  RxDBLeaderElectionPlugin: {},
}));
vi.mock("rxdb/plugins/dev-mode", () => ({
  RxDBDevModePlugin: {},
  disableWarnings: vi.fn(),
}));
vi.mock("rxdb/plugins/encryption-crypto-js", () => ({
  wrappedKeyEncryptionCryptoJsStorage: vi.fn().mockReturnValue({}),
}));
vi.mock("rxdb/plugins/validate-z-schema", () => ({
  wrappedValidateZSchemaStorage: vi.fn().mockReturnValue({}),
}));

const mockSecureStorage = {
  hasSecret: vi.fn().mockResolvedValue(false),
  getSecret: vi.fn().mockResolvedValue(null),
  setSecret: vi.fn().mockResolvedValue(undefined),
};

vi.mock("../../services/SecureStorage", () => ({
  secureStorage: mockSecureStorage,
}));

vi.mock("../../utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const mockEncryptionService = {
  encrypt: vi.fn().mockResolvedValue("encrypted_value"),
  decrypt: vi.fn().mockResolvedValue("decrypted_value"),
  deriveDbKey: vi.fn().mockResolvedValue("derived-hex-key-1234567890abcdef"),
};

vi.mock("../../services/EncryptionService", () => ({
  encryptionService: mockEncryptionService,
}));

vi.mock("../../db/schema", () => ({
  bookmarkSchema: {},
  documentSchema: {},
  documentAttachmentSchema: {},
  templateSchema: {},
  folderSchema: {},
  versionSchema: {},
  flashcardSchema: {},
  messageSchema: {},
  highlightSchema: {},
  insightSchema: {},
  chunkSchema: {},
}));

vi.mock("../../memory/memory-schemas", () => ({
  memoryAtomSchema: {},
  memoryScenarioSchema: {},
  memoryPersonaSchema: {},
  memorySessionSchema: {},
  memoryChatMessageSchema: {},
  memoryProfileSchema: {},
}));

const mockCryptoKey = {} as CryptoKey;
vi.stubGlobal("crypto", {
  subtle: {
    digest: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3, 4]).buffer),
    importKey: vi.fn().mockResolvedValue(mockCryptoKey),
    deriveKey: vi.fn().mockResolvedValue(mockCryptoKey),
    exportKey: vi.fn().mockResolvedValue(new Uint8Array(32).buffer),
  },
  getRandomValues: vi.fn((arr: Uint8Array) => {
    for (let i = 0; i < arr.length; i++) arr[i] = i;
    return arr;
  }),
});

vi.stubGlobal("indexedDB", {
  deleteDatabase: vi.fn().mockImplementation((): any => {
    const req: Record<string, any> = {
      onsuccess: null,
      onerror: null,
      onblocked: null,
      error: null,
    };
    Promise.resolve().then(() => req.onsuccess?.());
    return req;
  }),
});

// ========== PURE FUNCTION TESTS ==========

describe("database.ts - pure functions", () => {
  let defaultConflictHandler: Function;
  let migrationStrategies: Record<number, Function>;
  let isDBInitialized: Function;
  let COLLECTIONS: Record<string, any>;

  beforeAll(async () => {
    const mod = await import("../../db/database");
    defaultConflictHandler = mod.defaultConflictHandler;
    migrationStrategies = (
      mod.COLLECTIONS as Record<
        string,
        { migrationStrategies: Record<number, Function> }
      >
    ).bookmarks!.migrationStrategies;
    isDBInitialized = mod.isDBInitialized;
    COLLECTIONS = mod.COLLECTIONS;
  });

  describe("classified error guards", () => {
    it("recognizes DB_INACCESSIBLE errors without matching unrelated errors", async () => {
      const { isDbInaccessibleError } = await import("../../db/database");
      expect(isDbInaccessibleError(Object.assign(new Error("storage"), { name: "DB_INACCESSIBLE" }))).toBe(true);
      expect(isDbInaccessibleError(new Error("storage"))).toBe(false);
      expect(isDbInaccessibleError(null)).toBe(false);
    });
  });

  describe("defaultConflictHandler", () => {
    it("should accept new doc when rev height is higher", () => {
      const result = defaultConflictHandler({
        newDocumentState: { _rev: "2-abc" },
        realMasterState: { _rev: "1-def" },
      });
      expect(result.documentData).toEqual({ _rev: "2-abc" });
    });

    it("should accept master doc when rev height is higher", () => {
      const result = defaultConflictHandler({
        newDocumentState: { _rev: "1-abc" },
        realMasterState: { _rev: "2-def" },
      });
      expect(result.documentData).toEqual({ _rev: "2-def" });
    });

    it("should use updatedAt when rev heights equal", () => {
      const result = defaultConflictHandler({
        newDocumentState: { _rev: "1-abc", updatedAt: "2026-05-25T12:00:01Z" },
        realMasterState: { _rev: "1-def", updatedAt: "2026-05-25T12:00:00Z" },
      });
      expect(result.documentData).toEqual({
        _rev: "1-abc",
        updatedAt: "2026-05-25T12:00:01Z",
      });
    });

    it("should merge unique blocks", () => {
      const result = defaultConflictHandler({
        newDocumentState: {
          _rev: "1-abc",
          updatedAt: "2026-05-25T12:00:00Z",
          blocks: [{ id: "block3", content: "new" }],
        },
        realMasterState: {
          _rev: "1-def",
          updatedAt: "2026-05-25T12:00:00Z",
          blocks: [
            { id: "block1", content: "a" },
            { id: "block2", content: "b" },
          ],
        },
      });
      expect(result.documentData.blocks).toHaveLength(3);
      expect(result.documentData.blocks).toEqual(
        expect.arrayContaining([
          { id: "block1", content: "a" },
          { id: "block2", content: "b" },
          { id: "block3", content: "new" },
        ]),
      );
    });

    it("should not duplicate existing blocks", () => {
      const result = defaultConflictHandler({
        newDocumentState: {
          _rev: "1-abc",
          updatedAt: "2026-05-25T12:00:00Z",
          blocks: [{ id: "block1", content: "modified" }],
        },
        realMasterState: {
          _rev: "1-def",
          updatedAt: "2026-05-25T12:00:00Z",
          blocks: [{ id: "block1", content: "original" }],
        },
      });
      expect(result.documentData.blocks).toHaveLength(1);
    });

    it("should fallback to lexicographical rev comparison", () => {
      const result = defaultConflictHandler({
        newDocumentState: { _rev: "a-xxx" },
        realMasterState: { _rev: "b-xxx" },
      });
      expect(result.documentData).toEqual({ _rev: "b-xxx" });
    });

    it("should handle empty revs (no _rev key)", () => {
      const result = defaultConflictHandler({
        newDocumentState: {},
        realMasterState: { _rev: "1-abc" },
      });
      expect(result.documentData).toEqual({ _rev: "1-abc" });
    });

    it("should treat empty string _rev as height 0", () => {
      const result = defaultConflictHandler({
        newDocumentState: { _rev: "" },
        realMasterState: { _rev: "1-def" },
      });
      expect(result.documentData).toEqual({ _rev: "1-def" });
    });

    it("should treat null _rev as height 0", () => {
      const result = defaultConflictHandler({
        newDocumentState: { _rev: null },
        realMasterState: { _rev: "1-def" },
      });
      expect(result.documentData).toEqual({ _rev: "1-def" });
    });

    it("uses the complete revision as the deterministic tie-break", () => {
      const result = defaultConflictHandler({
        newDocumentState: { _rev: "abc" },
        realMasterState: { _rev: "1-def" },
      });
      expect(result.documentData).toEqual({ _rev: "abc" });
    });

    it("should handle newBlocks being undefined", () => {
      const result = defaultConflictHandler({
        newDocumentState: { _rev: "1-abc", updatedAt: "2026-05-25T12:00:00Z" },
        realMasterState: {
          _rev: "1-def",
          updatedAt: "2026-05-25T12:00:00Z",
          blocks: [{ id: "b1" }],
        },
      });
      expect(result.documentData).toEqual({
        _rev: "1-def",
        updatedAt: "2026-05-25T12:00:00Z",
        blocks: [{ id: "b1" }],
      });
    });

    it("should handle masterBlocks being undefined", () => {
      const result = defaultConflictHandler({
        newDocumentState: {
          _rev: "1-abc",
          updatedAt: "2026-05-25T12:00:00Z",
          blocks: [{ id: "b1" }],
        },
        realMasterState: { _rev: "1-def", updatedAt: "2026-05-25T12:00:00Z" },
      });
      expect(result.documentData).toEqual({
        _rev: "1-def",
        updatedAt: "2026-05-25T12:00:00Z",
      });
    });

    it("should merge blocks without IDs", () => {
      const result = defaultConflictHandler({
        newDocumentState: {
          _rev: "1-abc",
          updatedAt: "2026-05-25T12:00:00Z",
          blocks: [{ content: "new-block-no-id" }],
        },
        realMasterState: {
          _rev: "1-def",
          updatedAt: "2026-05-25T12:00:00Z",
          blocks: [{ id: "block1", content: "existing" }],
        },
      });
      expect(result.documentData.blocks).toHaveLength(2);
      expect(result.documentData.blocks[1]).toEqual({
        content: "new-block-no-id",
      });
    });

    it("should prefer higher _rev when both blocks present but timestamps are absent", () => {
      const result = defaultConflictHandler({
        newDocumentState: { _rev: "2-abc", blocks: [{ id: "b1" }] },
        realMasterState: { _rev: "1-def", blocks: [{ id: "b2" }] },
      });
      expect(result.documentData).toEqual({
        _rev: "2-abc",
        blocks: [{ id: "b1" }],
      });
    });

    it("should return master when lexicographic rev comparison favors master", () => {
      const result = defaultConflictHandler({
        newDocumentState: { _rev: "c-xxx" },
        realMasterState: { _rev: "d-xxx" },
      });
      expect(result.documentData).toEqual({ _rev: "d-xxx" });
    });

    it("should handle empty blocks arrays (no merge needed)", () => {
      const result = defaultConflictHandler({
        newDocumentState: {
          _rev: "1-abc",
          updatedAt: "2026-05-25T12:00:00Z",
          blocks: [],
        },
        realMasterState: {
          _rev: "1-def",
          updatedAt: "2026-05-25T12:00:00Z",
          blocks: [],
        },
      });
      expect(result.documentData).toEqual({
        _rev: "1-def",
        updatedAt: "2026-05-25T12:00:00Z",
        blocks: [],
      });
    });

    it("should use master when only master has updatedAt", () => {
      const result = defaultConflictHandler({
        newDocumentState: { _rev: "1-abc" },
        realMasterState: { _rev: "1-def", updatedAt: "2026-05-25T12:00:01Z" },
      });
      expect(result.documentData).toEqual({
        _rev: "1-def",
        updatedAt: "2026-05-25T12:00:01Z",
      });
    });

    it("should use master when only new has updatedAt", () => {
      const result = defaultConflictHandler({
        newDocumentState: { _rev: "1-abc", updatedAt: "2026-05-25T12:00:01Z" },
        realMasterState: { _rev: "1-def" },
      });
      expect(result.documentData).toEqual({ _rev: "1-def" });
    });

    it("should not merge when new blocks are all duplicates of master blocks", () => {
      const result = defaultConflictHandler({
        newDocumentState: {
          _rev: "1-abc",
          updatedAt: "2026-05-25T12:00:00Z",
          blocks: [{ id: "b1" }],
        },
        realMasterState: {
          _rev: "1-def",
          updatedAt: "2026-05-25T12:00:00Z",
          blocks: [{ id: "b1" }],
        },
      });
      expect(result.documentData.blocks).toHaveLength(1);
    });

    it("should prefer master when updatedAt is more recent on master side", () => {
      const result = defaultConflictHandler({
        newDocumentState: { _rev: "1-abc", updatedAt: "2026-05-25T12:00:00Z" },
        realMasterState: { _rev: "1-def", updatedAt: "2026-05-25T12:00:01Z" },
      });
      expect(result.documentData).toEqual({
        _rev: "1-def",
        updatedAt: "2026-05-25T12:00:01Z",
      });
    });

    it("should handle blocks where new blocks array is empty and master has blocks", () => {
      const result = defaultConflictHandler({
        newDocumentState: {
          _rev: "1-abc",
          updatedAt: "2026-05-25T12:00:00Z",
          blocks: [],
        },
        realMasterState: {
          _rev: "1-def",
          updatedAt: "2026-05-25T12:00:00Z",
          blocks: [{ id: "b1" }],
        },
      });
      expect(result.documentData).toEqual({
        _rev: "1-def",
        updatedAt: "2026-05-25T12:00:00Z",
        blocks: [{ id: "b1" }],
      });
    });

    it("should handle both blocks undefined with equal revs", () => {
      const result = defaultConflictHandler({
        newDocumentState: { _rev: "1-abc" },
        realMasterState: { _rev: "1-def" },
      });
      expect(result.documentData).toEqual({ _rev: "1-def" });
    });

    it("should resolve equal-clock states by the revision lexicographically", () => {
      const result = defaultConflictHandler({
        newDocumentState: { _rev: "b-xxx" },
        realMasterState: { _rev: "a-xxx" },
      });
      expect(result.isEqual).toBe(false);
      expect(result.documentData).toEqual({ _rev: "b-xxx" });
    });

    it("should handle equal updatedAt times with fallthrough to lexicographic", () => {
      const result = defaultConflictHandler({
        newDocumentState: { _rev: "1-abc", updatedAt: "2026-05-25T12:00:00Z" },
        realMasterState: { _rev: "1-def", updatedAt: "2026-05-25T12:00:00Z" },
      });
      expect(result.documentData._rev).toBe("1-def");
    });

    it("should fall through when mergedBlocks length is unchanged (all duplicates)", () => {
      const result = defaultConflictHandler({
        newDocumentState: {
          _rev: "1-abc",
          updatedAt: "2026-05-25T12:00:00Z",
          blocks: [{ id: "b1", content: "updated" }],
        },
        realMasterState: {
          _rev: "1-def",
          updatedAt: "2026-05-25T12:00:00Z",
          blocks: [{ id: "b1", content: "original" }],
        },
      });
      expect(result.documentData._rev).toBe("1-def");
    });

    it("should handle getRevHeight with undefined rev", () => {
      // Test the internal getRevHeight function via defaultConflictHandler with missing _rev
      const result = defaultConflictHandler({
        newDocumentState: {},
        realMasterState: { _rev: "1-abc" },
      });
      expect(result.documentData).toEqual({ _rev: "1-abc" });
    });

    it("should handle getRevHeight with null rev", () => {
      const result = defaultConflictHandler({
        newDocumentState: { _rev: null },
        realMasterState: { _rev: "1-abc" },
      });
      expect(result.documentData).toEqual({ _rev: "1-abc" });
    });

    it("should handle realMasterState without _rev (falsy fallback)", () => {
      const result = defaultConflictHandler({
        newDocumentState: { _rev: "1-abc" },
        realMasterState: {},
      });
      expect(result.documentData).toEqual({ _rev: "1-abc" });
    });

    it("should reach lexicographic fallback with newDocumentState._rev falsy", () => {
      const result = defaultConflictHandler({
        newDocumentState: {},
        realMasterState: { _rev: "x-xxx" },
      });
      expect(result.documentData).toEqual({ _rev: "x-xxx" });
    });
  });

  describe("migrationStrategies", () => {
    it("v1: should add default boolean fields", () => {
      const result = migrationStrategies[1]!({});
      expect(result.processed).toBe(false);
      expect(result.isDeleted).toBe(false);
      expect(result.isPrivate).toBe(false);
    });

    it("v1: should convert numeric timestamps to ISO strings", () => {
      const result = migrationStrategies[1]!({
        createdAt: 1700000000000,
        updatedAt: 1700000000001,
      });
      expect(typeof result.createdAt).toBe("string");
      expect(typeof result.updatedAt).toBe("string");
      expect(result.createdAt).toContain("2023");
    });

    it("v1: should preserve existing values", () => {
      const result = migrationStrategies[1]!({
        processed: true,
        isDeleted: true,
        isPrivate: true,
      });
      expect(result.processed).toBe(true);
      expect(result.isDeleted).toBe(true);
      expect(result.isPrivate).toBe(true);
    });

    it("v1: should not crash with null timestamps", () => {
      const result = migrationStrategies[1]!({
        createdAt: null,
        updatedAt: null,
      });
      expect(result.processed).toBe(false);
    });

    it("v2: should ensure tags is an array", () => {
      expect(migrationStrategies[2]!({ tags: "single-tag" }).tags).toEqual([
        "single-tag",
      ]);
      expect(migrationStrategies[2]!({ tags: ["a", "b"] }).tags).toEqual([
        "a",
        "b",
      ]);
      expect(migrationStrategies[2]!({}).tags).toEqual([]);
    });

    it("v2: should handle null tags", () => {
      expect(migrationStrategies[2]!({ tags: null }).tags).toEqual([]);
    });

    it("v2: should remove invalid embedding", () => {
      expect(
        migrationStrategies[2]!({ embedding: "not-array" }).embedding,
      ).toBeUndefined();
      expect(
        migrationStrategies[2]!({ embedding: [0.1, 0.2] }).embedding,
      ).toEqual([0.1, 0.2]);
    });

    it("v2: should add summary field if missing", () => {
      expect(migrationStrategies[2]!({}).summary).toBe("");
      expect(migrationStrategies[2]!({ summary: "existing" }).summary).toBe(
        "existing",
      );
    });

    it("v2: should normalize URLs", () => {
      const result = migrationStrategies[2]!({
        url: "https://example.com/path",
      });
      expect(result.url).toBe("https://example.com/path");
    });

    it("v2: should keep invalid URLs unchanged", () => {
      const result = migrationStrategies[2]!({ url: "not-a-url" });
      expect(result.url).toBe("not-a-url");
    });
  });

  describe("COLLECTIONS", () => {
    it("should have all expected collections", () => {
      const names = Object.keys(COLLECTIONS);
      expect(names).toContain("bookmarks");
      expect(names).toContain("documents");
      expect(names).toContain("templates");
      expect(names).toContain("folders");
      expect(names).toContain("versions");
      expect(names).toContain("flashcards");
      expect(names).toContain("messages");
      expect(names).toContain("chunks");
      expect(names).toContain("highlights");
      expect(names).toContain("insights");
      expect(names).toContain("memory");
    });

    // Regression anchor for COL23: RxDB 17 OSS dropped the open-collection
    // cap from 16 → 13 (release notes 17.0.0). The `memory` collection was
    // consolidated from four subcollections in 25504c8 specifically so we
    // sit at 12 — under the cap and under the fee threshold. Re-splitting
    // any single legacy collection back into multiple RxDB entries will
    // tip this back to RED and block app startup.
    it("fits under the RxDB 17 OSS open-collection cap (COL23)", () => {
      const names = Object.keys(COLLECTIONS);
      expect(names.length).toBeLessThanOrEqual(13);
      expect(names).not.toContain("memoryAtoms");
      expect(names).not.toContain("memoryProfiles");
      expect(names).not.toContain("memorySessions");
      expect(names).not.toContain("memoryChatMessages");
      expect(names).not.toContain("memoryScenarios");
      expect(names).not.toContain("memoryPersonas");
    });

    it("each collection should have schema and handler", () => {
      for (const [name, config] of Object.entries(COLLECTIONS)) {
        expect(config, `Collection ${name} missing schema`).toHaveProperty(
          "schema",
        );
        expect(
          config,
          `Collection ${name} missing conflictHandler`,
        ).toHaveProperty("conflictHandler");
        expect(
          config,
          `Collection ${name} missing migrationStrategies`,
        ).toHaveProperty("migrationStrategies");
      }
    });
  });
});

// ========== INIT/GET/DESTROY TESTS ==========

describe("database.ts - initDB, getDB, destroyDB", () => {
  let initDB: any;
  let getDB: any;
  let destroyDB: any;
  let isDBInitialized: any;
  let getActiveStorageBackend: any;

  beforeAll(async () => {
    const mod = await import("../../db/database");
    initDB = mod.initDB;
    getDB = mod.getDB;
    destroyDB = mod.destroyDB;
    isDBInitialized = mod.isDBInitialized;
    getActiveStorageBackend = mod.getActiveStorageBackend;
  });

  beforeEach(() => {
    // Reset createRxDatabase to default resolved value before each test
    mockCreateRxDatabase.mockResolvedValue(mockDbInstanceBase);
    // Reset secureStorage
    mockSecureStorage.hasSecret.mockResolvedValue(false);
    mockSecureStorage.getSecret.mockResolvedValue(null);
    mockSecureStorage.setSecret.mockResolvedValue(undefined);
    // Reset encryptionService
    mockEncryptionService.decrypt.mockResolvedValue("decrypted_value");
    mockEncryptionService.encrypt.mockResolvedValue("encrypted_value");
    mockEncryptionService.deriveDbKey.mockResolvedValue(
      "derived-hex-key-1234567890abcdef",
    );
    // Reset db instance methods
    mockDbInstanceBase.destroy = vi.fn().mockResolvedValue({});
    mockDbInstanceBase.addCollections = vi.fn().mockResolvedValue({});
    // Clear any added collection properties from previous tests
    const collectionKeys = [
      "bookmarks",
      "documents",
      "templates",
      "folders",
      "versions",
      "flashcards",
      "messages",
      "chunks",
      "memory",
    ];
    collectionKeys.forEach((key) => delete mockDbInstanceBase[key]);
    // Reset indexedDB mock. Cast to `any` because the underlying global is a
    // plain function outside the test scope of `vi.mocked()`'s inference;
    // runtime semantics unchanged.
    (globalThis.indexedDB.deleteDatabase as any).mockClear();
    (globalThis.indexedDB.deleteDatabase as any).mockImplementation((): any => {
      const req: Record<string, any> = {
        onsuccess: null,
        onerror: null,
        onblocked: null,
        error: null,
      };
      Promise.resolve().then(() => req.onsuccess?.());
      return req;
    });
  });

  afterEach(async () => {
    // Restaurar un mock de deleteDatabase que resuelva onsuccess: los
    // edge-case tests leave controllable versions that never resolve and
    // would hang destroyDB() of this hook (hook timeout of 60s).
    (globalThis.indexedDB.deleteDatabase as any).mockImplementation((): any => {
      const req: Record<string, any> = {
        onsuccess: null,
        onerror: null,
        onblocked: null,
        error: null,
      };
      Promise.resolve().then(() => req.onsuccess?.());
      return req;
    });
    try {
      await destroyDB();
    } catch {
      // The test intentionally tolerates destroyDB() rejecting after the
      // controllable IndexedDB teardown hook has been exercised.
    }
  });

  describe("getActiveStorageBackend", () => {
    it("is null before init, Dexie after initDB, and null again after destroyDB", async () => {
      await destroyDB();
      expect(getActiveStorageBackend()).toBeNull();

      await initDB();
      expect(getActiveStorageBackend()).toBe("Dexie");

      await destroyDB();
      expect(getActiveStorageBackend()).toBeNull();
    });
  });

  describe("initDB", () => {
    it("returns a database instance", async () => {
      const db = await initDB();
      expect(db).toBeDefined();
      expect(db).toBe(mockDbInstanceBase);
    });

    it("waits for destroyDB before reinitializing instead of returning a stale instance", async () => {
      await initDB();
      let releaseDestroy!: () => void;
      let blockDestroy = true;
      mockDbInstanceBase.destroy = vi.fn(() => {
        if (!blockDestroy) {return Promise.resolve({});}
        return new Promise((resolve) => {
          releaseDestroy = () => {
            blockDestroy = false;
            resolve({});
          };
        });
      });
      (mockCreateRxDatabase as any).mockClear();

      const destroyPromise = destroyDB();
      await Promise.resolve();
      const reinitPromise = initDB();
      const readPromise = getDB();
      let reinitSettled = false;
      let readSettled = false;
      void reinitPromise.then(() => {
        reinitSettled = true;
      });
      void readPromise.then(() => {
        readSettled = true;
      });
      await Promise.resolve();

      expect(reinitSettled).toBe(false);
      expect(readSettled).toBe(false);
      releaseDestroy();
      await destroyPromise;
      const reinitialized = await reinitPromise;

      expect(await readPromise).toBe(reinitialized);
      expect(reinitialized).toBe(mockDbInstanceBase);
      expect(mockCreateRxDatabase).toHaveBeenCalledTimes(1);
    });

    it("returns the same instance on subsequent calls (singleton)", async () => {
      const db1 = await initDB();
      const db2 = await initDB();
      expect(db1).toBe(db2);
    });

    it("only calls createRxDatabase once for multiple initDB calls", async () => {
      (mockCreateRxDatabase as any).mockClear();
      await initDB();
      await initDB();
      expect(mockCreateRxDatabase).toHaveBeenCalledTimes(1);
    });

    it("returns existing dbInstance on fast path", async () => {
      const db1 = await initDB();
      (mockCreateRxDatabase as any).mockClear();
      const db2 = await initDB();
      expect(db2).toBe(db1);
      expect(mockCreateRxDatabase).not.toHaveBeenCalled();
    });

    it("calls addCollections when no collections exist (fresh init)", async () => {
      // mockDbInstanceBase has no collection properties, so addCollections is called
      await initDB();
      expect(mockDbInstanceBase.addCollections).toHaveBeenCalled();
    });
  });

  describe("initDB — generate salt", () => {
    it("generates new salt when none exists in vault or localStorage", async () => {
      mockSecureStorage.getSecret.mockImplementation(async (key: string) => {
        if (key === "vault_salt") return null;
        if (key === "vault_crypto_key") return null;
        return null;
      });
      await initDB();
      // Should have called setSecret with a generated salt
      // Cast to `any` here so TS doesn't enforce index/iteration narrowing on a junction where the value is asserted-defined immediately below. Runtime contract unchanged.
      const setSaltCall: any = (mockSecureStorage.setSecret.mock.calls as any).find(
        (c: [string, string]) => c[0] === "vault_salt",
      );
      expect(setSaltCall).toBeDefined();
      expect(setSaltCall[1]).toEqual(expect.any(String));
    });
  });

  describe("initDB — getPassword key derivation paths", () => {
    it("uses encrypted_db_key when hasEncryptedDbKey is true and password is provided", async () => {
      mockSecureStorage.hasSecret.mockResolvedValue(true);
      mockSecureStorage.getSecret.mockImplementation(async (key: string) => {
        if (key === "encrypted_db_key") return "stored_encrypted_key";
        return null;
      });
      await initDB("mypassword");
      expect(mockEncryptionService.decrypt).toHaveBeenCalledWith(
        "stored_encrypted_key",
        "mypassword",
      );
      expect(mockSecureStorage.hasSecret).toHaveBeenCalledWith(
        "encrypted_db_key",
      );
    });

    it("throws INVALID_PASSWORD when encryptionService.decrypt fails", async () => {
      mockSecureStorage.hasSecret.mockResolvedValue(true);
      mockSecureStorage.getSecret.mockImplementation(async (key: string) => {
        if (key === "encrypted_db_key") return "stored_encrypted_key";
        if (key === "vault_salt") return "existing-salt";
        return null;
      });
      mockEncryptionService.decrypt.mockRejectedValue(
        new Error("decrypt failed"),
      );
      await expect(initDB("mypassword")).rejects.toThrow("Invalid password");
    });

    it("throws VAULT_LOCKED (not INVALID_PASSWORD) when the device key is wrapped but not materialized", async () => {
      // The password is correct; getSecret(encrypted_db_key) fails only
      // because the vault is locked (device key wrapped in memory, not
      // materialized this session). This must NOT surface as a wrong
      // password in the UI.
      mockSecureStorage.hasSecret.mockResolvedValue(true);
      mockSecureStorage.getSecret.mockImplementation(async (key: string) => {
        if (key === "encrypted_db_key") {
          const wrappedErr = new Error(
            "[SecureStorage] Device key is wrapped by the master password — unlock the vault first",
          );
          wrappedErr.name = "DEVICE_KEY_WRAPPED";
          throw wrappedErr;
        }
        return null;
      });
      await expect(initDB("mypassword")).rejects.toThrow(
        "Vault is locked",
      );
      await expect(initDB("mypassword")).rejects.toMatchObject({
        name: "VAULT_LOCKED",
      });
      await expect(initDB("mypassword")).rejects.not.toMatchObject({
        name: "INVALID_PASSWORD",
      });
    });

    it("migrates legacy salt from localStorage", async () => {
      localStorage.setItem("vault_salt", "legacy-salt");
      mockSecureStorage.getSecret.mockImplementation(async (key: string) => {
        if (key === "vault_salt") return null;
        if (key === "vault_crypto_key") return "existing-key";
        return null;
      });
      await initDB();
      expect(mockSecureStorage.setSecret).toHaveBeenCalledWith(
        "vault_salt",
        "legacy-salt",
      );
      expect(localStorage.getItem("vault_salt")).toBeNull();
      localStorage.removeItem("vault_salt");
    });

    it("migrates legacy crypto key from localStorage", async () => {
      localStorage.setItem("vault_crypto_key", "legacy-key");
      mockSecureStorage.getSecret.mockImplementation(async (key: string) => {
        if (key === "vault_salt") return "existing-salt";
        if (key === "vault_crypto_key") return null;
        return null;
      });
      await initDB();
      expect(mockSecureStorage.setSecret).toHaveBeenCalledWith(
        "vault_crypto_key",
        "legacy-key",
      );
      expect(localStorage.getItem("vault_crypto_key")).toBeNull();
      localStorage.removeItem("vault_crypto_key");
    });

    it("generates a new vault_crypto_key when none exists", async () => {
      mockSecureStorage.getSecret.mockImplementation(async (key: string) => {
        if (key === "vault_salt") return "existing-salt";
        if (key === "vault_crypto_key") return null;
        return null;
      });
      await initDB();
      expect(mockSecureStorage.setSecret).toHaveBeenCalledWith(
        "vault_crypto_key",
        expect.any(String),
      );
    });

    it("encrypts and saves derived key when password is provided", async () => {
      mockSecureStorage.getSecret.mockImplementation(async (key: string) => {
        if (key === "vault_salt") return "existing-salt";
        if (key === "vault_crypto_key") return null;
        return null;
      });
      mockEncryptionService.encrypt.mockResolvedValue("encrypted-db-key");
      await initDB("mypassword");
      expect(mockEncryptionService.encrypt).toHaveBeenCalledWith(
        expect.any(String),
        "mypassword",
      );
      expect(mockSecureStorage.setSecret).toHaveBeenCalledWith(
        "encrypted_db_key",
        "encrypted-db-key",
      );
    });

    it("handles encryption failure gracefully when saving encrypted_db_key", async () => {
      mockSecureStorage.getSecret.mockImplementation(async (key: string) => {
        if (key === "vault_salt") return "existing-salt";
        if (key === "vault_crypto_key") return null;
        return null;
      });
      mockEncryptionService.encrypt.mockRejectedValue(
        new Error("encrypt failed"),
      );
      const db = await initDB("mypassword");
      expect(db).toBe(mockDbInstanceBase);
    });

    it("falls through when encrypted_db_key is null despite hasEncryptedDbKey being true", async () => {
      mockSecureStorage.hasSecret.mockResolvedValue(true);
      mockSecureStorage.getSecret.mockImplementation(async (key: string) => {
        if (key === "encrypted_db_key") return null;
        if (key === "vault_salt") return "existing-salt";
        return null;
      });
      const db = await initDB("mypassword");
      expect(db).toBe(mockDbInstanceBase);
    });

    it("skips encrypted_db_key path when hasEncryptedDbKey is true but no password provided", async () => {
      mockSecureStorage.hasSecret.mockResolvedValue(true);
      mockSecureStorage.getSecret.mockImplementation(async (key: string) => {
        if (key === "vault_salt") return "existing-salt";
        if (key === "vault_crypto_key") return null;
        return null;
      });
      const db = await initDB();
      expect(db).toBe(mockDbInstanceBase);
      expect(mockSecureStorage.setSecret).toHaveBeenCalledWith(
        "vault_crypto_key",
        expect.any(String),
      );
    });

    it("skips encrypted_db_key path when hasEncryptedDbKey is true but password is whitespace", async () => {
      mockSecureStorage.hasSecret.mockResolvedValue(true);
      mockSecureStorage.getSecret.mockImplementation(async (key: string) => {
        if (key === "vault_salt") return "existing-salt";
        if (key === "vault_crypto_key") return null;
        return null;
      });
      const db = await initDB("   ");
      expect(db).toBe(mockDbInstanceBase);
      expect(mockSecureStorage.setSecret).toHaveBeenCalledWith(
        "vault_crypto_key",
        expect.any(String),
      );
    });

    it("returns decrypted key early when encrypted_db_key is available and decrypt succeeds", async () => {
      mockSecureStorage.hasSecret.mockResolvedValue(true);
      mockSecureStorage.getSecret.mockImplementation(async (key: string) => {
        if (key === "encrypted_db_key") return "stored_encrypted_key_123";
        if (key === "vault_salt") return "existing-salt";
        return null;
      });
      mockEncryptionService.decrypt.mockResolvedValue("decrypted-hex-key");
      mockEncryptionService.encrypt.mockResolvedValue("encrypted-db-key");
      const db = await initDB("mypassword");
      expect(db).toBe(mockDbInstanceBase);
      expect(mockEncryptionService.decrypt).toHaveBeenCalledWith(
        "stored_encrypted_key_123",
        "mypassword",
      );
    });
  });

  describe("initDB — createDBInstance paths", () => {
    it("creates database with password (encrypted storage)", async () => {
      await initDB("secret123");
      // The password passed to createRxDatabase should be the derived key (hex string), not the original
      const callArgs = mockCreateRxDatabase.mock.calls[0]![0];
      expect(callArgs.password).toEqual(expect.any(String));
      expect(callArgs.password.length).toBeGreaterThan(0);
      const { wrappedKeyEncryptionCryptoJsStorage } =
        await import("rxdb/plugins/encryption-crypto-js");
      expect(wrappedKeyEncryptionCryptoJsStorage).toHaveBeenCalled();
    });

    it("falls back to Memory storage when Dexie fails", async () => {
      (mockCreateRxDatabase as any).mockClear();
      let callCount = 0;
      mockCreateRxDatabase.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return Promise.reject(new Error("Dexie failed"));
        return Promise.resolve(mockDbInstanceBase);
      });
      const db = await initDB();
      expect(db).toBe(mockDbInstanceBase);
      expect(callCount).toBe(2);
    });

    it("logs warning when switching storage backend after failure", async () => {
      const { logger } = await import("../../utils/logger");
      (logger.warn as ReturnType<typeof vi.fn>).mockClear();
      (mockCreateRxDatabase as any).mockClear();
      let callCount = 0;
      mockCreateRxDatabase.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return Promise.reject(new Error("Dexie failed"));
        return Promise.resolve(mockDbInstanceBase);
      });
      await initDB();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("storage failed, trying next backend"),
      );
    });

    it("detects automated/headless environment and uses Memory storage only", async () => {
      Object.defineProperty(navigator, "webdriver", {
        value: true,
        writable: true,
        configurable: true,
      });
      const { getRxStorageMemory } =
        await import("rxdb/plugins/storage-memory");
      const { getRxStorageDexie } = await import("rxdb/plugins/storage-dexie");
(getRxStorageDexie as any).mockClear().mockClear();
(getRxStorageMemory as any).mockClear().mockClear();

      await initDB();
      expect(getRxStorageMemory).toHaveBeenCalled();
      delete (navigator as any).webdriver;
    });

    it("does not use Dexie storage in headless/automated environment", async () => {
      Object.defineProperty(navigator, "webdriver", {
        value: true,
        writable: true,
        configurable: true,
      });
      const { getRxStorageDexie } = await import("rxdb/plugins/storage-dexie");
(getRxStorageDexie as any).mockClear().mockClear();

      await initDB();
      expect(getRxStorageDexie).not.toHaveBeenCalled();
      delete (navigator as any).webdriver;
    });

    it("detects headless via user-agent", async () => {
      const originalUA = navigator.userAgent;
      Object.defineProperty(navigator, "userAgent", {
        value: "Mozilla/5.0 HeadlessChrome/120.0",
        writable: true,
        configurable: true,
      });
      Object.defineProperty(navigator, "webdriver", {
        value: false,
        writable: true,
        configurable: true,
      });
      const { getRxStorageMemory } =
        await import("rxdb/plugins/storage-memory");
(getRxStorageMemory as any).mockClear().mockClear();

      await initDB();
      expect(getRxStorageMemory).toHaveBeenCalled();
      Object.defineProperty(navigator, "userAgent", {
        value: originalUA,
        writable: true,
        configurable: true,
      });
      delete (navigator as any).webdriver;
    });

    it("detects automated env via VITE_FORCE_MEMORY_STORAGE env var", async () => {
      const originalEnv = import.meta.env.VITE_FORCE_MEMORY_STORAGE;
      import.meta.env.VITE_FORCE_MEMORY_STORAGE = "true";
      Object.defineProperty(navigator, "webdriver", {
        value: false,
        writable: true,
        configurable: true,
      });
      Object.defineProperty(navigator, "userAgent", {
        value: "Mozilla/5.0 Chrome/120.0",
        writable: true,
        configurable: true,
      });
      const { getRxStorageMemory } =
        await import("rxdb/plugins/storage-memory");
      const { getRxStorageDexie } = await import("rxdb/plugins/storage-dexie");
(getRxStorageMemory as any).mockClear().mockClear();
(getRxStorageDexie as any).mockClear().mockClear();

      await initDB();
      expect(getRxStorageMemory).toHaveBeenCalled();
      expect(getRxStorageDexie).not.toHaveBeenCalled();
      import.meta.env.VITE_FORCE_MEMORY_STORAGE = originalEnv;
      delete (navigator as any).webdriver;
    });

    it("passes derived key when creating DB with password", async () => {
      (mockCreateRxDatabase as any).mockClear();
      await initDB("testpassword");
      const callArgs = mockCreateRxDatabase.mock.calls[0]![0];
      expect(callArgs.password).toBe("derived-hex-key-1234567890abcdef");
    });

    it("handles createDBInstance rejection with non-Error value (String path)", async () => {
      (mockCreateRxDatabase as any).mockClear();
      mockCreateRxDatabase.mockRejectedValue("string rejection");
      await expect(initDB()).rejects.toThrow();
    });

    it("refuses Memory fallback in production even in an automated browser", async () => {
      const originalProd = import.meta.env.PROD;
      const originalMemoryFlag = import.meta.env.VITE_FORCE_MEMORY_STORAGE;
      vi.stubEnv("PROD", true as any);
      import.meta.env.VITE_FORCE_MEMORY_STORAGE = "false";
      Object.defineProperty(navigator, "webdriver", {
        value: true,
        writable: true,
        configurable: true,
      });

      const { getRxStorageMemory } =
        await import("rxdb/plugins/storage-memory");
      (getRxStorageMemory as any).mockClear();
      mockCreateRxDatabase.mockRejectedValue(new Error("IndexedDB unavailable"));

      await expect(initDB()).rejects.toThrow("Database inaccessible");
      expect(getRxStorageMemory).not.toHaveBeenCalled();

      vi.stubEnv("PROD", originalProd as any);
      import.meta.env.VITE_FORCE_MEMORY_STORAGE = originalMemoryFlag;
      delete (navigator as any).webdriver;
    });

    it("throws when all storage backends fail (non-headless, Dexie + Memory both fail)", async () => {
      // Force non-automated mode so both Dexie and Memory are tried
      Object.defineProperty(navigator, "webdriver", {
        value: false,
        writable: true,
        configurable: true,
      });
      Object.defineProperty(navigator, "userAgent", {
        value: "Mozilla/5.0 Chrome/120.0",
        writable: true,
        configurable: true,
      });

      (mockCreateRxDatabase as any).mockClear();
      mockCreateRxDatabase.mockRejectedValue(new Error("storage failed"));

      // ADR-019: the last backend's error is classified (UNKNOWN →
      // DB_INACCESSIBLE) in initDB; the raw message is not re-thrown.
      await expect(initDB()).rejects.toThrow("Database inaccessible");

      delete (navigator as any).webdriver;
    });
  });

  describe("initDB — createDBInstance retry", () => {
    it("retries the SAME backend with a larger budget on DB_INIT_TIMEOUT (no Memory fallback)", async () => {
      // Dev-like env: backends are [Dexie, Memory]. A migration timeout
      // must retry Dexie (migration is resumable), NOT fall back to
      // Memory — falling back presents an empty vault over real data.
      Object.defineProperty(navigator, "webdriver", {
        value: false,
        writable: true,
        configurable: true,
      });
      Object.defineProperty(navigator, "userAgent", {
        value: "Mozilla/5.0 Chrome/120.0",
        writable: true,
        configurable: true,
      });
      vi.useFakeTimers();
      try {
        let calls = 0;
        const DB_CONFIG = (await import("../../constants/config")).DB_CONFIG;
        mockCreateRxDatabase.mockImplementation(() => {
          calls += 1;
          if (calls === 1) return new Promise(() => {});
          if (calls === 2) {
            return new Promise((resolve) =>
              setTimeout(() => resolve(mockDbInstanceBase), 5000),
            );
          }
          return Promise.resolve(mockDbInstanceBase);
        });

        const initP = initDB();
        // Attempt 0 budget = INITIAL (10s): timeout fires at t=10s, retry
        // backoff 500ms lands at t=10.5s.
        await vi.advanceTimersByTimeAsync(DB_CONFIG.INITIAL_TIMEOUT_MS);
        // Attempt 1 budget = 1.5× INITIAL (15s); the mock resolves 5s in.
        await vi.advanceTimersByTimeAsync(DB_CONFIG.INITIAL_TIMEOUT_MS + 1000);

        await expect(initP).resolves.toBe(mockDbInstanceBase);
        expect(calls).toBe(2);
      } finally {
        vi.useRealTimers();
        delete (navigator as any).webdriver;
      }
    });

    it("throws DB_INIT_TIMEOUT after Dexie retries are exhausted — Memory backend never engaged", async () => {
      Object.defineProperty(navigator, "webdriver", {
        value: false,
        writable: true,
        configurable: true,
      });
      Object.defineProperty(navigator, "userAgent", {
        value: "Mozilla/5.0 Chrome/120.0",
        writable: true,
        configurable: true,
      });
      vi.useFakeTimers();
      (mockCreateRxDatabase as any).mockClear();
      mockCreateRxDatabase.mockImplementation(() => new Promise(() => {}));
      const { getRxStorageMemory } = await import(
        "rxdb/plugins/storage-memory"
      );
      (getRxStorageMemory as any).mockClear();
      try {
        const initP = initDB();
        initP.catch(() => { /* INTENTIONAL SILENCE: observes rejection without an unhandled-promise warning. */ });
        const DB_CONFIG = (await import("../../constants/config")).DB_CONFIG;
        const maxRetries = DB_CONFIG.MAX_RETRIES;
        const initialTimeout = DB_CONFIG.INITIAL_TIMEOUT_MS;
        let totalTime = 0;
        for (let i = 0; i <= maxRetries; i++) {
          totalTime +=
            Math.min(
              initialTimeout * Math.pow(1.5, i),
              DB_CONFIG.MAX_TIMEOUT_MS,
            ) +
            500 * (i + 1);
        }
        await vi.advanceTimersByTimeAsync(totalTime + 1000);
        // initDB classifies the raw DB_INIT_TIMEOUT into the user-facing
        // INACCESSIBLE error — a visible failure, never a silent Memory
        // vault.
        await expect(initP).rejects.toThrow("Database inaccessible");
        expect(getRxStorageMemory).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
        delete (navigator as any).webdriver;
      }
    }, 30000);

    it("throws original error when not a timeout despite retries left", async () => {
      (mockCreateRxDatabase as any).mockClear();
      let calls = 0;
      mockCreateRxDatabase.mockImplementation(() => {
        calls++;
        if (calls <= 1)
          return Promise.reject(new Error("Non-timeout storage error"));
        return Promise.resolve(mockDbInstanceBase);
      });
      const db = await initDB();
      expect(db).toBe(mockDbInstanceBase);
      expect(calls).toBe(2);
    });

    it("throws all backends failed when retries are exhausted", async () => {
      Object.defineProperty(navigator, "webdriver", {
        value: true,
        writable: true,
        configurable: true,
      });
      vi.useFakeTimers();
      (mockCreateRxDatabase as any).mockClear();
      mockCreateRxDatabase.mockImplementation(() => new Promise(() => {}));
      const initP = initDB();
      initP.catch(() => { /* INTENTIONAL SILENCE: this test intentionally observes rejection without an unhandled-promise warning. */ });
      const DB_CONFIG = (await import("../../constants/config")).DB_CONFIG;
      const maxRetries = DB_CONFIG.MAX_RETRIES;
      const initialTimeout = DB_CONFIG.INITIAL_TIMEOUT_MS;
      let totalTime = 0;
      for (let i = 0; i <= maxRetries; i++) {
        totalTime +=
          Math.min(
            initialTimeout * Math.pow(1.5, i),
            DB_CONFIG.MAX_TIMEOUT_MS,
          ) +
          500 * (i + 1);
      }
      await vi.advanceTimersByTimeAsync(totalTime + 1000);
      await expect(initP).rejects.toThrow();
      vi.useRealTimers();
      delete (navigator as any).webdriver;
    }, 30000);

    it("retries when Memory storage also times out", async () => {
      // Force automated detection so only Memory backend is used
      Object.defineProperty(navigator, "webdriver", {
        value: true,
        writable: true,
        configurable: true,
      });
      vi.useFakeTimers();
      (mockCreateRxDatabase as any).mockClear();

      // First call hangs (timeout), second call succeeds
      let calls = 0;
      mockCreateRxDatabase.mockImplementation(() => {
        calls++;
        if (calls === 1) return new Promise(() => {});
        return Promise.resolve(mockDbInstanceBase);
      });

      const initP = initDB();
      const DB_CONFIG = (await import("../../constants/config")).DB_CONFIG;
      const firstTimeout = DB_CONFIG.INITIAL_TIMEOUT_MS; // 10000ms
      // Advance past initial timeout (10000ms) + retry delay (500ms) = 10500ms
      await vi.advanceTimersByTimeAsync(firstTimeout + 600);

      const db = await initP;
      expect(db).toBe(mockDbInstanceBase);
      expect(calls).toBe(2);
      vi.useRealTimers();
      delete (navigator as any).webdriver;
    }, 15000);

    it("mid-migration timeout CLOSES the half-built instance but never removes its data (retry resumes the same vault)", async () => {
      // Regression (F-06 follow-up): the timeout/retry path used to call
      // teardownRxDB -> remove(), and RxDatabase.remove() clears every docs
      // table. A DB_INIT_TIMEOUT fires mid-migration, so remove() wiped the
      // half-migrated vault (old + new stores + migration checkpoints) and
      // the retry re-opened EMPTY storage — permanent data loss presented
      // as a healthy empty vault. The teardown must close the connection
      // only; RxDB's migration replication checkpoints then let the retry
      // RESUME the migration.
      Object.defineProperty(navigator, "webdriver", {
        value: false,
        writable: true,
        configurable: true,
      });
      Object.defineProperty(navigator, "userAgent", {
        value: "Mozilla/5.0 Chrome/120.0",
        writable: true,
        configurable: true,
      });
      vi.useFakeTimers();
      try {
        let calls = 0;
        const firstInstance = {
          remove: vi.fn().mockResolvedValue({}),
          close: vi.fn().mockResolvedValue({}),
          destroy: vi.fn().mockResolvedValue({}),
          // Hangs: simulates a schema migration still in flight when the
          // safety timeout fires.
          addCollections: vi.fn().mockImplementation(() => new Promise(() => {})),
        };
        mockCreateRxDatabase.mockImplementation(() => {
          calls += 1;
          if (calls === 1) return Promise.resolve(firstInstance);
          return Promise.resolve(mockDbInstanceBase);
        });

        const initP = initDB();
        const DB_CONFIG = (await import("../../constants/config")).DB_CONFIG;
        // Attempt 0 budget = INITIAL: the hanging addCollections trips the
        // timeout; the retry backoff (500ms) + instant second attempt land
        // shortly after.
        await vi.advanceTimersByTimeAsync(DB_CONFIG.INITIAL_TIMEOUT_MS + 1000);

        await expect(initP).resolves.toBe(mockDbInstanceBase);
        expect(calls).toBe(2);
        // The half-built instance was CLOSED for the retry...
        expect(firstInstance.close).toHaveBeenCalledTimes(1);
        // ...but its data was NEVER removed: remove() is reserved for
        // destroyDB's explicit user wipe.
        expect(firstInstance.remove).not.toHaveBeenCalled();
        // close() succeeded, so the destroy() fallback is never needed.
        expect(firstInstance.destroy).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
        delete (navigator as any).webdriver;
      }
    }, 20000);

    it("non-timeout addCollections failure also keeps the data (close-only, no remove)", async () => {
      // Same data-preservation contract for DXE1/DB3-style addCollections
      // failures: the next backend (Memory in dev) must not inherit a wiped
      // vault either.
      Object.defineProperty(navigator, "webdriver", {
        value: false,
        writable: true,
        configurable: true,
      });
      Object.defineProperty(navigator, "userAgent", {
        value: "Mozilla/5.0 Chrome/120.0",
        writable: true,
        configurable: true,
      });
      vi.useFakeTimers();
      try {
        let calls = 0;
        const firstInstance = {
          remove: vi.fn().mockResolvedValue({}),
          close: vi.fn().mockResolvedValue({}),
          destroy: vi.fn().mockResolvedValue({}),
          addCollections: vi
            .fn()
            .mockRejectedValue(new Error("DXE1: schema error")),
        };
        mockCreateRxDatabase.mockImplementation(() => {
          calls += 1;
          if (calls === 1) return Promise.resolve(firstInstance);
          return Promise.resolve(mockDbInstanceBase);
        });

        const db = await initDB();
        expect(db).toBe(mockDbInstanceBase);
        expect(calls).toBe(2);
        expect(firstInstance.close).toHaveBeenCalledTimes(1);
        expect(firstInstance.remove).not.toHaveBeenCalled();
        expect(firstInstance.destroy).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
        delete (navigator as any).webdriver;
      }
    }, 20000);
  });

  describe("initDB — addCollections error handling", () => {
    it("handles addCollections DXE1 error gracefully when collections are accessible", async () => {
      mockDbInstanceBase.addCollections = vi
        .fn()
        .mockImplementation(async () => {
          mockDbInstanceBase.bookmarks = {};
          mockDbInstanceBase.documents = {};
          mockDbInstanceBase.templates = {};
          mockDbInstanceBase.folders = {};
          mockDbInstanceBase.versions = {};
          mockDbInstanceBase.flashcards = {};
          mockDbInstanceBase.messages = {};
          mockDbInstanceBase.chunks = {};
          mockDbInstanceBase.highlights = {};
          mockDbInstanceBase.insights = {};
          mockDbInstanceBase.memory = {};
          mockDbInstanceBase.memory = {};
          mockDbInstanceBase.memory = {};
          mockDbInstanceBase.memory = {};
      mockDbInstanceBase.documentAttachments = {};
        mockDbInstanceBase.documentAttachments = {};
          mockDbInstanceBase.documentAttachments = {};
          throw new Error("DXE1: schema error");
        });
      const db = await initDB();
      expect(db).toBe(mockDbInstanceBase);
    });

    it("classifies DXE1 addCollections failure as DB_INACCESSIBLE when collections are NOT accessible", async () => {
      mockDbInstanceBase.addCollections = vi
        .fn()
        .mockRejectedValue(new Error("DXE1: schema error"));
      // ADR-019: an addCollections failure destroys the half-built
      // instance, falls to the next backend and, once all are exhausted, initDB
      // classifies the error as DB_INACCESSIBLE (never re-throws the raw one).
      await expect(initDB()).rejects.toThrow("Database inaccessible");
      const { logger } = await import("../../utils/logger");
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("addCollections failed"),
        expect.any(Object),
      );
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("closing half-built instance (data kept)"),
        expect.any(Object),
      );
    });

    it("handles addCollections DB3 error gracefully when collections are accessible", async () => {
      mockDbInstanceBase.addCollections = vi
        .fn()
        .mockImplementation(async () => {
          mockDbInstanceBase.bookmarks = {};
          mockDbInstanceBase.documents = {};
          mockDbInstanceBase.templates = {};
          mockDbInstanceBase.folders = {};
          mockDbInstanceBase.versions = {};
          mockDbInstanceBase.flashcards = {};
          mockDbInstanceBase.messages = {};
          mockDbInstanceBase.chunks = {};
          mockDbInstanceBase.highlights = {};
          mockDbInstanceBase.insights = {};
          mockDbInstanceBase.memory = {};
          mockDbInstanceBase.memory = {};
          mockDbInstanceBase.memory = {};
          mockDbInstanceBase.memory = {};
      mockDbInstanceBase.documentAttachments = {};
        mockDbInstanceBase.documentAttachments = {};
          mockDbInstanceBase.documentAttachments = {};
          throw new Error("DB3: some error");
        });
      const db = await initDB();
      expect(db).toBe(mockDbInstanceBase);
    });

    it("classifies non-DXE1/DB3 addCollections errors as DB_INACCESSIBLE", async () => {
      mockDbInstanceBase.addCollections = vi
        .fn()
        .mockRejectedValue(new Error("unexpected error"));
      // ADR-019: any addCollections failure falls to the next backend;
      // the final error is classified, not re-thrown raw.
      await expect(initDB()).rejects.toThrow("Database inaccessible");
    });

    it("handles addCollections error with object", async () => {
      mockDbInstanceBase.addCollections = vi
        .fn()
        .mockRejectedValue({ message: "object error", code: "ERR" });
      await expect(initDB()).rejects.toThrow();
    });

    it("handles addCollections error with string primitive", async () => {
      mockDbInstanceBase.addCollections = vi
        .fn()
        .mockRejectedValue("string error");
      await expect(initDB()).rejects.toThrow();
    });

    it("handles addCollections error with boolean true", async () => {
      mockDbInstanceBase.addCollections = vi.fn().mockRejectedValue(true);
      await expect(initDB()).rejects.toThrow();
    });

    it("handles addCollections error with empty message (empty string)", async () => {
      mockDbInstanceBase.addCollections = vi
        .fn()
        .mockRejectedValue(new Error(""));
      await expect(initDB()).rejects.toThrow();
    });

    it("handles addCollections error with error object having custom properties", async () => {
      const customErr = new Error("test error");
      (customErr as any).customField = "value";
      mockDbInstanceBase.addCollections = vi.fn().mockRejectedValue(customErr);
      await expect(initDB()).rejects.toThrow();
    });

    it("handles addCollections error with throwing property getter (<unreadable> path)", async () => {
      const throwingErr = Object.defineProperty(
        new Error("partial error"),
        "stack",
        {
          get: () => {
            throw new Error("cannot read stack");
          },
          configurable: true,
        },
      );
      mockDbInstanceBase.addCollections = vi
        .fn()
        .mockRejectedValue(throwingErr);
      await expect(initDB()).rejects.toThrow();
    });

    it("handles addCollections error with null", async () => {
      mockDbInstanceBase.addCollections = vi.fn().mockRejectedValue(null);
      await expect(initDB()).rejects.toThrow();
    });

    it("handles addCollections error with error object that has code", async () => {
      const err: any = { message: "err msg", name: "ErrName", code: "ERR123" };
      mockDbInstanceBase.addCollections = vi.fn().mockRejectedValue(err);
      await expect(initDB()).rejects.toThrow();
    });

    it("handles addCollections error with object having error prop instead of message", async () => {
      mockDbInstanceBase.addCollections = vi
        .fn()
        .mockRejectedValue({ error: "something failed" });
      await expect(initDB()).rejects.toThrow();
    });

    it("handles addCollections error with object having neither message nor error", async () => {
      mockDbInstanceBase.addCollections = vi
        .fn()
        .mockRejectedValue({ code: 500 });
      await expect(initDB()).rejects.toThrow();
    });

    it("handles addCollections DXE1 error from non-Error object", async () => {
      mockDbInstanceBase.addCollections = vi.fn().mockImplementation(() => {
        mockDbInstanceBase.bookmarks = {};
        mockDbInstanceBase.documents = {};
        mockDbInstanceBase.templates = {};
        mockDbInstanceBase.folders = {};
        mockDbInstanceBase.versions = {};
        mockDbInstanceBase.flashcards = {};
        mockDbInstanceBase.messages = {};
        mockDbInstanceBase.chunks = {};
        mockDbInstanceBase.highlights = {};
        mockDbInstanceBase.insights = {};
        mockDbInstanceBase.memory = {};
        mockDbInstanceBase.memory = {};
        mockDbInstanceBase.memory = {};
        mockDbInstanceBase.memory = {};
      mockDbInstanceBase.documentAttachments = {};
        mockDbInstanceBase.documentAttachments = {};
        throw { message: "DXE1: schema error from object", code: "ERR" };
      });
      const db = await initDB();
      expect(db).toBe(mockDbInstanceBase);
    });

    it("handles addCollections DXE1 error from string primitive", async () => {
      mockDbInstanceBase.addCollections = vi.fn().mockImplementation(() => {
        mockDbInstanceBase.bookmarks = {};
        mockDbInstanceBase.documents = {};
        mockDbInstanceBase.templates = {};
        mockDbInstanceBase.folders = {};
        mockDbInstanceBase.versions = {};
        mockDbInstanceBase.flashcards = {};
        mockDbInstanceBase.messages = {};
        mockDbInstanceBase.chunks = {};
        mockDbInstanceBase.highlights = {};
        mockDbInstanceBase.insights = {};
        mockDbInstanceBase.memory = {};
        mockDbInstanceBase.memory = {};
        mockDbInstanceBase.memory = {};
        mockDbInstanceBase.memory = {};
      mockDbInstanceBase.documentAttachments = {};
        mockDbInstanceBase.documentAttachments = {};
        throw "DB3: primitive error string";
      });
      const db = await initDB();
      expect(db).toBe(mockDbInstanceBase);
    });

    it("classifies collection-check throw as DB_INACCESSIBLE (all backends fail)", async () => {
      // ADR-019: el throw al inspeccionar colecciones (typedCreated[name])
      // makes the backend fail; once all are exhausted, initDB classifies the failure.
      Object.defineProperty(mockDbInstanceBase, "bookmarks", {
        get: () => {
          throw new Error("access error");
        },
        configurable: true,
      });
      mockDbInstanceBase.addCollections = vi.fn().mockResolvedValue({});
      await expect(initDB()).rejects.toThrow("Database inaccessible");
    });

    it("skips addCollections when all collections are already present", async () => {
      // Remove any leftover getter-only properties from previous tests
      delete (mockDbInstanceBase as any).bookmarks;
      // Set all collection properties before initDB so missingCollections is empty
      mockDbInstanceBase.bookmarks = {};
      mockDbInstanceBase.documents = {};
      mockDbInstanceBase.templates = {};
      mockDbInstanceBase.folders = {};
      mockDbInstanceBase.versions = {};
      mockDbInstanceBase.flashcards = {};
      mockDbInstanceBase.messages = {};
      mockDbInstanceBase.chunks = {};
      mockDbInstanceBase.highlights = {};
      mockDbInstanceBase.insights = {};
      mockDbInstanceBase.memory = {};
      mockDbInstanceBase.memory = {};
      mockDbInstanceBase.memory = {};
      mockDbInstanceBase.memory = {};
      mockDbInstanceBase.documentAttachments = {};
      mockDbInstanceBase.addCollections = vi.fn().mockResolvedValue({});

      const db = await initDB();
      expect(db).toBe(mockDbInstanceBase);
      expect(mockDbInstanceBase.addCollections).not.toHaveBeenCalled();
    });

    it("classifies non-Error collection-check throw (String path) as DB_INACCESSIBLE", async () => {
      Object.defineProperty(mockDbInstanceBase, "bookmarks", {
        get: () => {
          throw "string collection error";
        },
        configurable: true,
      });
      mockDbInstanceBase.addCollections = vi.fn().mockResolvedValue({});
      await expect(initDB()).rejects.toThrow("Database inaccessible");
    });
  });

  describe("initDB — tryInit error paths", () => {
    it("throws INVALID_PASSWORD error for DB1 errors", async () => {
      (mockCreateRxDatabase as any).mockClear();
      // ADR-019: the classifier uses ONLY the `.code` property, never the
      // message — so the mock must carry code="DB1" like real RxDB.
      const db1Error = new Error("DB1: password error") as Error & {
        code?: string;
      };
      db1Error.code = "DB1";
      mockCreateRxDatabase.mockRejectedValue(db1Error);
      await expect(initDB("wrongpass")).rejects.toThrow("Invalid password");
    });

    it("classifies non-password related failures as DB_INACCESSIBLE", async () => {
      (mockCreateRxDatabase as any).mockClear();
      mockCreateRxDatabase.mockRejectedValue(
        new Error("random storage failure"),
      );
      // ADR-019: without a DB1/DB3 code, initDB wraps the error in
      // DB_INACCESSIBLE so the UI shows a friendly fallback.
      await expect(initDB()).rejects.toThrow("Database inaccessible");
    });

    it("resets initLock and initPromise after initDB throws", async () => {
      (mockCreateRxDatabase as any).mockClear();
      mockCreateRxDatabase.mockRejectedValue(new Error("fail"));
      await expect(initDB()).rejects.toThrow();
      const db = await getDB();
      expect(db).toBeNull();
    });

    it("handles DB1 error via errorCode", async () => {
      const err: any = new Error("storage failed");
      err.code = "DB1";
      mockCreateRxDatabase.mockRejectedValue(err);
      await expect(initDB()).rejects.toThrow("Invalid password");
    });

    it("throws all storage backends failed when all backends error without timeout", async () => {
      mockCreateRxDatabase.mockRejectedValue(new Error("dexie crash"));
      await expect(initDB()).rejects.toThrow();
    });
  });

  describe("initDB — initLock paths", () => {
    it("returns existing initPromise when lock is held and initPromise exists", async () => {
      // First call starts init and sets initLock + initPromise
      const firstCall = initDB();
      // Second call hits initLock check, finds initPromise
      const secondCall = initDB();
      // Both should resolve to the same instance
      const [db1, db2] = await Promise.all([firstCall, secondCall]);
      expect(db1).toBe(db2);
    });

    it("falls back to yield and return dbInstance when lock is held but initPromise is null", async () => {
      const db = await initDB();
      (mockCreateRxDatabase as any).mockClear();
      await initDB();
      expect(db).toBe(mockDbInstanceBase);
    });

    it("returns existing instance on double-check inside initPromise when lock held", async () => {
      // First call creates dbInstance and sets initLock=true
      const firstCall = initDB();
      // Second call should hit the initLock check and return initPromise
      const secondCall = initDB();
      const [db1, db2] = await Promise.all([firstCall, secondCall]);
      expect(db1).toBe(db2);
      expect(db1).toBe(mockDbInstanceBase);
    });
  });

  describe("getDB", () => {
    it("returns null when database is not initialized", async () => {
      const db = await getDB();
      expect(db).toBeNull();
    });

    it("returns the same instance as initDB after initialization", async () => {
      await initDB();
      const getResult = await getDB();
      expect(getResult).toBe(mockDbInstanceBase);
    });

    it("returns null after destroyDB is called", async () => {
      await initDB();
      await destroyDB();
      const db = await getDB();
      expect(db).toBeNull();
    });

    it("returns null via catch when initDB rejects during initPromise", async () => {
      (mockCreateRxDatabase as any).mockClear();
      mockCreateRxDatabase.mockRejectedValue(new Error("storage error"));
      const initDbPromise = initDB();
      const getResult = await getDB();
      expect(getResult).toBeNull();
      // ADR-019: el error crudo se clasifica como DB_INACCESSIBLE.
      await expect(initDbPromise).rejects.toThrow("Database inaccessible");
    });

    it("returns initPromise result when initDB is in progress", async () => {
      let resolveCreate: (value: unknown) => void;
      mockCreateRxDatabase.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveCreate = resolve;
          }),
      );

      const initCall = initDB();

      const getResultPromise = getDB();

      await vi.waitFor(() => {
        expect(typeof resolveCreate).toBe("function");
      });

      resolveCreate!(mockDbInstanceBase);

      const getResult = await getResultPromise;
      expect(getResult).toBe(mockDbInstanceBase);

      await initCall;
    });
  });

  describe("isDBInitialized", () => {
    it("returns false when database has not been initialized", () => {
      expect(isDBInitialized()).toBe(false);
    });

    it("returns true after initDB completes", async () => {
      await initDB();
      expect(isDBInitialized()).toBe(true);
    });

    it("returns false after destroyDB completes", async () => {
      await initDB();
      await destroyDB();
      expect(isDBInitialized()).toBe(false);
    });
  });

  describe("destroyDB", () => {
    it("calls destroy on the database instance", async () => {
      await initDB();
      mockDbInstanceBase.destroy.mockClear();
      await destroyDB();
      expect(mockDbInstanceBase.destroy).toHaveBeenCalledTimes(1);
    });

    it("resets isDBInitialized to false", async () => {
      await initDB();
      expect(isDBInitialized()).toBe(true);
      await destroyDB();
      expect(isDBInitialized()).toBe(false);
    });

    it("makes getDB return null", async () => {
      await initDB();
      expect(await getDB()).not.toBeNull();
      await destroyDB();
      expect(await getDB()).toBeNull();
    });

    it("handles destroy errors gracefully without throwing", async () => {
      mockDbInstanceBase.destroy.mockRejectedValueOnce(
        new Error("destroy failed"),
      );
      await initDB();
      await expect(destroyDB()).rejects.toThrow("destroy failed");
    });

    it("resets state even when destroy throws", async () => {
      mockDbInstanceBase.destroy.mockRejectedValueOnce(
        new Error("destroy failed"),
      );
      await initDB();
      await expect(destroyDB()).rejects.toThrow("destroy failed");
      expect(isDBInitialized()).toBe(false);
      expect(await getDB()).toBeNull();
    });

    it("can be called multiple times without error", async () => {
      await initDB();
      await destroyDB();
      await expect(destroyDB()).resolves.toBeUndefined();
    });

    it("deletes the database from indexedDB", async () => {
      const deleteDatabaseMock = vi.mocked(globalThis.indexedDB.deleteDatabase);
      deleteDatabaseMock.mockClear();
      await initDB();
      await destroyDB();
      expect(deleteDatabaseMock).toHaveBeenCalled();
    });

    it("wipes rxdb-dexie-* per-collection databases when databases() is available", async () => {
      // Simulate an environment where indexedDB.databases() is enumerable
      // (browser), listing leftover per-collection Dexie DBs. destroyDB must
      // delete every one so a corrupted vault re-open does not hit DB1 /
      // remain unrecoverable (F0-2 restore regression).
      //
      // vault.stubGlobal persists across tests (no unstubGlobals), so the
      // original mock MUST be restored explicitly in `finally` to avoid
      // corrupting the shared global for later tests.
      const originalIndexedDB = globalThis.indexedDB;
      const dexieNames = [
        "rxdb-dexie-bookmarkforge_v5--7--bookmarks",
        "rxdb-dexie-bookmarkforge_v5--7--documents",
        "rxdb-dexie-bookmarkforge_v5--7--chunks",
        "bookmarkforge_secure_vault",
      ];
      vi.stubGlobal("indexedDB", {
        deleteDatabase: vi.fn().mockImplementation((): any => {
          const req: Record<string, any> = {
            onsuccess: null,
            onerror: null,
            onblocked: null,
            error: null,
          };
          Promise.resolve().then(() => req.onsuccess?.());
          return req;
        }),
        databases: vi.fn().mockResolvedValue(
          dexieNames.map((name) => ({ name })),
        ),
      });

      try {
        await initDB();
        await destroyDB();

        const deleteDatabaseMock = vi.mocked(globalThis.indexedDB.deleteDatabase);
        const calledNames = deleteDatabaseMock.mock.calls.map(([n]) => n);
        // Every per-collection Dexie db must be deleted.
        expect(calledNames).toContain("rxdb-dexie-bookmarkforge_v5--7--bookmarks");
        expect(calledNames).toContain("rxdb-dexie-bookmarkforge_v5--7--documents");
        expect(calledNames).toContain("rxdb-dexie-bookmarkforge_v5--7--chunks");
        // Non vault-prefixed databases (e.g. secure vault) must NOT be touched.
        expect(calledNames).not.toContain("bookmarkforge_secure_vault");
      } finally {
        (globalThis as unknown as { indexedDB: unknown }).indexedDB =
          originalIndexedDB;
      }
    });

    it("handles deleteDatabase onblocked gracefully", async () => {
      await initDB();
      const deleteDatabaseMock = vi.mocked(globalThis.indexedDB.deleteDatabase);      deleteDatabaseMock.mockImplementation((): any => {
          const req: Record<string, any> = {
          onsuccess: null,
          onerror: null,
          onblocked: null,
          error: null,
        };
        Promise.resolve().then(() => req.onblocked?.());
        return req;
      });
      await expect(destroyDB()).resolves.toBeUndefined();
      const { logger } = await import("../../utils/logger");
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("blocked"),
      );
    });

    it("handles deleteDatabase onerror gracefully", async () => {
      await initDB();
      const deleteDatabaseMock = vi.mocked(globalThis.indexedDB.deleteDatabase);
      const dbError = new DOMException("blocked", "VersionError");      deleteDatabaseMock.mockImplementation((): any => {
          const req: Record<string, any> = {
          onsuccess: null,
          onerror: null,
          onblocked: null,
          error: dbError,
        };
        Promise.resolve().then(() => req.onerror?.(dbError));
        return req;
      });
      await expect(destroyDB()).rejects.toThrow();
      const { logger } = await import("../../utils/logger");
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining("Error removing database"),
        expect.any(Object),
      );
    });

    it("handles deleteDatabase throw without crashing", async () => {
      const deleteDatabaseMock = vi.mocked(globalThis.indexedDB.deleteDatabase);
      deleteDatabaseMock.mockImplementation(() => {
        throw new Error("disk error");
      });
      await initDB();
      await expect(destroyDB()).rejects.toThrow("disk error");
      const { logger } = await import("../../utils/logger");
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining("Error removing database"),
        expect.any(Object),
      );
    });

    it("triggers success callback during deleteDatabase", async () => {
      let successCalled = false;
      const deleteDatabaseMock = vi.mocked(globalThis.indexedDB.deleteDatabase);      deleteDatabaseMock.mockImplementation((): any => {
          const req: Record<string, any> = {
          onsuccess: null,
          onerror: null,
          onblocked: null,
          error: null,
        };
        Promise.resolve().then(() => {
          successCalled = true;
          req.onsuccess?.();
        });
        return req;
      });
      await initDB();
      await destroyDB();
      expect(successCalled).toBe(true);
    });

    it("should not throw when called before initDB", async () => {
      await expect(destroyDB()).resolves.toBeUndefined();
    });

    it("handles destroyDB when initDB promise resolves", async () => {
      await initDB();
      await destroyDB();
      expect(await getDB()).toBeNull();
    });
  });

  describe("initDB - plugin registration errors (module-level catches)", () => {
    beforeEach(() => {
      vi.resetModules();
      mockAddRxPlugin.mockReset();
    });

    it("handles all plugin registration failures gracefully", async () => {
      mockAddRxPlugin.mockImplementation(() => {
        throw new Error("Plugin add failed");
      });
      const { logger } = await import("../../utils/logger");
      (logger.warn as ReturnType<typeof vi.fn>).mockClear();
      await expect(import("../../db/database")).resolves.toBeDefined();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Failed to add dev mode plugin"),
        expect.any(Object),
      );
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Failed to add query builder plugin"),
        expect.any(Object),
      );
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Failed to add migration plugin"),
        expect.any(Object),
      );
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Failed to add cleanup plugin"),
        expect.any(Object),
      );
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Failed to add leader election plugin"),
        expect.any(Object),
      );
    });

    it("handles plugin registration failure with non-Error throw (String path)", async () => {
      mockAddRxPlugin.mockImplementation(() => {
        throw "string plugin error";
      });
      const { logger } = await import("../../utils/logger");
      (logger.warn as ReturnType<typeof vi.fn>).mockClear();
      await expect(import("../../db/database")).resolves.toBeDefined();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Failed to add dev mode plugin"),
        expect.objectContaining({ error: "string plugin error" }),
      );
    });

    it("handles plugin registration failure with object throw (String path)", async () => {
      mockAddRxPlugin.mockImplementation(() => {
        throw { code: "ERR", message: "obj error" };
      });
      const { logger } = await import("../../utils/logger");
      (logger.warn as ReturnType<typeof vi.fn>).mockClear();
      await expect(import("../../db/database")).resolves.toBeDefined();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Failed to add dev mode plugin"),
        expect.objectContaining({ error: "[object Object]" }),
      );
    });
  });

  // ================================================================
  // Edge cases: destroy during init, isDestroying guard,
  // destroyPromise rejection, non-Error indexedDB throw
  // ================================================================

  describe("destroyDB / initDB — edge cases", () => {
    beforeEach(() => {
      vi.resetModules();
      // Re-mock dependencies after reset
      mockCreateRxDatabase.mockResolvedValue(mockDbInstanceBase);
      mockSecureStorage.hasSecret.mockResolvedValue(false);
      mockSecureStorage.getSecret.mockResolvedValue(null);
      mockSecureStorage.setSecret.mockResolvedValue(undefined);
      mockEncryptionService.decrypt.mockResolvedValue("decrypted_value");
      mockEncryptionService.encrypt.mockResolvedValue("encrypted_value");
      mockEncryptionService.deriveDbKey.mockResolvedValue(
        "derived-hex-key-1234567890abcdef",
      );
      mockDbInstanceBase.destroy = vi.fn().mockResolvedValue({});
      mockDbInstanceBase.addCollections = vi.fn().mockResolvedValue({});
      vi.mocked(globalThis.indexedDB.deleteDatabase).mockClear();
    (globalThis.indexedDB.deleteDatabase as any).mockImplementation((): any => {
      const req: Record<string, any> = {
          onsuccess: null,
          onerror: null,
          onblocked: null,
          error: null,
        };
        Promise.resolve().then(() => req.onsuccess?.());
        return req;
      });
    });

    it("parallel destroyDB: the second call waits for the active destroyPromise", async () => {
      // We use a controllable Promise for deleteDatabase.
      // destroyDB internally sets req.onsuccess = () => resolve() — only
      // we must call that resolver so the deleteDatabase promise
      // se resuelva.
      let finishDelete: (() => void) | null = null;
    (globalThis.indexedDB.deleteDatabase as any).mockImplementation((): any => {
      const req: Record<string, any> = {
          onsuccess: null,
          onerror: null,
          onblocked: null,
          error: null,
        };
        finishDelete = () => {
          // destroyDB ya seteo req.onsuccess = () => resolve() en este req
          Promise.resolve().then(() => req.onsuccess?.());
        };
        return req;
      });

      const mod = await import("../../db/database");
      await mod.initDB();

      // First call without await — destroyDB stays in progress
      const firstDestroy = mod.destroyDB();
      // Second call must detect isDestroying=true and await destroyPromise
      const secondDestroy = mod.destroyDB();

      // Esperamos a que destroyDB llegue a deleteDatabase y asigne el
      // callback (destroy es async: deleteDatabase se invoca tras microtasks).
      await vi.waitFor(() => {
        expect(finishDelete).not.toBeNull();
      });

      // We release the first destroy (without this, both hang)
      finishDelete!();
      await expect(firstDestroy).resolves.toBeUndefined();
      await expect(secondDestroy).resolves.toBeUndefined();
    });

    it("initDB waits for an in-progress destroyDB to finish (isDestroying guard)", async () => {
      let finishDelete: (() => void) | null = null;
    (globalThis.indexedDB.deleteDatabase as any).mockImplementation((): any => {
      const req: Record<string, any> = {
          onsuccess: null,
          onerror: null,
          onblocked: null,
          error: null,
        };
        finishDelete = () => {
          // destroyDB already set req.onsuccess = () => resolve(), we only call it
          Promise.resolve().then(() => req.onsuccess?.());
        };
        return req;
      });

      const mod = await import("../../db/database");
      await mod.initDB();

      // Iniciamos destroyDB (cuelga en deleteDatabase; dbInstance ya fue nulled)
      const destroyP = mod.destroyDB();

      // We wait for destroyDB to reach deleteDatabase: only then
      // dbInstance === null and initDB will go through the isDestroying guard instead
      // of the fast-path (if dbInstance still exists, initDB returns it without waiting).
      await vi.waitFor(() => {
        expect(finishDelete).not.toBeNull();
      });

      // initDB must detect isDestroying && destroyPromise and await destroyPromise
      const initP = mod.initDB();

      // We release destroy so initP can continue
      finishDelete!();

      const db = await initP;
      expect(db).toBeDefined();
      await destroyP;
    });

    it("initDB captures the destroyPromise rejection while waiting", async () => {
      // destroyDB cuelga en deleteDatabase (ya con dbInstance nulled);
      // controlamos el rechazo disparando req.onerror.
      let triggerError: (() => void) | null = null;
    (globalThis.indexedDB.deleteDatabase as any).mockImplementation((): any => {
      const req: Record<string, any> = {
          onsuccess: null,
          onerror: null,
          onblocked: null,
          error: null,
        };
        triggerError = () => {
          req.error = new Error("deleteDatabase failed");
          Promise.resolve().then(() => req.onerror?.());
        };
        return req;
      });

      const mod = await import("../../db/database");
      await mod.initDB();

      // Iniciamos destroy (cuelga en deleteDatabase; dbInstance ya nulled).
      // destroyDB eventualmente rechaza (dbDestroyError se relanza al final).
      // We suppress the unhandled rejection that vitest would detect.
      const destroyP = mod.destroyDB().catch(() => { /* INTENTIONAL SILENCE: this test intentionally observes rejection without an unhandled-promise warning. */ });

      // We wait for destroyDB to reach deleteDatabase before calling
      // initDB: only then is dbInstance === null and the isDestroying guard active.
      await vi.waitFor(() => {
        expect(triggerError).not.toBeNull();
      });

      // initDB must detect isDestroying && destroyPromise and await destroyPromise
      const initP = mod.initDB();

      // We reject destroyPromise while initDB is waiting
      const { logger } = await import("../../utils/logger");
      triggerError!();

      // initDB catches the error, logs a warn, and continues
      await vi.waitFor(() => {
        expect(logger.warn).toHaveBeenCalledWith(
          "[DB] destroy failed while re-initializing",
          expect.objectContaining({ error: expect.any(Error) }),
        );
      });

      const db = await initP;
      expect(db).toBe(mockDbInstanceBase);

      await destroyP;
    });

    it("destroyDB handles indexedDB.deleteDatabase with a non-Error throw (String)", async () => {
      const mod = await import("../../db/database");
      await mod.initDB();

      vi.mocked(globalThis.indexedDB.deleteDatabase).mockImplementation(() => {
        // Lanzamos string en vez de Error
        throw "IndexedDB disk corruption";
      });

      await expect(mod.destroyDB()).rejects.toThrow("IndexedDB disk corruption");
      const { logger } = await import("../../utils/logger");
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining("Error removing database"),
        expect.any(Object),
      );
    });
  });

  describe("migration-progress store", () => {
    const mod = () => import("../../db/migration-progress");

    beforeEach(async () => {
      const { resetMigrationProgress } = await mod();
      resetMigrationProgress();
    });

    it("starts inactive with zero counts", async () => {
      const { getMigrationProgress } = await mod();
      expect(getMigrationProgress()).toEqual({
        active: false,
        collections: [],
        total: 0,
        handled: 0,
        percent: 0,
        error: undefined,
        loadingRows: null,
      });
    });

    it("aggregates collection progress into totals and percent", async () => {
      const { updateCollectionMigrationProgress, getMigrationProgress } =
        await mod();
      updateCollectionMigrationProgress({
        collectionName: "bookmarks",
        status: "RUNNING",
        total: 1000,
        handled: 250,
        percent: 25,
      });
      updateCollectionMigrationProgress({
        collectionName: "documents",
        status: "DONE",
        total: 100,
        handled: 100,
        percent: 100,
      });
      const state = getMigrationProgress();
      expect(state.active).toBe(true);
      expect(state.total).toBe(1100);
      expect(state.handled).toBe(350);
      expect(state.percent).toBe(31); // floor(350/1100*100)
      expect(state.collections).toHaveLength(2);
    });

    it("upserts by collection name and flips active when all done", async () => {
      const { updateCollectionMigrationProgress, getMigrationProgress } =
        await mod();
      updateCollectionMigrationProgress({
        collectionName: "bookmarks",
        status: "RUNNING",
        total: 10,
        handled: 0,
        percent: 0,
      });
      updateCollectionMigrationProgress({
        collectionName: "bookmarks",
        status: "RUNNING",
        total: 10,
        handled: 7,
        percent: 70,
      });
      updateCollectionMigrationProgress({
        collectionName: "bookmarks",
        status: "DONE",
        total: 10,
        handled: 10,
        percent: 100,
      });
      const state = getMigrationProgress();
      expect(state.active).toBe(false);
      expect(state.percent).toBe(100);
      expect(state.collections).toHaveLength(1);
      expect(state.collections[0]!.status).toBe("DONE");
    });

    it("surfaces the first collection error", async () => {
      const { updateCollectionMigrationProgress, getMigrationProgress } =
        await mod();
      updateCollectionMigrationProgress({
        collectionName: "chunks",
        status: "ERROR",
        total: 5,
        handled: 2,
        percent: 40,
        error: "schema mismatch",
      });
      const state = getMigrationProgress();
      expect(state.active).toBe(false);
      expect(state.error).toBe("schema mismatch");
    });

    it("notifies subscribers and stops after unsubscribe", async () => {
      const {
        subscribeMigrationProgress,
        updateCollectionMigrationProgress,
        getMigrationProgress,
      } = await mod();
      const seen: number[] = [];
      const unsub = subscribeMigrationProgress(() => {
        seen.push(getMigrationProgress().percent);
      });
      updateCollectionMigrationProgress({
        collectionName: "bookmarks",
        status: "RUNNING",
        total: 100,
        handled: 10,
        percent: 10,
      });
      unsub();
      updateCollectionMigrationProgress({
        collectionName: "bookmarks",
        status: "RUNNING",
        total: 100,
        handled: 50,
        percent: 50,
      });
      expect(seen).toEqual([10]);
    });

    it("reset clears the store and notifies", async () => {
      const {
        updateCollectionMigrationProgress,
        resetMigrationProgress,
        getMigrationProgress,
        subscribeMigrationProgress,
      } = await mod();
      updateCollectionMigrationProgress({
        collectionName: "bookmarks",
        status: "RUNNING",
        total: 100,
        handled: 20,
        percent: 20,
      });
      let notified = 0;
      subscribeMigrationProgress(() => {
        notified += 1;
      });
      resetMigrationProgress();
      expect(notified).toBe(1);
      expect(getMigrationProgress().active).toBe(false);
      expect(getMigrationProgress().total).toBe(0);
      expect(getMigrationProgress().loadingRows).toBeNull();
    });

    it("setVaultLoadingRows publishes the reopen row count and notifies", async () => {
      const { setVaultLoadingRows, getMigrationProgress, subscribeMigrationProgress } =
        await mod();
      let notified = 0;
      subscribeMigrationProgress(() => {
        notified += 1;
      });
      setVaultLoadingRows(2000);
      expect(notified).toBe(1);
      const state = getMigrationProgress();
      expect(state.loadingRows).toBe(2000);
      expect(state.active).toBe(false);
      expect(state.total).toBe(0);
    });

    it("a RUNNING migration supersedes the loading rows", async () => {
      const { setVaultLoadingRows, updateCollectionMigrationProgress, getMigrationProgress } =
        await mod();
      setVaultLoadingRows(2000);
      updateCollectionMigrationProgress({
        collectionName: "bookmarks",
        status: "RUNNING",
        total: 2000,
        handled: 100,
        percent: 5,
      });
      const state = getMigrationProgress();
      expect(state.loadingRows).toBeNull();
      expect(state.active).toBe(true);
      expect(state.percent).toBe(5);
    });

    it("resetMigrationProgress clears the loading rows", async () => {
      const { setVaultLoadingRows, resetMigrationProgress, getMigrationProgress } =
        await mod();
      setVaultLoadingRows(5000);
      resetMigrationProgress();
      expect(getMigrationProgress().loadingRows).toBeNull();
    });
  });
});
