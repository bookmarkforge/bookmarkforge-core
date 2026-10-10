import { beforeEach, describe, expect, it, vi } from "vitest";

const mockDb = vi.hoisted(() => ({
  bookmarks: { find: vi.fn() },
  documents: { find: vi.fn() },
  chunks: { find: vi.fn() },
}));
const mockVault = vi.hoisted(() => ({ isLocked: vi.fn(() => false) }));
const mockIndex = vi.hoisted(() => ({
  getLoadStatus: vi.fn(() => "loaded"),
  getLoadDurationMs: vi.fn(() => 12),
}));

vi.mock("../../../src/db/database", () => ({ initDB: vi.fn(async () => mockDb) }));
vi.mock("../../../src/services/SecurityVault", () => ({ securityVault: mockVault }));
vi.mock("../../../src/services/ai/VectorIndexService", () => ({ vectorIndexService: mockIndex }));
vi.mock("../../../src/utils/logger", () => ({ logger: { warn: vi.fn() } }));
vi.mock("../../../src/utils/safeErrorForLog", () => ({ safeErrorForLog: (error: unknown) => String(error) }));

describe("VaultHealthScanner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVault.isLocked.mockReturnValue(false);
    mockIndex.getLoadStatus.mockReturnValue("loaded");
    mockDb.bookmarks.find.mockReturnValue({ exec: vi.fn(async () => []) });
    mockDb.documents.find.mockReturnValue({ exec: vi.fn(async () => []) });
    mockDb.chunks.find.mockReturnValue({ exec: vi.fn(async () => []) });
  });

  it("detects pending, missing embeddings and orphaned chunks without returning content", async () => {
    mockDb.bookmarks.find.mockReturnValueOnce({
      exec: vi.fn(async () => [{
        id: "bookmark-1",
        title: "private title",
        processed: false,
        embedding: [],
        isDeleted: false,
        secretField: "must-not-leak",
      }]),
    });
    mockDb.documents.find.mockReturnValueOnce({
      exec: vi.fn(async () => [{
        id: "document-1",
        title: "private document",
        processed: true,
        embedding: [1, 2],
        isDeleted: false,
      }]),
    });
    mockDb.chunks.find.mockReturnValueOnce({
      exec: vi.fn(async () => [{
        id: "chunk-1",
        parentId: "missing-parent",
        parentType: "document",
        content: "private content",
        embedding: [1],
      }]),
    });

    const { scanVaultHealth } = await import("../../../src/services/ai/VaultHealthScanner");
    const report = await scanVaultHealth();

    expect(report).toMatchObject({
      bookmarkCount: 1,
      documentCount: 1,
      chunkCount: 1,
      complete: true,
      vectorIndexStatus: "loaded",
    });
    expect(report.issues).toEqual([
      { kind: "pending-processing", count: 1, sampleIds: ["bookmark-1"] },
      { kind: "missing-embedding", count: 1, sampleIds: ["bookmark-1"] },
      { kind: "orphan-chunk", count: 1, sampleIds: ["chunk-1"] },
    ]);
    expect(JSON.stringify(report)).not.toContain("private title");
    expect(JSON.stringify(report)).not.toContain("private content");
    expect(JSON.stringify(report)).not.toContain("must-not-leak");
  });

  it("recommends rebuild when index is in unreliable state", async () => {
    mockIndex.getLoadStatus.mockReturnValue("malformed-rebuilt");
    const { scanVaultHealth } = await import("../../../src/services/ai/VaultHealthScanner");
    const report = await scanVaultHealth();
    expect(report.issues).toContainEqual({
      kind: "index-rebuild-recommended",
      count: 1,
      sampleIds: [],
    });
  });

  it("rejects scan with locked vault", async () => {
    mockVault.isLocked.mockReturnValue(true);
    const { scanVaultHealth } = await import("../../../src/services/ai/VaultHealthScanner");
    await expect(scanVaultHealth()).rejects.toMatchObject({ name: "VAULT_LOCKED" });
  });

  it("respects cancellation before opening database", async () => {
    const controller = new AbortController();
    controller.abort();
    const { scanVaultHealth } = await import("../../../src/services/ai/VaultHealthScanner");
    await expect(scanVaultHealth(controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  });
});
