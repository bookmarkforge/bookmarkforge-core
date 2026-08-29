import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";

const dbMock = vi.hoisted(() => ({ initDB: vi.fn() }));
vi.mock("../../db/database", () => ({ initDB: dbMock.initDB }));

vi.mock("motion/react", async () => {
  const { createMotionMock } = await import("../mocks/motion");
  return createMotionMock();
});

const t = (k: string, d?: unknown) => {
  const def =
    d && typeof d === "object"
      ? (d as Record<string, unknown>).defaultValue
      : (d as string | undefined);
  return def ?? k;
};
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t, i18n: { language: "en" } }),
}));

import React from "react";
import { KnowledgeDecayHeatmap } from "../../components/knowledge/KnowledgeDecayHeatmap";
import type { TFunction } from "i18next";

const tMock = vi.fn((k: string, d?: unknown) =>
  d && typeof d === "object"
    ? ((d as Record<string, unknown>).defaultValue ?? k)
    : ((d as unknown) ?? k),
) as unknown as TFunction;

function makeRow(over: Record<string, unknown> = {}) {
  const data = {
    id: "1",
    title: "Old",
    tags: ["ml"],
    createdAt: "2020-01-01T00:00:00.000Z",
    lastVisitedAt: "2020-01-01T00:00:00.000Z",
    ...over,
  };
  return {
    ...data,
    toMutableJSON: () => ({ ...data }),
    incrementalPatch: vi.fn().mockResolvedValue(undefined),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function setRows(rows: any[]) {
  dbMock.initDB.mockResolvedValue({
    bookmarks: { find: () => ({ exec: async () => rows }) },
  });
}

describe("KnowledgeDecayHeatmap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders decay heatmap aggregated from bookmarks", async () => {
    setRows([
      makeRow({ tags: ["ml", "ai"], id: "1" }),
      makeRow({ tags: ["web"], id: "2" }),
    ]);
    render(<KnowledgeDecayHeatmap cardVariants={{}} t={tMock} />);
    expect(await screen.findByText("Knowledge Decay")).toBeInTheDocument();
    expect(screen.getByText("ml")).toBeInTheDocument();
    expect(screen.getByText("ai")).toBeInTheDocument();
    expect(screen.getByText("web")).toBeInTheDocument();
    expect(screen.getByText("Lower = Fresher")).toBeInTheDocument();
  });

  it("ignores a database result that resolves after unmount", async () => {
    const rows = deferred<unknown[]>();
    dbMock.initDB.mockResolvedValue({
      bookmarks: { find: () => ({ exec: () => rows.promise }) },
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { unmount } = render(
      <KnowledgeDecayHeatmap cardVariants={{}} t={tMock} />,
    );
    await waitFor(() => expect(dbMock.initDB).toHaveBeenCalled());
    unmount();
    rows.resolve([]);
    await act(async () => {
      await Promise.resolve();
    });
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("shows no tags when there are no bookmarks", async () => {
    setRows([]);
    render(<KnowledgeDecayHeatmap cardVariants={{}} t={tMock} />);
    expect(await screen.findByText("Knowledge Decay")).toBeInTheDocument();
    expect(screen.queryByText("ml")).toBeNull();
  });

  it("resets decay for a tag", async () => {
    const row = makeRow({ tags: ["ml"], id: "1" });
    setRows([row]);
    render(<KnowledgeDecayHeatmap cardVariants={{}} t={tMock} />);
    await screen.findByText("Knowledge Decay");
    fireEvent.click(screen.getByTitle("Reset"));
    await waitFor(() =>
      expect(dbMock.initDB.mock.calls.length).toBeGreaterThan(1),
    );
    expect(row.incrementalPatch).toHaveBeenCalledWith({
      lastVisitedAt: expect.any(String),
    });
  });

  it("handles database load failure gracefully", async () => {
    dbMock.initDB.mockRejectedValue(new Error("boom"));
    render(<KnowledgeDecayHeatmap cardVariants={{}} t={tMock} />);
    expect(await screen.findByText("Knowledge Decay")).toBeInTheDocument();
    expect(screen.queryByText("ml")).toBeNull();
  });

  // ── Branch coverage: score cap, null tags, lastRead fallback, reset error ──

  it("caps score at 1 for very old bookmarks (>30 days)", async () => {
    // lastVisitedAt from 2020 → daysSince ≈ 2000+, score = Math.min(1, 2000/30) = 1
    setRows([makeRow({ tags: ["ancient"], id: "old1" })]);
    render(<KnowledgeDecayHeatmap cardVariants={{}} t={tMock} />);
    await screen.findByText("Knowledge Decay");
    expect(screen.getByText("ancient")).toBeInTheDocument();
    // Score=1 → hsl(0, 70%, 50%) → rgb(217, 38, 38) = red
    const heatCell = screen.getByTitle(/Last read:/);
    expect(heatCell.style.backgroundColor).toBe("rgb(217, 38, 38)");
  });

  it("handles undefined tags gracefully (?? [])", async () => {
    setRows([
      makeRow({ tags: undefined, id: "notags" }),
      makeRow({ tags: ["valid"], id: "v1" }),
    ]);
    render(<KnowledgeDecayHeatmap cardVariants={{}} t={tMock} />);
    await screen.findByText("Knowledge Decay");
    // Should not crash; only "valid" tag appears
    expect(screen.getByText("valid")).toBeInTheDocument();
    expect(screen.queryByText("undefined")).toBeNull();
  });

  it("falls back to now when both dates are falsy", async () => {
    setRows([
      makeRow({
        tags: ["nodate"],
        id: "nd",
        lastVisitedAt: "",
        createdAt: "",
      }),
    ]);
    render(<KnowledgeDecayHeatmap cardVariants={{}} t={tMock} />);
    await screen.findByText("Knowledge Decay");
    // Falls back to now → score ≈ 0 → hsl(120, 70%, 50%) → rgb(38, 217, 38) = green
    expect(screen.getByText("nodate")).toBeInTheDocument();
    const heatCell = screen.getByTitle(/Last read:/);
    expect(heatCell.style.backgroundColor).toBe("rgb(38, 217, 38)");
  });

  it("falls back to createdAt when lastVisitedAt is missing", async () => {
    // lastVisitedAt is falsy, so uses createdAt (2021-06-01) for lastReadTime
    setRows([
      makeRow({
        tags: ["onlycreated"],
        id: "oc",
        lastVisitedAt: "",
        createdAt: "2021-06-01T00:00:00.000Z",
      }),
    ]);
    render(<KnowledgeDecayHeatmap cardVariants={{}} t={tMock} />);
    await screen.findByText("Knowledge Decay");
    expect(screen.getByText("onlycreated")).toBeInTheDocument();
  });

  it("handles reset error gracefully", async () => {
    const row = {
      ...makeRow({ tags: ["rst"], id: "rst1" }),
      incrementalPatch: vi.fn().mockRejectedValue(new Error("patch fail")),
    };
    setRows([row]);
    render(<KnowledgeDecayHeatmap cardVariants={{}} t={tMock} />);
    await screen.findByText("Knowledge Decay");
    // Click reset — should not throw
    fireEvent.click(screen.getByTitle("Reset"));
    await waitFor(() => {
      // Component should still render after reset error
      expect(screen.getByText("Knowledge Decay")).toBeInTheDocument();
    });
  });
});
