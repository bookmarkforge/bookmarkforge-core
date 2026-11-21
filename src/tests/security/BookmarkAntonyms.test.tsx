import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import React from "react";
import { BookmarkAntonyms } from "../../components/knowledge/BookmarkAntonyms";
import type { TFunction } from "i18next";

const tMock = vi.fn((k: string, d?: unknown) =>
  d && typeof d === "object"
    ? ((d as Record<string, unknown>).defaultValue ?? k)
    : ((d as unknown) ?? k),
) as unknown as TFunction;

const safeStorage = vi.hoisted(() => ({
  safeGet: vi.fn(),
  safeSet: vi.fn(),
  safeRemove: vi.fn(),
}));
vi.mock("../../store/safeStorage", () => ({
  safeGet: safeStorage.safeGet,
  safeSet: safeStorage.safeSet,
  safeRemove: safeStorage.safeRemove,
}));

const dbMock = vi.hoisted(() => ({ initDB: vi.fn() }));
vi.mock("../../db/database", () => ({ initDB: dbMock.initDB }));

const agent = vi.hoisted(() => ({ globalChat: vi.fn() }));
vi.mock("../../services/ai/AgentService", () => ({
  agentService: agent,
}));

vi.mock("motion/react", async () => {
  const { createMotionMock } = await import("../mocks/motion");
  return createMotionMock();
});

const t = (k: string, d?: unknown) =>
  d && typeof d === "object"
    ? ((d as Record<string, unknown>).defaultValue ?? k)
    : ((d as unknown) ?? k);

// Components map docs via d.toJSON(), so the mock doc must expose it.
const bm = {
  id: "b1",
  title: "BM One",
  tags: ["x", "y"],
  content: "c",
  toJSON: () => ({
    id: "b1",
    title: "BM One",
    tags: ["x", "y"],
    content: "c",
  }),
};
const bm2 = {
  id: "b2",
  title: "BM Two",
  tags: ["z"],
  content: "d",
  toJSON: () => ({
    id: "b2",
    title: "BM Two",
    tags: ["z"],
    content: "d",
  }),
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("BookmarkAntonyms", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    safeStorage.safeGet.mockReturnValue(undefined);
    dbMock.initDB.mockResolvedValue({
      bookmarks: { find: () => ({ exec: async () => [bm] }) },
    });
    agent.globalChat.mockResolvedValue({
      text: JSON.stringify({
        title: "Opposite View",
        perspective: "Because reasons.",
      }),
    });
  });

  it("renders bookmarks loaded from the database", async () => {
    render(<BookmarkAntonyms cardVariants={{}} t={tMock} />);
    expect(await screen.findByText("BM One")).toBeInTheDocument();
    expect(screen.getByText("x")).toBeInTheDocument();
    expect(screen.getByText("y")).toBeInTheDocument();
  });

  it("ignores a database result that resolves after unmount", async () => {
    const docs = deferred<typeof bm[]>();
    dbMock.initDB.mockResolvedValue({
      bookmarks: { find: () => ({ exec: () => docs.promise }) },
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { unmount } = render(
      <BookmarkAntonyms cardVariants={{}} t={tMock} />,
    );
    await waitFor(() => expect(dbMock.initDB).toHaveBeenCalled());
    unmount();
    docs.resolve([bm]);
    await act(async () => {
      await Promise.resolve();
    });
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("shows a message when there are no bookmarks", async () => {
    dbMock.initDB.mockResolvedValue({
      bookmarks: { find: () => ({ exec: async () => [] }) },
    });
    render(<BookmarkAntonyms cardVariants={{}} t={tMock} />);
    expect(await screen.findByText("No bookmarks found")).toBeInTheDocument();
  });

  it("fetches an antonym from the AI agent and displays it", async () => {
    render(<BookmarkAntonyms cardVariants={{}} t={tMock} />);
    await screen.findByText("BM One");
    fireEvent.click(screen.getByTitle("Find Antonym"));
    expect(await screen.findByText("Opposite View")).toBeInTheDocument();
    expect(screen.getByText("Because reasons.")).toBeInTheDocument();
    expect(agent.globalChat).toHaveBeenCalled();
    expect(safeStorage.safeSet).toHaveBeenCalled();
  });

  it("ignores stale streaming results when another bookmark is selected", async () => {
    let resolveFirst!: (value: unknown) => void;
    let resolveSecond!: (value: unknown) => void;
    dbMock.initDB.mockResolvedValue({
      bookmarks: { find: () => ({ exec: async () => [bm, bm2] }) },
    });
    agent.globalChat
      .mockReset()
      .mockImplementationOnce(
        () => new Promise((resolve) => { resolveFirst = resolve; }),
      )
      .mockImplementationOnce(
        () => new Promise((resolve) => { resolveSecond = resolve; }),
      );

    render(<BookmarkAntonyms cardVariants={{}} t={tMock} />);
    await screen.findByText("BM Two");
    const buttons = screen.getAllByTitle("Find Antonym");
    fireEvent.click(buttons[0]!);
    await waitFor(() => expect(agent.globalChat).toHaveBeenCalledTimes(1));
    const firstSignal = agent.globalChat.mock.calls[0]![7] as AbortSignal;

    fireEvent.click(buttons[1]!);
    await waitFor(() => expect(agent.globalChat).toHaveBeenCalledTimes(2));
    const secondSignal = agent.globalChat.mock.calls[1]![7] as AbortSignal;
    expect(firstSignal.aborted).toBe(true);
    expect(secondSignal.aborted).toBe(false);

    resolveFirst!({
      text: JSON.stringify({
        title: "Stale Opposite",
        perspective: "Old result",
      }),
    });
    await Promise.resolve();
    expect(screen.queryByText("Stale Opposite")).toBeNull();

    resolveSecond!({
      text: JSON.stringify({
        title: "Current Opposite",
        perspective: "Current result",
      }),
    });
    expect(await screen.findByText("Current Opposite")).toBeInTheDocument();
    expect(screen.queryByText("Stale Opposite")).toBeNull();
  });

  it("uses the cached antonym without calling the agent", async () => {
    safeStorage.safeGet.mockReturnValue(
      JSON.stringify([
        { title: "Cached Opp", perspective: "Cached perspective." },
      ]),
    );
    render(<BookmarkAntonyms cardVariants={{}} t={tMock} />);
    await screen.findByText("BM One");
    fireEvent.click(screen.getByTitle("Find Antonym"));
    expect(await screen.findByText("Cached Opp")).toBeInTheDocument();
    expect(agent.globalChat).not.toHaveBeenCalled();
  });

  it("regenerates and never leaks a corrupt cache payload", async () => {
    const secret = "very-private-token-DO-NOT-LEAK-9f4b";
    // Corrupt cache blob that contains the secret: a real raw `JSON.parse`
    // would embed the fragment in `SyntaxError.message` and surface it
    // through the logger.
    safeStorage.safeGet.mockReturnValue(
      `[{"title":"${secret}","perspective":"p1"`,
    );
    agent.globalChat.mockResolvedValue({
      text: JSON.stringify({
        title: "Fresh Opposite",
        perspective: "Brand-new perspective.",
      }),
    });
    render(<BookmarkAntonyms cardVariants={{}} t={tMock} />);
    await screen.findByText("BM One");
    fireEvent.click(screen.getByTitle("Find Antonym"));

    // The agent must be called because the cache was discarded, and the
    // resulting UI must show the freshly generated antonym — never the
    // corrupt cache payload.
    expect(await screen.findByText("Fresh Opposite")).toBeInTheDocument();
    expect(screen.queryByText(secret)).toBeNull();
    expect(agent.globalChat).toHaveBeenCalled();
  });
});
