import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import { KnowledgeBasePublisher } from "../../components/knowledge/KnowledgeBasePublisher";
import type { TFunction } from "i18next";
import {
  MAX_AI_SOURCE_ITEMS,
  MAX_KNOWLEDGE_SCAN_ITEMS,
} from "../../utils/knowledgeCardBounds";

const tMock = vi.fn((k: string) => k) as unknown as TFunction;

const safeStorage = vi.hoisted(() => ({ safeGet: vi.fn(), safeSet: vi.fn() }));
vi.mock("../../store/safeStorage", () => ({
  safeGet: safeStorage.safeGet,
  safeSet: safeStorage.safeSet,
}));

const dbMock = vi.hoisted(() => ({ initDB: vi.fn() }));
vi.mock("../../db/database", () => ({ initDB: dbMock.initDB }));

const aiManager = vi.hoisted(() => ({ generateText: vi.fn() }));
vi.mock("../../services/ai/ProviderManager", () => ({ aiManager }));

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

const makeDb = (rows: unknown[]) => {
  const find = vi.fn(() => ({
    sort: vi.fn(() => ({
      limit: vi.fn(() => ({ exec: async () => rows })),
    })),
  }));
  return { bookmarks: { find } };
};

describe("KnowledgeBasePublisher", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    safeStorage.safeGet.mockReturnValue(undefined);
    dbMock.initDB.mockResolvedValue(makeDb([]));
  });

  it("renders collections computed from bookmarks", async () => {
    dbMock.initDB.mockResolvedValue(
      makeDb([
        { id: "1", title: "A", tags: ["ml"], content: "x" },
        { id: "2", title: "B", tags: ["ml", "ai"], content: "y" },
      ]),
    );
    render(<KnowledgeBasePublisher cardVariants={{}} t={tMock} />);
    expect(
      await screen.findByText("Knowledge Base Publisher"),
    ).toBeInTheDocument();
    // The header renders immediately; wait for the async bookmark load to
    // produce the computed collections before asserting on their content.
    expect(await screen.findByText("ml")).toBeInTheDocument();
    expect(screen.getAllByText(/bookmarks/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Publish").length).toBeGreaterThan(0);
  });

  it("shows no collections when the library is empty", async () => {
    render(<KnowledgeBasePublisher cardVariants={{}} t={tMock} />);
    expect(await screen.findByText("No collections found")).toBeInTheDocument();
  });

  it("bounds the collection scan and selected-tag source query", async () => {
    const db = makeDb([{ id: "1", title: "A", tags: ["ml"], content: "x" }]);
    dbMock.initDB.mockResolvedValue(db);
    aiManager.generateText.mockResolvedValue({ text: "<p>page</p>" });
    render(<KnowledgeBasePublisher cardVariants={{}} t={tMock} />);
    const publish = await screen.findByText("Publish");
    expect(db.bookmarks.find).toHaveBeenNthCalledWith(1, {
      selector: { isDeleted: false, isPrivate: false },
    });
    expect(db.bookmarks.find.mock.results[0]?.value.sort).toHaveBeenCalledWith({
      updatedAt: "desc",
    });
    expect(
      db.bookmarks.find.mock.results[0]?.value.sort.mock.results[0]?.value.limit,
    ).toHaveBeenCalledWith(MAX_KNOWLEDGE_SCAN_ITEMS);
    fireEvent.click(publish);
    await waitFor(() => expect(aiManager.generateText).toHaveBeenCalled());
    expect(db.bookmarks.find).toHaveBeenNthCalledWith(2, {
      selector: {
        isDeleted: false,
        isPrivate: false,
        tags: { $elemMatch: { $eq: "ml" } },
      },
    });
    expect(db.bookmarks.find.mock.results[1]?.value.sort).toHaveBeenCalledWith({
      updatedAt: "desc",
    });
    expect(
      db.bookmarks.find.mock.results[1]?.value.sort.mock.results[0]?.value.limit,
    ).toHaveBeenCalledWith(MAX_AI_SOURCE_ITEMS);
  });

  it("publishes a collection via AI generating HTML", async () => {
    dbMock.initDB.mockResolvedValue(
      makeDb([
        { id: "1", title: "A", tags: ["ml"], content: "x", summary: "s" },
      ]),
    );
    aiManager.generateText.mockResolvedValue({ text: "<html>page</html>" });
    render(<KnowledgeBasePublisher cardVariants={{}} t={tMock} />);
    fireEvent.click(await screen.findByText("Publish"));
    expect(await screen.findByText("Published")).toBeInTheDocument();
    expect(safeStorage.safeSet).toHaveBeenCalledWith(
      "bookmarkforge_published_sites",
      expect.any(String),
    );
    expect(aiManager.generateText).toHaveBeenCalled();
  });

  it("handles publish failure gracefully", async () => {
    dbMock.initDB.mockResolvedValue(
      makeDb([{ id: "1", title: "A", tags: ["ml"], content: "x" }]),
    );
    aiManager.generateText.mockRejectedValue(new Error("ai down"));
    render(<KnowledgeBasePublisher cardVariants={{}} t={tMock} />);
    fireEvent.click(await screen.findByText("Publish"));
    await waitFor(() => expect(aiManager.generateText).toHaveBeenCalled());
    expect(screen.queryByText("Published")).not.toBeInTheDocument();
  });

  it("loads previously published sites from storage", async () => {
    safeStorage.safeGet.mockReturnValue(
      JSON.stringify([
        { tag: "ml", html: "<p>x</p>", publishedAt: new Date().toISOString() },
      ]),
    );
    render(<KnowledgeBasePublisher cardVariants={{}} t={tMock} />);
    expect(await screen.findByText("Previously Published")).toBeInTheDocument();
    expect(screen.getByText("ml")).toBeInTheDocument();
  });

  it("renders AI-generated preview inside a sandboxed iframe", async () => {
    dbMock.initDB.mockResolvedValue(
      makeDb([
        { id: "1", title: "A", tags: ["ml"], content: "x", summary: "s" },
      ]),
    );
    aiManager.generateText.mockResolvedValue({ text: "<p>safe</p>" });
    render(<KnowledgeBasePublisher cardVariants={{}} t={tMock} />);
    fireEvent.click(await screen.findByText("Publish"));
    expect(await screen.findByText("Published")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Preview"));
    const iframe = await screen.findByTitle("Preview");
    expect(iframe).toBeInTheDocument();
    expect(iframe).toHaveAttribute("sandbox");
    expect(iframe).toHaveAttribute("srcDoc", "<p>safe</p>");
  });

  it("does not persist a previous tag after publishing switches", async () => {
    dbMock.initDB.mockResolvedValue(
      makeDb([
        { id: "1", title: "A", tags: ["ml"], content: "x" },
        { id: "2", title: "B", tags: ["ai"], content: "y" },
      ]),
    );
    let resolvePending!: (value: { text: string }) => void;
    const pending = new Promise<{ text: string }>((resolve) => {
      resolvePending = resolve;
    });
    aiManager.generateText
      .mockReturnValueOnce(pending)
      .mockImplementationOnce(() => new Promise(() => {}));

    render(<KnowledgeBasePublisher cardVariants={{}} t={tMock} />);
    const publishButtons = await screen.findAllByText("Publish");
    fireEvent.click(publishButtons[0]!);
    await waitFor(() => expect(aiManager.generateText).toHaveBeenCalled());
    const signal = aiManager.generateText.mock.calls[0]![2].signal as AbortSignal;

    fireEvent.click(publishButtons[1]!);
    expect(signal.aborted).toBe(true);
    resolvePending({ text: "<p>stale</p>" });

    await waitFor(() => expect(aiManager.generateText).toHaveBeenCalledTimes(2));
    expect(screen.queryByText("Published")).not.toBeInTheDocument();
    expect(safeStorage.safeSet).not.toHaveBeenCalled();
  });
});
