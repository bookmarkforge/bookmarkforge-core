import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("KnowledgeScanWorker", () => {
  let postMessageSpy: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    postMessageSpy = vi.fn();
    self.postMessage = postMessageSpy as unknown as typeof self.postMessage;
    await import("../../workers/knowledgeScan.worker");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const fireMessage = (data: Record<string, unknown>) => {
    const handler = self.onmessage as unknown as (e: MessageEvent) => void;
    handler({ data } as MessageEvent);
  };

  const ja = { id: "1", title: "日本語の記事", url: "", tags: ["ml"] };
  const en = { id: "2", title: "English ML Guide", url: "", tags: ["ml"] };

  it("sets onmessage handler after import", () => {
    expect(typeof self.onmessage).toBe("function");
  });

  it("computes bridges for a valid scan payload", async () => {
    fireMessage({
      taskId: "task-1",
      type: "crossLanguageScan",
      payload: { bookmarks: [ja, en] },
    });
    await vi.waitFor(() => {
      expect(postMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: "task-1",
          result: [
            {
              topic: "ml",
              pairs: [
                { lang: "en", title: "English ML Guide" },
                { lang: "ja", title: "日本語の記事" },
              ],
            },
          ],
        }),
      );
    });
  });

  it("returns an empty result when no bridges exist", async () => {
    fireMessage({
      taskId: "task-2",
      type: "crossLanguageScan",
      payload: { bookmarks: [] },
    });
    await vi.waitFor(() => {
      expect(postMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: "task-2", result: [] }),
      );
    });
  });

  it("rejects a missing taskId deterministically", async () => {
    fireMessage({ type: "crossLanguageScan", payload: { bookmarks: [] } });
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
      type: "crossLanguageScan",
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
      type: "crossLanguageScan",
      payload: { bookmarks: [{ id: "x", title: "t", url: "u" }] },
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

  it("posts progress status messages before the result", async () => {
    fireMessage({
      taskId: "task-progress",
      type: "crossLanguageScan",
      payload: { bookmarks: [ja, en] },
    });
    await vi.waitFor(() => {
      const statuses = postMessageSpy.mock.calls
        .map((c) => c[0] as Record<string, unknown>)
        .filter((m) => m.taskId === "task-progress" && m.status !== undefined);
      expect(statuses.length).toBeGreaterThan(0);
      // Coarse phases: sampling first, done last with fraction 1, and at
      // least one comparing step in between.
      expect(statuses[0]!.status).toBe("sampling");
      expect(statuses.some((m) => m.status === "comparing")).toBe(true);
      expect(statuses[statuses.length - 1]!.status).toBe("done");
      expect(statuses[statuses.length - 1]!.progress).toBe(1);
    });
    // The result is still posted after the status messages.
    await vi.waitFor(() => {
      expect(postMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: "task-progress", result: expect.any(Array) }),
      );
    });
  });

  it("sanitizes a NaN visitCount instead of poisoning the relevance sort", async () => {
    // A NaN visitCount must not leak into the comparator (the sort spec
    // would treat it as equal, silently degrading the sample to recency).
    const items = [
      {
        id: "old-hit",
        title: "English old hit",
        url: "",
        tags: ["shared"],
        updatedAt: "2026-01-01T00:00:00.000Z",
        visitCount: 10,
      },
      {
        id: "nan-fresh",
        title: "English fresh NaN",
        url: "",
        tags: ["shared"],
        updatedAt: "2026-02-01T00:00:00.000Z",
        visitCount: Number.NaN,
      },
      {
        id: "ja-1",
        title: "日本語の記事",
        url: "",
        tags: ["shared"],
      },
    ];
    fireMessage({
      taskId: "task-visits",
      type: "crossLanguageScan",
      payload: { bookmarks: items, options: { maxItemsPerLang: 1 } },
    });
    await vi.waitFor(() => {
      const call = postMessageSpy.mock.calls.find((c: unknown[]) => {
        const msg = c[0] as Record<string, unknown>;
        return msg.taskId === "task-visits" && Array.isArray(msg.result);
      });
      const result = (call?.[0] as { result?: Array<{ pairs: unknown[] }> })
        ?.result;
      const enTitles = result![0]!.pairs
        .filter((p) => (p as { lang: string }).lang === "en")
        .map((p) => (p as { title: string }).title);
      // The visited (older) item wins over the fresh NaN item: with the
      // NaN sanitized to 0, visitCount 10 > 0 decides.
      expect(enTitles).toEqual(["English old hit"]);
    });
  });

  it("honors scan options passed in the payload", async () => {
    const items: Array<Record<string, unknown>> = [];
    for (let i = 0; i < 10; i++) {
      items.push({
        id: `en-${i}`,
        title: `English article ${i}`,
        url: "",
        tags: ["shared"],
        updatedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
      });
    }
    items.push({
      id: "ja-1",
      title: "日本語の記事",
      url: "",
      tags: ["shared"],
    });
    fireMessage({
      taskId: "task-6",
      type: "crossLanguageScan",
      payload: { bookmarks: items, options: { maxItemsPerLang: 3 } },
    });
    await vi.waitFor(() => {
      // Progress status messages precede the result; match the completion
      // reply (the call carrying a result array).
      const call = postMessageSpy.mock.calls.find(
        (c: unknown[]) => {
          const msg = c[0] as Record<string, unknown>;
          return msg.taskId === "task-6" && Array.isArray(msg.result);
        },
      );
      const result = (call?.[0] as { result?: Array<{ pairs: unknown[] }> })
        ?.result;
      expect(result).toHaveLength(1);
      // Only the 3 newest English items participate.
      expect(
        result![0]!.pairs.filter(
          (p) => (p as { lang: string }).lang === "en",
        ),
      ).toHaveLength(3);
    });
  });
});
