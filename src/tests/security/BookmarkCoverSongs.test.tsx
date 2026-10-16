import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import type { TFunction } from "i18next";
import { BookmarkCoverSongs } from "../../components/knowledge/BookmarkCoverSongs";

const dbMock = vi.hoisted(() => ({ initDB: vi.fn() }));
vi.mock("../../db/database", () => ({ initDB: dbMock.initDB }));

const agent = vi.hoisted(() => ({ generateText: vi.fn() }));
vi.mock("../../services/ai/ProviderManager", () => ({
  aiManager: agent,
}));

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

const t = ((k: string, d?: unknown) =>
  d && typeof d === "object"
    ? ((d as Record<string, unknown>).defaultValue ?? k)
    : ((d as unknown) ?? k)) as unknown as TFunction;

const bm = {
  id: "b1",
  title: "BM One",
  content: "Some content here",
  isDeleted: false,
};

describe("BookmarkCoverSongs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.initDB.mockResolvedValue({
      bookmarks: {
        find: () => ({
          sort: () => ({ limit: () => ({ exec: async () => [bm] }) }),
        }),
      },
    });
    agent.generateText.mockResolvedValue({ text: "Cover text here" });
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    });
  });

  it("renders bookmarks loaded from the database", async () => {
    render(<BookmarkCoverSongs cardVariants={{}} t={t} />);
    expect(await screen.findByText("BM One")).toBeInTheDocument();
    expect(screen.queryByText("No bookmarks found")).not.toBeInTheDocument();
  });

  it("shows a message when there are no bookmarks", async () => {
    dbMock.initDB.mockResolvedValue({
      bookmarks: {
        find: () => ({
          sort: () => ({ limit: () => ({ exec: async () => [] }) }),
        }),
      },
    });
    render(<BookmarkCoverSongs cardVariants={{}} t={t} />);
    expect(await screen.findByText("No bookmarks found")).toBeInTheDocument();
  });

  it("generates a creative cover for the selected bookmark", async () => {
    render(<BookmarkCoverSongs cardVariants={{}} t={t} />);
    const select = await screen.findByDisplayValue("Choose a bookmark...");
    fireEvent.change(select, { target: { value: "b1" } });
    fireEvent.click(screen.getByText("Generate Cover"));
    expect(await screen.findByText("Cover text here")).toBeInTheDocument();
    expect(agent.generateText).toHaveBeenCalled();
  });

  it("copies the generated cover to the clipboard", async () => {
    render(<BookmarkCoverSongs cardVariants={{}} t={t} />);
    const select = await screen.findByDisplayValue("Choose a bookmark...");
    fireEvent.change(select, { target: { value: "b1" } });
    fireEvent.click(screen.getByText("Generate Cover"));
    await screen.findByText("Cover text here");
    fireEvent.click(screen.getByTitle("Copy to clipboard"));
    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        "Cover text here",
      ),
    );
  });

  it("cancels and discards a generation when changing the style", async () => {
    let resolveGeneration!: (value: { text: string }) => void;
    let requestSignal: AbortSignal | undefined;
    agent.generateText.mockImplementation(
      (_prompt: string, _system?: string, options?: { signal?: AbortSignal }) => {
        requestSignal = options?.signal;
        return new Promise<{ text: string }>((resolve) => {
          resolveGeneration = resolve;
        });
      },
    );
    render(<BookmarkCoverSongs cardVariants={{}} t={t} />);
    const select = await screen.findByDisplayValue("Choose a bookmark...");
    fireEvent.change(select, { target: { value: "b1" } });
    fireEvent.click(screen.getByText("Generate Cover"));
    await waitFor(() => expect(agent.generateText).toHaveBeenCalled());

    fireEvent.click(screen.getByText("Poem"));
    expect(requestSignal?.aborted).toBe(true);

    resolveGeneration({ text: "Stale cover" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByText("Stale cover")).not.toBeInTheDocument();
    expect(screen.getByText("Generate Cover")).toBeInTheDocument();
  });

  it("shows an error message when generation fails", async () => {
    agent.generateText.mockRejectedValue(new Error("ai down"));
    render(<BookmarkCoverSongs cardVariants={{}} t={t} />);
    const select = await screen.findByDisplayValue("Choose a bookmark...");
    fireEvent.change(select, { target: { value: "b1" } });
    fireEvent.click(screen.getByText("Generate Cover"));
    expect(
      await screen.findByText("Failed to generate cover. Please try again."),
    ).toBeInTheDocument();
  });
});
