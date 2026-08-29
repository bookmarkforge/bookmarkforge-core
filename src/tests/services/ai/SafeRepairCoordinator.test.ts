import { describe, expect, it, vi, beforeEach } from "vitest";

const mockScan = vi.hoisted(() => vi.fn());
const mockLocked = vi.hoisted(() => vi.fn(() => false));
const mockProcess = vi.hoisted(() => vi.fn());
const mockEmbedding = vi.hoisted(() => vi.fn());
const mockRebuild = vi.hoisted(() => vi.fn());

vi.mock("../../../services/ai/VaultHealthScanner", () => ({ scanVaultHealth: mockScan }));
vi.mock("../../../services/SecurityVault", () => ({ securityVault: {
  isLocked: mockLocked,
  onLock: vi.fn(() => () => undefined),
  onUnlock: vi.fn(() => () => undefined),
} }));
vi.mock("../../../services/ai/AutoProcessorService", () => ({ autoProcessorService: { processPendingItems: mockProcess } }));
vi.mock("../../../services/ai/RAGEngine", () => ({ ragEngine: { generateEmbedding: mockEmbedding } }));
vi.mock("../../../services/ai/VectorIndexService", () => ({ vectorIndexService: { rebuild: mockRebuild } }));
vi.mock("../../../db/database", () => ({ initDB: vi.fn() }));
vi.mock("../../../utils/logger", () => ({ logger: { warn: vi.fn() } }));
vi.mock("../../../utils/safeErrorForLog", () => ({ safeErrorForLog: (e: unknown) => String(e) }));

import { initDB } from "../../../db/database";
import { safeRepairCoordinator } from "../../../services/ai/SafeRepairCoordinator";

const report = (issues: Array<{ kind: string; count: number }> = [], complete = true) => ({
  complete,
  issues,
} as any);

beforeEach(() => {
  vi.clearAllMocks();
  (safeRepairCoordinator as any).active = null;
  (safeRepairCoordinator as any).lastRunAt = null;
  (safeRepairCoordinator as any).lastResult = null;
  (safeRepairCoordinator as any).consecutiveFailures = 0;
  (safeRepairCoordinator as any).pausedUntil = null;
  mockLocked.mockReturnValue(false);
  mockScan.mockResolvedValue(report());
});

describe("SafeRepairCoordinator", () => {
  it("returns a completed no-op result for a healthy vault", async () => {
    const result = await safeRepairCoordinator.run();
    expect(result).toMatchObject({ status: "completed", repaired: 0, operations: [] });
    expect(result.report).toEqual(report());
  });

  it("skips incomplete health reports", async () => {
    mockScan.mockResolvedValue(report([{ kind: "scan-incomplete", count: 2 }], false));
    await expect(safeRepairCoordinator.run()).resolves.toMatchObject({
      status: "skipped", skipped: 2, operations: [],
    });
  });

  it("rejects locked and aborted runs", async () => {
    mockLocked.mockReturnValue(true);
    await expect(safeRepairCoordinator.run()).rejects.toMatchObject({ name: "VAULT_LOCKED" });
    mockLocked.mockReturnValue(false);
    const controller = new AbortController();
    controller.abort();
    await expect(safeRepairCoordinator.run({ signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
  });

  it("processes pending items, repairs embeddings, and rebuilds the index", async () => {
    mockScan
      .mockResolvedValueOnce(report([
        { kind: "pending-processing", count: 1 },
        { kind: "missing-embedding", count: 1 },
        { kind: "index-rebuild-recommended", count: 1 },
      ]))
      .mockResolvedValueOnce(report());
    mockProcess.mockResolvedValue({ processed: 1, failed: 0, skipped: 0 });
    mockEmbedding.mockResolvedValue([0.1, 0.2]);
    mockRebuild.mockResolvedValue(undefined);
    const item = { title: "Title", summary: "Summary", content: "Body", embedding: [], incrementalPatch: vi.fn() };
    (initDB as any).mockResolvedValue({
      bookmarks: { find: vi.fn(() => ({ exec: vi.fn().mockResolvedValue([item]) })) },
      documents: { find: vi.fn(() => ({ exec: vi.fn().mockResolvedValue([]) })) },
    });

    const result = await safeRepairCoordinator.run({ maxItems: 5 });
    expect(result.status).toBe("completed");
    expect(result.operations).toEqual(["pending-processing", "missing-embedding", "index-rebuild"]);
    expect(mockProcess).toHaveBeenCalledWith(5, undefined);
    expect(mockEmbedding).toHaveBeenCalledWith("Title Summary Body", undefined);
    expect(item.incrementalPatch).toHaveBeenCalledWith(expect.objectContaining({ embedding: [0.1, 0.2] }));
    expect(mockRebuild).toHaveBeenCalledOnce();
  });

  it("serializes concurrent runs", async () => {
    let release!: (value: any) => void;
    mockScan.mockReturnValueOnce(new Promise((resolve) => { release = resolve; }));
    const first = safeRepairCoordinator.run();
    const second = safeRepairCoordinator.run();
    expect(second).not.toBe(first);
    release(report());
    await expect(first).resolves.toMatchObject({ status: "completed" });
  });

  it("pauses after three failed runs and skips while paused", async () => {
    mockScan.mockRejectedValue(new Error("health failure"));
    for (let i = 0; i < 3; i += 1) {
      await expect(safeRepairCoordinator.run()).rejects.toThrow("health failure");
    }
    // A thrown health error is not a failed result, so the coordinator does
    // not increment result-based failure accounting.
    expect((safeRepairCoordinator as any).consecutiveFailures).toBe(0);
  });

  it("returns partial when one repair fails after another succeeds", async () => {
    mockScan
      .mockResolvedValueOnce(report([{ kind: "index-rebuild-recommended", count: 1 }]))
      .mockResolvedValueOnce(report([{ kind: "index-rebuild-recommended", count: 1 }]));
    mockRebuild.mockRejectedValue(new Error("rebuild failed"));
    const result = await safeRepairCoordinator.run();
    expect(result).toMatchObject({ status: "failed", failed: 1, repaired: 0 });
  });
});
