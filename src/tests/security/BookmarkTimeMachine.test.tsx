import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import { BookmarkTimeMachine } from "../../components/knowledge/BookmarkTimeMachine";
import type { TFunction } from "i18next";

const tMock = vi.fn((k: string, d?: unknown) =>
  d && typeof d === "object"
    ? ((d as Record<string, unknown>).defaultValue ?? k)
    : ((d as unknown) ?? k),
) as unknown as TFunction;

const dbMock = vi.hoisted(() => ({ initDB: vi.fn() }));
vi.mock("../../db/database", () => ({ initDB: dbMock.initDB }));

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

describe("BookmarkTimeMachine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.initDB.mockResolvedValue(makeDb([]));
  });

  it("shows the empty state when there are no bookmarks", async () => {
    dbMock.initDB.mockRejectedValue(new Error("db down"));
    render(<BookmarkTimeMachine cardVariants={{}} t={tMock} />);
    expect(
      await screen.findByText(
        "No bookmarks yet. Your timeline will appear here.",
      ),
    ).toBeInTheDocument();
  });

  it("renders a timeline grouped by month", async () => {
    dbMock.initDB.mockResolvedValue(
      makeDb([
        {
          id: "1",
          title: "BM A",
          tags: ["x"],
          createdAt: "2023-01-15T00:00:00.000Z",
        },
        {
          id: "2",
          title: "BM B",
          tags: ["y"],
          createdAt: "2023-03-15T00:00:00.000Z",
        },
      ]),
    );
    render(<BookmarkTimeMachine cardVariants={{}} t={tMock} />);
    expect(await screen.findByText("Time Machine")).toBeInTheDocument();
    expect(screen.getAllByText(/2023/).length).toBeGreaterThan(0);
    expect(screen.queryByText("BM A")).not.toBeInTheDocument();
  });

  it("reveals a month's bookmarks when its pillar is selected", async () => {
    dbMock.initDB.mockResolvedValue(
      makeDb([
        {
          id: "1",
          title: "BM A",
          tags: ["x"],
          createdAt: "2023-01-15T00:00:00.000Z",
        },
      ]),
    );
    render(<BookmarkTimeMachine cardVariants={{}} t={tMock} />);
    fireEvent.click(await screen.findByText(/2023/));
    expect(await screen.findByText("BM A")).toBeInTheDocument();
  });

  it("handles database load failure gracefully", async () => {
    dbMock.initDB.mockRejectedValue(new Error("db down"));
    render(<BookmarkTimeMachine cardVariants={{}} t={tMock} />);
    expect(
      await screen.findByText(
        "No bookmarks yet. Your timeline will appear here.",
      ),
    ).toBeInTheDocument();
  });

  it("deselects month when clicked again", async () => {
    dbMock.initDB.mockResolvedValue(
      makeDb([
        {
          id: "1",
          title: "BM A",
          tags: [],
          createdAt: "2023-01-15T00:00:00.000Z",
        },
      ]),
    );
    render(<BookmarkTimeMachine cardVariants={{}} t={tMock} />);
    const monthEl = await screen.findByText(/2023/);
    fireEvent.click(monthEl);
    expect(await screen.findByText("BM A")).toBeInTheDocument();
    fireEvent.click(monthEl);
    await waitFor(() => {
      expect(screen.queryByText("BM A")).not.toBeInTheDocument();
    });
  });

  it("shows tags on the selected month's expanded view", async () => {
    dbMock.initDB.mockResolvedValue(
      makeDb([
        {
          id: "1",
          title: "Tagged BM",
          tags: ["react", "typescript"],
          createdAt: "2023-01-15T00:00:00.000Z",
        },
      ]),
    );
    render(<BookmarkTimeMachine cardVariants={{}} t={tMock} />);
    fireEvent.click(await screen.findByText(/2023/));
    expect(await screen.findByText("react")).toBeInTheDocument();
    expect(screen.getByText("typescript")).toBeInTheDocument();
  });

  it("uses URL as fallback when bookmark has no title", async () => {
    dbMock.initDB.mockResolvedValue(
      makeDb([
        {
          id: "1",
          title: "",
          url: "https://example.com",
          tags: [],
          createdAt: "2023-06-15T00:00:00.000Z",
        },
      ]),
    );
    render(<BookmarkTimeMachine cardVariants={{}} t={tMock} />);
    fireEvent.click(await screen.findByText(/2023/));
    expect(
      await screen.findByText("https://example.com"),
    ).toBeInTheDocument();
  });

  it("renders with 0 tags without crashing", async () => {
    dbMock.initDB.mockResolvedValue(
      makeDb([
        {
          id: "1",
          title: "No Tags",
          tags: [],
          createdAt: "2023-01-15T00:00:00.000Z",
        },
      ]),
    );
    render(<BookmarkTimeMachine cardVariants={{}} t={tMock} />);
    expect(await screen.findByText("Time Machine")).toBeInTheDocument();
  });

  it("shows the loading state while the database query is pending", () => {
    dbMock.initDB.mockReturnValue(new Promise(() => {}));
    render(<BookmarkTimeMachine cardVariants={{}} t={tMock} />);
    expect(
      screen.getByText("Loading timeline..."),
    ).toBeInTheDocument();
  });

  it("applies the small-count pillar color for 1-3 bookmarks", async () => {
    dbMock.initDB.mockResolvedValue(
      makeDb([
        {
          id: "1",
          title: "A",
          tags: [],
          createdAt: "2023-01-15T00:00:00.000Z",
        },
      ]),
    );
    const { container } = render(
      <BookmarkTimeMachine cardVariants={{}} t={tMock} />,
    );
    await screen.findByText(/2023/);
    expect(container.querySelector('[class*="bg-blue-500/10"]')).toBeTruthy();
  });

  it("applies the medium-count pillar color for 4-10 bookmarks", async () => {
    dbMock.initDB.mockResolvedValue(
      makeDb([
        {
          id: "1",
          title: "A",
          tags: [],
          createdAt: "2023-01-15T00:00:00.000Z",
        },
        {
          id: "2",
          title: "B",
          tags: [],
          createdAt: "2023-01-16T00:00:00.000Z",
        },
        {
          id: "3",
          title: "C",
          tags: [],
          createdAt: "2023-01-17T00:00:00.000Z",
        },
        {
          id: "4",
          title: "D",
          tags: [],
          createdAt: "2023-01-18T00:00:00.000Z",
        },
        {
          id: "5",
          title: "E",
          tags: [],
          createdAt: "2023-01-19T00:00:00.000Z",
        },
      ]),
    );
    const { container } = render(
      <BookmarkTimeMachine cardVariants={{}} t={tMock} />,
    );
    await screen.findByText(/2023/);
    expect(container.querySelector('[class*="bg-purple-500/10"]')).toBeTruthy();
  });

  it("applies the large-count pillar color for more than 10 bookmarks", async () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({
      id: `bm-${i}`,
      title: `BM ${i}`,
      tags: [],
      createdAt: "2023-01-15T00:00:00.000Z",
    }));
    dbMock.initDB.mockResolvedValue(makeDb(rows));
    const { container } = render(
      <BookmarkTimeMachine cardVariants={{}} t={tMock} />,
    );
    await screen.findByText(/2023/);
    expect(container.querySelector('[class*="bg-amber-500/10"]')).toBeTruthy();
  });

  it("ranks the top tags by frequency in the expanded view", async () => {
    dbMock.initDB.mockResolvedValue(
      makeDb([
        {
          id: "1",
          title: "A",
          tags: ["react", "js", "css", "html"],
          createdAt: "2023-01-15T00:00:00.000Z",
        },
        {
          id: "2",
          title: "B",
          tags: ["react", "js", "css"],
          createdAt: "2023-01-16T00:00:00.000Z",
        },
        {
          id: "3",
          title: "C",
          tags: ["react"],
          createdAt: "2023-01-17T00:00:00.000Z",
        },
      ]),
    );
    render(<BookmarkTimeMachine cardVariants={{}} t={tMock} />);
    // Expand the month
    fireEvent.click(await screen.findByText(/2023/));
    // react appears 3x, js 2x, css 2x — all three tags are in the top-3
    expect(await screen.findByText("react")).toBeInTheDocument();
    expect(screen.getByText("js")).toBeInTheDocument();
    expect(screen.getByText("css")).toBeInTheDocument();
    // The tag with the lowest frequency (html, count 1) is dropped from top 3
    expect(screen.queryByText("html")).not.toBeInTheDocument();
  });
});
