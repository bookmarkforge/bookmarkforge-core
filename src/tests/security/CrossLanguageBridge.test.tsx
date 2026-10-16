import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import React from "react";
import type { TFunction } from "i18next";
import { CrossLanguageBridge } from "../../components/knowledge/CrossLanguageBridge";

const safeStorage = vi.hoisted(() => ({ safeGet: vi.fn(), safeSet: vi.fn() }));
vi.mock("../../store/safeStorage", () => ({
  safeGet: safeStorage.safeGet,
  safeSet: safeStorage.safeSet,
}));

// The scan runs through knowledgeScanService, which prefers a Web Worker.
// setup.ts stubs window.Worker with a mock that never replies, so the pool
// path would hang in jsdom — mock the service seam and delegate to the real
// (bounded) computeBridges so these tests exercise the actual scan logic.
const scanService = vi.hoisted(() => ({
  scanCrossLanguageBridges: vi.fn(),
}));
vi.mock("../../services/knowledgeScanService", () => ({
  scanCrossLanguageBridges: scanService.scanCrossLanguageBridges,
}));

import { computeBridges } from "../../utils/knowledgeScan";

const dbMock = vi.hoisted(() => ({ initDB: vi.fn() }));
vi.mock("../../db/database", () => ({ initDB: dbMock.initDB }));

vi.mock("motion/react", async () => {
  const { createMotionMock } = await import("../mocks/motion");
  return createMotionMock();
});

vi.mock("react-i18next", () => {
  const t = (k: string, d?: unknown, o?: Record<string, unknown>) => {
    const def =
      d && typeof d === "object"
        ? (d as Record<string, unknown>).defaultValue
        : (d as string | undefined);
    let out = String(def ?? k);
    if (o) {
      for (const [key, value] of Object.entries(o)) {
        out = out.replace(new RegExp(`{{${key}}}`, "g"), String(value));
        out = out.replace(new RegExp(`{${key}}`, "g"), String(value));
      }
    }
    return out;
  };
  return { useTranslation: () => ({ t, i18n: { language: "en" } }) };
});

const t = ((k: string): string => k) as unknown as TFunction;

const makeDb = (rows: unknown[]) => ({
  bookmarks: { find: () => ({ exec: async () => rows }) },
});

describe("CrossLanguageBridge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    safeStorage.safeGet.mockReturnValue(undefined);
    dbMock.initDB.mockResolvedValue(makeDb([]));
    scanService.scanCrossLanguageBridges.mockImplementation(async (bookmarks) =>
      computeBridges(bookmarks),
    );
  });

  it("renders the no-bridges state when none are found", async () => {
    render(<CrossLanguageBridge cardVariants={{}} t={t} />);
    expect(
      await screen.findByText(
        "No cross-language bridges found. Bookmark pages in different languages with shared tags to create bridges.",
      ),
    ).toBeInTheDocument();
  });

  it("uses cached bridges from storage without scanning", async () => {
    safeStorage.safeGet.mockReturnValue(
      JSON.stringify([
        {
          topic: "ml",
          pairs: [
            { lang: "ja", title: "X" },
            { lang: "en", title: "Y" },
          ],
        },
      ]),
    );
    render(<CrossLanguageBridge cardVariants={{}} t={t} />);
    expect(await screen.findByText("ml")).toBeInTheDocument();
    expect(screen.getByText("1 bridge(s) found")).toBeInTheDocument();
    expect(dbMock.initDB).not.toHaveBeenCalled();
  });

  it("scans and builds bridges between languages with shared tags", async () => {
    dbMock.initDB.mockResolvedValue(
      makeDb([
        {
          id: "1",
          title: "日本語の記事",
          url: "",
          tags: ["ml"],
          isDeleted: false,
        },
        {
          id: "2",
          title: "English ML Guide",
          url: "",
          tags: ["ml"],
          isDeleted: false,
        },
      ]),
    );
    render(<CrossLanguageBridge cardVariants={{}} t={t} />);
    expect(await screen.findByText("ml")).toBeInTheDocument();
    expect(screen.getByText("1 bridge(s) found")).toBeInTheDocument();
    expect(safeStorage.safeSet).toHaveBeenCalledWith(
      "bookmarkforge_language_bridges",
      expect.any(String),
    );
  });

  it("handles scan failure gracefully", async () => {
    dbMock.initDB.mockRejectedValue(new Error("db down"));
    render(<CrossLanguageBridge cardVariants={{}} t={t} />);
    expect(
      await screen.findByText(
        "No cross-language bridges found. Bookmark pages in different languages with shared tags to create bridges.",
      ),
    ).toBeInTheDocument();
  });

  it("re-scans when the rescan button is clicked", async () => {
    dbMock.initDB.mockResolvedValue(makeDb([]));
    render(<CrossLanguageBridge cardVariants={{}} t={t} />);
    await screen.findByText(/No cross-language bridges found/);
    fireEvent.click(screen.getByTitle("Rescan"));
    await waitFor(() => expect(dbMock.initDB).toHaveBeenCalledTimes(2));
  });

  it("detects CJK scripts (Chinese + Korean) with a shared tag", async () => {
    dbMock.initDB.mockResolvedValue(
      makeDb([
        {
          id: "1",
          title: "中文技术文章",
          url: "",
          tags: ["tech"],
          isDeleted: false,
        },
        {
          id: "2",
          title: "한국어 기술 기사",
          url: "",
          tags: ["tech"],
          isDeleted: false,
        },
      ]),
    );
    render(<CrossLanguageBridge cardVariants={{}} t={t} />);
    expect(await screen.findByText("tech")).toBeInTheDocument();
    expect(screen.getByText("1 bridge(s) found")).toBeInTheDocument();
    expect(screen.getByText("中文技术文章")).toBeInTheDocument();
    expect(screen.getByText("한국어 기술 기사")).toBeInTheDocument();
  });

  it("detects Cyrillic/Arabic/Devanagari and merges pairs into one bridge", async () => {
    dbMock.initDB.mockResolvedValue(
      makeDb([
        {
          id: "1",
          title: "Русская статья",
          url: "",
          tags: ["x"],
          isDeleted: false,
        },
        {
          id: "2",
          title: "مقالة عربية",
          url: "",
          tags: ["x"],
          isDeleted: false,
        },
        {
          id: "3",
          title: "हिन्दी लेख",
          url: "",
          tags: ["x"],
          isDeleted: false,
        },
      ]),
    );
    render(<CrossLanguageBridge cardVariants={{}} t={t} />);
    expect(await screen.findByText("x")).toBeInTheDocument();
    // All three titles appear under the single merged bridge
    expect(screen.getByText("Русская статья")).toBeInTheDocument();
    expect(screen.getByText("مقالة عربية")).toBeInTheDocument();
    expect(screen.getByText("हिन्दी लेख")).toBeInTheDocument();
  });

  it("rescans when the cached JSON is invalid", async () => {
    safeStorage.safeGet.mockReturnValue("{invalid json");
    dbMock.initDB.mockResolvedValue(makeDb([]));
    render(<CrossLanguageBridge cardVariants={{}} t={t} />);
    expect(
      await screen.findByText(/No cross-language bridges found/),
    ).toBeInTheDocument();
    expect(dbMock.initDB).toHaveBeenCalled();
  });

  it("rescans when the cache is an empty array", async () => {
    safeStorage.safeGet.mockReturnValue("[]");
    dbMock.initDB.mockResolvedValue(makeDb([]));
    render(<CrossLanguageBridge cardVariants={{}} t={t} />);
    expect(
      await screen.findByText(/No cross-language bridges found/),
    ).toBeInTheDocument();
    expect(dbMock.initDB).toHaveBeenCalled();
  });

  it("tolerates safeSet failures (storage full)", async () => {
    safeStorage.safeSet.mockImplementation(() => {
      throw new Error("quota exceeded");
    });
    dbMock.initDB.mockResolvedValue(
      makeDb([
        {
          id: "1",
          title: "日本語の記事",
          url: "",
          tags: ["ml"],
          isDeleted: false,
        },
        {
          id: "2",
          title: "English Guide",
          url: "",
          tags: ["ml"],
          isDeleted: false,
        },
      ]),
    );
    render(<CrossLanguageBridge cardVariants={{}} t={t} />);
    expect(await screen.findByText("ml")).toBeInTheDocument();
  });

  it("shows the scan progress percentage from worker status messages", async () => {
    // Complete the initial scan (gated behind `loading`) before driving a
    // rescan, whose progress the card actually renders.
    dbMock.initDB.mockResolvedValue(makeDb([]));
    render(<CrossLanguageBridge cardVariants={{}} t={t} />);
    await screen.findByText(/No cross-language bridges found/);

    let resolveScan!: (v: unknown) => void;
    let capturedProgress:
      | ((phase: string, fraction: number) => void)
      | undefined;
    scanService.scanCrossLanguageBridges.mockImplementation(
      (_bookmarks: unknown, _options: unknown, extras: unknown) => {
        capturedProgress = (extras as {
          onProgress?: (phase: string, fraction: number) => void;
        })?.onProgress;
        return new Promise((res) => {
          resolveScan = res;
        });
      },
    );
    fireEvent.click(screen.getByTitle("Rescan"));
    await waitFor(() => expect(capturedProgress).toBeDefined());

    act(() => {
      capturedProgress!("comparing", 0.5);
    });
    expect(await screen.findByText(/Scanning…/)).toBeInTheDocument();
    expect(screen.getByText(/50%/)).toBeInTheDocument();

    act(() => {
      resolveScan([]);
    });
    await waitFor(() =>
      expect(screen.queryByText(/50%/)).toBeNull(),
    );
  });

  it("keeps visible bridges in place while the rescan uses the fixed progress slot", async () => {
    safeStorage.safeGet.mockReturnValue(
      JSON.stringify([
        {
          topic: "ml",
          pairs: [
            { lang: "ja", title: "Existing Japanese" },
            { lang: "en", title: "Existing English" },
          ],
        },
      ]),
    );
    render(<CrossLanguageBridge cardVariants={{}} t={t} />);
    expect(await screen.findByText("ml")).toBeInTheDocument();
    const slot = screen.getByTestId("cross-lang-progress-slot");
    expect(slot.className).toContain("h-0.5");

    let resolveScan!: (value: unknown) => void;
    let reportProgress:
      | ((phase: string, fraction: number) => void)
      | undefined;
    scanService.scanCrossLanguageBridges.mockImplementation(
      (_bookmarks: unknown, _options: unknown, extras: unknown) => {
        reportProgress = (extras as {
          onProgress?: (phase: string, fraction: number) => void;
        }).onProgress;
        return new Promise((resolve) => {
          resolveScan = resolve;
        });
      },
    );

    fireEvent.click(screen.getByTitle("Rescan"));
    await waitFor(() => expect(reportProgress).toBeDefined());
    act(() => reportProgress!("comparing", 0.5));

    const progressBar = await screen.findByRole("progressbar");
    expect(progressBar).toHaveAttribute("aria-valuenow", "50");
    expect(screen.getByText("ml")).toBeInTheDocument();
    expect(screen.queryByTestId("cross-lang-rescan-spinner")).toBeNull();
    expect(screen.getByTestId("cross-lang-progress-slot")).toBe(slot);

    act(() => resolveScan([]));
    await waitFor(() => expect(screen.queryByRole("progressbar")).toBeNull());
    expect(screen.getByTestId("cross-lang-progress-slot")).toBe(slot);
  });

  it("passes the guard's AbortSignal to the scan and drops late results", async () => {
    let resolveScan!: (v: unknown) => void;
    let capturedSignal: AbortSignal | undefined;
    scanService.scanCrossLanguageBridges.mockImplementation(
      (_bookmarks: unknown, _options: unknown, extras: unknown) => {
        capturedSignal = (extras as { signal?: AbortSignal }).signal;
        return new Promise((res) => {
          resolveScan = res;
        });
      },
    );
    dbMock.initDB.mockResolvedValue(makeDb([]));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { unmount } = render(
      <CrossLanguageBridge cardVariants={{}} t={t} />,
    );
    await waitFor(() => expect(capturedSignal).toBeDefined());
    expect(capturedSignal?.aborted).toBe(false);

    unmount();
    expect(capturedSignal?.aborted).toBe(true);
    act(() => {
      resolveScan([]);
    });
    await act(async () => {
      await Promise.resolve();
    });
    // A cancelled scan must not surface as an error.
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("shows the scanning spinner while a rescan is pending", async () => {
    // Initial load completes (loading=false) so the rescan spinner branch
    // ({scanning && bridges.length === 0}) is reachable — the initial scan
    // is gated behind `loading`, so it never shows the spinner.
    dbMock.initDB.mockResolvedValue(makeDb([]));
    render(<CrossLanguageBridge cardVariants={{}} t={t} />);
    await screen.findByText(/No cross-language bridges found/);

    let resolveScan!: (v: unknown) => void;
    const pending = new Promise((res) => {
      resolveScan = res;
    });
    dbMock.initDB.mockReturnValue(pending as never);
    fireEvent.click(screen.getByTitle("Rescan"));
    await waitFor(() =>
      expect(document.querySelector(".animate-spin")).toBeTruthy(),
    );
    resolveScan(makeDb([]));
    await screen.findByText(/No cross-language bridges found/);
  });
});
