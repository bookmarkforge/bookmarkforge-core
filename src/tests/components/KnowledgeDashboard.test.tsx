import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { Subject } from "rxjs";
import React from "react";

const docsSubject = new Subject<any[]>();
const bookmarksSubject = new Subject<any[]>();

vi.mock("../../db/database", () => ({
  initDB: vi.fn().mockResolvedValue({
    documents: { find: () => ({ $: docsSubject }) },
    bookmarks: { find: () => ({ $: bookmarksSubject }) },
  }),
}));

vi.mock("react-i18next", () => {
  const t = (key: string, fb?: string | { defaultValue?: string }) => {
    if (typeof fb === "string") return fb;
    if (fb && typeof fb === "object" && "defaultValue" in fb)
      return fb.defaultValue;
    return key;
  };
  return {
    useTranslation: () => ({ t, i18n: { language: "en" } }),
    initReactI18next: { type: "3rdParty", init: vi.fn() },
  };
});

vi.mock("../../contexts/ThemeContext", () => ({
  useTheme: () => ({ isDark: false, theme: "light" }),
}));

vi.mock("../../components/analytics/SystemIntegrity", () => ({
  SystemIntegrity: () => <div data-testid="system-integrity" />,
}));

vi.mock("../../components/knowledge/ActivityChartSection", () => ({
  ActivityChartSection: () => <div data-testid="activity-chart" />,
}));

vi.mock("../../components/knowledge/TagDistributionCard", () => ({
  TagDistributionCard: () => <div data-testid="tag-distribution" />,
}));

vi.mock("../../components/knowledge/AIInsightsCard", () => ({
  AIInsightsCard: () => <div data-testid="ai-insights" />,
}));

const mockForceReprocessAll = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("../../services/ai/AutoProcessorService", () => ({
  autoProcessorService: { forceReprocessAll: mockForceReprocessAll },
}));

const mockToast = { success: vi.fn(), error: vi.fn() };
vi.mock("sonner", () => ({ toast: mockToast }));

vi.mock("../../components/knowledge/QuickActionCard", () => ({
  QuickActionCard: (props: { onForceReindex?: () => void }) => (
    <button data-testid="quick-action" onClick={props.onForceReindex} />
  ),
}));

vi.mock("../../components/knowledge/DigestCard", () => ({
  DigestCard: () => <div data-testid="digest-card" />,
}));

vi.mock("../../components/knowledge/ReadingPathsCard", () => ({
  ReadingPathsCard: () => <div data-testid="reading-paths" />,
}));

vi.mock("../../components/knowledge/KnowledgeDecayHeatmap", () => ({
  KnowledgeDecayHeatmap: () => <div data-testid="decay-heatmap" />,
}));

vi.mock("../../components/knowledge/BlindspotDetection", () => ({
  BlindspotDetection: () => <div data-testid="blindspot-detection" />,
}));

vi.mock("../../components/knowledge/BookmarkPersonality", () => ({
  BookmarkPersonality: () => <div data-testid="bookmark-personality" />,
}));

vi.mock("../../components/knowledge/BookmarkFusion", () => ({
  BookmarkFusion: () => <div data-testid="bookmark-fusion" />,
}));

vi.mock("../../components/knowledge/CrossLanguageBridge", () => ({
  CrossLanguageBridge: () => <div data-testid="cross-language-bridge" />,
}));

vi.mock("../../components/knowledge/EphemeralBookmarks", () => ({
  EphemeralBookmarks: () => <div data-testid="ephemeral-bookmarks" />,
}));

vi.mock("../../components/knowledge/BookmarkTimeMachine", () => ({
  BookmarkTimeMachine: () => <div data-testid="bookmark-time-machine" />,
}));

vi.mock("../../components/knowledge/BookmarkAntonyms", () => ({
  BookmarkAntonyms: () => <div data-testid="bookmark-antonyms" />,
}));

vi.mock("../../components/knowledge/ReadingStreaksDebt", () => ({
  ReadingStreaksDebt: () => <div data-testid="reading-streaks-debt" />,
}));

vi.mock("../../components/knowledge/AmbientSerendipity", () => ({
  AmbientSerendipity: () => <div data-testid="ambient-serendipity" />,
}));

vi.mock("../../components/knowledge/BookmarkCoverSongs", () => ({
  BookmarkCoverSongs: () => <div data-testid="bookmark-cover-songs" />,
}));

vi.mock("../../components/knowledge/KnowledgeAvatars", () => ({
  KnowledgeAvatars: () => <div data-testid="knowledge-avatars" />,
}));

vi.mock("../../components/knowledge/BookmarkNostalgia", () => ({
  BookmarkNostalgia: () => <div data-testid="bookmark-nostalgia" />,
}));

vi.mock("../../components/knowledge/KnowledgeFengShui", () => ({
  KnowledgeFengShui: () => <div data-testid="knowledge-feng-shui" />,
}));

vi.mock("../../components/knowledge/BookmarkEchoes", () => ({
  BookmarkEchoes: () => <div data-testid="bookmark-echoes" />,
}));

vi.mock("../../components/knowledge/KnowledgeMigration", () => ({
  KnowledgeMigration: () => <div data-testid="knowledge-migration" />,
}));

vi.mock("../../components/knowledge/AISommelier", () => ({
  AISommelier: () => <div data-testid="ai-sommelier" />,
}));

vi.mock("../../components/knowledge/KnowledgeAudit", () => ({
  KnowledgeAudit: () => <div data-testid="knowledge-audit" />,
}));

vi.mock("../../components/knowledge/MeetingPrepMode", () => ({
  MeetingPrepMode: () => <div data-testid="meeting-prep-mode" />,
}));

vi.mock("../../components/knowledge/QuizGenerator", () => ({
  QuizGenerator: () => <div data-testid="quiz-generator" />,
}));

vi.mock("../../components/knowledge/KnowledgeBasePublisher", () => ({
  KnowledgeBasePublisher: () => <div data-testid="knowledge-base-publisher" />,
}));

vi.mock("../../components/knowledge/DependencyMap", () => ({
  DependencyMap: () => <div data-testid="dependency-map" />,
}));

vi.mock("lucide-react", () => {
  const mock = (name: string) => {
    const Icon = (props: any) => (
      <svg data-testid={`icon-${name}`} {...props} />
    );
    Icon.displayName = name;
    return Icon;
  };
  return {
    Activity: mock("Activity"),
    Bookmark: mock("Bookmark"),
    Tag: mock("Tag"),
    Brain: mock("Brain"),
    FileText: mock("FileText"),
    Eye: mock("Eye"),
    Shuffle: mock("Shuffle"),
    Lightbulb: mock("Lightbulb"),
  };
});

vi.mock("motion/react", async () => {
  const { createMotionMock } = await import("../mocks/motion");
  return createMotionMock();
});

describe("KnowledgeDashboard", () => {
  let KnowledgeDashboard: React.FC;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("../../components/KnowledgeDashboard");
    KnowledgeDashboard = mod.default;
  });

  it("shows loading while there is no data", () => {
    const { container } = render(<KnowledgeDashboard />);
    expect(screen.getByText("app_analyzingBrain")).toBeTruthy();
    expect(container.querySelector(".animate-pulse")).toBeTruthy();
  });

  it("shows statistics when the subscription activates", async () => {
    render(<KnowledgeDashboard />);

    await act(async () => {});
    await act(async () => {
      docsSubject.next([
        {
          createdAt: new Date().toISOString(),
          tags: ["tag1", "tag2"],
          embedding: [1, 2, 3],
        },
        { createdAt: new Date().toISOString(), tags: ["tag1"], embedding: [] },
      ]);
      bookmarksSubject.next([
        {
          createdAt: new Date(Date.now() - 86400000).toISOString(),
          tags: ["tag2"],
          summary: "test summary",
        },
        { createdAt: new Date().toISOString(), tags: ["tag3"], summary: null },
      ]);
    });

    expect(screen.getByText("app_analytics")).toBeTruthy();
    expect(screen.getByText("app_analyticsSubtitle")).toBeTruthy();
    expect(screen.getByTestId("activity-chart")).toBeTruthy();
    expect(screen.getByTestId("tag-distribution")).toBeTruthy();
    expect(screen.getByTestId("ai-insights")).toBeTruthy();
    expect(screen.getByTestId("quick-action")).toBeTruthy();
    expect(screen.getByTestId("system-integrity")).toBeTruthy();
  });

  it("wires the reindex action to the AutoProcessor", async () => {
    render(<KnowledgeDashboard />);
    await act(async () => {});
    await act(async () => {
      docsSubject.next([{ createdAt: new Date().toISOString(), tags: [], embedding: [] }]);
      bookmarksSubject.next([]);
    });
    await act(async () => {
      screen.getByTestId("quick-action").click();
    });
    expect(mockForceReprocessAll).toHaveBeenCalledTimes(1);
  });

  it("reports success or error when reindexing", async () => {
    render(<KnowledgeDashboard />);
    await act(async () => {});
    await act(async () => {
      docsSubject.next([{ createdAt: new Date().toISOString(), tags: [], embedding: [] }]);
      bookmarksSubject.next([]);
    });
    await act(async () => {
      screen.getByTestId("quick-action").click();
    });
    expect(mockToast.success).toHaveBeenCalledWith("app_reprocessStarted");

    mockForceReprocessAll.mockRejectedValueOnce(new Error("failed"));
    await act(async () => {
      screen.getByTestId("quick-action").click();
    });
    expect(mockToast.error).toHaveBeenCalledWith("Re-indexing failed");
  });

  it("shows analysis engine active badge after receiving data", async () => {
    render(<KnowledgeDashboard />);

    await act(async () => {});
    await act(async () => {
      docsSubject.next([
        { createdAt: new Date().toISOString(), tags: [], embedding: [] },
      ]);
      bookmarksSubject.next([
        { createdAt: new Date().toISOString(), tags: [], summary: "" },
      ]);
    });

    expect(screen.getByText("app_analysisEngineActive")).toBeTruthy();
  });

  it("shows the Most Read section when there are bookmarks with visitCount", async () => {
    render(<KnowledgeDashboard />);

    await act(async () => {});
    await act(async () => {
      docsSubject.next([]);
      bookmarksSubject.next([
        {
          id: "b1",
          title: "Popular Post",
          createdAt: new Date().toISOString(),
          tags: [],
          summary: "s",
          visitCount: 10,
        },
        {
          id: "b2",
          title: "Rare Post",
          createdAt: new Date().toISOString(),
          tags: [],
          summary: "s",
          visitCount: 1,
        },
      ]);
    });

    expect(screen.getByText("Most Read")).toBeTruthy();
    expect(screen.getByText("Popular Post")).toBeTruthy();
    expect(screen.getByText("Rare Post")).toBeTruthy();
  });

  it("caps the healthScore at 100% with many items", async () => {
    render(<KnowledgeDashboard />);

    await act(async () => {});
    await act(async () => {
      const manyDocs = Array.from({ length: 60 }, () => ({
        createdAt: new Date().toISOString(),
        tags: [],
        embedding: [],
      }));
      docsSubject.next(manyDocs);
      bookmarksSubject.next([]);
    });

    expect(screen.getByText("100%")).toBeTruthy();
  });

  it("does not show toasts if reindexing finishes after unmount", async () => {
    let resolveReindex: (value: void) => void;
    mockForceReprocessAll.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveReindex = resolve;
      }),
    );

    const { unmount } = render(<KnowledgeDashboard />);
    await act(async () => {});
    await act(async () => {
      docsSubject.next([
        { createdAt: new Date().toISOString(), tags: [], embedding: [] },
      ]);
      bookmarksSubject.next([]);
    });
    await act(async () => {
      screen.getByTestId("quick-action").click();
    });
    unmount();
    await act(async () => {
      resolveReindex!();
    });

    expect(mockToast.success).not.toHaveBeenCalled();
    expect(mockToast.error).not.toHaveBeenCalled();
  });

  it("does not subscribe if initDB resolves after unmount", async () => {
    let resolveInit: (value: unknown) => void;
    const { initDB } = await import("../../db/database");
    (initDB as ReturnType<typeof vi.fn>).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveInit = resolve;
      }),
    );

    const { unmount } = render(<KnowledgeDashboard />);
    unmount();
    await act(async () => {
      resolveInit!({
        documents: { find: () => ({ $: docsSubject }) },
        bookmarks: { find: () => ({ $: bookmarksSubject }) },
      });
    });

    // A late initDB() must not create subscriptions that are never torn down.
    expect(docsSubject.observers.length).toBe(0);
    expect(bookmarksSubject.observers.length).toBe(0);
  });

  it("shows a retryable error if initDB fails", async () => {
    const { initDB } = await import("../../db/database");
    (initDB as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("db down"),
    );
    render(<KnowledgeDashboard />);

    await act(async () => {});
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText("Unable to load analytics right now.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });
});
