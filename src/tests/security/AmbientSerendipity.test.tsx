import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import type { TFunction } from "i18next";
import { AmbientSerendipity } from "../../components/knowledge/AmbientSerendipity";

const dbMock = vi.hoisted(() => ({ initDB: vi.fn() }));
vi.mock("../../db/database", () => ({ initDB: dbMock.initDB }));

const t = ((k: string): string => k) as unknown as TFunction;

const agent = vi.hoisted(() => ({ globalChat: vi.fn() }));
vi.mock("../../services/ai/AgentService", () => ({ agentService: agent }));

vi.mock("motion/react", async () => {
  const { createMotionMock } = await import("../mocks/motion");
  return createMotionMock();
});

vi.mock("react-i18next", () => ({
  useTranslation: () => {
    const t = (k: string, d?: unknown, o?: Record<string, unknown>) => {
      const def =
        d && typeof d === "object"
          ? (d as Record<string, unknown>).defaultValue
          : (d as string | undefined);          let out = String(def ?? k);
      if (o) {
        for (const [key, value] of Object.entries(o)) {
          out = out.replace(new RegExp(`{{${key}}}`, "g"), String(value));
          out = out.replace(new RegExp(`{${key}}`, "g"), String(value));
        }
      }
      return out;
    };
    return { t, i18n: { language: "en" } };
  },
}));

const daysAgo = (n: number) =>
  new Date(Date.now() - n * 86400000).toISOString();

const makeRow = (over: Record<string, unknown> = {}) => ({
  id: "b1",
  title: "Old Bookmark",
  tags: ["ai"],
  createdAt: daysAgo(60),
  ...over,
  toJSON: function () {
    const { toJSON, ...rest } = this as Record<string, unknown>;
    return rest;
  },
});

const makeDb = (rows: unknown[]) => ({
  bookmarks: { find: () => ({ exec: async () => rows }) },
});

describe("AmbientSerendipity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.initDB.mockResolvedValue(makeDb([]));
  });

  it("ignores the initial database result after unmount", async () => {
    let resolveRows!: (rows: unknown[]) => void;
    const rowsPromise = new Promise<unknown[]>((resolve) => {
      resolveRows = resolve;
    });
    dbMock.initDB.mockResolvedValue({
      bookmarks: { find: () => ({ exec: () => rowsPromise }) },
    });
    const { unmount } = render(
      <AmbientSerendipity cardVariants={{}} t={t} />,
    );
    await waitFor(() => expect(dbMock.initDB).toHaveBeenCalled());
    unmount();

    await act(async () => {
      resolveRows([makeRow({ lastVisitedAt: undefined })]);
      await rowsPromise;
    });
    expect(screen.queryByText("Ambient Serendipity")).not.toBeInTheDocument();
    expect(agent.globalChat).not.toHaveBeenCalled();
  });

  it("shows the empty state when no bookmarks are forgotten", async () => {
    dbMock.initDB.mockResolvedValue(
      makeDb([makeRow({ createdAt: daysAgo(2), lastVisitedAt: daysAgo(1) })]),
    );
    render(<AmbientSerendipity cardVariants={{}} t={t} />);
    expect(
      await screen.findByText(
        "No forgotten bookmarks yet. Save more bookmarks and come back later.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Start Serendipity")).toBeDisabled();
  });

  it("renders forgotten bookmarks in the idle state", async () => {
    dbMock.initDB.mockResolvedValue(
      makeDb([makeRow({ lastVisitedAt: undefined })]),
    );
    render(<AmbientSerendipity cardVariants={{}} t={t} />);
    expect(
      await screen.findByText(
        "1 forgotten bookmarks waiting to be rediscovered",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Start Serendipity")).toBeEnabled();
  });

  it("generates AI context when started", async () => {
    dbMock.initDB.mockResolvedValue(
      makeDb([makeRow({ lastVisitedAt: undefined })]),
    );
    agent.globalChat.mockResolvedValue({
      text: "Revisit this for fresh insight.",
    });
    render(<AmbientSerendipity cardVariants={{}} t={t} />);
    await screen.findByText("1 forgotten bookmarks waiting to be rediscovered");
    fireEvent.click(screen.getByText("Start Serendipity"));
    expect(
      await screen.findByText(/Revisit this for fresh insight/),
    ).toBeInTheDocument();
    expect(screen.getByText("Why this matters now:")).toBeInTheDocument();
    expect(agent.globalChat).toHaveBeenCalled();
  });

  it("reuses cached context without calling the agent again", async () => {
    dbMock.initDB.mockResolvedValue(
      makeDb([makeRow({ lastVisitedAt: undefined })]),
    );
    agent.globalChat.mockResolvedValue({ text: "Cached insight text" });
    render(<AmbientSerendipity cardVariants={{}} t={t} />);
    await screen.findByText("1 forgotten bookmarks waiting to be rediscovered");
    fireEvent.click(screen.getByText("Start Serendipity"));
    expect(await screen.findByText(/Cached insight text/)).toBeInTheDocument();
    expect(agent.globalChat).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText("Stop Serendipity"));
    fireEvent.click(screen.getByText("Start Serendipity"));
    await waitFor(() => expect(agent.globalChat).toHaveBeenCalledTimes(1));
  });

  it("streams tokens en vivo via onChunk en el contexto", async () => {
    dbMock.initDB.mockResolvedValue(
      makeDb([makeRow({ lastVisitedAt: undefined })]),
    );
    agent.globalChat.mockImplementation(
      (_p: string, _l?: string, _pr?: boolean, _s?: string, onChunk?: (c: string) => void) => {
        onChunk?.("Un dato ");
        onChunk?.("nuevo");
        return Promise.resolve({ text: "Un dato nuevo" });
      },
    );
    render(<AmbientSerendipity cardVariants={{}} t={t} />);
    await screen.findByText("1 forgotten bookmarks waiting to be rediscovered");
    fireEvent.click(screen.getByText("Start Serendipity"));
    expect(await screen.findByText(/Un dato nuevo/)).toBeInTheDocument();
    expect(agent.globalChat).toHaveBeenCalledWith(
      expect.any(String),
      undefined,
      false,
      undefined,
      expect.any(Function),
      undefined,
      undefined,
      expect.any(AbortSignal),
    );
  });

  it("aborts stale context when the ambient bookmark changes", async () => {
    const first = makeRow({ id: "b1", title: "First Bookmark" });
    const second = makeRow({ id: "b2", title: "Second Bookmark" });
    dbMock.initDB.mockResolvedValue(makeDb([first, second]));
    const resolvers: Array<(value: { text: string }) => void> = [];
    agent.globalChat.mockImplementation(
      (
        _prompt: string,
        _lang?: string,
        _private?: boolean,
        _sessionId?: string,
        _onChunk?: (chunk: string) => void,
      ) =>
        new Promise<{ text: string }>((resolve) => {
          resolvers.push(resolve);
        }),
    );
    render(<AmbientSerendipity cardVariants={{}} t={t} />);
    await screen.findByText("2 forgotten bookmarks waiting to be rediscovered");
    fireEvent.click(screen.getByText("Start Serendipity"));
    await waitFor(() => expect(agent.globalChat).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(agent.globalChat).toHaveBeenCalledTimes(2));
    expect((agent.globalChat.mock.calls[0]![7] as AbortSignal).aborted).toBe(true);

    const firstOnChunk = agent.globalChat.mock.calls[0]![4] as (chunk: string) => void;
    const secondOnChunk = agent.globalChat.mock.calls[1]![4] as (chunk: string) => void;
    await act(async () => {
      firstOnChunk("Stale");
      secondOnChunk("Current");
    });
    expect(await screen.findByText(/Current/)).toBeInTheDocument();
    expect(screen.queryByText(/Stale/)).not.toBeInTheDocument();

    await act(async () => {
      resolvers[0]!({ text: "Stale result" });
      resolvers[1]!({ text: "Current result" });
    });
    await waitFor(() => expect(screen.getByText(/Current result/)).toBeInTheDocument());
  });

  it("handles AI context failure gracefully", async () => {
    dbMock.initDB.mockResolvedValue(
      makeDb([makeRow({ lastVisitedAt: undefined })]),
    );
    agent.globalChat.mockRejectedValue(new Error("ai down"));
    render(<AmbientSerendipity cardVariants={{}} t={t} />);
    await screen.findByText("1 forgotten bookmarks waiting to be rediscovered");
    fireEvent.click(screen.getByText("Start Serendipity"));
    expect(
      await screen.findByText("Unable to generate context at this time."),
    ).toBeInTheDocument();
  });
});
