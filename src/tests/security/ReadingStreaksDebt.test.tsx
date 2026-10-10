import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { ReadingStreaksDebt } from "../../components/knowledge/ReadingStreaksDebt";
import type { TFunction } from "i18next";

const tMock = vi.fn((k: string) => k) as unknown as TFunction;

const dbMock = vi.hoisted(() => ({ initDB: vi.fn() }));
vi.mock("../../db/database", () => ({ initDB: dbMock.initDB }));

const safeStorage = vi.hoisted(() => ({ safeGet: vi.fn(), safeSet: vi.fn() }));
vi.mock("../../store/safeStorage", () => ({
  safeGet: safeStorage.safeGet,
  safeSet: safeStorage.safeSet,
}));

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

const dayAgo = (n: number) => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return d.toISOString();
};

const makeDb = (rows: unknown[]) => ({
  bookmarks: { find: () => ({ exec: async () => rows }) },
});

describe("ReadingStreaksDebt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    safeStorage.safeGet.mockReturnValue(null);
    dbMock.initDB.mockResolvedValue(makeDb([]));
  });

  it("renders the title with a zero streak when there are no bookmarks", async () => {
    render(<ReadingStreaksDebt cardVariants={{}} t={tMock} />);
    expect(await screen.findByText("Reading Streaks")).toBeInTheDocument();
    expect(screen.getByText("Current streak: 0 days")).toBeInTheDocument();
    expect(screen.getByText("Longest: 0 days")).toBeInTheDocument();
  });

  it("computes the current streak, progress and knowledge debt", async () => {
    dbMock.initDB.mockResolvedValue(
      makeDb([
        {
          id: "1",
          createdAt: dayAgo(0),
          lastVisitedAt: undefined,
          isDeleted: false,
        },
        {
          id: "2",
          createdAt: dayAgo(1),
          lastVisitedAt: undefined,
          isDeleted: false,
        },
      ]),
    );
    render(<ReadingStreaksDebt cardVariants={{}} t={tMock} />);
    expect(
      await screen.findByText("Current streak: 2 days"),
    ).toBeInTheDocument();
    expect(screen.getByText("Longest: 2 days")).toBeInTheDocument();
    expect(screen.getByText("0%")).toBeInTheDocument();
    expect(
      screen.getByText("2 unread (~1 days to catch up)"),
    ).toBeInTheDocument();
  });

  it("persists the longest streak via safeSet", async () => {
    safeStorage.safeGet.mockReturnValue("0");
    dbMock.initDB.mockResolvedValue(
      makeDb([
        {
          id: "1",
          createdAt: dayAgo(0),
          lastVisitedAt: undefined,
          isDeleted: false,
        },
        {
          id: "2",
          createdAt: dayAgo(1),
          lastVisitedAt: undefined,
          isDeleted: false,
        },
        {
          id: "3",
          createdAt: dayAgo(2),
          lastVisitedAt: undefined,
          isDeleted: false,
        },
      ]),
    );
    render(<ReadingStreaksDebt cardVariants={{}} t={tMock} />);
    await screen.findByText("Current streak: 3 days");
    expect(safeStorage.safeSet).toHaveBeenCalledWith(
      "bookmarkforge_longest_streak",
      "3",
    );
    expect(safeStorage.safeSet).toHaveBeenCalledWith(
      "bookmarkforge_current_streak",
      "3",
    );
  });

  it("handles database errors gracefully", async () => {
    dbMock.initDB.mockRejectedValue(new Error("db down"));
    render(<ReadingStreaksDebt cardVariants={{}} t={tMock} />);
    expect(await screen.findByText("Reading Streaks")).toBeInTheDocument();
  });

  it("reports 100% progress and zero debt when everything is read", async () => {
    dbMock.initDB.mockResolvedValue(
      makeDb([
        {
          id: "1",
          createdAt: dayAgo(0),
          lastVisitedAt: new Date(Date.now() - 3600000).toISOString(),
          isDeleted: false,
        },
      ]),
    );
    render(<ReadingStreaksDebt cardVariants={{}} t={tMock} />);
    expect(await screen.findByText("100%")).toBeInTheDocument();
    expect(
      screen.getByText("0 unread (~0 days to catch up)"),
    ).toBeInTheDocument();
  });
});
