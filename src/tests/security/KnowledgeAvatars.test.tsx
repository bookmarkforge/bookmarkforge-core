import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import { KnowledgeAvatars } from "../../components/knowledge/KnowledgeAvatars";
import type { TFunction } from "i18next";

const tMock = vi.fn((k: string) => k) as unknown as TFunction;

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

describe("KnowledgeAvatars", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis.crypto as unknown as { randomUUID: () => string }).randomUUID =
      vi.fn(() => "avatar-uuid-1");
    Element.prototype.scrollIntoView = vi.fn();
    safeStorage.safeGet.mockReturnValue(undefined);
    dbMock.initDB.mockResolvedValue({
      bookmarks: { find: () => ({ exec: async () => [] }) },
    });
  });

  it("ignores bookmarks that load after unmount", async () => {
    let resolveDocs!: (docs: unknown[]) => void;
    const docsPromise = new Promise<unknown[]>((resolve) => {
      resolveDocs = resolve;
    });
    dbMock.initDB.mockResolvedValue({
      bookmarks: { find: () => ({ exec: () => docsPromise }) },
    });
    const { unmount } = render(
      <KnowledgeAvatars cardVariants={{}} t={tMock} />,
    );
    await waitFor(() => expect(dbMock.initDB).toHaveBeenCalled());
    unmount();

    await act(async () => {
      resolveDocs([]);
      await docsPromise;
    });
    expect(screen.queryByText("Knowledge Avatars")).not.toBeInTheDocument();
  });

  it("renders the empty state with a create prompt", async () => {
    render(<KnowledgeAvatars cardVariants={{}} t={tMock} />);
    expect(await screen.findByText("Knowledge Avatars")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Create AI personas that answer questions strictly from your bookmarked knowledge.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Create Your First Avatar")).toBeInTheDocument();
  });

  it("creates a new avatar", async () => {
    render(<KnowledgeAvatars cardVariants={{}} t={tMock} />);
    fireEvent.click(await screen.findByText("Create Your First Avatar"));
    fireEvent.change(screen.getByLabelText("Avatar name"), {
      target: { value: "Rust Expert" },
    });
    fireEvent.change(screen.getByLabelText("Avatar topic"), {
      target: { value: "rust" },
    });
    fireEvent.click(screen.getByText("Save Avatar"));
    expect(await screen.findByText("Rust Expert")).toBeInTheDocument();
    expect(safeStorage.safeSet).toHaveBeenCalledWith(
      "bookmarkforge_knowledge_avatars",
      expect.any(String),
    );
  });

  it("selects an avatar and sends a chat message via AI", async () => {
    safeStorage.safeGet.mockImplementation((k: string) =>
      k === "bookmarkforge_knowledge_avatars"
        ? JSON.stringify([
            {
              id: "a1",
              name: "ML Guide",
              topic: "ml",
              createdAt: new Date().toISOString(),
            },
          ])
        : undefined,
    );
    dbMock.initDB.mockResolvedValue({
      bookmarks: {
        find: () => ({
          exec: async () => [{ title: "ML Book", tags: ["ml"], content: "x" }],
        }),
      },
    });
    agent.globalChat.mockResolvedValue({ text: "The answer is 42." });
    render(<KnowledgeAvatars cardVariants={{}} t={tMock} />);
    fireEvent.click(await screen.findByText("ML Guide"));
    const input = await screen.findByLabelText("Chat input");
    fireEvent.change(input, { target: { value: "What is ML?" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(await screen.findByText("The answer is 42.")).toBeInTheDocument();
    expect(agent.globalChat).toHaveBeenCalled();
  });

  it("streams tokens en vivo via onChunk en el chat", async () => {
    safeStorage.safeGet.mockImplementation((k: string) =>
      k === "bookmarkforge_knowledge_avatars"
        ? JSON.stringify([
            {
              id: "a1",
              name: "ML Guide",
              topic: "ml",
              createdAt: new Date().toISOString(),
            },
          ])
        : undefined,
    );
    agent.globalChat.mockImplementation(
      (_p: string, _l?: string, _pr?: boolean, _s?: string, onChunk?: (c: string) => void) => {
        onChunk?.("Pienso ");
        onChunk?.("en vivo");
        return Promise.resolve({ text: "Pienso en vivo" });
      },
    );
    render(<KnowledgeAvatars cardVariants={{}} t={tMock} />);
    fireEvent.click(await screen.findByText("ML Guide"));
    const input = await screen.findByLabelText("Chat input");
    fireEvent.change(input, { target: { value: "Que es ML?" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(await screen.findByText("Pienso en vivo")).toBeInTheDocument();
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

  it("ignores a reply when switching avatars during streaming", async () => {
    safeStorage.safeGet.mockImplementation((k: string) =>
      k === "bookmarkforge_knowledge_avatars"
        ? JSON.stringify([
            {
              id: "a1",
              name: "ML Guide",
              topic: "ml",
              createdAt: new Date().toISOString(),
            },
            {
              id: "a2",
              name: "Rust Expert",
              topic: "rust",
              createdAt: new Date().toISOString(),
            },
          ])
        : undefined,
    );
    let resolveReply!: (value: { text: string }) => void;
    agent.globalChat.mockImplementation(
      (
        _prompt: string,
        _lang?: string,
        _private?: boolean,
        _sessionId?: string,
        _onChunk?: (chunk: string) => void,
      ) =>
        new Promise<{ text: string }>((resolve) => {
          resolveReply = resolve;
        }),
    );
    render(<KnowledgeAvatars cardVariants={{}} t={tMock} />);
    fireEvent.click(await screen.findByText("ML Guide"));
    const input = await screen.findByLabelText("Chat input");
    fireEvent.change(input, { target: { value: "What is ML?" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(agent.globalChat).toHaveBeenCalledTimes(1));

    const signal = agent.globalChat.mock.calls[0]![7] as AbortSignal;
    const onChunk = agent.globalChat.mock.calls[0]![4] as (chunk: string) => void;
    fireEvent.click(screen.getByText("Rust Expert"));
    expect(signal.aborted).toBe(true);

    await act(async () => {
      onChunk("Stale reply");
      resolveReply({ text: "Stale final reply" });
      await Promise.resolve();
    });
    expect(screen.queryByText(/Stale/)).not.toBeInTheDocument();
    expect(screen.getByText("Rust Expert")).toBeInTheDocument();
  });

  it("handles chat send failure gracefully", async () => {
    safeStorage.safeGet.mockImplementation((k: string) =>
      k === "bookmarkforge_knowledge_avatars"
        ? JSON.stringify([
            {
              id: "a1",
              name: "ML Guide",
              topic: "ml",
              createdAt: new Date().toISOString(),
            },
          ])
        : undefined,
    );
    agent.globalChat.mockRejectedValue(new Error("ai down"));
    render(<KnowledgeAvatars cardVariants={{}} t={tMock} />);
    fireEvent.click(await screen.findByText("ML Guide"));
    const input = await screen.findByLabelText("Chat input");
    fireEvent.change(input, { target: { value: "What is ML?" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(
      await screen.findByText("An error occurred. Please try again."),
    ).toBeInTheDocument();
  });

  it("deletes an avatar", async () => {
    safeStorage.safeGet.mockImplementation((k: string) =>
      k === "bookmarkforge_knowledge_avatars"
        ? JSON.stringify([
            {
              id: "a1",
              name: "ML Guide",
              topic: "ml",
              createdAt: new Date().toISOString(),
            },
          ])
        : undefined,
    );
    render(<KnowledgeAvatars cardVariants={{}} t={tMock} />);
    expect(await screen.findByText("ML Guide")).toBeInTheDocument();
    const buttons = screen.getAllByRole("button");
    fireEvent.click(buttons[buttons.length - 1]!);
    expect(screen.queryByText("ML Guide")).not.toBeInTheDocument();
    expect(safeStorage.safeRemove).toHaveBeenCalled();
  });
});
