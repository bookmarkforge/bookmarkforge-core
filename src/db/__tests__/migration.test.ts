import { describe, it, expect } from "vitest";
import { sha256 } from "@noble/hashes/sha2.js";
import { migrationStrategies } from "../../db/database";

describe("DB Migration Strategies", () => {
  describe("v0 → v1 migration", () => {
    const migrateV1 = migrationStrategies[1];

    it("should add default boolean fields", () => {
      const doc = { id: "1", title: "Test" };
      const migrated = migrateV1(doc);
      expect(migrated.processed).toBe(false);
      expect(migrated.isDeleted).toBe(false);
      expect(migrated.isPrivate).toBe(false);
    });

    it("should convert numeric timestamps to ISO strings", () => {
      const doc = {
        id: "1",
        createdAt: 1700000000000,
        updatedAt: 1700000000000,
        processed: false,
        isDeleted: false,
      };
      const migrated = migrateV1(doc);
      expect(typeof migrated.createdAt).toBe("string");
      expect(typeof migrated.updatedAt).toBe("string");
      expect(migrated.createdAt).toContain("T");
    });

    it("should preserve existing ISO timestamps", () => {
      const isoDate = "2024-01-01T00:00:00.000Z";
      const doc = {
        id: "1",
        createdAt: isoDate,
        updatedAt: isoDate,
        processed: false,
        isDeleted: false,
      };
      const migrated = migrateV1(doc);
      expect(migrated.createdAt).toBe(isoDate);
      expect(migrated.updatedAt).toBe(isoDate);
    });
  });

  describe("v1 → v2 migration", () => {
    const migrateV2 = migrationStrategies[2];

    it("should ensure tags is an array", () => {
      const doc = {
        id: "1",
        tags: "single-tag",
        processed: false,
        isDeleted: false,
      };
      const migrated = migrateV2(doc);
      expect(Array.isArray(migrated.tags)).toBe(true);
      expect(migrated.tags).toEqual(["single-tag"]);
    });

    it("should initialize missing tags as empty array", () => {
      const doc = { id: "1", processed: false, isDeleted: false };
      const migrated = migrateV2(doc);
      expect(Array.isArray(migrated.tags)).toBe(true);
      expect(migrated.tags).toEqual([]);
    });

    it("should preserve valid tags array", () => {
      const doc = {
        id: "1",
        tags: ["tag1", "tag2"],
        processed: false,
        isDeleted: false,
      };
      const migrated = migrateV2(doc);
      expect(migrated.tags).toEqual(["tag1", "tag2"]);
    });

    it("should remove invalid embedding values", () => {
      const doc = {
        id: "1",
        embedding: "not-an-array",
        processed: false,
        isDeleted: false,
      };
      const migrated = migrateV2(doc);
      expect(migrated.embedding).toBe(undefined);
    });

    it("should preserve valid embedding array", () => {
      const embedding = [0.1, 0.2, 0.3];
      const doc = { id: "1", embedding, processed: false, isDeleted: false };
      const migrated = migrateV2(doc);
      expect(migrated.embedding).toEqual(embedding);
    });

    it("should add missing summary field", () => {
      const doc = { id: "1", processed: false, isDeleted: false };
      const migrated = migrateV2(doc);
      expect(migrated.summary).toBe("");
    });

    it("should normalize valid URLs with protocol", () => {
      const doc = {
        id: "1",
        url: "https://example.com/page",
        processed: false,
        isDeleted: false,
      };
      const migrated = migrateV2(doc);
      expect(migrated.url).toBe("https://example.com/page");
    });

    it("should keep invalid URLs unchanged", () => {
      const doc = {
        id: "1",
        url: "not-a-valid-url",
        processed: false,
        isDeleted: false,
      };
      const migrated = migrateV2(doc);
      expect(migrated.url).toBe("not-a-valid-url");
    });
  });

  describe("v4 → v5 migration", () => {
    const migrateV5 = migrationStrategies[5];

    it("should be an identity migration (url decryption happens at the storage layer)", () => {
      const doc = {
        id: "1",
        url: "https://example.com/page",
        title: "Example",
      };
      const migrated = migrateV5(doc);
      expect(migrated).toEqual(doc);
      expect(migrated).not.toBe(doc); // returns a shallow copy
    });
  });

  // v5 → v6: urlHash dedup. Migrate a row whose `urlHash` is missing —
  // the strategy must backfill it from `url` so dedup can find duplicates.
  // The COL12 bug surfaced in the e2e specs when addCollections threw a
  // migrationStrategy-not-found error because the v6 strategies were not
  // registered; this regression test pins the v5→v6 contract.
  describe("v5 → v6 migration", () => {
    const migrateV6 = migrationStrategies[6];

    it("should backfill urlHash from url when missing", () => {
      const doc = {
        id: "1",
        url: "https://example.com/page",
        title: "Example",
      };
      const migrated = migrateV6(doc);
      expect(typeof migrated.urlHash).toBe("string");
      const expected = Array.from(
        sha256(new TextEncoder().encode(doc.url)),
        (byte) => byte.toString(16).padStart(2, "0"),
      ).join("");
      expect(migrated.urlHash).toBe(expected);
      // The url itself is preserved (the field is still populated).
      expect(migrated.url).toBe("https://example.com/page");
    });

    it("should preserve an existing urlHash without recomputing", () => {
      const doc = {
        id: "2",
        url: "https://example.com/page",
        urlHash: "precomputed-hash",
        title: "Example",
      };
      const migrated = migrateV6(doc);
      expect(migrated.urlHash).toBe("precomputed-hash");
    });

    it("should pass rows without a url through untouched", () => {
      const doc = {
        id: "3",
        title: "Example",
      };
      const migrated = migrateV6(doc);
      expect(migrated.urlHash).toBeUndefined();
      expect(migrated.title).toBe("Example");
    });
  });
});
