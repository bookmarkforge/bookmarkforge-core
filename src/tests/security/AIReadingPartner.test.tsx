import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
  act,
} from "@testing-library/react";
import React from "react";
import { AIReadingPartner } from "../../components/bookmarks/AIReadingPartner";

const dbMock = vi.hoisted(() => ({ initDB: vi.fn() }));
vi.mock("../../db/database", () => ({ initDB: dbMock.initDB }));

const agent = vi.hoisted(() => ({ globalChat: vi.fn() }));
vi.mock("../../services/ai/AgentService", () => ({ agentService: agent }));

vi.mock("motion/react", async () => {
  const { createMotionMock } = await import("../mocks/motion");
  return createMotionMock();
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, d?: unknown) =>
      d && typeof d === "object"
        ? ((d as Record<string, unknown>).defaultValue ?? k)
        : ((d as unknown) ?? k),
  }),
}));

const bm = (id: string, title: string, tags: string[]) => ({
  id,
  title,
  tags,
  content: "",
});

describe("AIReadingPartner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.initDB.mockResolvedValue({
      bookmarks: {
        find: () => ({
          sort: () => ({ limit: () => ({ exec: async () => [] }) }),
        }),
      },
    });
    agent.globalChat.mockResolvedValue({ text: "Deep insight here" });
  });

  it("renders the toggle and opens the panel", async () => {
    render(
      <AIReadingPartner
        content="some readable content"
        currentBookmarkId="b1"
      />,
    );
    expect(screen.getByText("AI")).toBeInTheDocument();
    fireEvent.click(screen.getByText("AI"));
    expect(await screen.findByText("AI Reading Partner")).toBeInTheDocument();
  });

  it("shows an empty state when there are no related bookmarks", async () => {
    dbMock.initDB.mockResolvedValue({
      bookmarks: {
        find: () => ({
          sort: () => ({ limit: () => ({ exec: async () => [] }) }),
        }),
      },
    });
    render(
      <AIReadingPartner
        content="machine learning is fascinating"
        currentBookmarkId="b1"
      />,
    );
    fireEvent.click(screen.getByText("AI"));
    expect(await screen.findByText("No annotations yet.")).toBeInTheDocument();
  });

  it("builds connection annotations from related bookmarks", async () => {
    dbMock.initDB.mockResolvedValue({
      bookmarks: {
        find: () => ({
          sort: () => ({
            limit: () => ({
              exec: async () => [
                bm("b2", "machine learning basics", ["machine", "learning"]),
              ],
            }),
          }),
        }),
      },
    });
    render(
      <AIReadingPartner
        content="machine learning is fascinating and neural networks are powerful"
        currentBookmarkId="b1"
      />,
    );
    fireEvent.click(screen.getByText("AI"));
    expect(
      await screen.findByText("Related to machine learning basics"),
    ).toBeInTheDocument();
  });

  it("appends a deep-analysis insight on Analyze Full Page", async () => {
    render(
      <AIReadingPartner
        content="machine learning content"
        currentBookmarkId="b1"
      />,
    );
    fireEvent.click(screen.getByText("AI"));
    fireEvent.click(await screen.findByText("Analyze Full Page"));
    expect(await screen.findByText("Deep insight here")).toBeInTheDocument();
    expect(agent.globalChat).toHaveBeenCalled();
  });

  it("cancels deep analysis when the bookmark content changes", async () => {
    let resolveAnalysis!: (result: { text: string }) => void;
    agent.globalChat.mockReturnValue(
      new Promise((resolve) => {
        resolveAnalysis = resolve;
      }),
    );
    const { rerender } = render(
      <AIReadingPartner
        content="machine learning content"
        currentBookmarkId="b1"
      />,
    );
    fireEvent.click(screen.getByText("AI"));
    fireEvent.click(await screen.findByText("Analyze Full Page"));
    await waitFor(() => expect(agent.globalChat).toHaveBeenCalled());
    const signal = agent.globalChat.mock.calls[0]?.[7];
    expect(signal).toBeInstanceOf(AbortSignal);

    rerender(
      <AIReadingPartner
        content="quantum computing content"
        currentBookmarkId="b1"
      />,
    );
    expect(signal?.aborted).toBe(true);
    resolveAnalysis({ text: "Stale deep insight" });
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByText("Stale deep insight")).toBeNull();
  });

  it("propagates cancellation to deep analysis", async () => {
    let rejectAnalysis!: (error: unknown) => void;
    agent.globalChat.mockImplementation((...args: unknown[]) => {
      const signal = args[7] as AbortSignal | undefined;
      return new Promise((_resolve, reject) => {
        rejectAnalysis = reject;
        signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        }, { once: true });
      });
    });
    const { unmount } = render(
      <AIReadingPartner content="machine learning content" currentBookmarkId="b1" />,
    );
    fireEvent.click(screen.getByText("AI"));
    fireEvent.click(await screen.findByText("Analyze Full Page"));
    await waitFor(() => expect(agent.globalChat).toHaveBeenCalled());
    const signal = agent.globalChat.mock.calls[0]?.[7];
    expect(signal).toBeInstanceOf(AbortSignal);
    unmount();
    expect(signal?.aborted).toBe(true);
    rejectAnalysis(new DOMException("aborted", "AbortError"));
  });

  it("does not analyze when content is empty", async () => {
    render(<AIReadingPartner content="" currentBookmarkId="b1" />);
    fireEvent.click(screen.getByText("AI"));
    expect(await screen.findByText("No annotations yet.")).toBeInTheDocument();
    expect(agent.globalChat).not.toHaveBeenCalled();
  });

  it("skips analysis when content has no meaningful keywords", async () => {
    dbMock.initDB.mockResolvedValue({
      bookmarks: {
        find: () => ({
          sort: () => ({ limit: () => ({ exec: async () => [bm("b2", "x", [])] }) }),
        }),
      },
    });
    render(<AIReadingPartner content="a b c d" currentBookmarkId="b1" />);
    fireEvent.click(screen.getByText("AI"));
    expect(await screen.findByText("No annotations yet.")).toBeInTheDocument();
    // No keyword extraction → initDB never called for analysis
    expect(agent.globalChat).not.toHaveBeenCalled();
  });

  it("builds contradiction annotations when content has contrast words", async () => {
    dbMock.initDB.mockResolvedValue({
      bookmarks: {
        find: () => ({
          sort: () => ({
            limit: () => ({
              exec: async () => [
                bm("b2", "machine learning analysis", []),
              ],
            }),
          }),
        }),
      },
    });
    render(
      <AIReadingPartner
        content="machine learning is great however it has limits"
        currentBookmarkId="b1"
      />,
    );
    fireEvent.click(screen.getByText("AI"));
    expect(
      await screen.findByText("This may contradict machine learning analysis"),
    ).toBeInTheDocument();
  });

  it("builds insight annotations for neutral related bookmarks", async () => {
    dbMock.initDB.mockResolvedValue({
      bookmarks: {
        find: () => ({
          sort: () => ({
            limit: () => ({
              exec: async () => [
                bm("b2", "neural networks overview", []),
              ],
            }),
          }),
        }),
      },
    });
    render(
      <AIReadingPartner
        content="machine learning is great and neural networks are powerful"
        currentBookmarkId="b1"
      />,
    );
    fireEvent.click(screen.getByText("AI"));
    expect(
      await screen.findByText("This reminds me of neural networks overview"),
    ).toBeInTheDocument();
  });

  it("limits annotations to 5 and skips bookmarks without shared keywords", async () => {
    const all = [
      bm("r1", "machine learning one", ["machine", "learning"]),
      bm("r2", "machine learning two", ["machine", "learning"]),
      bm("r3", "machine learning three", ["machine", "learning"]),
      bm("r4", "machine learning four", ["machine", "learning"]),
      bm("r5", "machine learning five", ["machine", "learning"]),
      bm("r6", "machine learning six", ["machine", "learning"]),
      bm("unrelated", "kitchen recipes", ["cooking"]),
    ];
    dbMock.initDB.mockResolvedValue({
      bookmarks: {
        find: () => ({
          sort: () => ({ limit: () => ({ exec: async () => all }) }),
        }),
      },
    });
    render(
      <AIReadingPartner
        content="machine learning is fascinating"
        currentBookmarkId="b1"
      />,
    );
    fireEvent.click(screen.getByText("AI"));
    await waitFor(() => {
      expect(screen.getAllByText(/Related to machine learning/).length).toBe(5);
    });
    expect(screen.queryByText(/kitchen recipes/)).not.toBeInTheDocument();
  });

  it("silently fails deep analysis when agent errors", async () => {
    agent.globalChat.mockRejectedValue(new Error("agent down"));
    render(
      <AIReadingPartner
        content="machine learning content"
        currentBookmarkId="b1"
      />,
    );
    fireEvent.click(screen.getByText("AI"));
    fireEvent.click(await screen.findByText("Analyze Full Page"));
    await waitFor(() => expect(agent.globalChat).toHaveBeenCalled());
    expect(screen.getByText("No annotations yet.")).toBeInTheDocument();
  });

  it("uses default message when deep analysis returns no text", async () => {
    agent.globalChat.mockResolvedValue({ other: "no text" });
    render(
      <AIReadingPartner
        content="machine learning content"
        currentBookmarkId="b1"
      />,
    );
    fireEvent.click(screen.getByText("AI"));
    fireEvent.click(await screen.findByText("Analyze Full Page"));
    expect(
      await screen.findByText("Deep analysis complete."),
    ).toBeInTheDocument();
  });
});
