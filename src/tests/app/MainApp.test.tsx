import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// ── Barrel mock: all 21 mock factories live in a single file so the test
//    file only needs string-path vi.mock() calls (no dynamic import()
//    expressions), reducing hoisting overhead on Windows. ──────
import {
  mockUseTheme,
  mockUseTabManager,
  mockUseTranslation,
  createI18nMock,
  createThemeContextMock,
  createUseMemoryPressureMock,
  createUseTabManagerMock,
  createUseKeyboardShortcutsMock,
  createUseAIStatusMock,
  createUseClipperSyncMock,
  createUseAppLifecycleMock,
  createUseRoutePrefetchMock,
  createAutoLockManagerMock,
  createReactRouterMock,
  createHeaderMock,
  createSidebarMock,
  createQuickCaptureMock,
  createKeyboardShortcutsMock,
  createBottomNavMock,
  createSonnerMock,
  createAppRoutesMock,
  createDatabaseMock,
  createLazyComponentsMock,
} from "../../tests/mocks/main-app-mocks";

vi.mock("react-i18next",                () => createI18nMock());
vi.mock("../../hooks/useMemoryPressure", () => createUseMemoryPressureMock());
vi.mock("../../hooks/useTabManager",     () => createUseTabManagerMock());
vi.mock("../../hooks/useKeyboardShortcuts", () => createUseKeyboardShortcutsMock());
vi.mock("../../hooks/useAIStatus",       () => createUseAIStatusMock());
vi.mock("../../hooks/useClipperSync",    () => createUseClipperSyncMock());
vi.mock("../../hooks/useAppLifecycle",   () => createUseAppLifecycleMock());
vi.mock("../../hooks/useRoutePrefetch",  () => createUseRoutePrefetchMock());
vi.mock("../../hooks/AutoLockManager",   () => createAutoLockManagerMock());
vi.mock("../../contexts/ThemeContext",   () => createThemeContextMock());
vi.mock("react-router",               () => createReactRouterMock());
vi.mock("../../components/Header",       () => createHeaderMock());
vi.mock("../../components/Sidebar",      () => createSidebarMock());
vi.mock("../../components/QuickCapture", () => createQuickCaptureMock());
vi.mock("../../components/KeyboardShortcuts", () => createKeyboardShortcutsMock());
vi.mock("../../components/BottomNav",    () => createBottomNavMock());
vi.mock("sonner",                        () => createSonnerMock());
vi.mock("../../components/app/AppRoutes", () => createAppRoutesMock());
vi.mock("../../db/database",             () => createDatabaseMock());
vi.mock("../../components/app/lazyComponents", () => createLazyComponentsMock());

const { MainApp } = await import("../../components/app/MainApp");

describe("MainApp", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("renders Header and BottomNav", () => {
    const { getByTestId } = render(<MainApp />);
    expect(getByTestId("header")).toBeTruthy();
    expect(getByTestId("bottom-nav")).toBeTruthy();
    expect(getByTestId("app-routes")).toBeTruthy();
    expect(getByTestId("toaster")).toBeTruthy();
  });

  it("does not show Header when distraction free mode", () => {
    localStorage.setItem("distraction_free_mode", "true");
    const { queryByTestId, getByText } = render(<MainApp />);
    expect(queryByTestId("header")).toBeNull();
    expect(getByText("Exit Focus Mode")).toBeTruthy();
  });

  it("shows Header when distraction free mode is off", () => {
    localStorage.setItem("distraction_free_mode", "false");
    const { getByTestId } = render(<MainApp />);
    expect(getByTestId("header")).toBeTruthy();
  });

  it("renders with dark theme", () => {
    mockUseTheme.mockReturnValue({
      isDark: true,
      theme: "dark",
      toggleTheme: vi.fn(),
      setThemeMode: vi.fn(),
    });
    const { container } = render(<MainApp />);
    expect(container.querySelector('[data-theme="dark"]')).toBeTruthy();
  });

  it("renders Omnibar when search button clicked", async () => {
    const { getByTestId, queryByTestId } = render(<MainApp />);
    expect(queryByTestId("omnibar")).toBeNull();
    await userEvent.click(getByTestId("btn-search"));
    expect(queryByTestId("omnibar")).toBeTruthy();
  });

  it("opens the Omnibar when a surface asks for search by event", async () => {
    const { queryByTestId } = render(<MainApp />);
    expect(queryByTestId("omnibar")).toBeNull();
    // The dashboard's first-run checklist hands the user off to search this
    // way, because the Omnibar's state lives here in the shell.
    await act(async () => {
      window.dispatchEvent(new Event("forge:open-search"));
    });
    expect(queryByTestId("omnibar")).toBeTruthy();
  });

  it("records the first-run search step whenever search opens", async () => {
    const { getByTestId } = render(<MainApp />);
    expect(localStorage.getItem("forge_first_run_search_tried")).toBeNull();

    await userEvent.click(getByTestId("btn-search"));

    // Any route into search — Ctrl+K, the sidebar, voice, the checklist —
    // counts as the user having tried to retrieve something.
    expect(localStorage.getItem("forge_first_run_search_tried")).toBe("1");
  });

  it("renders Settings when settings button clicked", async () => {
    const { getByTestId, queryByTestId } = render(<MainApp />);
    expect(queryByTestId("settings")).toBeNull();
    await userEvent.click(getByTestId("btn-settings"));
    expect(queryByTestId("settings")).toBeTruthy();
  });

  it("shows Dashboard when Omnibar triggers show_analysis", async () => {
    const { getByTestId, queryByTestId } = render(<MainApp />);
    await userEvent.click(getByTestId("btn-search"));
    expect(queryByTestId("omnibar")).toBeTruthy();
    expect(queryByTestId("dashboard")).toBeNull();
    await userEvent.click(getByTestId("omnibar-analysis"));
    expect(queryByTestId("dashboard")).toBeTruthy();
  });

  it("shows FlashcardReview when Omnibar triggers show_flashcards", async () => {
    const { getByTestId, queryByTestId } = render(<MainApp />);
    await userEvent.click(getByTestId("btn-search"));
    await userEvent.click(getByTestId("omnibar-flashcards"));
    expect(queryByTestId("flashcard-review")).toBeTruthy();
  });

  it("creates a document when Omnibar triggers create_doc", async () => {
    const setCurrentDocId = vi.fn();
    const setActiveTab = vi.fn();
    mockUseTabManager.mockReturnValue({
      activeTab: "dashboard",
      setActiveTab,
      currentDocId: "",
      setCurrentDocId,
    });
    const { getByTestId, queryByTestId } = render(<MainApp />);
    await userEvent.click(getByTestId("btn-search"));
    await userEvent.click(getByTestId("omnibar-create-doc"));
    await vi.waitFor(() => {
      expect(setCurrentDocId).toHaveBeenCalledWith(expect.any(String));
    });
    expect(setActiveTab).toHaveBeenCalledWith("editor");
    expect(queryByTestId("omnibar")).toBeNull();
  });

  it("toggles theme when Omnibar triggers toggle_theme", async () => {
    const toggleTheme = vi.fn();
    mockUseTheme.mockReturnValue({
      isDark: false,
      theme: "light",
      toggleTheme,
      setThemeMode: vi.fn(),
    });
    const { getByTestId } = render(<MainApp />);
    await userEvent.click(getByTestId("btn-search"));
    await userEvent.click(getByTestId("omnibar-toggle-theme"));
    expect(toggleTheme).toHaveBeenCalled();
  });

  it("navigates to editor when selecting a document from Omnibar", async () => {
    const setCurrentDocId = vi.fn();
    const setActiveTab = vi.fn();
    mockUseTabManager.mockReturnValue({
      activeTab: "dashboard",
      setActiveTab,
      currentDocId: "",
      setCurrentDocId,
    });
    const { getByTestId } = render(<MainApp />);
    await userEvent.click(getByTestId("btn-search"));
    await userEvent.click(getByTestId("omnibar-select-doc"));
    expect(setCurrentDocId).toHaveBeenCalledWith("omni-doc-1");
    expect(setActiveTab).toHaveBeenCalledWith("editor");
  });

  it("navigates to bookmarks when selecting a bookmark from Omnibar", async () => {
    const setActiveTab = vi.fn();
    mockUseTabManager.mockReturnValue({
      activeTab: "dashboard",
      setActiveTab,
      currentDocId: "",
      setCurrentDocId: vi.fn(),
    });
    const { getByTestId } = render(<MainApp />);
    await userEvent.click(getByTestId("btn-search"));
    await userEvent.click(getByTestId("omnibar-select-bookmark"));
    expect(setActiveTab).toHaveBeenCalledWith("bookmarks");
  });

  describe("voice actions", () => {
    it("opens the omnibar for voice action 'search'", async () => {
      const { getByTestId, queryByTestId } = render(<MainApp />);
      await userEvent.click(getByTestId("voice-action-search"));
      expect(queryByTestId("omnibar")).toBeTruthy();
    });

    it("navigates per voice action map", async () => {
      const setActiveTab = vi.fn();
      mockUseTabManager.mockReturnValue({
        activeTab: "dashboard",
        setActiveTab,
        currentDocId: "",
        setCurrentDocId: vi.fn(),
      });
      const { getByTestId } = render(<MainApp />);
      await userEvent.click(getByTestId("voice-action-bookmark"));
      expect(setActiveTab).toHaveBeenCalledWith("bookmarks");
      await userEvent.click(getByTestId("voice-action-settings"));
      expect(setActiveTab).toHaveBeenCalledWith("settings");
      await userEvent.click(getByTestId("voice-action-dashboard"));
      expect(setActiveTab).toHaveBeenCalledWith("dashboard");
      await userEvent.click(getByTestId("voice-action-chat"));
      expect(setActiveTab).toHaveBeenCalledWith("chat");
    });

    it("uses params.tab for unknown voice actions", async () => {
      const setActiveTab = vi.fn();
      mockUseTabManager.mockReturnValue({
        activeTab: "dashboard",
        setActiveTab,
        currentDocId: "",
        setCurrentDocId: vi.fn(),
      });
      const { getByTestId } = render(<MainApp />);
      await userEvent.click(getByTestId("voice-action-unknown"));
      expect(setActiveTab).toHaveBeenCalledWith("canvas");
    });

    it("ignores unknown voice actions without a tab param", async () => {
      const setActiveTab = vi.fn();
      mockUseTabManager.mockReturnValue({
        activeTab: "dashboard",
        setActiveTab,
        currentDocId: "",
        setCurrentDocId: vi.fn(),
      });
      const { getByTestId } = render(<MainApp />);
      await userEvent.click(getByTestId("voice-action-noop"));
      expect(setActiveTab).not.toHaveBeenCalled();
    });

    it("navigates for voice navigate action", async () => {
      const setActiveTab = vi.fn();
      mockUseTabManager.mockReturnValue({
        activeTab: "dashboard",
        setActiveTab,
        currentDocId: "",
        setCurrentDocId: vi.fn(),
      });
      const { getByTestId } = render(<MainApp />);
      await userEvent.click(getByTestId("voice-navigate"));
      expect(setActiveTab).toHaveBeenCalledWith("graph");
    });
  });

  describe("chat source selection", () => {
    it("opens editor for a document source", async () => {
      const setCurrentDocId = vi.fn();
      const setActiveTab = vi.fn();
      mockUseTabManager.mockReturnValue({
        activeTab: "dashboard",
        setActiveTab,
        currentDocId: "",
        setCurrentDocId,
      });
      const { getByTestId } = render(<MainApp />);
      await userEvent.click(getByTestId("chat-source-doc"));
      expect(setCurrentDocId).toHaveBeenCalledWith("doc-1");
      expect(setActiveTab).toHaveBeenCalledWith("editor");
    });

    it("opens bookmarks for a bookmark source", async () => {
      const setActiveTab = vi.fn();
      mockUseTabManager.mockReturnValue({
        activeTab: "dashboard",
        setActiveTab,
        currentDocId: "",
        setCurrentDocId: vi.fn(),
      });
      const { getByTestId } = render(<MainApp />);
      await userEvent.click(getByTestId("chat-source-bookmark"));
      expect(setActiveTab).toHaveBeenCalledWith("bookmarks");
    });
  });

  it("selects a document from AppRoutes", async () => {
    const setCurrentDocId = vi.fn();
    const setActiveTab = vi.fn();
    mockUseTabManager.mockReturnValue({
      activeTab: "dashboard",
      setActiveTab,
      currentDocId: "",
      setCurrentDocId,
    });
    const { getByTestId } = render(<MainApp />);
    await userEvent.click(getByTestId("select-document"));
    expect(setCurrentDocId).toHaveBeenCalledWith("doc-2");
    expect(setActiveTab).toHaveBeenCalledWith("editor");
  });

  // Only the language differs from the shared mock's default; spreading the
  // default keeps the same t() string/object defaultValue behavior.
  const renderWithLanguage = (language: string) => {
    mockUseTranslation.mockReturnValue({
      ...mockUseTranslation(),
      i18n: { language },
    });
    const { container } = render(<MainApp />);
    return container.querySelector("div")?.getAttribute("dir");
  };

  it("sets LTR direction for a left-to-right language", () => {
    expect(renderWithLanguage("en")).toBe("ltr");
  });

  it("sets RTL direction when language is Arabic", () => {
    expect(renderWithLanguage("ar")).toBe("rtl");
  });

  it("sets RTL direction when language is Hebrew", () => {
    expect(renderWithLanguage("he")).toBe("rtl");
  });

  it("exits focus mode and restores the header", async () => {
    localStorage.setItem("distraction_free_mode", "true");
    const { queryByTestId, getByText } = render(<MainApp />);
    expect(queryByTestId("header")).toBeNull();
    await userEvent.click(getByText("Exit Focus Mode"));
    expect(getByText("Search")).toBeTruthy();
  });

  it("navigates to the Help Center when bmf:navigate is dispatched", async () => {
    const setActiveTab = vi.fn();
    mockUseTabManager.mockReturnValue({
      activeTab: "dashboard",
      setActiveTab,
      currentDocId: "",
      setCurrentDocId: vi.fn(),
    });
    render(<MainApp />);
    window.dispatchEvent(
      new CustomEvent("bmf:navigate", { detail: { tab: "chat" } }),
    );
    expect(setActiveTab).toHaveBeenCalledWith("chat");
  });

  it("ignores bmf:navigate events without a tab", async () => {
    const setActiveTab = vi.fn();
    mockUseTabManager.mockReturnValue({
      activeTab: "dashboard",
      setActiveTab,
      currentDocId: "",
      setCurrentDocId: vi.fn(),
    });
    render(<MainApp />);
    window.dispatchEvent(new CustomEvent("bmf:navigate", { detail: {} }));
    expect(setActiveTab).not.toHaveBeenCalled();
  });
});
