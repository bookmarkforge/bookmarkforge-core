import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import { BookmarkFusion } from "../../components/knowledge/BookmarkFusion";

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
    const t = (k: string, d?: unknown, o?: Record<string, unknown>) => {
      const def =
        d && typeof d === "object"
          ? (d as Record<string, unknown>).defaultValue
          : (d as string | undefined);
      let out: any = def ?? k;
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

interface Bm {
  id: string;
  title: string;
  tags: string[];
  createdAt: string;
  content: string;
  url: string;
}

const makeRows = (): Bm[] => [
  {
    id: "1",
    title: "BM One",
    tags: ["a"],
    createdAt: "2023-01-01T00:00:00.000Z",
    content: "c1",
    url: "u1",
  },
  {
    id: "2",
    title: "BM Two",
    tags: ["b"],
    createdAt: "2023-02-01T00:00:00.000Z",
    content: "c2",
    url: "u2",
  },
  {
    id: "3",
    title: "BM Three",
    tags: ["c"],
    createdAt: "2023-03-01T00:00:00.000Z",
    content: "c3",
    url: "u3",
  },
];

const makeDb = (rows: unknown[]) => ({
  bookmarks: { find: () => ({ exec: async () => rows }) },
});

describe("BookmarkFusion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.initDB.mockResolvedValue(makeDb(makeRows()));
  });

  it("loads bookmarks and shows the fuse button disabled until 2 are selected", async () => {
    render(<BookmarkFusion cardVariants={{}} />);
    const fuse = await screen.findByText("Fuse Selected (0)");
    expect(fuse).toBeDisabled();
    // Bookmark cards load asynchronously — the fuse button (initial state)
    // can appear before them, so await the cards themselves.
    expect(await screen.findByLabelText("BM One")).toBeInTheDocument();
    expect(await screen.findByLabelText("BM Two")).toBeInTheDocument();
  });

  it("fuses two selected bookmarks via AI and shows the result", async () => {
    aiManager.generateText.mockResolvedValue({ text: "Fused insight" });
    render(<BookmarkFusion cardVariants={{}} />);
    await screen.findByText("Fuse Selected (0)");
    fireEvent.click(await screen.findByLabelText("BM One"));
    fireEvent.click(await screen.findByLabelText("BM Two"));
    const fuse = await screen.findByText("Fuse Selected (2)");
    expect(fuse).toBeEnabled();
    fireEvent.click(fuse);
    expect(await screen.findByText("Fusion Result")).toBeInTheDocument();
    expect(screen.getByText("Fused insight")).toBeInTheDocument();
    expect(aiManager.generateText).toHaveBeenCalled();
  });

  it("does not call AI when fewer than 2 bookmarks are selected", async () => {
    render(<BookmarkFusion cardVariants={{}} />);
    await screen.findByText("Fuse Selected (0)");
    fireEvent.click(await screen.findByLabelText("BM One"));
    const fuse = await screen.findByText("Fuse Selected (1)");
    expect(fuse).toBeDisabled();
    expect(aiManager.generateText).not.toHaveBeenCalled();
  });

  it("shows an error when AI fusion fails", async () => {
    aiManager.generateText.mockRejectedValue(new Error("ai down"));
    render(<BookmarkFusion cardVariants={{}} />);
    await screen.findByText("Fuse Selected (0)");
    fireEvent.click(await screen.findByLabelText("BM One"));
    fireEvent.click(await screen.findByLabelText("BM Two"));
    fireEvent.click(await screen.findByText("Fuse Selected (2)"));
    expect(
      await screen.findByText("Failed to fuse bookmarks. Please try again."),
    ).toBeInTheDocument();
  });
});
