import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import type { TFunction } from "i18next";
import { KnowledgeFengShui } from "../../components/knowledge/KnowledgeFengShui";

const safeStorage = vi.hoisted(() => ({ safeGet: vi.fn(), safeSet: vi.fn() }));
vi.mock("../../store/safeStorage", () => ({
  safeGet: safeStorage.safeGet,
  safeSet: safeStorage.safeSet,
}));

const dbMock = vi.hoisted(() => ({ initDB: vi.fn() }));
vi.mock("../../db/database", () => ({ initDB: dbMock.initDB }));

const agent = vi.hoisted(() => ({ globalChat: vi.fn() }));
vi.mock("../../services/ai/AgentService", () => ({ agentService: agent }));

vi.mock("motion/react", async () => {
  const { createMotionMock } = await import("../mocks/motion");
  return createMotionMock();
});

const t = ((
  k: string,
  d?: unknown,
  o?: Record<string, unknown>,
): string => {
  const def =
    d && typeof d === "object"
      ? (d as Record<string, unknown>).defaultValue
      : (d as string | undefined);
  let out = String(def ?? k);
  if (o) {
    for (const [key, value] of Object.entries(o)) {
      out = out.replace(new RegExp(`{{${key}}}`, "g"), String(value));
      out = out.replace(new RegExp(`{${key}}`, "g"), String(value));
    }
  }
  return out;
}) as unknown as TFunction;

const makeDb = (rows: unknown[]) => ({
  bookmarks: { find: () => ({ exec: async () => rows }) },
});

describe("KnowledgeFengShui", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    safeStorage.safeGet.mockReturnValue(undefined);
    dbMock.initDB.mockResolvedValue(makeDb([]));
  });

  it("renders tag stats computed from bookmarks", async () => {
    dbMock.initDB.mockResolvedValue(
      makeDb([
        { id: "1", title: "A", tags: ["ai", "ml"], content: "x" },
        { id: "2", title: "B", tags: ["ai"], content: "x" },
      ]),
    );
    render(<KnowledgeFengShui cardVariants={{}} t={t} />);
    expect(await screen.findByText("Knowledge Feng Shui")).toBeInTheDocument();
    expect(screen.getByText("0 orphaned")).toBeInTheDocument();
    expect(screen.getByText("ai (2)")).toBeInTheDocument();
    expect(screen.getByText("ml (1)")).toBeInTheDocument();
    expect(screen.getByText("Analyze Structure")).toBeInTheDocument();
  });

  it("aborts and discards the pending analysis on unmount", async () => {
    let resolveAnalysis!: (value: { text: string }) => void;
    let requestSignal: AbortSignal | undefined;
    agent.globalChat.mockImplementation(
      (_prompt: string, _lang?: string, _private?: boolean, _session?: string, _onChunk?: (chunk: string) => void, _context?: unknown, _provider?: unknown, signal?: AbortSignal) => {
        requestSignal = signal;
        return new Promise<{ text: string }>((resolve) => {
          resolveAnalysis = resolve;
        });
      },
    );
    dbMock.initDB.mockResolvedValue(
      makeDb([{ id: "1", title: "A", tags: ["solo-tag"], content: "x" }]),
    );
    const { unmount } = render(<KnowledgeFengShui cardVariants={{}} t={t} />);
    fireEvent.click(await screen.findByText("Analyze Structure"));
    await waitFor(() => expect(agent.globalChat).toHaveBeenCalled());
    expect(requestSignal).toBeDefined();

    unmount();
    expect(requestSignal?.aborted).toBe(true);
    await act(async () => {
      resolveAnalysis({ text: JSON.stringify([]) });
      await Promise.resolve();
    });
    expect(safeStorage.safeSet).not.toHaveBeenCalledWith(
      "bookmarkforge_fengshui",
      expect.any(String),
    );
  });

  it("shows the prompt to analyze before any suggestions", async () => {
    dbMock.initDB.mockResolvedValue(
      makeDb([{ id: "1", title: "A", tags: ["ai"], content: "x" }]),
    );
    render(<KnowledgeFengShui cardVariants={{}} t={t} />);
    expect(
      await screen.findByText(
        "Press 'Analyze Structure' to get suggestions for improving your tag organization.",
      ),
    ).toBeInTheDocument();
  });

  it("analyzes structure merging algorithmic and AI suggestions", async () => {
    dbMock.initDB.mockResolvedValue(
      makeDb([
        { id: "1", title: "A", tags: ["reactjs"], content: "x" },
        { id: "2", title: "B", tags: ["react-js"], content: "x" },
      ]),
    );
    agent.globalChat.mockResolvedValue({
      text: JSON.stringify([
        {
          type: "rename",
          description: "AI suggestion here",
          from: "a",
          to: "b",
          severity: "low",
        },
      ]),
    });
    render(<KnowledgeFengShui cardVariants={{}} t={t} />);
    fireEvent.click(await screen.findByText("Analyze Structure"));
    expect(await screen.findByText(/appear similar/)).toBeInTheDocument();
    expect(screen.getByText("AI suggestion here")).toBeInTheDocument();
    expect(safeStorage.safeSet).toHaveBeenCalledWith(
      "bookmarkforge_fengshui",
      expect.any(String),
    );
  });

  it("marks a suggestion as applied", async () => {
    dbMock.initDB.mockResolvedValue(
      makeDb([
        { id: "1", title: "A", tags: ["reactjs"], content: "x" },
        { id: "2", title: "B", tags: ["react-js"], content: "x" },
      ]),
    );
    agent.globalChat.mockResolvedValue({ text: JSON.stringify([]) });
    render(<KnowledgeFengShui cardVariants={{}} t={t} />);
    fireEvent.click(await screen.findByText("Analyze Structure"));
    await screen.findByText(/appear similar/);
    const buttons = screen.getAllByRole("button");
    fireEvent.click(buttons[buttons.length - 1]!);
    expect(safeStorage.safeSet).toHaveBeenCalledWith(
      "bookmarkforge_fengshui_applied",
      expect.any(String),
    );
  });

  it("shows algorithmic suggestions even when AI analysis fails", async () => {
    dbMock.initDB.mockResolvedValue(
      makeDb([
        { id: "1", title: "A", tags: ["reactjs"], content: "x" },
        { id: "2", title: "B", tags: ["react-js"], content: "x" },
      ]),
    );
    agent.globalChat.mockRejectedValue(new Error("ai down"));
    render(<KnowledgeFengShui cardVariants={{}} t={t} />);
    fireEvent.click(await screen.findByText("Analyze Structure"));
    expect(await screen.findByText(/appear similar/)).toBeInTheDocument();
  });

  it("returns null while the initial DB load is pending", () => {
    dbMock.initDB.mockReturnValue(new Promise(() => {}));
    const { container } = render(<KnowledgeFengShui cardVariants={{}} t={t} />);
    // The component renders null; only injected <style> tags remain.
    expect(
      Array.from(container.children).every((el) => el.tagName === "STYLE"),
    ).toBe(true);
  });

  it("restores previously applied suggestions from storage", async () => {
    safeStorage.safeGet.mockImplementation((k: string) => {
      // Restore a wide range so any suggestion index (algorithmic order is
      // not stable across data shapes) is marked as applied.
      if (k === "bookmarkforge_fengshui_applied") {
        return JSON.stringify(["0", "1", "2", "3", "4", "5"]);
      }
      return undefined;
    });
    dbMock.initDB.mockResolvedValue(
      makeDb([
        { id: "1", title: "A", tags: ["reactjs"], content: "x" },
        { id: "2", title: "B", tags: ["react-js"], content: "x" },
      ]),
    );
    agent.globalChat.mockResolvedValue({ text: JSON.stringify([]) });
    render(<KnowledgeFengShui cardVariants={{}} t={t} />);
    fireEvent.click(await screen.findByText("Analyze Structure"));
    const suggestion = await screen.findByText(/appear similar/);
    // Applied suggestions render with line-through on the description <p>
    expect(suggestion.closest("p")?.className).toContain("line-through");
  });

  it("falls back to an empty applied list when stored JSON is invalid", async () => {
    safeStorage.safeGet.mockImplementation((k: string) =>
      k === "bookmarkforge_fengshui_applied" ? "{not-json" : undefined,
    );
    dbMock.initDB.mockResolvedValue(
      makeDb([{ id: "1", title: "A", tags: ["reactjs"], content: "x" }]),
    );
    render(<KnowledgeFengShui cardVariants={{}} t={t} />);
    expect(
      await screen.findByText("Knowledge Feng Shui"),
    ).toBeInTheDocument();
  });

  it("suggests merging a tag that has a single bookmark", async () => {
    dbMock.initDB.mockResolvedValue(
      makeDb([{ id: "1", title: "A", tags: ["solo-tag"], content: "x" }]),
    );
    agent.globalChat.mockResolvedValue({ text: JSON.stringify([]) });
    render(<KnowledgeFengShui cardVariants={{}} t={t} />);
    fireEvent.click(await screen.findByText("Analyze Structure"));
    expect(await screen.findByText(/has only 1 bookmark/)).toBeInTheDocument();
  });

  it("suggests splitting a tag that has 10+ bookmarks", async () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({
      id: `bm-${i}`,
      title: `BM ${i}`,
      tags: ["big-tag"],
      content: "x",
    }));
    dbMock.initDB.mockResolvedValue(makeDb(rows));
    agent.globalChat.mockResolvedValue({ text: JSON.stringify([]) });
    render(<KnowledgeFengShui cardVariants={{}} t={t} />);
    fireEvent.click(await screen.findByText("Analyze Structure"));
    expect(await screen.findByText(/splitting into subtags/)).toBeInTheDocument();
  });

  it("suggests restructuring when bookmarks have no tags", async () => {
    dbMock.initDB.mockResolvedValue(
      makeDb([{ id: "1", title: "A", tags: [], content: "x" }]),
    );
    agent.globalChat.mockResolvedValue({ text: JSON.stringify([]) });
    render(<KnowledgeFengShui cardVariants={{}} t={t} />);
    expect(await screen.findByText("1 orphaned")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Analyze Structure"));
    expect(await screen.findByText(/no tags/)).toBeInTheDocument();
  });

  it("un-applies a suggestion when clicked a second time", async () => {
    dbMock.initDB.mockResolvedValue(
      makeDb([
        { id: "1", title: "A", tags: ["reactjs"], content: "x" },
        { id: "2", title: "B", tags: ["react-js"], content: "x" },
      ]),
    );
    agent.globalChat.mockResolvedValue({ text: JSON.stringify([]) });
    render(<KnowledgeFengShui cardVariants={{}} t={t} />);
    fireEvent.click(await screen.findByText("Analyze Structure"));
    await screen.findByText(/appear similar/);
    const buttons = screen.getAllByRole("button");
    // Click apply, then click again to un-apply
    fireEvent.click(buttons[buttons.length - 1]!);
    fireEvent.click(buttons[buttons.length - 1]!);
    expect(safeStorage.safeSet).toHaveBeenLastCalledWith(
      "bookmarkforge_fengshui_applied",
      JSON.stringify([]),
    );
  });
});
