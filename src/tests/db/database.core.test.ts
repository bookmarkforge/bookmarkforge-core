
import { describe, it, expect } from "vitest";

describe("database.core", () => {
  let mod: typeof import("../../db/database.core");

  beforeAll(async () => {
    mod = await import("../../db/database.core");
  });

  describe("defaultConflictHandler", () => {
    it("prefers higher rev height", () => {
      const result = mod.defaultConflictHandler({
        newDocumentState: { _rev: "2-abc" },
        realMasterState: { _rev: "1-def" },
      });
      expect(result.isEqual).toBe(false);
      expect(result.documentData).toEqual({ _rev: "2-abc" });
    });

    it("prefers master when it has higher rev height", () => {
      const result = mod.defaultConflictHandler({
        newDocumentState: { _rev: "1-abc" },
        realMasterState: { _rev: "2-def" },
      });
      expect(result.isEqual).toBe(false);
      expect(result.documentData).toEqual({ _rev: "2-def" });
    });

    it("uses updatedAt when rev heights equal", () => {
      const result = mod.defaultConflictHandler({
        newDocumentState: { _rev: "1-abc", updatedAt: "2024-02-01T00:00:00Z" },
        realMasterState: { _rev: "1-def", updatedAt: "2024-01-01T00:00:00Z" },
      });
      expect(result.isEqual).toBe(false);
      expect(result.documentData).toEqual({
        _rev: "1-abc",
        updatedAt: "2024-02-01T00:00:00Z",
      });
    });

    it("prefers master when its updatedAt is newer", () => {
      const result = mod.defaultConflictHandler({
        newDocumentState: { _rev: "1-abc", updatedAt: "2024-01-01T00:00:00Z" },
        realMasterState: { _rev: "1-def", updatedAt: "2024-02-01T00:00:00Z" },
      });
      expect(result.isEqual).toBe(false);
      expect(result.documentData).toEqual({
        _rev: "1-def",
        updatedAt: "2024-02-01T00:00:00Z",
      });
    });

    it("uses the greater revision when timestamps are equal", () => {
      const result = mod.defaultConflictHandler({
        newDocumentState: { _rev: "1-abc", updatedAt: "2024-01-01T00:00:00Z" },
        realMasterState: { _rev: "1-def", updatedAt: "2024-01-01T00:00:00Z" },
      });
      expect(result.isEqual).toBe(false);
      expect(result.documentData).toEqual({
        _rev: "1-def",
        updatedAt: "2024-01-01T00:00:00Z",
      });
    });

    it("uses updatedAt before revision when timestamps differ", () => {
      const result = mod.defaultConflictHandler({
        newDocumentState: { _rev: "99-aaa", updatedAt: "2024-01-01T00:00:00Z" },
        realMasterState: { _rev: "1-zzz", updatedAt: "2024-01-02T00:00:00Z" },
      });
      expect(result.documentData).toEqual({
        _rev: "1-zzz",
        updatedAt: "2024-01-02T00:00:00Z",
      });
    });

    it("uses revision height as part of the revision ordering", () => {
      const result = mod.defaultConflictHandler({
        newDocumentState: { _rev: "2-zzz", updatedAt: "2024-01-01T00:00:00Z" },
        realMasterState: { _rev: "1-aaa", updatedAt: "2024-01-01T00:00:00Z" },
      });
      expect(result.isEqual).toBe(false);
      // Higher rev height wins, regardless of the string suffix.
      expect(result.documentData).toEqual({
        _rev: "2-zzz",
        updatedAt: "2024-01-01T00:00:00Z",
      });
    });

    it("uses the lexicographically greater revision on equal timestamps", () => {
      const result = mod.defaultConflictHandler({
        newDocumentState: { _rev: "1-zzz", updatedAt: "2024-01-01T00:00:00Z" },
        realMasterState: { _rev: "1-aaa", updatedAt: "2024-01-01T00:00:00Z" },
      });
      expect(result.isEqual).toBe(false);
      expect(result.documentData).toEqual({
        _rev: "1-zzz",
        updatedAt: "2024-01-01T00:00:00Z",
      });
    });

    it("falls through to the revision winner when blocks merge is unavailable", () => {
      const result = mod.defaultConflictHandler({
        newDocumentState: { _rev: "1-abc", blocks: [{ id: "b1" }] },
        realMasterState: { _rev: "1-def", blocks: [{ id: "b1" }] },
      });
      expect(result.documentData).toEqual({
        _rev: "1-def",
        blocks: [{ id: "b1" }],
      });
    });

    it("handles _rev as empty string in getRevHeight (line 24)", () => {
      const result = mod.defaultConflictHandler({
        newDocumentState: { _rev: "", updatedAt: "2024-01-01T00:00:00Z" },
        realMasterState: { _rev: "1-abc", updatedAt: "2024-02-01T00:00:00Z" },
      });
      expect(result.documentData).toEqual({
        _rev: "1-abc",
        updatedAt: "2024-02-01T00:00:00Z",
      });
    });

    it("uses the newer timestamp even when the master revision is empty", () => {
      const result = mod.defaultConflictHandler({
        newDocumentState: { _rev: "1-abc", updatedAt: "2024-01-01T00:00:00Z" },
        realMasterState: { _rev: "", updatedAt: "2024-02-01T00:00:00Z" },
      });
      expect(result.documentData).toEqual({
        _rev: "",
        updatedAt: "2024-02-01T00:00:00Z",
      });
    });

    it("handles rev without digit prefix (hits getRevHeight regex)", () => {
      const result = mod.defaultConflictHandler({
        newDocumentState: {
          _rev: "no-digits",
          updatedAt: "2024-01-01T00:00:00Z",
        },
        realMasterState: { _rev: "1-abc", updatedAt: "2024-02-01T00:00:00Z" },
      });
      expect(result.documentData).toEqual({
        _rev: "1-abc",
        updatedAt: "2024-02-01T00:00:00Z",
      });
    });

    it("falls to lexicographic rev comparison when blocks merge adds nothing", () => {
      // Same blocks, new rev lexicographically smaller -> master wins
      const result = mod.defaultConflictHandler({
        newDocumentState: { _rev: "1-aaa", blocks: [{ id: "b1" }] },
        realMasterState: { _rev: "1-zzz", blocks: [{ id: "b1" }] },
      });
      expect(result.documentData).toEqual({
        _rev: "1-zzz",
        blocks: [{ id: "b1" }],
      });
    });

    it("merges blocks when both have blocks", () => {
      const result = mod.defaultConflictHandler({
        newDocumentState: {
          _rev: "1-abc",
          updatedAt: "2024-01-01T00:00:00Z",
          blocks: [{ id: "b1", text: "new" }],
        },
        realMasterState: {
          _rev: "1-def",
          updatedAt: "2024-01-01T00:00:00Z",
          blocks: [{ id: "b2", text: "existing" }],
        },
      });
      expect((result.documentData as any).blocks).toHaveLength(2);
      expect((result.documentData as any).blocks[0]).toMatchObject({ id: "b1" });
    });

    it("does not add duplicate block ids", () => {
      const result = mod.defaultConflictHandler({
        newDocumentState: {
          _rev: "1-abc",
          blocks: [{ id: "b1", text: "dup" }],
        },
        realMasterState: {
          _rev: "1-def",
          blocks: [{ id: "b1", text: "original" }],
        },
      });
      expect((result.documentData as any).blocks).toHaveLength(1);
    });

    it("adds blocks without ids even if master has blocks", () => {
      const result = mod.defaultConflictHandler({
        newDocumentState: {
          _rev: "1-abc",
          updatedAt: "2024-01-01T00:00:00Z",
          blocks: [{ text: "no-id" }],
        },
        realMasterState: {
          _rev: "1-def",
          updatedAt: "2024-01-01T00:00:00Z",
          blocks: [{ id: "b1" }],
        },
      });
      expect((result.documentData as any).blocks).toHaveLength(2);
    });

    it("handles missing rev strings", () => {
      const result = mod.defaultConflictHandler({
        newDocumentState: { updatedAt: "2024-01-01T00:00:00Z" },
        realMasterState: { updatedAt: "2024-02-01T00:00:00Z" },
      });
      expect(result.documentData).toEqual({
        updatedAt: "2024-02-01T00:00:00Z",
      });
    });

    it("handles missing updatedAt on both sides", () => {
      const result = mod.defaultConflictHandler({
        newDocumentState: { _rev: "1-abc" },
        realMasterState: { _rev: "1-def" },
      });
      expect(result.documentData).toBeDefined();
    });
  });

  describe("migration strategies", () => {
    describe("migrateToV1", () => {
      it("sets default boolean fields", () => {
        const result = mod.migrationStrategies[1]({});
        expect(result.processed).toBe(false);
        expect(result.isDeleted).toBe(false);
        expect(result.isPrivate).toBe(false);
      });

      it("converts numeric createdAt to ISO string", () => {
        const result = mod.migrationStrategies[1]({ createdAt: 1704067200000 });
        expect(typeof result.createdAt).toBe("string");
        expect(result.createdAt).toContain("T");
      });

      it("converts numeric updatedAt to ISO string", () => {
        const result = mod.migrationStrategies[1]({ updatedAt: 1704067200000 });
        expect(typeof result.updatedAt).toBe("string");
      });

      it("preserves string dates", () => {
        const result = mod.migrationStrategies[1]({
          createdAt: "2024-01-01T00:00:00Z",
        });
        expect(result.createdAt).toBe("2024-01-01T00:00:00Z");
      });

      it("preserves existing boolean values", () => {
        const result = mod.migrationStrategies[1]({
          processed: true,
          isDeleted: true,
          isPrivate: true,
        });
        expect(result.processed).toBe(true);
        expect(result.isDeleted).toBe(true);
        expect(result.isPrivate).toBe(true);
      });
    });

    describe("migrateToV2", () => {
      it("sets tags to empty array when undefined", () => {
        const result = mod.migrationStrategies[2]({});
        expect(result.tags).toEqual([]);
      });

      it("sets tags to empty array when null", () => {
        const result = mod.migrationStrategies[2]({ tags: null });
        expect(result.tags).toEqual([]);
      });

      it("converts non-array tags to array with string", () => {
        const result = mod.migrationStrategies[2]({ tags: "dev" });
        expect(result.tags).toEqual(["dev"]);
      });

      it("preserves valid array tags", () => {
        const result = mod.migrationStrategies[2]({ tags: ["a", "b"] });
        expect(result.tags).toEqual(["a", "b"]);
      });

      it("removes non-array embedding", () => {
        const result = mod.migrationStrategies[2]({ embedding: "not-array" });
        expect(result.embedding).toBeUndefined();
      });

      it("preserves array embedding", () => {
        const result = mod.migrationStrategies[2]({ embedding: [0.1, 0.2] });
        expect(result.embedding).toEqual([0.1, 0.2]);
      });

      it("sets default summary", () => {
        const result = mod.migrationStrategies[2]({});
        expect(result.summary).toBe("");
      });

      it("preserves existing summary", () => {
        const result = mod.migrationStrategies[2]({ summary: "existing" });
        expect(result.summary).toBe("existing");
      });

      it("normalizes URL", () => {
        const result = mod.migrationStrategies[2]({
          url: "HTTPS://EXAMPLE.COM",
        });
        expect(result.url).toBe("https://example.com/");
      });

      it("keeps original URL when invalid", () => {
        const result = mod.migrationStrategies[2]({ url: "not-a-url" });
        expect(result.url).toBe("not-a-url");
      });
    });

    describe("migrateToV3", () => {
      it("sets default broken and lastChecked", () => {
        const result = mod.migrationStrategies[3]({});
        expect(result.broken).toBe(false);
        expect(result.lastChecked).toBe("");
      });

      it("preserves existing values", () => {
        const result = mod.migrationStrategies[3]({
          broken: true,
          lastChecked: "2024-01-01",
        });
        expect(result.broken).toBe(true);
        expect(result.lastChecked).toBe("2024-01-01");
      });
    });
  });

  describe("message collection migration", () => {
    it("uses the v4 migration map for the evolved message schema", () => {
      expect(Object.keys(mod.COLLECTIONS.messages!.migrationStrategies)).toEqual(["1", "2", "3", "4"]);
      expect(mod.COLLECTIONS.messages!.schema.version).toBe(4);
    });

    it("preserves legacy message fields while adding no unsafe defaults", () => {
      const migrate = mod.COLLECTIONS.messages!.migrationStrategies[2]!;
      const legacy = {
        id: "m1",
        role: "assistant",
        content: "encrypted content",
        sources: [{ id: "s1" }],
        isTranslationKey: true,
        createdAt: "2026-01-01T00:00:00.000Z",
      };
      expect(migrate(legacy)).toEqual(legacy);
      // v3 is the F-06 authenticated-envelope bump: identity.
      expect(
        mod.COLLECTIONS.messages!.migrationStrategies[3]!(legacy),
      ).toEqual(legacy);
      // v4 adds optional retryable error fields: identity migration.
      expect(
        mod.COLLECTIONS.messages!.migrationStrategies[4]!(legacy),
      ).toEqual(legacy);
    });
  });

  describe("encrypted-collection migrations", () => {
    it("chunks: quarantines legacy rows without a public privacy decision", () => {
      const migrate = mod.COLLECTIONS.chunks!.migrationStrategies[1]!;
      expect(migrate({ id: "c1", isPrivate: false }).isPrivate).toBe(false);
      expect(migrate({ id: "c2" }).isPrivate).toBe(true);
    });

    it("folders: v4 schema with a full 1→4 strategy map", () => {
      expect(mod.COLLECTIONS.folders!.schema.version).toBe(4);
      expect(Object.keys(mod.COLLECTIONS.folders!.migrationStrategies)).toEqual([
        "1",
        "2",
        "3",
        "4",
      ]);
      // Strategy 2 still backfills parentId for pre-v2 rows.
      const migrateV2 = mod.COLLECTIONS.folders!.migrationStrategies[2]!;
      expect(migrateV2({ id: "f1", title: "t" }).parentId).toBe("");
      // Strategies 3 and 4 are identity: only the encrypted array / the
      // F-06 authenticated envelope changed.
      const legacy = { id: "f1", title: "t", parentId: "", createdAt: "2024-01-01T00:00:00.000Z" };
      const migrateV3 = mod.COLLECTIONS.folders!.migrationStrategies[3]!;
      expect(migrateV3(legacy)).toEqual(legacy);
      const migrateV4 = mod.COLLECTIONS.folders!.migrationStrategies[4]!;
      expect(migrateV4(legacy)).toEqual(legacy);
    });

    it("templates: v3 schema with a 1→3 strategy map", () => {
      expect(mod.COLLECTIONS.templates!.schema.version).toBe(3);
      expect(Object.keys(mod.COLLECTIONS.templates!.migrationStrategies)).toEqual([
        "1",
        "2",
        "3",
      ]);
      const legacy = { id: "t1", title: "t", blocks: [], createdAt: "2024-01-01T00:00:00.000Z" };
      const migrate = mod.COLLECTIONS.templates!.migrationStrategies[2]!;
      expect(migrate(legacy)).toEqual(legacy);
      expect(
        mod.COLLECTIONS.templates!.migrationStrategies[3]!(legacy),
      ).toEqual(legacy);
    });

    it("highlights: v3 schema with a 1→3 strategy map", () => {
      expect(mod.COLLECTIONS.highlights!.schema.version).toBe(3);
      expect(Object.keys(mod.COLLECTIONS.highlights!.migrationStrategies)).toEqual([
        "1",
        "2",
        "3",
      ]);
      const legacy = { id: "h1", bookmarkId: "b1", text: "t", color: "yellow", note: "", createdAt: "2024-01-01T00:00:00.000Z" };
      const migrate = mod.COLLECTIONS.highlights!.migrationStrategies[2]!;
      expect(migrate(legacy)).toEqual(legacy);
      expect(
        mod.COLLECTIONS.highlights!.migrationStrategies[3]!(legacy),
      ).toEqual(legacy);
    });

    it("insights: v3 schema with a 1→3 strategy map", () => {
      expect(mod.COLLECTIONS.insights!.schema.version).toBe(3);
      expect(Object.keys(mod.COLLECTIONS.insights!.migrationStrategies)).toEqual([
        "1",
        "2",
        "3",
      ]);
      const legacy = { id: "i1", type: "summary", title: "t", content: "c", relatedIds: [], isRead: false, createdAt: "2024-01-01T00:00:00.000Z" };
      const migrate = mod.COLLECTIONS.insights!.migrationStrategies[2]!;
      expect(migrate(legacy)).toEqual(legacy);
      expect(
        mod.COLLECTIONS.insights!.migrationStrategies[3]!(legacy),
      ).toEqual(legacy);
    });
  });

  describe("COLLECTIONS", () => {
    it("exports COLLECTIONS with expected keys", () => {
      expect(mod.COLLECTIONS).toBeDefined();
      expect(mod.COLLECTIONS.bookmarks).toBeDefined();
      expect(mod.COLLECTIONS.documents).toBeDefined();
      expect(mod.COLLECTIONS.templates).toBeDefined();
      expect(mod.COLLECTIONS.folders).toBeDefined();
      expect(mod.COLLECTIONS.versions).toBeDefined();
      expect(mod.COLLECTIONS.flashcards).toBeDefined();
      expect(mod.COLLECTIONS.messages).toBeDefined();
      expect(mod.COLLECTIONS.chunks).toBeDefined();
      expect(mod.COLLECTIONS.memory).toBeDefined();
    });

    it("memory schema and migrations cover the profileType field", () => {
      expect(mod.COLLECTIONS.memory!.schema.version).toBe(3);
      expect(mod.COLLECTIONS.memory!.schema.properties).toHaveProperty(
        "profileType",
      );
      expect(
        Object.keys(mod.COLLECTIONS.memory!.migrationStrategies),
      ).toEqual(["1", "2", "3"]);
    });

    it("each collection has schema, conflictHandler, migrationStrategies", () => {
      for (const [name, col] of Object.entries(mod.COLLECTIONS)) {
        expect(col).toHaveProperty("schema");
        expect(col).toHaveProperty("conflictHandler");
        expect(col).toHaveProperty("migrationStrategies");
      }
    });

    it("bookmarks has 8 migration strategies", () => {
      // bookmarkSchema is at v8 (v6 urlHash dedup + v7 F-06 authenticated
      // envelope + v8 read-state normalization); the migration map must
      // cover strategies 1..8 so existing vaults open safely.
      expect(
        Object.keys(mod.COLLECTIONS.bookmarks!.migrationStrategies),
      ).toHaveLength(8);
    });

    it("migrateToV4 defaults isPrivate to false", () => {
      const result = mod.migrationStrategies[4]({ id: "b1", title: "t" });
      expect(result.isPrivate).toBe(false);
    });

    it("migrateToV5 is an identity migration", () => {
      const doc = { id: "b1", title: "t", url: "https://example.com" };
      const result = mod.migrationStrategies[5](doc);
      expect(result).toEqual(doc);
      expect(result).not.toBe(doc);
    });

    it("migrateToV8 defaults legacy bookmarks to read", () => {
      const result = mod.COLLECTIONS.bookmarks!.migrationStrategies[8]!({
        id: "b1",
        title: "t",
      });
      expect(result.isRead).toBe(true);
    });
  });
});
