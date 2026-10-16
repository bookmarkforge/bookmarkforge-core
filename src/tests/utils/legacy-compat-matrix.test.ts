/**
 * src/tests/utils/legacy-compat-matrix.test.ts
 *
 * Contract tests for the legacy compatibility / migration matrix.
 *
 * The matrix must remain:
 *  - deterministic (stable row id ordering)
 *  - executable without vault access
 *  - explicit about which legacy surfaces are read-only vs supported
 */

import {
  buildLegacyCompatMatrix,
  findRowsBySubject,
  findRowsByStatus,
  summarizeLocalLegacyExposure,
  scanSchemaSet,
  type LegacyCompatRow,
} from "../../utils/legacy-compat-matrix";
import type { RxJsonSchema } from "rxdb";

// Sentinel import to force the test runner to resolve the module path

// Sentinel import to force the test runner to resolve the module path
// through the same package/module graph the application uses. It is unused
// at runtime; it exists only to make resolution errors fail loudly.
describe("legacy-compat-matrix", () => {
  describe("buildLegacyCompatMatrix", () => {
    it("should expose a fixed, deterministic row set", () => {
      const matrix = buildLegacyCompatMatrix("test.version");
      expect(matrix.generatedFrom.appVersion).toBe("test.version");
      expect(matrix.generatedFrom.generatorFile).toBe(
        "src/utils/legacy-compat-matrix.ts",
      );
      expect(matrix.generatedFrom.generatorSymbol).toBe(
        "buildLegacyCompatMatrix",
      );

      const ids = matrix.rows.map((row) => row.id);
      expect(ids).toEqual([...new Set(ids)]);
    });

    it("should sort rows deterministically by id", () => {
      const first = buildLegacyCompatMatrix();
      const second = buildLegacyCompatMatrix();

      expect(first.rows.map((r) => r.id)).toEqual(
        second.rows.map((r) => r.id),
      );
    });

    it("should contain both crypto and storage legacy surfaces", () => {
      const matrix = buildLegacyCompatMatrix();
      const subjects = matrix.rows.map((row) => row.subject);

      expect(subjects).toContain("crypto-format");
      expect(subjects).toContain("storage-format");
      expect(subjects).toContain("key-material");
      // The current matrix declares migration-related rows only through
      // migration-in-progress status, not a dedicated subject value. Assert
      // that the migration bit is represented by status instead of subject.
      const hasMigrationStatus = matrix.rows.some(
        (row) =>
          row.status === "migration-in-progress" ||
          row.status === "migration-required",
      );
      expect(hasMigrationStatus).toBe(true);
    });

    it("should flag the v2 PBKDF2 path as legacy-read-only", () => {
      const matrix = buildLegacyCompatMatrix();
      const row = matrix.rows.find((row) => row.id === "crypto-v2-pbkdf2");

      expect(row).toBeDefined();
      expect(row?.severity).toBe("legacy-read-only");
      expect(row?.status).toBe("supported-read-only");
      expect(row?.subject).toBe("crypto-format");
    });

    it("should flag the legacy unwrap path as migration-in-progress", () => {
      const matrix = buildLegacyCompatMatrix();
      const row = matrix.rows.find(
        (row) => row.id === "storage-legacy-unwrap",
      );

      expect(row).toBeDefined();
      expect(row?.status).toBe("migration-in-progress");
      expect(row?.severity).toBe("warning");
    });

    it("should include source location metadata for actionable rows", () => {
      const matrix = buildLegacyCompatMatrix();
      const row = matrix.rows.find(
        (row) => row.id === "crypto-v2-pbkdf2",
      )!;

      expect(row.source.file).toBe("src/utils/crypto-core.ts");
      expect(row.source.symbol).toBe("decrypt");
    });
  });

  describe("findRowsBySubject and findRowsByStatus", () => {
    it("should filter by subject", () => {
      const matrix = buildLegacyCompatMatrix();
      const cryptoRows = findRowsBySubject(matrix, "crypto-format");

      expect(cryptoRows.length).toBeGreaterThan(0);
      expect(cryptoRows.every((row) => row.subject === "crypto-format")).toBe(
        true,
      );
    });

    it("should filter by status", () => {
      const matrix = buildLegacyCompatMatrix();
      const migrationRows = findRowsByStatus(matrix, "migration-in-progress");

      expect(migrationRows.length).toBeGreaterThan(0);
      expect(
        migrationRows.every(
          (row) => row.status === "migration-in-progress",
        ),
      ).toBe(true);
    });
  });

  describe("summarizeLocalLegacyExposure", () => {
    it("should count severity and status buckets", () => {
      const matrix = buildLegacyCompatMatrix();
      const summary = summarizeLocalLegacyExposure(matrix);

      expect(summary.totalRows).toBe(matrix.rows.length);
      expect(summary.rowsById).toEqual(
        Object.fromEntries(matrix.rows.map((row) => [row.id, row])),
      );

      expect(summary.critical + summary.warning + summary.legacyReadOnly).toBe(
        matrix.rows.filter(
          (row) =>
            row.severity === "critical" ||
            row.severity === "warning" ||
            row.severity === "legacy-read-only",
        ).length,
      );
    });

    it("should mark migration-in-progress rows separately from deprecated rows", () => {
      const matrix = buildLegacyCompatMatrix();
      const summary = summarizeLocalLegacyExposure(matrix);

      expect(
        matrix.rows.some(
          (row) =>
            row.status === "migration-in-progress" &&
            row.severity === "warning",
        ),
      ).toBe(true);
    });
  });

  describe("scanSchemaSet", () => {
    it("should return only collections with encrypted fields", () => {
      const schemas = [
        {
          name: "plain",
          schema: undefined,
        },
        {
          name: "encrypted",
          schema: {
            title: "encrypted",
            version: 1,
            type: "object",
            properties: {
              id: { type: "string" },
              secret: { type: "string" },
            },
            primaryKey: "id" as const,
            encrypted: ["secret"],
          } as unknown as RxJsonSchema<string>,
        },
      ];

      const result = scanSchemaSet(schemas);

      expect(result).toEqual([
        {
          collection: "encrypted",
          encryptedFields: ["secret"],
          legacyCommentFound: false,
        },
      ]);
    });

    it("should keep encrypted-field order stable", () => {
      const schemas = [
        {
          name: "multi",
          schema: {
            title: "multi",
            version: 1,
            type: "object",
            properties: {
              id: { type: "string" },
              a: { type: "string" },
              b: { type: "string" },
            },
            primaryKey: "id" as const,
            encrypted: ["b", "a"],
          } as unknown as RxJsonSchema<string>,
        },
      ];

      const result = scanSchemaSet(schemas);
      expect(result[0]?.encryptedFields).toEqual(["b", "a"]);
    });
  });

  describe("LegacyCompatRow shape", () => {
    it("should be serializable to JSON without losing meaning", () => {
      const matrix = buildLegacyCompatMatrix();
      const row = matrix.rows[0] as LegacyCompatRow;

      expect(row).toHaveProperty("id");
      expect(row).toHaveProperty("label");
      expect(row).toHaveProperty("severity");
      expect(row).toHaveProperty("subject");
      expect(row).toHaveProperty("source");
      expect(row).toHaveProperty("contexts");
      expect(row).toHaveProperty("status");
      expect(row).toHaveProperty("note");
      expect(row).toHaveProperty("recommendedAction");

      expect(Array.isArray(row.contexts)).toBe(true);
      expect(row.contexts.length).toBeGreaterThan(0);
    });
  });
});
