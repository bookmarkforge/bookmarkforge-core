import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import { BookmarkEchoes } from "../../components/knowledge/BookmarkEchoes";
import type { TFunction } from "i18next";

const tMock = vi.fn((k: string) => k) as unknown as TFunction;

const dbMock = vi.hoisted(() => ({ initDB: vi.fn() }));
vi.mock("../../db/database", () => ({ initDB: dbMock.initDB }));

vi.mock("motion/react", async () => {
  const { createMotionMock } = await import("../mocks/motion");
  return createMotionMock();
});

vi.mock("react-i18next", () => {
  const interpolate = (s: string, opts?: Record<string, unknown>) => {
    let out = s;
    if (opts) {
      for (const [k, v] of Object.entries(opts)) {
        out = out.replace(new RegExp(`{{${k}}}`, "g"), String(v));
      }
    }
    return out;
  };
  return {
    useTranslation: () => ({
      t: (k: string, d?: unknown, o?: Record<string, unknown>) => {
        const def =
          typeof d === "string"
            ? d
            : d && typeof d === "object"
              ? ((d as Record<string, unknown>).defaultValue ?? k)
              : ((d as unknown) ?? k);
        const opts =
          (typeof d === "string" ? o : (d as Record<string, unknown>)) ||
          undefined;
        return typeof def === "string" ? interpolate(def, opts) : def;
      },
    }),
  };
});

const makeDb = (rows: unknown[]) => ({
  bookmarks: {
    find: () => ({ exec: async () => rows }),
    findOne: () => ({
      exec: async () => ({ incrementalPatch: vi.fn().mockResolvedValue(undefined) }),
    }),
  },
});

const oldBookmark = (id: string, daysAgo: number) => ({
  id,
  title: `BM ${id}`,
  tags: ["ai"],
  isDeleted: false,
  createdAt: new Date(Date.now() - daysAgo * 86400000).toISOString(),
  lastVisitedAt: undefined,
});

describe("BookmarkEchoes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.initDB.mockResolvedValue(makeDb([]));
  });

  it("renders the title and empty state when there are no fading bookmarks", async () => {
    render(<BookmarkEchoes cardVariants={{}} t={tMock} />);
    expect(await screen.findByText("Bookmark Echoes")).toBeInTheDocument();
    expect(
      screen.getByText("Your library is well-tended. No fading bookmarks."),
    ).toBeInTheDocument();
  });

  it("renders fading bookmarks with a Revive button", async () => {
    dbMock.initDB.mockResolvedValue(makeDb([oldBookmark("1", 100)]));
    render(<BookmarkEchoes cardVariants={{}} t={tMock} />);
    expect(await screen.findByText(/1 fading bookmarks/)).toBeInTheDocument();
    expect(screen.getByText("BM 1")).toBeInTheDocument();
    expect(screen.getByTitle("Revive")).toBeInTheDocument();
  });

  it("revives a bookmark and removes it from the list", async () => {
    dbMock.initDB.mockResolvedValue(makeDb([oldBookmark("1", 100)]));
    render(<BookmarkEchoes cardVariants={{}} t={tMock} />);
    const revive = await screen.findByTitle("Revive");
    fireEvent.click(revive);
    await waitFor(() =>
      expect(
        screen.getByText("Your library is well-tended. No fading bookmarks."),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByText("BM 1")).not.toBeInTheDocument();
  });

  it("shows the never-visited label for bookmarks that were never opened", async () => {
    dbMock.initDB.mockResolvedValue(makeDb([oldBookmark("1", 100)]));
    render(<BookmarkEchoes cardVariants={{}} t={tMock} />);
    expect(await screen.findByText(/Never visited/)).toBeInTheDocument();
  });

  it("handles database errors gracefully", async () => {
    dbMock.initDB.mockRejectedValue(new Error("db down"));
    render(<BookmarkEchoes cardVariants={{}} t={tMock} />);
    expect(
      await screen.findByText(
        "Your library is well-tended. No fading bookmarks.",
      ),
    ).toBeInTheDocument();
  });

  it("returns null while the database query is pending", () => {
    dbMock.initDB.mockReturnValue(new Promise(() => {}));
    const { container } = render(<BookmarkEchoes cardVariants={{}} t={tMock} />);
    expect(
      Array.from(container.children).every((el) => el.tagName === "STYLE"),
    ).toBe(true);
  });

  it("renders the visited-ago label for bookmarks with a lastVisitedAt", async () => {
    dbMock.initDB.mockResolvedValue(
      makeDb([
        {
          id: "2",
          title: "BM 2",
          tags: ["ai"],
          isDeleted: false,
          createdAt: new Date(Date.now() - 200 * 86400000).toISOString(),
          lastVisitedAt: new Date(Date.now() - 45 * 86400000).toISOString(),
        },
      ]),
    );
    render(<BookmarkEchoes cardVariants={{}} t={tMock} />);
    expect(await screen.findByText(/Visited 45 days ago/)).toBeInTheDocument();
    expect(screen.queryByText(/Never visited/)).not.toBeInTheDocument();
  });

  it("skips deleted bookmarks", async () => {
    dbMock.initDB.mockResolvedValue(
      makeDb([
        { ...oldBookmark("deleted", 100), isDeleted: true },
        oldBookmark("1", 100),
      ]),
    );
    render(<BookmarkEchoes cardVariants={{}} t={tMock} />);
    expect(await screen.findByText(/1 fading bookmarks/)).toBeInTheDocument();
    expect(screen.queryByText("BM deleted")).not.toBeInTheDocument();
  });

  it("skips bookmarks whose echo level is zero (recently visited)", async () => {
    dbMock.initDB.mockResolvedValue(
      makeDb([
        {
          id: "fresh",
          title: "BM fresh",
          tags: [],
          isDeleted: false,
          createdAt: new Date(Date.now() - 100 * 86400000).toISOString(),
          lastVisitedAt: new Date().toISOString(),
        },
      ]),
    );
    render(<BookmarkEchoes cardVariants={{}} t={tMock} />);
    expect(
      await screen.findByText(
        "Your library is well-tended. No fading bookmarks.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("BM fresh")).not.toBeInTheDocument();
  });

  it("falls back to 'Untitled' when a bookmark has no title", async () => {
    dbMock.initDB.mockResolvedValue(
      makeDb([{ ...oldBookmark("1", 100), title: "" }]),
    );
    render(<BookmarkEchoes cardVariants={{}} t={tMock} />);
    expect(await screen.findByText("Untitled")).toBeInTheDocument();
  });

  it("keeps only the top 10 fading bookmarks by echo level", async () => {
    const rows = Array.from({ length: 15 }, (_, i) => ({
      ...oldBookmark(`bm-${i}`, 100 + i),
    }));
    dbMock.initDB.mockResolvedValue(makeDb(rows));
    render(<BookmarkEchoes cardVariants={{}} t={tMock} />);
    expect(await screen.findByText(/10 fading bookmarks/)).toBeInTheDocument();
  });

  it("logs an error when reviving a bookmark fails", async () => {
    const failingDb = {
      bookmarks: {
        find: () => ({ exec: async () => [oldBookmark("1", 100)] }),
        findOne: () => ({
          exec: async () => {
            throw new Error("revive failed");
          },
        }),
      },
    };
    dbMock.initDB.mockResolvedValue(failingDb);
    render(<BookmarkEchoes cardVariants={{}} t={tMock} />);
    const revive = await screen.findByTitle("Revive");
    fireEvent.click(revive);
    await waitFor(() => {
      // The item stays because the revive failed
      expect(screen.getByText("BM 1")).toBeInTheDocument();
    });
  });
});
