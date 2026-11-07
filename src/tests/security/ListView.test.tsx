import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { act } from "react";
import React from "react";
import ListView from "../../components/list/ListView";

const dbMock = vi.hoisted(() => ({ initDB: vi.fn() }));
vi.mock("../../db/database", () => ({ initDB: dbMock.initDB }));

const logger = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock("../../utils/logger", () => ({ logger }));

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
    i18n: { language: "en" },
  }),
}));

const docs = [
  {
    id: "d1",
    title: "Doc One",
    textContent: "excerpt doc one",
    tags: ["a", "b"],
    updatedAt: "2024-01-02T00:00:00Z",
  },
  {
    id: "d2",
    title: "Doc Two",
    textContent: "excerpt doc two",
    tags: ["c"],
    updatedAt: "2024-01-01T00:00:00Z",
  },
  {
    id: "deleted-doc",
    title: "Deleted Doc",
    textContent: "must stay hidden",
    tags: [],
    isDeleted: true,
    updatedAt: "2024-01-04T00:00:00Z",
  },
];
const bookmarks = [
  {
    id: "b1",
    title: "Bookmark One",
    url: "https://example.com",
    tags: ["x"],
    updatedAt: "2024-01-03T00:00:00Z",
  },
];

const makeDb = (d: unknown[], b: unknown[]) => ({
  documents: { find: () => ({ exec: async () => d }) },
  bookmarks: { find: () => ({ exec: async () => b }) },
});

describe("ListView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.initDB.mockResolvedValue(makeDb(docs, bookmarks));
  });

  it("loads and renders documents and bookmarks sorted by date", async () => {
    render(<ListView />);
    expect(await screen.findByText("Doc One")).toBeInTheDocument();
    expect(screen.getByText("Doc Two")).toBeInTheDocument();
    expect(screen.getByText("Bookmark One")).toBeInTheDocument();
    expect(screen.getByText("3 items")).toBeInTheDocument();
    expect(screen.queryByText("Deleted Doc")).not.toBeInTheDocument();
  });

  it("ignores the load that finishes after unmount", async () => {
    let resolveInit!: (db: unknown) => void;
    dbMock.initDB.mockImplementationOnce(
      () => new Promise((resolve) => { resolveInit = resolve; }),
    );
    const { unmount } = render(<ListView />);
    await act(async () => { await Promise.resolve(); });

    unmount();
    await act(async () => {
      resolveInit(makeDb(docs, bookmarks));
    });

    expect(logger.error).not.toHaveBeenCalled();
  });

  it("filters to documents only when the Documents tab is clicked", async () => {
    render(<ListView />);
    await screen.findByText("Doc One");
    fireEvent.click(screen.getByRole("tab", { name: "Documents" }));
    expect(screen.getByText("Doc One")).toBeInTheDocument();
    expect(screen.getByText("Doc Two")).toBeInTheDocument();
    expect(screen.queryByText("Bookmark One")).not.toBeInTheDocument();
  });

  it("filters items by the search query", async () => {
    render(<ListView />);
    await screen.findByText("Doc One");
    fireEvent.change(screen.getByLabelText("Search"), {
      target: { value: "Doc Two" },
    });
    expect(screen.getByText("Doc Two")).toBeInTheDocument();
    expect(screen.queryByText("Doc One")).not.toBeInTheDocument();
    expect(screen.queryByText("Bookmark One")).not.toBeInTheDocument();
  });

  it("shows an empty state when there are no items", async () => {
    dbMock.initDB.mockResolvedValue(makeDb([], []));
    render(<ListView />);
    expect(await screen.findByText("No items yet")).toBeInTheDocument();
  });

  it("logs an error and shows the empty state when loading fails", async () => {
    dbMock.initDB.mockRejectedValue(new Error("db down"));
    render(<ListView />);
    await waitFor(() => expect(logger.error).toHaveBeenCalled());
    expect(screen.getByText("No items yet")).toBeInTheDocument();
  });
});
