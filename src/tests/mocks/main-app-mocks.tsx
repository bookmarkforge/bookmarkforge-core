/**
 * Barrel mock file for MainApp tests.
 *
 * Centralizes all 21 individual vi.mock() factories into a single module so
 * that src/tests/app/MainApp.test.tsx needs only string-path vi.mock() calls
 * (no dynamic import() expressions). This reduces the hoisting overhead that
 * contributes to Windows teardown race conditions (EnvironmentTeardownError).
 *
 * Usage from test files:
 *   import { mockUseTheme, createHeaderMock, ... } from "./main-app-mocks";
 *
 *   vi.mock("react-i18next",                () => createI18nMock());
 *   vi.mock("../../hooks/useMemoryPressure", () => createUseMemoryPressureMock());
 *   ...
 *
 * Shared mock state (mockUseTheme, mockUseTabManager, etc.) is exported so
 * tests can override return values per-test-case via mockReturnValue/mockImplementation.
 */

import { vi } from "vitest";
import type { ReactElement } from "react";

// ── Shared mock state ──────────────────────────────────────────────
// Test files import these to read/override mock return values.

export const mockUseTheme = vi.fn(() => ({
  isDark: false,
  theme: "light",
  toggleTheme: vi.fn(),
  setThemeMode: vi.fn(),
}));

// useTranslation is created by createI18nMock() but exposed here so tests can
// override the language per-case (e.g. RTL tests with i18n.language = "ar").
export const mockUseTranslation = vi.fn(() => ({
  t: (s: string, options?: any) =>
    typeof options === "string"
      ? options
      : typeof options === "object" && options?.defaultValue
        ? options.defaultValue
        : s,
  i18n: { language: "en" },
}));

export const mockUseTabManager = vi.fn(() => ({
  activeTab: "dashboard",
  setActiveTab: vi.fn(),
  currentDocId: "",
  setCurrentDocId: vi.fn(),
}));

export const mockUseAIStatus = vi.fn(() => ({
  isAIEnabled: false,
  isAILoaded: false,
  provider: "",
}));

export const mockUseRoutePrefetch = vi.fn(() => ({
  containerRef: { current: null },
}));

// ── Mock factory functions ─────────────────────────────────────────
// Each factory is a plain function returning the mock implementation.
// They are called from vi.mock("string-path", () => factory()) in the test.

export async function createI18nMock() {
  // Preserve all other exports (Trans, I18nextProvider, etc.) so
  // sub-components that import them don't get undefined at runtime.
  const actual = await vi.importActual("react-i18next");
  return {
    ...(actual as Record<string, unknown>),
    useTranslation: () => mockUseTranslation(),
    initReactI18next: { type: "3rdParty", init: () => {} },
  };
}

export function createThemeContextMock() {
  return { useTheme: mockUseTheme };
}

export function createUseMemoryPressureMock() {
  return { useMemoryPressure: vi.fn(() => false) };
}

export function createUseTabManagerMock() {
  return { useTabManager: mockUseTabManager };
}

export function createUseKeyboardShortcutsMock() {
  return { useKeyboardShortcuts: vi.fn() };
}

export function createUseAIStatusMock() {
  return { useAIStatus: mockUseAIStatus };
}

export function createUseClipperSyncMock() {
  return { useClipperSync: vi.fn() };
}

export function createUseAppLifecycleMock() {
  return { useAppLifecycle: vi.fn() };
}

export function createUseRoutePrefetchMock() {
  return { useRoutePrefetch: mockUseRoutePrefetch };
}

export function createAutoLockManagerMock() {
  return { AutoLockManager: () => null };
}

export function createReactRouterMock() {
  return {
    useNavigate: () => vi.fn(),
    useLocation: () => ({ pathname: "/" }),
  };
}

export function createHeaderMock() {
  return {
    Header: ({
      onOpenSettings,
      onOpenSearch,
    }: {
      onOpenSettings: () => void;
      onOpenSearch: () => void;
    }) =>
      (
        <div data-testid="header">
          <button data-testid="btn-search" onClick={onOpenSearch}>
            Search
          </button>
          <button data-testid="btn-settings" onClick={onOpenSettings}>
            Settings
          </button>
        </div>
      ) as ReactElement,
  };
}

export function createSidebarMock() {
  return { Sidebar: () => null };
}

export function createQuickCaptureMock() {
  return { QuickCapture: () => null };
}

export function createKeyboardShortcutsMock() {
  return { KeyboardShortcuts: () => null };
}

export function createBottomNavMock() {
  return {
    BottomNav: () => <div data-testid="bottom-nav" />,
  };
}

export function createSonnerMock() {
  return {
    Toaster: () => <div data-testid="toaster" />,
  };
}

export function createAppRoutesMock() {
  return {
    AppRoutes: ({
      onVoiceAction,
      onVoiceNavigate,
      onChatSelectSource,
      onSelectDocument,
    }: {
      onVoiceAction?: (action: string, params?: Record<string, unknown>) => void;
      onVoiceNavigate?: (tab: string) => void;
      onChatSelectSource?: (type: string, id: string) => void;
      onSelectDocument?: (id: string) => void;
    }) =>
      (
        <div data-testid="app-routes">
          <button data-testid="voice-action-search" onClick={() => onVoiceAction?.("search")}>
            Voice Search
          </button>
          <button data-testid="voice-action-bookmark" onClick={() => onVoiceAction?.("bookmark")}>
            Voice Bookmark
          </button>
          <button data-testid="voice-action-settings" onClick={() => onVoiceAction?.("settings")}>
            Voice Settings
          </button>
          <button data-testid="voice-action-dashboard" onClick={() => onVoiceAction?.("dashboard")}>
            Voice Dashboard
          </button>
          <button data-testid="voice-action-chat" onClick={() => onVoiceAction?.("chat")}>
            Voice Chat
          </button>
          <button data-testid="voice-action-unknown" onClick={() => onVoiceAction?.("unknown", { tab: "canvas" })}>
            Voice Unknown
          </button>
          <button data-testid="voice-action-noop" onClick={() => onVoiceAction?.("bogus")}>
            Voice Noop
          </button>
          <button data-testid="voice-navigate" onClick={() => onVoiceNavigate?.("graph")}>
            Voice Navigate
          </button>
          <button data-testid="chat-source-doc" onClick={() => onChatSelectSource?.("document", "doc-1")}>
            Chat Doc
          </button>
          <button data-testid="chat-source-bookmark" onClick={() => onChatSelectSource?.("bookmark", "bm-1")}>
            Chat Bookmark
          </button>
          <button data-testid="select-document" onClick={() => onSelectDocument?.("doc-2")}>
            Select Doc
          </button>
        </div>
      ) as ReactElement,
  };
}

export function createDatabaseMock() {
  return {
    initDB: vi.fn().mockResolvedValue({
      documents: { insert: vi.fn().mockResolvedValue({}) },
    }),
  };
}

export function createLazyComponentsMock() {
  return {
    Dashboard: () => <div data-testid="dashboard" />,
    Settings: () => <div data-testid="settings" />,
    FlashcardReview: () => <div data-testid="flashcard-review" />,
    Omnibar: ({
      onAction,
      onSelectDocument,
      onSelectBookmark,
    }: {
      onAction: (action: string) => void;
      onSelectDocument?: (id: string) => void;
      onSelectBookmark?: () => void;
    }) =>
      (
        <div data-testid="omnibar">
          <button
            data-testid="omnibar-create-doc"
            onClick={() => onAction("create_doc")}
          >
            Create Doc
          </button>
          <button
            data-testid="omnibar-toggle-theme"
            onClick={() => onAction("toggle_theme")}
          >
            Toggle Theme
          </button>
          <button
            data-testid="omnibar-analysis"
            onClick={() => onAction("show_analysis")}
          >
            Analysis
          </button>
          <button
            data-testid="omnibar-flashcards"
            onClick={() => onAction("show_flashcards")}
          >
            Flashcards
          </button>
          <button
            data-testid="omnibar-select-doc"
            onClick={() => onSelectDocument?.("omni-doc-1")}
          >
            Select Doc
          </button>
          <button
            data-testid="omnibar-select-bookmark"
            onClick={() => onSelectBookmark?.()}
          >
            Select Bookmark
          </button>
        </div>
      ) as ReactElement,
    AIModelHydration: () => null,
    SyncStatus: () => null,
    BackgroundProgress: () => null,
    ReloadPrompt: () => null,
  };
}
