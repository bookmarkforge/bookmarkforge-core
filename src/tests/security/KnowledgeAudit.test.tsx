import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import React from "react";
import { KnowledgeAudit } from "../../components/knowledge/KnowledgeAudit";
import type { TFunction } from "i18next";
import { MAX_AUDIT_SAMPLE } from "../../utils/auditScan";

const tMock = vi.fn(
  (k: string, d?: unknown, options?: Record<string, unknown>) => {
    const fallback =
      d && typeof d === "object"
        ? ((d as Record<string, unknown>).defaultValue ?? k)
        : ((d as unknown as string | undefined) ?? k);
    return String(fallback).replace(
      /\{\{\s*(\w+)\s*\}\}/g,
      (_match, name: string) => String(options?.[name] ?? `{{${name}}}`),
    );
  },
) as unknown as TFunction;

const dbMock = vi.hoisted(() => ({ initDB: vi.fn() }));
vi.mock("../../db/database", () => ({ initDB: dbMock.initDB }));

// The scan runs through auditScanService, which prefers a Web Worker.
// setup.ts stubs window.Worker with a mock that never replies, so the pool
// path would hang in jsdom — mock the service seam and delegate to the real
// (bounded) computeAuditScan so these tests exercise the actual scan logic.
const auditService = vi.hoisted(() => ({ runAuditScan: vi.fn() }));
vi.mock("../../services/auditScanService", () => ({
  runAuditScan: auditService.runAuditScan,
}));

import { computeAuditScan } from "../../utils/auditScan";

const agent = vi.hoisted(() => ({ globalChat: vi.fn() }));
vi.mock("../../services/ai/AgentService", () => ({ agentService: agent }));

vi.mock("motion/react", async () => {
  const { createMotionMock } = await import("../mocks/motion");
  return createMotionMock();
});

const t = (k: string, d?: unknown) =>
  d && typeof d === "object"
    ? ((d as Record<string, unknown>).defaultValue ?? k)
    : ((d as unknown) ?? k);

const recent = () => new Date(Date.now() - 5 * 86400000).toISOString();
const old = () => new Date(Date.now() - 400 * 86400000).toISOString();

const makeDb = (rows: unknown[], totalCount = rows.length) => ({
  bookmarks: {
    count: () => ({ exec: async () => totalCount }),
    find: () => ({
      sort: () => ({ limit: () => ({ exec: async () => rows }) }),
    }),
  },
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("KnowledgeAudit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auditService.runAuditScan.mockImplementation(async (bookmarks) =>
      computeAuditScan(bookmarks),
    );
    dbMock.initDB.mockResolvedValue(makeDb([]));
  });

  it("shows the no-data state when the database fails", async () => {
    dbMock.initDB.mockRejectedValue(new Error("db down"));
    render(<KnowledgeAudit cardVariants={{}} t={tMock} />);
    expect(
      await screen.findByText("No bookmark data available"),
    ).toBeInTheDocument();
  });

  it("ignores a database result that resolves after unmount", async () => {
    const rows = deferred<unknown[]>();
    dbMock.initDB.mockResolvedValue({
      bookmarks: {
        count: () => ({ exec: async () => 0 }),
        find: () => ({
          sort: () => ({ limit: () => ({ exec: () => rows.promise }) }),
        }),
      },
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { unmount } = render(<KnowledgeAudit cardVariants={{}} t={tMock} />);
    await waitFor(() => expect(dbMock.initDB).toHaveBeenCalled());
    unmount();
    rows.resolve([]);
    await act(async () => {
      await Promise.resolve();
    });
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("computes report stats from bookmarks", async () => {
    dbMock.initDB.mockResolvedValue(
      makeDb([
        {
          id: "1",
          title: "A",
          tags: ["ai", "ml"],
          createdAt: old(),
          lastVisitedAt: recent(),
        },
        {
          id: "2",
          title: "B",
          tags: ["ai"],
          createdAt: old(),
          lastVisitedAt: recent(),
        },
      ]),
    );
    render(<KnowledgeAudit cardVariants={{}} t={tMock} />);
    expect(
      await screen.findByText("Knowledge Audit Report"),
    ).toBeInTheDocument();
    expect(screen.getByText("Total Bookmarks")).toBeInTheDocument();
    expect(screen.getByText("100%")).toBeInTheDocument();
    expect(screen.getByText("Coverage by Tag")).toBeInTheDocument();
    expect(screen.getByText("ai")).toBeInTheDocument();
    expect(
      screen.queryByText("No bookmark data available"),
    ).not.toBeInTheDocument();
  });

  it("shows the real vault total and sample size when the audit is bounded", async () => {
    const rows = [
      {
        id: "1",
        title: "A",
        tags: ["ai"],
        createdAt: recent(),
        lastVisitedAt: recent(),
      },
    ];
    dbMock.initDB.mockResolvedValue(
      makeDb(rows, MAX_AUDIT_SAMPLE + 123),
    );
    render(<KnowledgeAudit cardVariants={{}} t={tMock} />);
    const note = await screen.findByTestId("audit-sample-note");
    expect(note).toHaveTextContent(
      `Showing ${rows.length} of ${MAX_AUDIT_SAMPLE + 123} bookmarks; metrics use this sample.`,
    );
    expect(screen.getByText(String(MAX_AUDIT_SAMPLE + 123))).toBeInTheDocument();
  });

  it("does not show a sample note at or below the audit cap", async () => {
    dbMock.initDB.mockResolvedValue(
      makeDb([
        {
          id: "1",
          title: "A",
          tags: ["ai"],
          createdAt: recent(),
          lastVisitedAt: recent(),
        },
      ], MAX_AUDIT_SAMPLE),
    );
    render(<KnowledgeAudit cardVariants={{}} t={tMock} />);
    await screen.findByText("Knowledge Audit Report");
    expect(screen.queryByTestId("audit-sample-note")).not.toBeInTheDocument();
  });

  it("generates a full audit via AI updating gaps, contradictions and recommendation", async () => {
    dbMock.initDB.mockResolvedValue(
      makeDb([
        {
          id: "1",
          title: "A",
          tags: ["ai"],
          createdAt: old(),
          lastVisitedAt: recent(),
        },
      ]),
    );
    agent.globalChat.mockResolvedValue({
      text: JSON.stringify({
        gaps: ["gap1"],
        contradictions: ["c1"],
        outdatedCount: 5,
        recommendation: "rec1",
      }),
    });
    render(<KnowledgeAudit cardVariants={{}} t={tMock} />);
    fireEvent.click(await screen.findByText("Generate Full Audit"));
    expect(await screen.findByText("gap1")).toBeInTheDocument();
    expect(screen.getByText("c1")).toBeInTheDocument();
    expect(screen.getByText("rec1")).toBeInTheDocument();
    expect(agent.globalChat).toHaveBeenCalled();
  });

  it("propagates cancellation and ignores an audit resolved after unmount", async () => {
    dbMock.initDB.mockResolvedValue(
      makeDb([
        {
          id: "1",
          title: "A",
          tags: ["ai"],
          createdAt: old(),
          lastVisitedAt: recent(),
        },
      ]),
    );
    let resolveAudit!: (result: { text: string }) => void;
    agent.globalChat.mockReturnValue(
      new Promise((resolve) => {
        resolveAudit = resolve;
      }),
    );
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { unmount } = render(<KnowledgeAudit cardVariants={{}} t={tMock} />);
    fireEvent.click(await screen.findByText("Generate Full Audit"));
    await waitFor(() => expect(agent.globalChat).toHaveBeenCalled());
    const signal = agent.globalChat.mock.calls[0]?.[7];
    expect(signal).toBeInstanceOf(AbortSignal);
    unmount();
    expect(signal?.aborted).toBe(true);
    resolveAudit({ text: JSON.stringify({ recommendation: "stale" }) });
    await act(async () => {
      await Promise.resolve();
    });
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("handles AI generation failure gracefully", async () => {
    dbMock.initDB.mockResolvedValue(
      makeDb([
        {
          id: "1",
          title: "A",
          tags: ["ai"],
          createdAt: old(),
          lastVisitedAt: recent(),
        },
      ]),
    );
    agent.globalChat.mockRejectedValue(new Error("ai down"));
    render(<KnowledgeAudit cardVariants={{}} t={tMock} />);
    fireEvent.click(await screen.findByText("Generate Full Audit"));
    await waitFor(() => expect(agent.globalChat).toHaveBeenCalled());
    expect(screen.getByText("Knowledge Audit Report")).toBeInTheDocument();
  });

  // ── Branch coverage: loading, visit age, health score, AI code blocks, download ──

  it("shows spinner in the loading state", () => {
    // Don't resolve initDB — it stays pending so loading remains true
    dbMock.initDB.mockReturnValue(new Promise(() => {}));
    const { container } = render(<KnowledgeAudit cardVariants={{}} t={tMock} />);
    expect(container.querySelector(".animate-spin")).toBeTruthy();
  });

  it("shows worker scan percentage beside the spinner", async () => {
    const pending = deferred<ReturnType<typeof computeAuditScan>>();
    dbMock.initDB.mockResolvedValue(
      makeDb([
        {
          id: "1",
          title: "A",
          tags: ["ai"],
          createdAt: recent(),
          lastVisitedAt: recent(),
        },
      ]),
    );
    auditService.runAuditScan.mockImplementation(
      async (_bookmarks, options) => {
        options?.onProgress?.("scanning", 0.42);
        return pending.promise;
      },
    );

    render(<KnowledgeAudit cardVariants={{}} t={tMock} />);
    expect(await screen.findByText("Scanning… 42%")).toBeInTheDocument();
    const options = auditService.runAuditScan.mock.calls[0]?.[1];
    expect(options.signal).toBeInstanceOf(AbortSignal);

    pending.resolve({
      totalTags: 1,
      visitedIn30d: 1,
      coverageByTag: [{ tag: "ai", count: 1, lastVisitDays: 0 }],
      outdatedCount: 0,
    });
    expect(await screen.findByText("Knowledge Audit Report")).toBeInTheDocument();
  });

  it("shows 'Today' when lastVisitDays <= 1", async () => {
    const today = new Date().toISOString();
    dbMock.initDB.mockResolvedValue(
      makeDb([
        {
          id: "1",
          title: "Fresh",
          tags: ["hot"],
          createdAt: today,
          lastVisitedAt: today,
        },
      ]),
    );
    render(<KnowledgeAudit cardVariants={{}} t={tMock} />);
    await screen.findByText("Knowledge Audit Report");
    // Tag visited today → "Today" label
    expect(screen.getByText("Today")).toBeInTheDocument();
  });

  it("shows 'Never' and a gray dot for never-visited tags", async () => {
    dbMock.initDB.mockResolvedValue(
      makeDb([
        {
          id: "1",
          title: "Forgotten",
          tags: ["stale"],
          createdAt: old(),
          lastVisitedAt: null,
        },
      ]),
    );
    render(<KnowledgeAudit cardVariants={{}} t={tMock} />);
    await screen.findByText("Knowledge Audit Report");
    expect(screen.getByText("Never")).toBeInTheDocument();
    // Gray dot for never-visited tags
    const grayDots = document.querySelectorAll(".bg-gray-400");
    expect(grayDots.length).toBeGreaterThanOrEqual(1);
  });

  it("shows red dot for tags with lastVisit > 90 days", async () => {
    const veryOld = new Date(Date.now() - 100 * 86400000).toISOString();
    dbMock.initDB.mockResolvedValue(
      makeDb([
        {
          id: "1",
          title: "Ancient",
          tags: ["dino"],
          createdAt: old(),
          lastVisitedAt: veryOld,
        },
      ]),
    );
    render(<KnowledgeAudit cardVariants={{}} t={tMock} />);
    await screen.findByText("Knowledge Audit Report");
    // Red dot for tags > 90 days since last visit
    const redDots = document.querySelectorAll(".bg-red-500");
    expect(redDots.length).toBeGreaterThanOrEqual(1);
  });

  it("uses warning colors for healthScore < 50", async () => {
    // Only old bookmarks with no recent visits → healthScore = 0%
    dbMock.initDB.mockResolvedValue(
      makeDb([
        {
          id: "1",
          title: "Old",
          tags: ["old"],
          createdAt: old(),
          lastVisitedAt: old(),
        },
      ]),
    );
    render(<KnowledgeAudit cardVariants={{}} t={tMock} />);
    await screen.findByText("Knowledge Audit Report");
    // Health score 0% with warning colors
    expect(screen.getByText("0%")).toBeInTheDocument();
  });

  it("parses AI response from code blocks", async () => {
    dbMock.initDB.mockResolvedValue(
      makeDb([
        {
          id: "1",
          title: "A",
          tags: ["ai"],
          createdAt: old(),
          lastVisitedAt: recent(),
        },
      ]),
    );
    agent.globalChat.mockResolvedValue({
      text: '```json\n{"gaps":["missing-ml"],"contradictions":[],"outdatedCount":3,"recommendation":"Add ML resources"}\n```',
    });
    render(<KnowledgeAudit cardVariants={{}} t={tMock} />);
    fireEvent.click(await screen.findByText("Generate Full Audit"));
    expect(await screen.findByText("missing-ml")).toBeInTheDocument();
    expect(screen.getByText("Add ML resources")).toBeInTheDocument();
  });

  it("generates and downloads an HTML report", async () => {
    dbMock.initDB.mockResolvedValue(
      makeDb([
        {
          id: "1",
          title: "A",
          tags: ["ai"],
          createdAt: old(),
          lastVisitedAt: recent(),
        },
      ]),
    );
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    const revokeSpy = vi.spyOn(URL, "revokeObjectURL");
    render(<KnowledgeAudit cardVariants={{}} t={tMock} />);
    await screen.findByText("Knowledge Audit Report");
    fireEvent.click(screen.getByTitle("Download Report"));
    // window.open was called; since it returned null, revokeObjectURL should fire
    await waitFor(() => {
      expect(openSpy).toHaveBeenCalled();
    });
    openSpy.mockRestore();
    revokeSpy.mockRestore();
  });

  it("cancels the previous cleanup on consecutive downloads", async () => {
    dbMock.initDB.mockResolvedValue(
      makeDb([
        {
          id: "1",
          title: "A",
          tags: ["ai"],
          createdAt: old(),
          lastVisitedAt: recent(),
        },
      ]),
    );
    const openSpy = vi.spyOn(window, "open").mockReturnValue({} as Window);
    const createSpy = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValueOnce("blob:first-report")
      .mockReturnValueOnce("blob:second-report");
    const revokeSpy = vi.spyOn(URL, "revokeObjectURL");
    render(<KnowledgeAudit cardVariants={{}} t={tMock} />);
    await screen.findByText("Knowledge Audit Report");

    vi.useFakeTimers();
    fireEvent.click(screen.getByTitle("Download Report"));
    fireEvent.click(screen.getByTitle("Download Report"));
    await act(async () => {
      vi.runAllTimers();
    });

    expect(createSpy).toHaveBeenCalledTimes(2);
    expect(revokeSpy).toHaveBeenCalledWith("blob:first-report");
    expect(revokeSpy).toHaveBeenCalledWith("blob:second-report");
    expect(revokeSpy).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
    openSpy.mockRestore();
    createSpy.mockRestore();
    revokeSpy.mockRestore();
  });

  it("localiza el reporte HTML descargado con claves i18n", async () => {
    dbMock.initDB.mockResolvedValue(
      makeDb([
        {
          id: "1",
          title: "A",
          tags: ["ai"],
          createdAt: old(),
          lastVisitedAt: recent(),
        },
        {
          id: "2",
          title: "Forgotten",
          tags: ["stale"],
          createdAt: old(),
          lastVisitedAt: null,
        },
      ]),
    );
    agent.globalChat.mockResolvedValue({
      text: '```json\n{"gaps":["missing-ml"],"contradictions":["dup"],"outdatedCount":3,"recommendation":"Add ML resources"}\n```',
    });
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    render(<KnowledgeAudit cardVariants={{}} t={tMock} />);
    await screen.findByText("Knowledge Audit Report");
    fireEvent.click(await screen.findByText("Generate Full Audit"));
    await screen.findByText("missing-ml");
    fireEvent.click(screen.getByTitle("Download Report"));
    await waitFor(() => {
      expect(openSpy).toHaveBeenCalled();
    });
    // The report HTML must use the i18n keys (not hardcoded English):
    // headers, stat labels and the age label all go through t().
    const calls = (tMock as unknown as { mock: { calls: unknown[][] } })
      .mock.calls;
    const calledKeys = new Set(calls.map((call) => call[0] as string));
    for (const key of [
      "app_knowledgeAudit",
      "app_totalBookmarks",
      "app_totalTags",
      "app_outdated",
      "app_healthScore",
      "app_coverageByTag",
      "app_tag",
      "app_count",
      "app_lastVisit",
      "app_daysAgo",
      "app_never",
      "app_knowledgeGaps",
      "app_contradictions",
      "app_recommendation",
      "app_generatedAt",
    ]) {
      expect(calledKeys).toContain(key);
    }
    // The days-ago call must pass the interpolation value as `count`
    // (the key uses {{count}} plural forms in every locale).
    expect(tMock).toHaveBeenCalledWith(
      "app_daysAgo",
      expect.any(String),
      expect.objectContaining({ count: expect.any(Number) }),
    );
    openSpy.mockRestore();
  });
});
