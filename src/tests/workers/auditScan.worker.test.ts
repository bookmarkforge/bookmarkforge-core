import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("AuditScanWorker", () => {
  let postMessageSpy: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    postMessageSpy = vi.fn();
    self.postMessage = postMessageSpy as unknown as typeof self.postMessage;
    await import("../../workers/auditScan.worker");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const fireMessage = (data: Record<string, unknown>) => {
    const handler = self.onmessage as unknown as (e: MessageEvent) => void;
    handler({ data } as MessageEvent);
  };

  const recent = new Date(Date.now() - 5 * 86_400_000).toISOString();
  const old = new Date(Date.now() - 400 * 86_400_000).toISOString();

  it("sets onmessage handler after import", () => {
    expect(typeof self.onmessage).toBe("function");
  });

  it("computes the audit for a valid payload", async () => {
    fireMessage({
      taskId: "task-1",
      type: "auditScan",
      payload: {
        bookmarks: [
          {
            id: "1",
            title: "A",
            tags: ["ai", "ml"],
            createdAt: old,
            lastVisitedAt: recent,
            updatedAt: recent,
          },
          {
            id: "2",
            title: "B",
            tags: ["ai"],
            createdAt: old,
            lastVisitedAt: recent,
            updatedAt: recent,
          },
        ],
      },
    });
    await vi.waitFor(() => {
      expect(postMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: "task-1",
          result: expect.objectContaining({
            totalTags: 2,
            visitedIn30d: 2,
            outdatedCount: 0,
          }),
        }),
      );
      expect(postMessageSpy).toHaveBeenCalledWith({
        taskId: "task-1",
        status: "scanning",
        progress: 0.05,
      });
      expect(postMessageSpy).toHaveBeenCalledWith({
        taskId: "task-1",
        status: "done",
        progress: 1,
      });
    });
  });

  it("returns a zeroed result for an empty payload", async () => {
    fireMessage({
      taskId: "task-2",
      type: "auditScan",
      payload: { bookmarks: [] },
    });
    await vi.waitFor(() => {
      expect(postMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: "task-2",
          result: {
            totalTags: 0,
            visitedIn30d: 0,
            coverageByTag: [],
            outdatedCount: 0,
          },
        }),
      );
    });
  });

  it("rejects a missing taskId deterministically", async () => {
    fireMessage({ type: "auditScan", payload: { bookmarks: [] } });
    await vi.waitFor(() => {
      expect(postMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: "unknown",
          error: expect.stringContaining("taskId"),
        }),
      );
    });
  });

  it("rejects an unknown message type", async () => {
    fireMessage({ taskId: "task-3", type: "nope", payload: {} });
    await vi.waitFor(() => {
      expect(postMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: "task-3",
          error: expect.stringContaining("Unknown worker message type"),
        }),
      );
    });
  });

  it("rejects a payload without a bookmarks array", async () => {
    fireMessage({
      taskId: "task-4",
      type: "auditScan",
      payload: { bookmarks: "nope" },
    });
    await vi.waitFor(() => {
      expect(postMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: "task-4",
          error: expect.stringContaining("bookmarks array"),
        }),
      );
    });
  });

  it("rejects malformed bookmark entries", async () => {
    fireMessage({
      taskId: "task-5",
      type: "auditScan",
      payload: { bookmarks: [{ id: "x", title: "t", tags: "nope" }] },
    });
    await vi.waitFor(() => {
      expect(postMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: "task-5",
          error: expect.stringContaining("bookmarks array"),
        }),
      );
    });
  });
});
