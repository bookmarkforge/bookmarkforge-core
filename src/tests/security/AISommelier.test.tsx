import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import React from "react";
import { AISommelier } from "../../components/knowledge/AISommelier";
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

// Components map docs via d.toJSON(), so mock docs must expose it.
const bookmarks = [
  { id: "b1", title: "BM One", tags: ["x"] },
  { id: "b2", title: "BM Two", tags: ["y"] },
].map((b) => ({ ...b, toJSON: () => b }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

/**
 * The <select> renders its placeholder before the bookmarks data-load
 * resolves; changing to a bookmark before its <option> exists makes
 * handleSelect early-return (bookmarks still []), which flakes the pairing
 * assertions under parallel suite load. Wait for the option first.
 */
async function selectBookmark(select: HTMLElement, value: string): Promise<void> {
  await waitFor(() => {
    expect(select.querySelector(`option[value="${value}"]`)).not.toBeNull();
  });
  fireEvent.change(select, { target: { value } });
}

describe("AISommelier", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    safeStorage.safeGet.mockReturnValue(undefined);
    dbMock.initDB.mockResolvedValue({
      bookmarks: {
        find: () => ({
          sort: () => ({ limit: () => ({ exec: async () => bookmarks }) }),
        }),
      },
    });
    agent.globalChat.mockResolvedValue({
      text: JSON.stringify([
        { title: "BM Two", reason: "complementary", tags: ["y"] },
      ]),
    });
  });

  it("shows the idle prompt before a bookmark is selected", async () => {
    render(<AISommelier cardVariants={{}} t={tMock} />);
    expect(await screen.findByText("BM One")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Select a bookmark from the dropdown to see contextual pairings.",
      ),
    ).toBeInTheDocument();
  });

  it("ignores a database result that resolves after unmount", async () => {
    const docs = deferred<typeof bookmarks>();
    dbMock.initDB.mockResolvedValue({
      bookmarks: {
        find: () => ({
          sort: () => ({ limit: () => ({ exec: () => docs.promise }) }),
        }),
      },
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { unmount } = render(<AISommelier cardVariants={{}} t={tMock} />);
    await waitFor(() => expect(dbMock.initDB).toHaveBeenCalled());
    unmount();
    docs.resolve(bookmarks);
    await act(async () => {
      await Promise.resolve();
    });
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("fetches pairings from the agent for a selected bookmark", async () => {
    render(<AISommelier cardVariants={{}} t={tMock} />);
    const select = await screen.findByDisplayValue("Select a bookmark...");
    await selectBookmark(select, "b1");
    // "BM Two" matches both the <option> and the pairing card, so anchor on
    // the reason text that is unique to the rendered pairing result.
    expect(await screen.findByText("complementary")).toBeInTheDocument();
    expect(screen.getAllByText("BM Two").length).toBeGreaterThanOrEqual(1);
    expect(agent.globalChat).toHaveBeenCalled();
    expect(safeStorage.safeSet).toHaveBeenCalled();
  });

  it("ignores a stale streaming result when the selected bookmark changes", async () => {
    let resolveFirst!: (value: unknown) => void;
    let resolveSecond!: (value: unknown) => void;
    agent.globalChat
      .mockReset()
      .mockImplementationOnce(
        () => new Promise((resolve) => { resolveFirst = resolve; }),
      )
      .mockImplementationOnce(
        () => new Promise((resolve) => { resolveSecond = resolve; }),
      );

    render(<AISommelier cardVariants={{}} t={tMock} />);
    const select = await screen.findByDisplayValue("Select a bookmark...");
    await selectBookmark(select, "b1");
    await waitFor(() => expect(agent.globalChat).toHaveBeenCalledTimes(1));
    const firstSignal = agent.globalChat.mock.calls[0]![7] as AbortSignal;

    await selectBookmark(select, "b2");
    await waitFor(() => expect(agent.globalChat).toHaveBeenCalledTimes(2));
    const secondSignal = agent.globalChat.mock.calls[1]![7] as AbortSignal;
    expect(firstSignal.aborted).toBe(true);
    expect(secondSignal.aborted).toBe(false);

    resolveFirst!({
      text: JSON.stringify([
        { title: "Stale Pairing", reason: "old", tags: [] },
      ]),
    });
    await Promise.resolve();
    expect(screen.queryByText("Stale Pairing")).toBeNull();

    resolveSecond!({
      text: JSON.stringify([
        { title: "Current Pairing", reason: "new", tags: [] },
      ]),
    });
    expect(await screen.findByText("Current Pairing")).toBeInTheDocument();
    expect(screen.queryByText("Stale Pairing")).toBeNull();
  });

  it("clears the active pairing state when the selection is cleared", async () => {
    render(<AISommelier cardVariants={{}} t={tMock} />);
    const select = await screen.findByDisplayValue("Select a bookmark...");
    await selectBookmark(select, "b1");
    await screen.findByText("complementary");
    fireEvent.change(select, { target: { value: "" } });
    expect(
      await screen.findByText(
        "Select a bookmark from the dropdown to see contextual pairings.",
      ),
    ).toBeInTheDocument();
  });

  it("uses cached pairings without calling the agent", async () => {
    safeStorage.safeGet.mockReturnValue(
      JSON.stringify([{ title: "Cached Pair", reason: "cached", tags: ["z"] }]),
    );
    render(<AISommelier cardVariants={{}} t={tMock} />);
    const select = await screen.findByDisplayValue("Select a bookmark...");
    await selectBookmark(select, "b1");
    expect(await screen.findByText("Cached Pair")).toBeInTheDocument();
    expect(agent.globalChat).not.toHaveBeenCalled();
  });

  it("refreshes by clearing the cache and refetching", async () => {
    render(<AISommelier cardVariants={{}} t={tMock} />);
    const select = await screen.findByDisplayValue("Select a bookmark...");
    await selectBookmark(select, "b1");
    await screen.findByText("complementary");
    fireEvent.click(screen.getByTitle("Refresh pairings"));
    await waitFor(() => expect(safeStorage.safeRemove).toHaveBeenCalled());
    expect(agent.globalChat).toHaveBeenCalledTimes(2);
  });

  it("shows an empty state when pairing generation fails", async () => {
    agent.globalChat.mockRejectedValue(new Error("agent down"));
    render(<AISommelier cardVariants={{}} t={tMock} />);
    const select = await screen.findByDisplayValue("Select a bookmark...");
    await selectBookmark(select, "b1");
    expect(
      await screen.findByText("No pairings found. Try another bookmark."),
    ).toBeInTheDocument();
  });
});
