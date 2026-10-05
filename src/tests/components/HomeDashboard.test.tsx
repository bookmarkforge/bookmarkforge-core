import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  act,
  cleanup,
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import React from "react";
import { initDB } from "../../db/database";
import { fileSystemService } from "../../services/FileSystemService";
import { crossPollinationService } from "../../services/ai/CrossPollinationService";
import { notificationService } from "../../services/NotificationService";
import { documentTemplateService } from "../../services/DocumentTemplateService";
import { securityVault } from "../../services/SecurityVault";
import { toast } from "sonner";

vi.mock("react-i18next", () => {
  const t = (key: string, fb?: string) => fb || key;
  return {
    useTranslation: () => ({ t, i18n: { language: "en" } }),
    initReactI18next: { type: "3rdParty", init: vi.fn() },
  };
});

vi.mock("sonner", () => {
  const mockToast = { success: vi.fn(), error: vi.fn(), loading: vi.fn() };
  return { toast: mockToast };
});

vi.mock("../../db/database", () => ({
  initDB: vi.fn(),
}));

vi.mock("../../services/FileSystemService", () => ({
  fileSystemService: {
    isSupported: vi.fn().mockReturnValue(true),
    requestDirectoryAccess: vi.fn().mockResolvedValue(true),
    syncFiles: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../../services/ai/CrossPollinationService", () => ({
  crossPollinationService: {
    generateInsights: vi.fn().mockResolvedValue([]),
    generateWeeklyCuration: vi.fn().mockResolvedValue(null),
  },
}));

vi.mock("../../services/NotificationService", () => ({
  notificationService: { scheduleSRSNotification: vi.fn() },
}));

vi.mock("../../services/DocumentTemplateService", async () => {
  const actual =
    await vi.importActual<typeof import("../../services/DocumentTemplateService")>(
      "../../services/DocumentTemplateService",
    );
  return {
    documentTemplateService: { getAllTemplates: vi.fn().mockReturnValue([]) },
    // Pure helpers, no side effects — keep the real implementations so the
    // create-from-template flow works in tests.
    templateBlocksToPlainText: actual.templateBlocksToPlainText,
    normalizeTemplateBlocksToBlockNote: actual.normalizeTemplateBlocksToBlockNote,
  };
});

vi.mock("../../services/SecurityVault", () => ({
  securityVault: {
    hasSecret: vi.fn().mockResolvedValue(false),
    onLock: vi.fn(() => () => {}),
    onUnlock: vi.fn(() => () => {}),
  },
}));

vi.mock("../../components/ai/InsightCards", () => ({
  default: ({ insights }: any) =>
    insights.length > 0 ? (
      <div data-testid="insight-cards">{insights.length} insights</div>
    ) : null,
}));

vi.mock("../../components/ai/ForgottenConnections", () => ({
  ForgottenConnections: ({ onSelect }: any) => (
    <div
      data-testid="forgotten-connections"
      onClick={() => onSelect?.("test-id")}
    />
  ),
}));

vi.mock("../../components/dashboard/components/NavCard", () => ({
  NavCard: ({ title, description, onClick }: any) => (
    <div data-testid="nav-card" onClick={onClick}>
      <span>{title}</span>
      <span>{description}</span>
    </div>
  ),
}));

vi.mock("../../components/dashboard/components/EvictionBanner", () => ({
  EvictionBanner: ({ show, onDismiss, onConfigureSync }: any) =>
    show ? (
      <div data-testid="eviction-banner">
        <button onClick={onDismiss} data-testid="eviction-dismiss">
          dismiss
        </button>
        <button onClick={onConfigureSync} data-testid="eviction-configure">
          configure
        </button>
      </div>
    ) : null,
}));

vi.mock("../../components/dashboard/components/BackupReminderBanner", () => ({
  BackupReminderBanner: ({ show, onDismiss }: any) =>
    show ? (
      <div data-testid="backup-banner">
        <button onClick={onDismiss} data-testid="backup-dismiss">
          dismiss
        </button>
      </div>
    ) : null,
}));

// Free-tier wall nudge — mock the hook so the real one never touches RxDB
// or LicenseService in this suite; FreeTierNudge is mocked like its banner
// siblings.
const { mockFreeTierUsage } = vi.hoisted(() => ({
  mockFreeTierUsage: {
    count: undefined as number | undefined,
    limit: 1000,
    atWall: false,
    nearWall: false,
    isFree: false,
  },
}));
vi.mock("../../hooks/useFreeTierUsage", () => ({
  useFreeTierUsage: () => mockFreeTierUsage,
}));
vi.mock("../../components/dashboard/components/FreeTierNudge", () => ({
  FreeTierNudge: ({ show, onDismiss, onSeePro }: any) =>
    show ? (
      <div data-testid="free-tier-nudge">
        <button onClick={onDismiss} data-testid="nudge-dismiss">
          dismiss
        </button>
        <button onClick={onSeePro} data-testid="nudge-see-pro">
          see pro
        </button>
      </div>
    ) : null,
}));

vi.mock("../../components/dashboard/components/SRSReviewCard", () => ({
  SRSReviewCard: ({ dueCardsCount, onStartReview }: any) =>
    dueCardsCount > 0 ? (
      <div data-testid="srs-review-card">
        <span data-testid="srs-count">{dueCardsCount}</span>
        <button onClick={onStartReview} data-testid="srs-start">
          start
        </button>
      </div>
    ) : null,
}));

vi.mock("../../components/dashboard/components/TemplateModal", () => ({
  TemplateModal: ({ show, onClose, templates, onCreateFromTemplate }: any) =>
    show ? (
      <div data-testid="template-modal">
        <button onClick={onClose} data-testid="template-close">
          close
        </button>
        <button
          onClick={() =>
            onCreateFromTemplate({
              id: "t1",
              name: "Test Template",
              content: [],
              tags: ["test"],
              description: "",
            })
          }
          data-testid="template-create"
        >
          create
        </button>
      </div>
    ) : null,
}));

vi.mock("../../components/QuickTips", () => ({
  QuickTips: () => <div data-testid="quick-tips" />,
}));

// First-run checklist — the hook is mocked so the real one never counts rows
// in RxDB here, and the component is mocked into labelled buttons so this
// suite can assert the wiring without depending on the checklist's internals
// (covered by its own test file).
const { mockFirstRun } = vi.hoisted(() => ({
  mockFirstRun: {
    bookmarkCount: undefined as number | undefined,
    documentCount: undefined as number | undefined,
    searchTried: false,
    dismissed: true,
    dismiss: vi.fn(),
  },
}));
vi.mock("../../hooks/useFirstRunChecklist", () => ({
  useFirstRunChecklist: () => mockFirstRun,
  markFirstRunSearchTried: vi.fn(),
}));
vi.mock("../../components/dashboard/components/FirstRunChecklist", () => ({
  FirstRunChecklist: ({
    onCaptureBookmark,
    onCreateDocument,
    onTrySearch,
    onDismiss,
  }: any) => (
    <div data-testid="first-run-checklist">
      <button onClick={onCaptureBookmark} data-testid="first-run-capture">
        capture
      </button>
      <button onClick={onCreateDocument} data-testid="first-run-create">
        create
      </button>
      <button onClick={onTrySearch} data-testid="first-run-search">
        search
      </button>
      <button onClick={onDismiss} data-testid="first-run-dismiss">
        dismiss
      </button>
    </div>
  ),
}));

const { mockGetLatestBackupAgeMs } = vi.hoisted(() => ({
  mockGetLatestBackupAgeMs: vi.fn(),
}));

vi.mock("../../components/StorageStatus", () => ({
  StorageStatus: () => <div data-testid="storage-status" />,
  getLatestBackupAgeMs: mockGetLatestBackupAgeMs,
  BACKUP_STALE_MS: 48 * 60 * 60 * 1000,
  BACKUP_REFRESH_INTERVAL_MS: 60_000,
}));

vi.mock("../../components/ResearchAssistant", () => ({
  ResearchAssistant: ({ isOpen, onClose }: any) =>
    isOpen ? (
      <div data-testid="research-assistant">
        <button onClick={onClose} data-testid="research-close">
          close
        </button>
      </div>
    ) : null,
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
    FileText: mock("FileText"),
    HelpCircle: mock("HelpCircle"),
    Bookmark: mock("Bookmark"),
    Sparkles: mock("Sparkles"),
    ArrowRight: mock("ArrowRight"),
    Folder: mock("Folder"),
    MessageSquare: mock("MessageSquare"),
    Activity: mock("Activity"),
    Clock: mock("Clock"),
    Plus: mock("Plus"),
    Share2: mock("Share2"),
    Mic: mock("Mic"),
    Users: mock("Users"),
    Search: mock("Search"),
  };
});

vi.mock("motion/react", async () => {
  const { createMotionMock } = await import("../mocks/motion");
  return createMotionMock();
});

const mockDB = {
  documents: {
    find: vi.fn().mockReturnValue({ exec: vi.fn().mockResolvedValue([]) }),
    insert: vi.fn().mockResolvedValue({ id: "new-doc-id" }),
  },
  flashcards: {
    find: vi.fn().mockReturnValue({ exec: vi.fn().mockResolvedValue([]) }),
  },
};

describe("HomeDashboard", () => {
  let HomeDashboard: React.FC<any>;
  const onNavigate = vi.fn();
  const onSelectDocument = vi.fn();

  beforeEach(async () => {
    vi.clearAllMocks();
    localStorage.clear();
    // Default: Pro/quiet — the nudge must not appear in unrelated tests.
    Object.assign(mockFreeTierUsage, {
      count: undefined,
      limit: 1000,
      atWall: false,
      nearWall: false,
      isFree: false,
    });
    // Default: the checklist is already dismissed, so every pre-existing
    // assertion in this suite sees the same dashboard it always saw. The
    // first-run branches opt in explicitly.
    Object.assign(mockFirstRun, {
      bookmarkCount: undefined,
      documentCount: undefined,
      searchTried: false,
      dismissed: true,
      dismiss: vi.fn(),
    });
    // Default: no backup at all → the reminder shows (matches the pre-F0-3
    // "no manual backup date" behaviour). Individual branches override.
    mockGetLatestBackupAgeMs.mockResolvedValue(null);

    // `clearAllMocks` resets call history, not custom implementations. Reset
    // every mutable async fixture here so one branch (e.g. a rejected DB
    // query) cannot leak resolved data into later interaction tests and make
    // React report genuine updates outside `act(...)`.
    vi.mocked(initDB).mockResolvedValue(mockDB as any);
    mockDB.documents.find.mockReturnValue({
      exec: vi.fn().mockResolvedValue([]),
    });
    mockDB.documents.insert.mockResolvedValue({ id: "new-doc-id" });
    mockDB.flashcards.find.mockReturnValue({
      exec: vi.fn().mockResolvedValue([]),
    });
    vi.mocked(crossPollinationService.generateInsights).mockResolvedValue([]);
    vi.mocked(crossPollinationService.generateWeeklyCuration).mockResolvedValue(
      null,
    );
    vi.mocked(documentTemplateService.getAllTemplates).mockReturnValue([]);
    vi.mocked(securityVault.hasSecret).mockResolvedValue(false);
    vi.mocked(fileSystemService.isSupported).mockReturnValue(true);
    vi.mocked(fileSystemService.requestDirectoryAccess).mockResolvedValue(true);
    vi.mocked(fileSystemService.syncFiles).mockResolvedValue(undefined);

    const mod = await import("../../components/HomeDashboard");
    HomeDashboard = mod.HomeDashboard;
  });

  afterEach(async () => {
    // Let the dashboard's resolved data effect settle while it is still
    // mounted. Cleaning up first leaves React to report legitimate async
    // updates from the previous test as unwrapped `act(...)` work.
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });
    cleanup();
    vi.restoreAllMocks();
  });

  // ── Helper: flush async useEffect state on mount ─────────────────
  // HomeDashboard fires several async effects on mount (DB queries,
  // shouldShowBackupBanner, getLatestBackupAgeMs). Wrapping render in
  // act() + a microtask flush keeps React from reporting updates
  // outside act(...).
  async function renderDashboard(
    props?: Partial<React.ComponentProps<typeof HomeDashboard>>,
  ) {
    let result: ReturnType<typeof render>;
    await act(async () => {
      result = render(
        <HomeDashboard
          onNavigate={onNavigate}
          onSelectDocument={onSelectDocument}
          {...props}
        />,
      );
      // Flush microtasks so async effects (DB init, backup banner check)
      // resolve and their state updates land inside act().
      await new Promise<void>((r) => setTimeout(r, 0));
    });
    return result!;
  }

  // ── Basic rendering ──────────────────────────────────────────────────

  it("renders without errors", async () => {
    const { container } = await renderDashboard();
    expect(container).toBeTruthy();
  });

  it("renders welcome message", async () => {
    await renderDashboard();
    expect(screen.getByText("app_welcome")).toBeTruthy();
  });

  it("renders new document button", async () => {
    await renderDashboard();
    expect(screen.getByText("app_newDocument")).toBeTruthy();
  });

  it("navigates to documents on new document button click", async () => {
    await renderDashboard()
    fireEvent.click(screen.getByText("app_newDocument"));
    expect(onNavigate).toHaveBeenCalledWith("documents");
  });

  // ── NavCard clicks ──────────────────────────────────────────────────

  it("renders NavCards for all sections", async () => {
    await renderDashboard()
    const navCards = screen.getAllByTestId("nav-card");
    expect(navCards.length).toBeGreaterThanOrEqual(6);
  });

  it("renders QuickTips and StorageStatus", async () => {
    await renderDashboard()
    expect(screen.getByTestId("quick-tips")).toBeTruthy();
    expect(screen.getByTestId("storage-status")).toBeTruthy();
  });

  // ── First-run checklist ────────────────────────────────────────────

  it("shows the checklist and hides the daily tip while it is pending", async () => {
    Object.assign(mockFirstRun, { dismissed: false, searchTried: false });

    await renderDashboard();

    expect(screen.getByTestId("first-run-checklist")).toBeTruthy();
    expect(screen.queryByTestId("quick-tips")).toBeNull();
  });

  it("hides the checklist once all three steps are complete", async () => {
    Object.assign(mockFirstRun, {
      dismissed: false,
      bookmarkCount: 2,
      documentCount: 1,
      searchTried: true,
    });

    await renderDashboard();

    expect(screen.queryByTestId("first-run-checklist")).toBeNull();
    expect(screen.getByTestId("quick-tips")).toBeTruthy();
  });

  it("keeps the checklist while the search step is still missing", async () => {
    Object.assign(mockFirstRun, {
      dismissed: false,
      bookmarkCount: 2,
      documentCount: 1,
      searchTried: false,
    });

    await renderDashboard();

    expect(screen.getByTestId("first-run-checklist")).toBeTruthy();
  });

  it("stays hidden when the checklist was dismissed", async () => {
    Object.assign(mockFirstRun, { dismissed: true, bookmarkCount: 0 });

    await renderDashboard();

    expect(screen.queryByTestId("first-run-checklist")).toBeNull();
  });

  it("wires checklist steps to navigation, search and dismissal", async () => {
    Object.assign(mockFirstRun, { dismissed: false });

    await renderDashboard();

    fireEvent.click(screen.getByTestId("first-run-capture"));
    expect(onNavigate).toHaveBeenCalledWith("bookmarks");

    fireEvent.click(screen.getByTestId("first-run-create"));
    expect(onNavigate).toHaveBeenCalledWith("documents");

    const searchSpy = vi.fn();
    window.addEventListener("forge:open-search", searchSpy);
    fireEvent.click(screen.getByTestId("first-run-search"));
    expect(searchSpy).toHaveBeenCalledTimes(1);
    window.removeEventListener("forge:open-search", searchSpy);

    fireEvent.click(screen.getByTestId("first-run-dismiss"));
    expect(mockFirstRun.dismiss).toHaveBeenCalledTimes(1);
  });

  it("opens ResearchAssistant via the Web Research NavCard", async () => {
    await renderDashboard()
    expect(screen.queryByTestId("research-assistant")).toBeNull();
    const navCards = screen.getAllByTestId("nav-card");
    const researchCard = navCards.find((c) =>
      c.textContent?.includes("Web Research"),
    );
    expect(researchCard).toBeTruthy();
    fireEvent.click(researchCard!);
    expect(screen.getByTestId("research-assistant")).toBeTruthy();
  });

  it("closes ResearchAssistant via onClose", async () => {
    await renderDashboard()
    const navCards = screen.getAllByTestId("nav-card");
    const researchCard = navCards.find((c) =>
      c.textContent?.includes("Web Research"),
    );
    act(() => {
      fireEvent.click(researchCard!);
    });
    expect(screen.getByTestId("research-assistant")).toBeTruthy();
    act(() => {
      fireEvent.click(screen.getByTestId("research-close"));
    });
    expect(screen.queryByTestId("research-assistant")).toBeNull();
  });

  it("navigates to chatLocal on chat card click", async () => {
    await renderDashboard()
    const chatCard = screen.getByText("app_chatLocal");
    fireEvent.click(chatCard.closest('[role="button"]')!);
    expect(onNavigate).toHaveBeenCalledWith("chatLocal");
  });

  it("navigates to bookmarks when bookmark NavCard is clicked", async () => {
    await renderDashboard()
    const navCards = screen.getAllByTestId("nav-card");
    const bookmarkCard = navCards.find((c) =>
      c.textContent?.includes("app_bookmarksTitle"),
    );
    expect(bookmarkCard).toBeTruthy();
    fireEvent.click(bookmarkCard!);
    expect(onNavigate).toHaveBeenCalledWith("bookmarks");
  });

  it("navigates to analytics when analytics NavCard is clicked", async () => {
    await renderDashboard()
    const navCards = screen.getAllByTestId("nav-card");
    const analyticsCard = navCards.find((c) =>
      c.textContent?.includes("app_analytics"),
    );
    expect(analyticsCard).toBeTruthy();
    fireEvent.click(analyticsCard!);
    expect(onNavigate).toHaveBeenCalledWith("analytics");
  });

  it("navigates to graph when graph NavCard is clicked", async () => {
    await renderDashboard()
    const navCards = screen.getAllByTestId("nav-card");
    const graphCard = navCards.find((c) =>
      c.textContent?.includes("app_graph"),
    );
    expect(graphCard).toBeTruthy();
    fireEvent.click(graphCard!);
    expect(onNavigate).toHaveBeenCalledWith("graph");
  });

  it("navigates to chat when support NavCard is clicked", async () => {
    await renderDashboard()
    const navCards = screen.getAllByTestId("nav-card");
    const supportCard = navCards.find((c) =>
      c.textContent?.includes("Support & Help"),
    );
    expect(supportCard).toBeTruthy();
    fireEvent.click(supportCard!);
    expect(onNavigate).toHaveBeenCalledWith("chat");
  });

  it("navigates to voiceLocal when voice NavCard is clicked", async () => {
    await renderDashboard()
    const navCards = screen.getAllByTestId("nav-card");
    const voiceCard = navCards.find((c) =>
      c.textContent?.includes("app_voiceLocal"),
    );
    expect(voiceCard).toBeTruthy();
    fireEvent.click(voiceCard!);
    expect(onNavigate).toHaveBeenCalledWith("voiceLocal");
  });

  it("navigates to collaboration when collaboration NavCard is clicked", async () => {
    await renderDashboard()
    const navCards = screen.getAllByTestId("nav-card");
    const collabCard = navCards.find((c) =>
      c.textContent?.includes("app_collaborationTitle"),
    );
    expect(collabCard).toBeTruthy();
    fireEvent.click(collabCard!);
    expect(onNavigate).toHaveBeenCalledWith("collaboration");
  });

  // ── EvictionBanner: checkEvictionRisk branches ──────────────────────

  it("shows eviction banner on Safari iOS when no cloud config and not dismissed", async () => {
    const originalUA = navigator.userAgent;
    Object.defineProperty(navigator, "userAgent", {
      value:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15",
      configurable: true,
    });
    localStorage.removeItem("forge_eviction_banner_dismissed");
    vi.mocked(securityVault.hasSecret).mockResolvedValue(false);

    await renderDashboard()

    await waitFor(() => {
      expect(screen.queryByTestId("eviction-banner")).toBeTruthy();
    });

    Object.defineProperty(navigator, "userAgent", {
      value: originalUA,
      configurable: true,
    });
  });

  it("does not show eviction banner when already dismissed", async () => {
    const originalUA = navigator.userAgent;
    Object.defineProperty(navigator, "userAgent", {
      value:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15",
      configurable: true,
    });
    localStorage.setItem("forge_eviction_banner_dismissed", "true");

    await renderDashboard()

    await waitFor(() => {
      expect(screen.queryByTestId("eviction-banner")).toBeNull();
    });

    Object.defineProperty(navigator, "userAgent", {
      value: originalUA,
      configurable: true,
    });
  });

  it("does not show eviction banner on non-Safari iOS", async () => {
    const originalUA = navigator.userAgent;
    Object.defineProperty(navigator, "userAgent", {
      value: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      configurable: true,
    });

    await renderDashboard()

    await waitFor(() => {
      expect(screen.queryByTestId("eviction-banner")).toBeNull();
    });

    Object.defineProperty(navigator, "userAgent", {
      value: originalUA,
      configurable: true,
    });
  });

  it("does not show eviction banner when has cloud config", async () => {
    const originalUA = navigator.userAgent;
    Object.defineProperty(navigator, "userAgent", {
      value:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15",
      configurable: true,
    });
    localStorage.removeItem("forge_eviction_banner_dismissed");
    vi.mocked(securityVault.hasSecret).mockResolvedValue(true);

    await renderDashboard()

    await waitFor(() => {
      expect(screen.queryByTestId("eviction-banner")).toBeNull();
    });

    Object.defineProperty(navigator, "userAgent", {
      value: originalUA,
      configurable: true,
    });
  });

  it("dismisses eviction banner and saves to localStorage", async () => {
    const originalUA = navigator.userAgent;
    Object.defineProperty(navigator, "userAgent", {
      value:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15",
      configurable: true,
    });
    localStorage.removeItem("forge_eviction_banner_dismissed");
    vi.mocked(securityVault.hasSecret).mockResolvedValue(false);

    await renderDashboard()

    await waitFor(() => {
      expect(screen.queryByTestId("eviction-banner")).toBeTruthy();
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("eviction-dismiss"));
    });
    expect(screen.queryByTestId("eviction-banner")).toBeNull();
    expect(localStorage.getItem("forge_eviction_banner_dismissed")).toBe(
      "true",
    );

    Object.defineProperty(navigator, "userAgent", {
      value: originalUA,
      configurable: true,
    });
  });

  it("onConfigureSync dispatches forge:open-settings event", async () => {
    const originalUA = navigator.userAgent;
    Object.defineProperty(navigator, "userAgent", {
      value:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15",
      configurable: true,
    });
    localStorage.removeItem("forge_eviction_banner_dismissed");
    vi.mocked(securityVault.hasSecret).mockResolvedValue(false);

    const eventSpy = vi.fn();
    window.addEventListener("forge:open-settings", eventSpy);

    await renderDashboard()

    await waitFor(() => {
      expect(screen.queryByTestId("eviction-banner")).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId("eviction-configure"));
    expect(eventSpy).toHaveBeenCalled();

    window.removeEventListener("forge:open-settings", eventSpy);
    Object.defineProperty(navigator, "userAgent", {
      value: originalUA,
      configurable: true,
    });
  });

  // ── BackupReminderBanner: checkBackupStatus branches ─────────────────

  it("shows backup banner when no backup has ever run", async () => {
    localStorage.removeItem("forge_backup_banner_dismissed_until");
    mockGetLatestBackupAgeMs.mockResolvedValue(null);

    await renderDashboard()

    await waitFor(() => {
      expect(screen.queryByTestId("backup-banner")).toBeTruthy();
    });
  });

  it("shows backup banner when the latest backup is over 48h old", async () => {
    localStorage.removeItem("forge_backup_banner_dismissed_until");
    mockGetLatestBackupAgeMs.mockResolvedValue(60 * 60 * 60 * 1000); // 60 h

    await renderDashboard()

    await waitFor(() => {
      expect(screen.queryByTestId("backup-banner")).toBeTruthy();
    });
  });

  it("does not show backup banner when the latest backup is under 48h", async () => {
    localStorage.removeItem("forge_backup_banner_dismissed_until");
    // A fresh daily auto-backup (F0-1) keeps the reminder quiet even when
    // the user never did a manual export.
    mockGetLatestBackupAgeMs.mockResolvedValue(5 * 60 * 60 * 1000); // 5 h

    await renderDashboard()

    await waitFor(() => {
      expect(mockGetLatestBackupAgeMs).toHaveBeenCalled();
    });
    expect(screen.queryByTestId("backup-banner")).toBeNull();
  });

  it("does not show backup banner when dismissed and not expired", async () => {
    const futureTime = Date.now() + 7 * 24 * 60 * 60 * 1000;
    localStorage.setItem(
      "forge_backup_banner_dismissed_until",
      futureTime.toString(),
    );

    await renderDashboard()

    await waitFor(() => {
      expect(screen.queryByTestId("backup-banner")).toBeNull();
    });
  });

  it("shows backup banner when dismissed but expired", async () => {
    const pastTime = Date.now() - 1000;
    localStorage.setItem(
      "forge_backup_banner_dismissed_until",
      pastTime.toString(),
    );
    localStorage.removeItem("forge_last_manual_backup_date");

    await renderDashboard()

    await waitFor(() => {
      expect(screen.queryByTestId("backup-banner")).toBeTruthy();
    });
  });

  it("does not show backup banner when eviction banner is shown", async () => {
    const originalUA = navigator.userAgent;
    Object.defineProperty(navigator, "userAgent", {
      value:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15",
      configurable: true,
    });
    localStorage.removeItem("forge_eviction_banner_dismissed");
    localStorage.removeItem("forge_last_manual_backup_date");
    vi.mocked(securityVault.hasSecret).mockResolvedValue(false);

    await renderDashboard()

    await waitFor(() => {
      expect(screen.queryByTestId("eviction-banner")).toBeTruthy();
    });

    await waitFor(() => {
      expect(screen.queryByTestId("backup-banner")).toBeNull();
    });

    Object.defineProperty(navigator, "userAgent", {
      value: originalUA,
      configurable: true,
    });
  });

  it("dismisses backup banner and sets future dismissal time", async () => {
    localStorage.removeItem("forge_last_manual_backup_date");
    localStorage.removeItem("forge_backup_banner_dismissed_until");

    await renderDashboard()

    await waitFor(() => {
      expect(screen.queryByTestId("backup-banner")).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId("backup-dismiss"));
    expect(screen.queryByTestId("backup-banner")).toBeNull();

    const dismissedUntil = parseInt(
      localStorage.getItem("forge_backup_banner_dismissed_until") || "0",
      10,
    );
    expect(dismissedUntil).toBeGreaterThan(Date.now());
  });

  // ── Backup banner: 60 s interval re-evaluation ────────────────────

  it("backup banner reappears automatically when backup crosses 48h via 60s interval", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      localStorage.removeItem("forge_backup_banner_dismissed_until");
      // Start with a fresh backup (5 h old) — banner should be hidden.
      mockGetLatestBackupAgeMs.mockResolvedValue(5 * 60 * 60 * 1000);

      await renderDashboard();

      await waitFor(() => {
        expect(mockGetLatestBackupAgeMs).toHaveBeenCalled();
      });
      expect(screen.queryByTestId("backup-banner")).toBeNull();

      // Simulate the backup aging past 48 h.
      mockGetLatestBackupAgeMs.mockResolvedValue(50 * 60 * 60 * 1000);

      // Advance past the 60 s interval so the refresh fires.
      await act(async () => {
        vi.advanceTimersByTime(61_000);
      });

      await waitFor(() => {
        expect(screen.queryByTestId("backup-banner")).toBeTruthy();
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("backup banner stays hidden when backup remains fresh across 60s interval", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      localStorage.removeItem("forge_backup_banner_dismissed_until");
      mockGetLatestBackupAgeMs.mockResolvedValue(10 * 60 * 60 * 1000); // 10 h

      await renderDashboard();

      await waitFor(() => {
        expect(mockGetLatestBackupAgeMs).toHaveBeenCalled();
      });
      expect(screen.queryByTestId("backup-banner")).toBeNull();

      // Advance 5 minutes — interval fires 5 times but backup is still fresh.
      await act(async () => {
        vi.advanceTimersByTime(5 * 60_000);
      });

      expect(screen.queryByTestId("backup-banner")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  // ── fetchData branches ──────────────────────────────────────────────

  it("fetches and displays recent documents", async () => {
    const mockDocs = [
      {
        id: "d1",
        title: "Doc 1",
        content: "",
        tags: [],
        createdAt: "2026-01-01",
        updatedAt: "2026-01-02",
        isDeleted: false,
        toJSON() {
          return this;
        },
      },
      {
        id: "d2",
        title: "Doc 2",
        content: "",
        tags: [],
        createdAt: "2026-01-01",
        updatedAt: "2026-01-03",
        isDeleted: false,
        toJSON() {
          return this;
        },
      },
    ];
    vi.mocked(mockDB.documents.find).mockReturnValue({
      exec: vi.fn().mockResolvedValue(mockDocs),
    } as any);
    vi.mocked(mockDB.flashcards.find).mockReturnValue({
      exec: vi.fn().mockResolvedValue([]),
    } as any);

    await renderDashboard()

    await waitFor(() => {
      expect(screen.getByText("Doc 1")).toBeTruthy();
      expect(screen.getByText("Doc 2")).toBeTruthy();
    });
  });

  it("shows empty state when no recent docs", async () => {
    vi.mocked(mockDB.documents.find).mockReturnValue({
      exec: vi.fn().mockResolvedValue([]),
    } as any);
    vi.mocked(mockDB.flashcards.find).mockReturnValue({
      exec: vi.fn().mockResolvedValue([]),
    } as any);

    await renderDashboard()

    await waitFor(() => {
      expect(screen.getByText("app_noDocumentsYet")).toBeTruthy();
    });
  });

  it("selects document when recent doc is clicked", async () => {
    const mockDocs = [
      {
        id: "d1",
        title: "Doc 1",
        content: "",
        tags: [],
        createdAt: "2026-01-01",
        updatedAt: "2026-01-02",
        isDeleted: false,
        toJSON() {
          return this;
        },
      },
    ];
    vi.mocked(mockDB.documents.find).mockReturnValue({
      exec: vi.fn().mockResolvedValue(mockDocs),
    } as any);

    await renderDashboard()

    await waitFor(() => {
      expect(screen.getByText("Doc 1")).toBeTruthy();
    });

    fireEvent.click(screen.getByText("Doc 1"));
    expect(onSelectDocument).toHaveBeenCalledWith("d1");
  });

  it("selects document on Enter keydown on recent doc", async () => {
    const mockDocs = [
      {
        id: "d1",
        title: "Doc 1",
        content: "",
        tags: [],
        createdAt: "2026-01-01",
        updatedAt: "2026-01-02",
        isDeleted: false,
        toJSON() {
          return this;
        },
      },
    ];
    vi.mocked(mockDB.documents.find).mockReturnValue({
      exec: vi.fn().mockResolvedValue(mockDocs),
    } as any);

    await renderDashboard()

    await waitFor(() => {
      expect(screen.getByText("Doc 1")).toBeTruthy();
    });

    fireEvent.keyDown(screen.getByText("Doc 1").closest('[role="button"]')!, {
      key: "Enter",
    });
    expect(onSelectDocument).toHaveBeenCalledWith("d1");
  });

  it("schedules SRS notification when dueCards > 0", async () => {
    const now = new Date().toISOString();
    vi.mocked(mockDB.flashcards.find).mockReturnValue({
      exec: vi.fn().mockResolvedValue([
        { id: "f1", nextReview: now },
        { id: "f2", nextReview: now },
      ]),
    } as any);

    await renderDashboard()

    await waitFor(() => {
      expect(notificationService.scheduleSRSNotification).toHaveBeenCalledWith(
        2,
      );
    });
  });

  it("does not schedule SRS notification when dueCards === 0", async () => {
    vi.mocked(mockDB.flashcards.find).mockReturnValue({
      exec: vi.fn().mockResolvedValue([]),
    } as any);

    await renderDashboard()

    await waitFor(() => {
      expect(mockDB.documents.find).toHaveBeenCalled();
    });

    expect(notificationService.scheduleSRSNotification).not.toHaveBeenCalled();
  });

  // ── InsightCards ────────────────────────────────────────────────────

  it("shows InsightCards when insights > 0", async () => {
    vi.mocked(crossPollinationService.generateInsights).mockResolvedValue([
      {
        id: "i1",
        type: "connection",
        title: "Insight 1",
        content: "",
        relatedIds: ["d1"],
        createdAt: "",
        isRead: false,
      },
    ]);

    await renderDashboard()

    await waitFor(() => {
      expect(screen.queryByTestId("insight-cards")).toBeTruthy();
    });
  });

  it("does not show InsightCards when no insights", async () => {
    vi.mocked(crossPollinationService.generateInsights).mockResolvedValue([]);

    await renderDashboard()

    await waitFor(() => {
      expect(mockDB.documents.find).toHaveBeenCalled();
    });

    expect(screen.queryByTestId("insight-cards")).toBeNull();
  });

  it("insights include weekly curation when available", async () => {
    const curation = {
      id: "w1",
      type: "summary",
      title: "Weekly",
      content: "",
      relatedIds: [],
      createdAt: "",
      isRead: false,
    };
    vi.mocked(crossPollinationService.generateWeeklyCuration).mockResolvedValue(
      curation as any,
    );
    vi.mocked(crossPollinationService.generateInsights).mockResolvedValue([
      {
        id: "i1",
        type: "connection",
        title: "I1",
        content: "",
        relatedIds: [],
        createdAt: "",
        isRead: false,
      },
    ]);

    await renderDashboard()

    await waitFor(() => {
      expect(screen.queryByTestId("insight-cards")).toBeTruthy();
    });
    expect(screen.getByText("2 insights")).toBeTruthy();
  });

  it("insights are just the new ones when no weekly curation", async () => {
    vi.mocked(crossPollinationService.generateWeeklyCuration).mockResolvedValue(
      null,
    );
    vi.mocked(crossPollinationService.generateInsights).mockResolvedValue([
      {
        id: "i1",
        type: "connection",
        title: "I1",
        content: "",
        relatedIds: [],
        createdAt: "",
        isRead: false,
      },
    ]);

    await renderDashboard()

    await waitFor(() => {
      expect(screen.queryByTestId("insight-cards")).toBeTruthy();
    });
    expect(screen.getByText("1 insights")).toBeTruthy();
  });

  it("aborts insight loading when the dashboard unmounts", async () => {
    let resolveInsights!: (insights: never[]) => void;
    vi.mocked(crossPollinationService.generateInsights).mockReturnValue(
      new Promise((resolve) => {
        resolveInsights = resolve;
      }),
    );

    const { unmount } = render(
      <HomeDashboard
        onNavigate={onNavigate}
        onSelectDocument={onSelectDocument}
      />,
    );

    await waitFor(() => {
      expect(crossPollinationService.generateInsights).toHaveBeenCalled();
    });
    const signal = vi.mocked(crossPollinationService.generateInsights).mock
      .calls[0]?.[1];
    expect(signal).toBeInstanceOf(AbortSignal);

    unmount();
    expect(signal?.aborted).toBe(true);

    await act(async () => {
      resolveInsights([]);
      await Promise.resolve();
    });
    expect(crossPollinationService.generateWeeklyCuration).not.toHaveBeenCalled();
  });

  it("insight onAction selects document when relatedIds > 0", async () => {
    vi.mocked(crossPollinationService.generateInsights).mockResolvedValue([
      {
        id: "i1",
        type: "connection",
        title: "I1",
        content: "",
        relatedIds: ["doc-related"],
        createdAt: "",
        isRead: false,
      },
    ]);

    await renderDashboard()

    await waitFor(() => {
      expect(screen.queryByTestId("insight-cards")).toBeTruthy();
    });
  });

  // ── SRSReviewCard ──────────────────────────────────────────────────

  it("shows SRSReviewCard when dueCardsCount > 0", async () => {
    const now = new Date().toISOString();
    vi.mocked(mockDB.flashcards.find).mockReturnValue({
      exec: vi.fn().mockResolvedValue([{ id: "f1", nextReview: now }]),
    } as any);

    await renderDashboard()

    await waitFor(() => {
      expect(screen.queryByTestId("srs-review-card")).toBeTruthy();
    });
    expect(screen.getByTestId("srs-count").textContent).toBe("1");
  });

  it("does not show SRSReviewCard when dueCardsCount === 0", async () => {
    vi.mocked(mockDB.flashcards.find).mockReturnValue({
      exec: vi.fn().mockResolvedValue([]),
    } as any);

    await renderDashboard()

    await waitFor(() => {
      expect(mockDB.documents.find).toHaveBeenCalled();
    });

    expect(screen.queryByTestId("srs-review-card")).toBeNull();
  });

  it("SRSReviewCard start review navigates to analytics", async () => {
    const now = new Date().toISOString();
    vi.mocked(mockDB.flashcards.find).mockReturnValue({
      exec: vi.fn().mockResolvedValue([{ id: "f1", nextReview: now }]),
    } as any);

    await renderDashboard()

    await waitFor(() => {
      expect(screen.queryByTestId("srs-review-card")).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId("srs-start"));
    expect(onNavigate).toHaveBeenCalledWith("analytics");
  });

  // ── TemplateModal ──────────────────────────────────────────────────

  it("opens template modal when templates button clicked", async () => {
    await renderDashboard()

    const templatesBtn = screen.getByText("app_templates");
    await act(async () => {
      fireEvent.click(templatesBtn);
    });
    expect(screen.queryByTestId("template-modal")).toBeTruthy();
  });

  it("closes template modal on close button", async () => {
    await renderDashboard()

    await act(async () => {
      fireEvent.click(screen.getByText("app_templates"));
    });
    expect(screen.queryByTestId("template-modal")).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByTestId("template-close"));
    });
    expect(screen.queryByTestId("template-modal")).toBeNull();
  });

  it("handleCreateFromTemplate success path", async () => {
    await renderDashboard()
    fireEvent.click(screen.getByText("app_templates"));

    await waitFor(() => {
      expect(screen.queryByTestId("template-modal")).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId("template-create"));

    await waitFor(() => {
      expect(mockDB.documents.insert).toHaveBeenCalled();
      expect(onSelectDocument).toHaveBeenCalledWith("new-doc-id");
      expect(onNavigate).toHaveBeenCalledWith("documents");
      expect(screen.queryByTestId("template-modal")).toBeNull();
      expect(toast.success).toHaveBeenCalled();
    });
  });

  it("discards template creation after unmount", async () => {
    let resolveInsert!: (value: { id: string }) => void;
    const pendingInsert = new Promise<{ id: string }>((resolve) => {
      resolveInsert = resolve;
    });
    vi.mocked(mockDB.documents.insert).mockReturnValueOnce(pendingInsert);

    const { unmount } = render(
      <HomeDashboard
        onNavigate={onNavigate}
        onSelectDocument={onSelectDocument}
      />,
    );
    fireEvent.click(screen.getByText("app_templates"));
    await waitFor(() => {
      expect(screen.queryByTestId("template-modal")).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId("template-create"));
    await waitFor(() => {
      expect(mockDB.documents.insert).toHaveBeenCalled();
    });
    unmount();
    resolveInsert!({ id: "stale-doc" });
    await act(async () => { await Promise.resolve(); });

    expect(onSelectDocument).not.toHaveBeenCalledWith("stale-doc");
    expect(onNavigate).not.toHaveBeenCalledWith("documents");
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("handleCreateFromTemplate error path", async () => {
    vi.mocked(mockDB.documents.insert).mockRejectedValueOnce(
      new Error("insert failed"),
    );

    await renderDashboard()
    fireEvent.click(screen.getByText("app_templates"));

    await waitFor(() => {
      expect(screen.queryByTestId("template-modal")).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId("template-create"));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalled();
    });
  });

  // ── handleOpenFolder branches ───────────────────────────────────────

  it("shows error when file system not supported", async () => {
    vi.mocked(fileSystemService.isSupported).mockReturnValue(false);

    await renderDashboard()
    const navCards = screen.getAllByTestId("nav-card");
    const folderCard = navCards.find((c) =>
      c.textContent?.includes("app_localFolder"),
    );
    expect(folderCard).toBeTruthy();

    fireEvent.click(folderCard!);

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("app_browserNotSupported");
    });
  });

  it("shows error when directory access denied", async () => {
    vi.mocked(fileSystemService.isSupported).mockReturnValue(true);
    vi.mocked(fileSystemService.requestDirectoryAccess).mockResolvedValue(
      false,
    );

    await renderDashboard()
    const navCards = screen.getAllByTestId("nav-card");
    const folderCard = navCards.find((c) =>
      c.textContent?.includes("app_localFolder"),
    );

    fireEvent.click(folderCard!);

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("app_directoryAccessDenied");
    });
  });

  it("syncs files on successful directory access", async () => {
    vi.mocked(fileSystemService.isSupported).mockReturnValue(true);
    vi.mocked(fileSystemService.requestDirectoryAccess).mockResolvedValue(true);
    vi.mocked(fileSystemService.syncFiles).mockResolvedValue(undefined);

    await renderDashboard()
    const navCards = screen.getAllByTestId("nav-card");
    const folderCard = navCards.find((c) =>
      c.textContent?.includes("app_localFolder"),
    );

    fireEvent.click(folderCard!);

    await waitFor(() => {
      expect(toast.loading).toHaveBeenCalledWith("app_indexingFiles");
      expect(fileSystemService.syncFiles).toHaveBeenCalled();
      expect(toast.success).toHaveBeenCalledWith("app_folderOpenedSuccess");
    });
  });

  it("shows error when syncFiles fails", async () => {
    vi.mocked(fileSystemService.isSupported).mockReturnValue(true);
    vi.mocked(fileSystemService.requestDirectoryAccess).mockResolvedValue(true);
    vi.mocked(fileSystemService.syncFiles).mockRejectedValue(
      new Error("sync failed"),
    );

    await renderDashboard()
    const navCards = screen.getAllByTestId("nav-card");
    const folderCard = navCards.find((c) =>
      c.textContent?.includes("app_localFolder"),
    );

    fireEvent.click(folderCard!);

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("app_indexingError");
    });
  });

  // ── ForgottenConnections ───────────────────────────────────────────

  it("renders ForgottenConnections and navigates to bookmarks on select", async () => {
    await renderDashboard()
    const forgotten = screen.getByTestId("forgotten-connections");
    fireEvent.click(forgotten);
    expect(onNavigate).toHaveBeenCalledWith("bookmarks");
  });

  // ── Keyboard navigation ────────────────────────────────────────────

  it("navigates to documents on Enter key in documents card", async () => {
    await renderDashboard()
    const docsCard = screen
      .getByText("app_documents")
      .closest(".bento-item")! as HTMLElement;
    fireEvent.keyDown(docsCard, { key: "Enter" });
    expect(onNavigate).toHaveBeenCalledWith("documents");
  });

  it("navigates to documents on Space key in documents card", async () => {
    await renderDashboard()
    const docsCard = screen
      .getByText("app_documents")
      .closest(".bento-item")! as HTMLElement;
    fireEvent.keyDown(docsCard, { key: " " });
    expect(onNavigate).toHaveBeenCalledWith("documents");
  });

  it("navigates to chatLocal on Enter key in chat card", async () => {
    await renderDashboard()
    const chatCard = screen
      .getByText("app_chatLocal")
      .closest('[role="button"]')!;
    fireEvent.keyDown(chatCard, { key: "Enter" });
    expect(onNavigate).toHaveBeenCalledWith("chatLocal");
  });

  // ── fetchData error handling ────────────────────────────────────────

  it("catches errors during fetchData", async () => {
    vi.mocked(initDB).mockRejectedValueOnce(new Error("db error"));

    await renderDashboard()

    await waitFor(() => {
      expect(initDB).toHaveBeenCalled();
    });
  });

  // ── Elapsed days edge cases ────────────────────────────────────────

  it("shows backup banner just over 48h", async () => {
    localStorage.removeItem("forge_backup_banner_dismissed_until");
    mockGetLatestBackupAgeMs.mockResolvedValue(
      48 * 60 * 60 * 1000 + 1, // just past the threshold
    );

    await renderDashboard()

    await waitFor(() => {
      expect(screen.queryByTestId("backup-banner")).toBeTruthy();
    });
  });

  it("does not show backup banner at exactly 48h", async () => {
    localStorage.removeItem("forge_backup_banner_dismissed_until");
    mockGetLatestBackupAgeMs.mockResolvedValue(48 * 60 * 60 * 1000);

    await renderDashboard()

    await waitFor(() => {
      expect(mockGetLatestBackupAgeMs).toHaveBeenCalled();
    });

    expect(screen.queryByTestId("backup-banner")).toBeNull();
  });

  // ── Templates loading ──────────────────────────────────────────────

  it("loads templates from DocumentTemplateService", async () => {
    const mockTemplates = [
      {
        id: "t1",
        name: "T1",
        content: [],
        tags: [],
        description: "",
        category: "cat",
        icon: "",
      },
    ];
    vi.mocked(documentTemplateService.getAllTemplates).mockReturnValue(
      mockTemplates,
    );

    await renderDashboard()

    await waitFor(() => {
      expect(documentTemplateService.getAllTemplates).toHaveBeenCalled();
    });
  });

  // ── No SRS notification when empty ─────────────────────────────────

  it("does not call scheduleSRSNotification with zero cards", async () => {
    vi.mocked(mockDB.flashcards.find).mockReturnValue({
      exec: vi.fn().mockResolvedValue([]),
    } as any);

    await renderDashboard()

    await waitFor(() => {
      expect(mockDB.documents.find).toHaveBeenCalled();
    });

    expect(notificationService.scheduleSRSNotification).not.toHaveBeenCalled();
  });

  // ── Backup banner shows when lastBackup date exists and expired ────

  it("shows backup banner when the latest backup is well over 48h", async () => {
    localStorage.removeItem("forge_backup_banner_dismissed_until");
    mockGetLatestBackupAgeMs.mockResolvedValue(20 * 24 * 60 * 60 * 1000); // 20 d

    await renderDashboard()

    await waitFor(() => {
      expect(screen.queryByTestId("backup-banner")).toBeTruthy();
    });
  });

  // ── Eviction banner Mac with touch (iPad mode) ─────────────────────

  it("shows eviction banner on Mac with ontouchend (iPad)", async () => {
    const originalUA = navigator.userAgent;
    Object.defineProperty(navigator, "userAgent", {
      value:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_0) AppleWebKit/605.1.15",
      configurable: true,
    });
    Object.defineProperty(document, "ontouchend", {
      value: () => {},
      configurable: true,
    });
    localStorage.removeItem("forge_eviction_banner_dismissed");
    vi.mocked(securityVault.hasSecret).mockResolvedValue(false);

    await renderDashboard()

    await waitFor(() => {
      expect(screen.queryByTestId("eviction-banner")).toBeTruthy();
    });

    Object.defineProperty(navigator, "userAgent", {
      value: originalUA,
      configurable: true,
    });
    delete (document as any).ontouchend;
  });

  // ── TemplateModal passes templates ─────────────────────────────────

  it("template modal receives templates from service", async () => {
    const mockTemplates = [
      {
        id: "t1",
        name: "Article",
        content: [],
        tags: [],
        description: "Write articles",
        category: "Writing",
        icon: "",
      },
      {
        id: "t2",
        name: "Notes",
        content: [],
        tags: [],
        description: "Quick notes",
        category: "Writing",
        icon: "",
      },
    ];
    vi.mocked(documentTemplateService.getAllTemplates).mockReturnValue(
      mockTemplates,
    );

    await renderDashboard()
    fireEvent.click(screen.getByText("app_templates"));

    await waitFor(() => {
      expect(screen.queryByTestId("template-modal")).toBeTruthy();
    });
  });
});
