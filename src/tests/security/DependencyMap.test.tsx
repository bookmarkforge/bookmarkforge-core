import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import { DependencyMap } from "../../components/knowledge/DependencyMap";
import type { TFunction } from "i18next";

const tMock = vi.fn((k: string) => k) as unknown as TFunction;

const dbMock = vi.hoisted(() => ({ initDB: vi.fn() }));
vi.mock("../../db/database", () => ({ initDB: dbMock.initDB }));

const agent = vi.hoisted(() => ({ globalChat: vi.fn() }));
vi.mock("../../services/ai/AgentService", () => ({ agentService: agent }));

vi.mock("motion/react", async () => {
  const { createMotionMock } = await import("../mocks/motion");
  return createMotionMock();
});

vi.mock("react-i18next", () => ({
  useTranslation: () => {
    const t = (k: string, d?: unknown) => {
      const def =
        d && typeof d === "object"
          ? (d as Record<string, unknown>).defaultValue
          : (d as string | undefined);
      return def ?? k;
    };
    return { t, i18n: { language: "en" } };
  },
}));

interface Bm {
  id: string;
  title: string;
  tags: string[];
  createdAt: string;
  visitCount: number;
  content: string;
  url: string;
  isDeleted?: boolean;
}

const makeRows = (): Bm[] =>
  [
    {
      id: "1",
      title: "Alpha",
      tags: ["a"],
      createdAt: "2023-01-01T00:00:00.000Z",
      visitCount: 5,
      content: "c1",
      url: "u1",
    },
    {
      id: "2",
      title: "Beta",
      tags: ["b"],
      createdAt: "2023-02-01T00:00:00.000Z",
      visitCount: 3,
      content: "c2",
      url: "u2",
    },
  ].map((b) => ({ ...b, toJSON: () => b }));

const makeDb = (rows: unknown[]) => ({
  bookmarks: { find: () => ({ exec: async () => rows }) },
});

describe("DependencyMap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.initDB.mockResolvedValue(makeDb(makeRows()));
  });

  it("renders the analyze button once bookmarks are loaded", async () => {
    render(<DependencyMap cardVariants={{}} t={tMock} />);
    const btn = await screen.findByText("Analyze Dependencies");
    // The button is rendered immediately but stays disabled until the
    // async bookmark load resolves (allBookmarks.length > 0).
    await waitFor(() => expect(btn).toBeEnabled());
    expect(screen.getByText("Dependency Map")).toBeInTheDocument();
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
    const { unmount } = render(<DependencyMap cardVariants={{}} t={tMock} />);
    fireEvent.click(await screen.findByText("Analyze Dependencies"));
    await waitFor(() => expect(agent.globalChat).toHaveBeenCalled());
    expect(requestSignal).toBeDefined();

    unmount();
    expect(requestSignal?.aborted).toBe(true);
    await act(async () => {
      resolveAnalysis({ text: JSON.stringify({ edges: [] }) });
      await Promise.resolve();
    });
    expect(screen.queryByText("Alpha")).not.toBeInTheDocument();
  });

  it("shows an empty state when there are no bookmarks", async () => {
    dbMock.initDB.mockResolvedValue(makeDb([]));
    render(<DependencyMap cardVariants={{}} t={tMock} />);
    const btn = await screen.findByText("Analyze Dependencies");
    expect(btn).toBeDisabled();
    expect(
      await screen.findByText(
        "Not enough data. Save more bookmarks on related topics.",
      ),
    ).toBeInTheDocument();
  });

  it("analyzes dependencies and renders nodes with edges", async () => {
    agent.globalChat.mockResolvedValue({
      text: JSON.stringify({
        edges: [{ from: "Alpha", to: "Beta", label: "prerequisite" }],
      }),
    });
    render(<DependencyMap cardVariants={{}} t={tMock} />);
    fireEvent.click(await screen.findByText("Analyze Dependencies"));
    expect(await screen.findByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
    expect(agent.globalChat).toHaveBeenCalled();
  });

  it("shows dependency details when a node is selected", async () => {
    agent.globalChat.mockResolvedValue({
      text: JSON.stringify({
        edges: [{ from: "Alpha", to: "Beta", label: "prerequisite" }],
      }),
    });
    render(<DependencyMap cardVariants={{}} t={tMock} />);
    fireEvent.click(await screen.findByText("Analyze Dependencies"));
    fireEvent.click(await screen.findByText("Alpha"));
    expect(await screen.findByText("Dependencies")).toBeInTheDocument();
    expect(screen.getByText("Depended by")).toBeInTheDocument();
    expect(screen.getAllByText("Beta").length).toBeGreaterThan(0);
  });

  it("handles analysis failure gracefully", async () => {
    agent.globalChat.mockRejectedValue(new Error("ai down"));
    render(<DependencyMap cardVariants={{}} t={tMock} />);
    fireEvent.click(await screen.findByText("Analyze Dependencies"));
    expect(
      await screen.findByText(
        "Not enough data. Save more bookmarks on related topics.",
      ),
    ).toBeInTheDocument();
  });
});
