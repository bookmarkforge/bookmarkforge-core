import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import React from "react";
import { BookmarkNostalgia } from "../../components/knowledge/BookmarkNostalgia";
import type { TFunction } from "i18next";

const tMock = vi.fn((k: string, d?: unknown) =>
  d && typeof d === "object"
    ? ((d as Record<string, unknown>).defaultValue ?? k)
    : ((d as unknown) ?? k),
) as unknown as TFunction;

const dbMock = vi.hoisted(() => ({ initDB: vi.fn() }));
vi.mock("../../db/database", () => ({ initDB: dbMock.initDB }));

const agent = vi.hoisted(() => ({ globalChat: vi.fn() }));
vi.mock("../../services/ai/AgentService", () => ({ agentService: agent }));

const getClientMock = vi.hoisted(() => ({ getClient: vi.fn() }));
vi.mock("../../services/ai/ProviderManager", () => ({
  getClient: getClientMock.getClient,
}));

vi.mock("motion/react", async () => {
  const { createMotionMock } = await import("../mocks/motion");
  return createMotionMock();
});

const t = (k: string, d?: unknown) =>
  d && typeof d === "object"
    ? ((d as Record<string, unknown>).defaultValue ?? k)
    : ((d as unknown) ?? k);

const makeDb = (rows: unknown[]) => ({
  bookmarks: { find: () => ({ exec: async () => rows }) },
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("BookmarkNostalgia", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getClientMock.getClient.mockResolvedValue({});
    dbMock.initDB.mockResolvedValue(makeDb([]));
  });

  it("shows loading then the empty state when there are no bookmarks", async () => {
    render(<BookmarkNostalgia cardVariants={{}} t={tMock} />);
    expect(
      await screen.findByText(
        "No bookmarks yet. Start collecting to see your year in review.",
      ),
    ).toBeInTheDocument();
  });

  it("renders the year in review with computed stats", async () => {
    dbMock.initDB.mockResolvedValue(
      makeDb([
        {
          id: "1",
          title: "BM One",
          tags: ["ai"],
          createdAt: "2023-06-15T10:00:00.000Z",
          content: "x",
          url: "u",
        },
      ]),
    );
    render(<BookmarkNostalgia cardVariants={{}} t={tMock} />);
    expect(await screen.findByText("Bookmark Wrapped")).toBeInTheDocument();
    expect(screen.getAllByText("2023").length).toBeGreaterThan(0);
    expect(
      screen.getByText("You saved 1 bookmarks in 2023"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("June was your peak (1 bookmarks)"),
    ).toBeInTheDocument();
    expect(screen.getByText("BM One")).toBeInTheDocument();
    expect(screen.getByText(/1 day streak/)).toBeInTheDocument();
    expect(screen.getByText("Top Topics")).toBeInTheDocument();
    expect(screen.getAllByText("ai").length).toBeGreaterThan(0);
  });

  it("switches the displayed year when a different year is selected", async () => {
    dbMock.initDB.mockResolvedValue(
      makeDb([
        {
          id: "1",
          title: "BM A",
          tags: ["x"],
          createdAt: "2022-03-10T10:00:00.000Z",
          content: "x",
          url: "u",
        },
        {
          id: "2",
          title: "BM B",
          tags: ["y"],
          createdAt: "2023-03-10T10:00:00.000Z",
          content: "x",
          url: "u",
        },
      ]),
    );
    render(<BookmarkNostalgia cardVariants={{}} t={tMock} />);
    expect(await screen.findAllByText("2023")).toBeTruthy();
    fireEvent.click(screen.getByText("2022"));
    expect(
      await screen.findByText("You saved 1 bookmarks in 2022"),
    ).toBeInTheDocument();
  });

  it("generates a reflection via AI", async () => {
    dbMock.initDB.mockResolvedValue(
      makeDb([
        {
          id: "1",
          title: "BM One",
          tags: ["ai"],
          createdAt: "2023-06-15T10:00:00.000Z",
          content: "x",
          url: "u",
        },
      ]),
    );
    agent.globalChat.mockResolvedValue({ text: "Poetic line about learning" });
    render(<BookmarkNostalgia cardVariants={{}} t={tMock} />);
    const btn = await screen.findByText("Generate Reflection");
    fireEvent.click(btn);
    expect(
      await screen.findByText(/Poetic line about learning/),
    ).toBeInTheDocument();
    expect(agent.globalChat).toHaveBeenCalled();
  });

  it("ignores a database result that resolves after unmount", async () => {
    const rows = deferred<unknown[]>();
    dbMock.initDB.mockResolvedValue({
      bookmarks: { find: () => ({ exec: () => rows.promise }) },
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { unmount } = render(
      <BookmarkNostalgia cardVariants={{}} t={tMock} />,
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

  it("aborts a reflection when switching years and discards its result", async () => {
    dbMock.initDB.mockResolvedValue(
      makeDb([
        {
          id: "1",
          title: "BM A",
          tags: ["x"],
          createdAt: "2022-03-10T10:00:00.000Z",
          content: "x",
          url: "u",
        },
        {
          id: "2",
          title: "BM B",
          tags: ["y"],
          createdAt: "2023-03-10T10:00:00.000Z",
          content: "x",
          url: "u",
        },
      ]),
    );
    let resolveReflection!: (result: { text: string }) => void;
    agent.globalChat.mockReturnValue(
      new Promise((resolve) => {
        resolveReflection = resolve;
      }),
    );
    render(<BookmarkNostalgia cardVariants={{}} t={tMock} />);
    fireEvent.click(await screen.findByText("Generate Reflection"));
    await waitFor(() => expect(agent.globalChat).toHaveBeenCalled());
    const signal = agent.globalChat.mock.calls[0]?.[7];
    expect(signal).toBeInstanceOf(AbortSignal);

    fireEvent.click(screen.getByText("2022"));
    expect(signal?.aborted).toBe(true);
    resolveReflection({ text: "Obsolete reflection" });
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByText(/Obsolete reflection/)).toBeNull();
  });

  it("shows an error reflection when AI fails", async () => {
    dbMock.initDB.mockResolvedValue(
      makeDb([
        {
          id: "1",
          title: "BM One",
          tags: ["ai"],
          createdAt: "2023-06-15T10:00:00.000Z",
          content: "x",
          url: "u",
        },
      ]),
    );
    agent.globalChat.mockRejectedValue(new Error("ai down"));
    render(<BookmarkNostalgia cardVariants={{}} t={tMock} />);
    fireEvent.click(await screen.findByText("Generate Reflection"));
    expect(
      await screen.findByText(/The stars are quiet tonight/),
    ).toBeInTheDocument();
  });
});
