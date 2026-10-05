import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  scan: vi.fn(),
  initDB: vi.fn(),
  locked: vi.fn(() => false),
  embedding: vi.fn(),
  rebuild: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
}));

vi.mock("../../../src/db/database", () => ({ initDB: mocks.initDB }));
vi.mock("../../../src/services/SecurityVault", () => ({ securityVault: { isLocked: mocks.locked } }));
vi.mock("../../../src/services/ai/VaultHealthScanner", () => ({ scanVaultHealth: mocks.scan }));
vi.mock("../../../src/services/ai/RAGEngine", () => ({ ragEngine: { generateEmbedding: mocks.embedding } }));
vi.mock("../../../src/services/ai/VectorIndexService", () => ({ vectorIndexService: { rebuild: mocks.rebuild } }));
vi.mock("../../../src/services/ai/AutoProcessorService", () => ({ autoProcessorService: { start: mocks.start, stop: mocks.stop } }));
vi.mock("../../../src/utils/logger", () => ({ logger: { warn: vi.fn() } }));
vi.mock("../../../src/utils/safeErrorForLog", () => ({ safeErrorForLog: String }));

describe("SafeRepairCoordinator", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.locked.mockReturnValue(false);
    mocks.scan.mockResolvedValue({
      scannedAt: "2026-01-01T00:00:00.000Z",
      isVaultLocked: false,
      complete: true,
      bookmarkCount: 0,
      documentCount: 0,
      chunkCount: 0,
      issues: [],
      vectorIndexStatus: "loaded",
      vectorIndexLoadDurationMs: 1,
    });
  });

  it("no hace nada cuando la bóveda está sana", async () => {
    const { safeRepairCoordinator } = await import("../../../src/services/ai/SafeRepairCoordinator");
    const result = await safeRepairCoordinator.run();
    expect(result).toMatchObject({ status: "completed", repaired: 0, failed: 0, operations: [] });
    expect(mocks.initDB).not.toHaveBeenCalled();
    expect(mocks.rebuild).not.toHaveBeenCalled();
  });

  it("reconstruye el índice si el escáner lo recomienda y vuelve a verificar", async () => {
    mocks.scan
      .mockResolvedValueOnce({
        scannedAt: "2026-01-01T00:00:00.000Z",
        isVaultLocked: false,
        complete: true,
        bookmarkCount: 0,
        documentCount: 0,
        chunkCount: 0,
        issues: [{ kind: "index-rebuild-recommended", count: 1, sampleIds: [] }],
        vectorIndexStatus: "malformed-rebuilt",
        vectorIndexLoadDurationMs: null,
      })
      .mockResolvedValueOnce({
        scannedAt: "2026-01-01T00:00:01.000Z",
        isVaultLocked: false,
        complete: true,
        bookmarkCount: 0,
        documentCount: 0,
        chunkCount: 0,
        issues: [],
        vectorIndexStatus: "loaded",
        vectorIndexLoadDurationMs: 3,
      });
    const { safeRepairCoordinator } = await import("../../../src/services/ai/SafeRepairCoordinator");
    const result = await safeRepairCoordinator.run();
    expect(mocks.rebuild).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ status: "completed", repaired: 1, failed: 0 });
    expect(mocks.scan).toHaveBeenCalledTimes(2);
  });

  it("rechaza una reparación con la bóveda bloqueada", async () => {
    mocks.locked.mockReturnValue(true);
    const { safeRepairCoordinator } = await import("../../../src/services/ai/SafeRepairCoordinator");
    await expect(safeRepairCoordinator.run()).rejects.toMatchObject({ name: "VAULT_LOCKED" });
  });

  it("comparte la misma promesa para llamadas concurrentes", async () => {
    let release!: () => void;
    mocks.scan.mockReturnValue(new Promise((resolve) => { release = () => resolve({
      scannedAt: "2026-01-01T00:00:00.000Z", isVaultLocked: false, complete: true,
      bookmarkCount: 0, documentCount: 0, chunkCount: 0, issues: [],
      vectorIndexStatus: "loaded", vectorIndexLoadDurationMs: 1,
    }); }));
    const { safeRepairCoordinator } = await import("../../../src/services/ai/SafeRepairCoordinator");
    const first = safeRepairCoordinator.run();
    const second = safeRepairCoordinator.run();
    release();
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    expect(mocks.scan).toHaveBeenCalledTimes(2);
  });
});
