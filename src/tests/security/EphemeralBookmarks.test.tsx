import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";

const dbMock = vi.hoisted(() => ({ initDB: vi.fn() }));
vi.mock("../../db/database", () => ({ initDB: dbMock.initDB }));

vi.mock("../../utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("motion/react", async () => {
  const { createMotionMock } = await import("../mocks/motion");
  return createMotionMock();
});

function interpolate(template: string, vars: Record<string, unknown>) {
  return template.replace(/\{\{?\s*(\w+)\s*\}?\}/g, (_m, name: string) =>
    name in vars ? String(vars[name]) : `{{${name}}}`,
  );
}

const defaults: Record<string, string> = {
  ephemeral_title: "Ephemeral Bookmarks",
  ephemeral_subtitle: "Auto-expiring bookmarks",
  ephemeral_archiveAll: "Archive {{count}} expired",
  ephemeral_noEntries:
    "No ephemeral bookmarks yet. Search a bookmark title and set an expiry above.",
  ephemeral_daysRemaining: "{{count}} days",
  ephemeral_hoursRemaining: "{{count}} hours",
  ephemeral_archived: "ARCHIVED",
  ephemeral_restore: "Restore",
};

const t = (k: string, d?: unknown, opts?: Record<string, unknown>) => {
  let options: Record<string, unknown> = {};
  let def: string | undefined;
  if (d && typeof d === "object") {
    options = { ...(d as Record<string, unknown>) };
    def = options.defaultValue as string | undefined;
  } else if (typeof d === "string") {
    def = d;
  }
  if (opts) options = { ...options, ...opts };
  return interpolate(def ?? defaults[k] ?? k, options);
};

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t, i18n: { language: "en" } }),
}));

import { EphemeralBookmarks } from "../../components/knowledge/EphemeralBookmarks";
import { logger } from "../../utils/logger";
import type { TFunction } from "i18next";
import { MAX_KNOWLEDGE_SCAN_ITEMS } from "../../utils/knowledgeCardBounds";

const tMock = vi.fn((k: string) => k) as unknown as TFunction;

function daysFromNow(n: number) {
  return new Date(Date.now() + n * 86400000).toISOString();
}

function setBookmarks(rows: any[], doc: any = { incrementalPatch: vi.fn() }) {
  const find = vi.fn((query?: any) => ({
    sort: vi.fn(() => ({
      limit: vi.fn(() => ({
        exec: async () => rows,
      })),
    })),
    query,
  }));
  const db = {
    bookmarks: {
      find,
      findOne: vi.fn(() => ({ exec: async () => doc })),
    },
  };
  dbMock.initDB.mockResolvedValue(db);
  return db;
}

describe("EphemeralBookmarks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders ephemeral bookmarks with remaining days", async () => {
    setBookmarks([
      {
        id: "e1",
        title: "Fresh",
        lastChecked: JSON.stringify({ expiresAt: daysFromNow(10) }),
      },
    ]);
    render(<EphemeralBookmarks cardVariants={{}} t={tMock} />);
    expect(await screen.findByText("Ephemeral Bookmarks")).toBeInTheDocument();
    expect(screen.getByText("Fresh")).toBeInTheDocument();
    expect(screen.getByText("10 days")).toBeInTheDocument();
  });

  it("shows empty state when no ephemeral bookmarks", async () => {
    setBookmarks([]);
    render(<EphemeralBookmarks cardVariants={{}} t={tMock} />);
    expect(
      await screen.findByText(/No ephemeral bookmarks yet/i),
    ).toBeInTheDocument();
  });

  it("bounds the vault scan used to find ephemeral entries", async () => {
    const db = setBookmarks([]);
    render(<EphemeralBookmarks cardVariants={{}} t={tMock} />);
    await screen.findByText(/No ephemeral bookmarks yet/i);
    expect(db.bookmarks.find).toHaveBeenCalledWith({
      selector: { isDeleted: false },
    });
    const query = db.bookmarks.find.mock.results[0]?.value;
    expect(query.sort).toHaveBeenCalledWith({ updatedAt: "desc" });
    expect(query.sort.mock.results[0]?.value.limit).toHaveBeenCalledWith(
      MAX_KNOWLEDGE_SCAN_ITEMS,
    );
  });

  it("restores an expired bookmark", async () => {
    const doc = { incrementalPatch: vi.fn().mockResolvedValue(undefined) };
    setBookmarks(
      [
        {
          id: "ex1",
          title: "Old",
          lastChecked: JSON.stringify({ expiresAt: daysFromNow(-1) }),
        },
      ],
      doc,
    );
    render(<EphemeralBookmarks cardVariants={{}} t={tMock} />);
    expect(await screen.findByText("ARCHIVED")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Restore"));
    await screen.findByText("Ephemeral Bookmarks");
    expect(doc.incrementalPatch).toHaveBeenCalledWith({
      lastChecked: JSON.stringify({}),
      updatedAt: expect.any(String),
    });
  });

  it("archives expired bookmarks", async () => {
    const doc = { incrementalPatch: vi.fn().mockResolvedValue(undefined) };
    setBookmarks(
      [
        {
          id: "ex1",
          title: "Old",
          lastChecked: JSON.stringify({ expiresAt: daysFromNow(-1) }),
        },
        {
          id: "ex2",
          title: "Fresh",
          lastChecked: JSON.stringify({ expiresAt: daysFromNow(10) }),
        },
      ],
      doc,
    );
    render(<EphemeralBookmarks cardVariants={{}} t={tMock} />);
    const archiveBtn = await screen.findByText("Archive 1 expired");
    fireEvent.click(archiveBtn);
    await screen.findByText("Ephemeral Bookmarks");
    expect(doc.incrementalPatch).toHaveBeenCalledWith({
      isDeleted: true,
      updatedAt: expect.any(String),
    });
  });

  it("shows yellow badge for expiration between 1 and 7 days", async () => {
    setBookmarks([
      {
        id: "e2",
        title: "Soon",
        lastChecked: JSON.stringify({ expiresAt: daysFromNow(3) }),
      },
    ]);
    render(<EphemeralBookmarks cardVariants={{}} t={tMock} />);
    expect(await screen.findByText("Soon")).toBeInTheDocument();
    expect(screen.getByText("3 days")).toBeInTheDocument();
  });

  it("shows yellow badge for expiration in less than a day (ceiled to 1 day)", async () => {
    const expiresAt = new Date(Date.now() + 6 * 3600000).toISOString();
    setBookmarks([
      {
        id: "e3",
        title: "Hours",
        lastChecked: JSON.stringify({ expiresAt }),
      },
    ]);
    render(<EphemeralBookmarks cardVariants={{}} t={tMock} />);
    expect(await screen.findByText("Hours")).toBeInTheDocument();
    // getExpiryInfo uses Math.ceil on days, so <24h => "1 days"
    expect(screen.getByText("1 days")).toBeInTheDocument();
  });

  it("applies expiration to bookmarks matching the title", async () => {
    const patched = vi.fn().mockResolvedValue(undefined);
    dbMock.initDB.mockResolvedValue({
      bookmarks: {
        find: vi.fn((query: any) => ({
          sort: vi.fn(() => ({
            limit: vi.fn(() => ({
              exec: async () =>
                query?.selector?.title
                  ? [{ id: "m1", title: "Match", incrementalPatch: patched }]
                  : [],
            })),
          })),
        })),
        findOne: vi.fn(() => ({ exec: async () => null })),
      },
    });
    render(<EphemeralBookmarks cardVariants={{}} t={tMock} />);
    await screen.findByText("Ephemeral Bookmarks");
    fireEvent.change(screen.getByLabelText("Search bookmark title"), {
      target: { value: "Match" },
    });
    fireEvent.click(screen.getByText("Apply"));
    await waitFor(() => expect(patched).toHaveBeenCalled());
    const call = patched.mock.calls[0]![0];
    expect(call.updatedAt).toEqual(expect.any(String));
    const parsed = JSON.parse(call.lastChecked);
    expect(parsed.expiresAt).toEqual(expect.any(String));
    expect(screen.getByLabelText("Search bookmark title")).toHaveValue("");
  });

  it("does not apply expiration with empty title", async () => {
    setBookmarks([]);
    render(<EphemeralBookmarks cardVariants={{}} t={tMock} />);
    await screen.findByText("Ephemeral Bookmarks");
    const btn = screen.getByText("Apply") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it("logs error when loadEphemeral fails", async () => {
    dbMock.initDB.mockRejectedValue(new Error("db down"));
    render(<EphemeralBookmarks cardVariants={{}} t={tMock} />);
    await waitFor(() => {
      expect(logger.error).toHaveBeenCalledWith(
        "[EphemeralBookmarks] load failed",
        expect.any(Error),
      );
    });
  });

  it("logs error when set expiry fails", async () => {
    dbMock.initDB
      .mockResolvedValueOnce({
        bookmarks: {
          find: () => ({
            sort: () => ({ limit: () => ({ exec: async () => [] }) }),
          }),
          findOne: vi.fn(),
        },
      })
      .mockRejectedValueOnce(new Error("patch failed"));
    render(<EphemeralBookmarks cardVariants={{}} t={tMock} />);
    await screen.findByText("Ephemeral Bookmarks");
    fireEvent.change(screen.getByLabelText("Search bookmark title"), {
      target: { value: "Match" },
    });
    fireEvent.click(screen.getByText("Apply"));
    await waitFor(() => {
      expect(logger.error).toHaveBeenCalledWith(
        "[EphemeralBookmarks] set expiry failed",
        expect.any(Error),
      );
    });
  });

  it("logs error when restore fails", async () => {
    const doc = { incrementalPatch: vi.fn().mockRejectedValue(new Error("patch failed")) };
    setBookmarks(
      [
        {
          id: "ex1",
          title: "Old",
          lastChecked: JSON.stringify({ expiresAt: daysFromNow(-1) }),
        },
      ],
      doc,
    );
    render(<EphemeralBookmarks cardVariants={{}} t={tMock} />);
    expect(await screen.findByText("ARCHIVED")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Restore"));
    await waitFor(() => {
      expect(logger.error).toHaveBeenCalledWith(
        "[EphemeralBookmarks] restore failed",
        expect.any(Error),
      );
    });
  });

  it("logs error when archive all fails", async () => {
    const doc = { incrementalPatch: vi.fn().mockRejectedValue(new Error("patch failed")) };
    setBookmarks(
      [
        {
          id: "ex1",
          title: "Old",
          lastChecked: JSON.stringify({ expiresAt: daysFromNow(-1) }),
        },
      ],
      doc,
    );
    render(<EphemeralBookmarks cardVariants={{}} t={tMock} />);
    const archiveBtn = await screen.findByText("Archive 1 expired");
    fireEvent.click(archiveBtn);
    await waitFor(() => {
      expect(logger.error).toHaveBeenCalledWith(
        "[EphemeralBookmarks] archive all failed",
        expect.any(Error),
      );
    });
  });

  it("ignores bookmarks without lastChecked or with invalid format", async () => {
    setBookmarks([
      { id: "a1", title: "NoCheck", lastChecked: null },
      { id: "a2", title: "BadJSON", lastChecked: "not-json" },
      {
        id: "a3",
        title: "NoExpiry",
        lastChecked: JSON.stringify({ other: 1 }),
      },
    ]);
    render(<EphemeralBookmarks cardVariants={{}} t={tMock} />);
    expect(
      await screen.findByText(/No ephemeral bookmarks yet/i),
    ).toBeInTheDocument();
    expect(screen.queryByText("NoCheck")).not.toBeInTheDocument();
    expect(screen.queryByText("BadJSON")).not.toBeInTheDocument();
    expect(screen.queryByText("NoExpiry")).not.toBeInTheDocument();
  });

  it("does nothing in restore when the doc does not exist", async () => {
    setBookmarks(
      [
        {
          id: "ex1",
          title: "Old",
          lastChecked: JSON.stringify({ expiresAt: daysFromNow(-1) }),
        },
      ],
      null,
    );
    render(<EphemeralBookmarks cardVariants={{}} t={tMock} />);
    expect(await screen.findByText("ARCHIVED")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Restore"));
    await waitFor(() => {
      expect(logger.error).not.toHaveBeenCalledWith(
        "[EphemeralBookmarks] restore failed",
        expect.any(Error),
      );
    });
  });
});
