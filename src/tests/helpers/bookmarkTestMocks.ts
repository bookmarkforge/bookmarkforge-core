/**
 * Shared test helpers for BookmarksTable and BookmarkFlow tests.
 *
 * Exports default return-value objects for every hook the refactored
 * BookmarksTable component uses, plus common fixtures.
 *
 * Usage (in a test file):
 *   import { baseBm, defaultBookmarkData, ... } from "../helpers/bookmarkTestMocks";
 *
 * vi.fn() mocks and vi.mock() calls stay in each test file because
 * Vitest hoists vi.mock factories above ES imports.
 */

import { vi } from "vitest";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

export const baseBm = {
  url: "https://test.com",
  tags: [] as string[],
  createdAt: "2024-01-01",
  updatedAt: "2024-01-01",
};

export const createDefaultBookmarks = (count: number) =>
  Array.from({ length: count }, (_, i) => ({
    id: `bm-${i + 1}`,
    title: `Bookmark ${i + 1}`,
    url: `https://example${i + 1}.com`,
    tags: i === 0 ? ["tag1"] : i === 1 ? ["tag2"] : [],
    createdAt: `2024-01-${String(i + 1).padStart(2, "0")}`,
    updatedAt: `2024-01-${String(i + 1).padStart(2, "0")}`,
  }));

// ---------------------------------------------------------------------------
// Default return values — one per hook the component calls
// ---------------------------------------------------------------------------

export const defaultBookmarkData = {
  bookmarks: [{ id: "1", title: "Test", ...baseBm }],
  isLoading: false,
};

export const defaultBookmarkCRUD = {
  handleDelete: vi.fn(),
  handleAddTag: vi.fn(),
  handleRemoveTag: vi.fn(),
  handleClearTags: vi.fn(),
  handleBulkDelete: vi.fn(),
  handleBulkAddTag: vi.fn(),
  handleBulkRemoveTag: vi.fn(),
  handleBulkClearTags: vi.fn(),
  handleImportHTML: vi.fn(),
  isImporting: false,
};

export const defaultBookmarkAI = {
  isSummarizing: null as string | null,
  isSummarizingAll: false,
  isGeneratingAllOverviews: false,
  isGeneratingEmbeddings: false,
  isGeneratingContent: null as string | null,
  isAutoTagging: null as string | null,
  isCleaningContent: null as string | null,
  setIsCleaningContent: vi.fn(),
  error: null as string | null,
  setError: vi.fn(),
  handleSummarize: vi.fn(),
  handleGenerateDetailedContent: vi.fn(),
  handleBulkGenerateOverviews: vi.fn(),
};

export const defaultBookmarkUI = {
  viewingContent: null as any,
  setViewingContent: vi.fn(),
  sharingBookmark: null as any,
  setSharingBookmark: vi.fn(),
  shareEmail: "",
  setShareEmail: vi.fn(),
  showApiSettings: false,
  setShowApiSettings: vi.fn(),
  apiKeyInput: "",
  setApiKeyInput: vi.fn(),
  providerInfo: {
    provider: "unknown",
    model: "",
    fullSupport: false,
    name: "",
    availableModels: [],
    isConfigured: false,
  },
  setProviderInfo: vi.fn(),
};

export const defaultBookmarkSort = {
  sortField: "createdAt" as const,
  sortDirection: "desc" as const,
  sortedBookmarks: [{ id: "1", title: "Test", ...baseBm }],
  handleSort: vi.fn(),
  SortIcon: () => null,
};

export const defaultBookmarkSearch = {
  searchQuery: "",
  setSearchQuery: vi.fn(),
  isSemanticSearch: false,
  setIsSemanticSearch: vi.fn(),
  isSearching: false,
  filteredBookmarks: [] as any[],
  selectedTags: [] as string[],
  setSelectedTags: vi.fn(),
};

export const defaultBookmarkSelection = {
  selectedIds: new Set<string>(),
  setSelectedIds: vi.fn(),
  expandedIds: new Set<string>(),
  setExpandedIds: vi.fn(),
  selectedIndex: 0,
  setSelectedIndex: vi.fn(),
  handleSelectAll: vi.fn(),
  handleSelect: vi.fn(),
  handleToggleExpand: vi.fn(),
  selectedRowRef: { current: null },
};

export const defaultBookmarkBulkActions = {
  isBulkTagging: false,
  isCleaningContent: false,
  isSummarizingCollection: false,
  isGeneratingAllOverviews: false,
  isGeneratingEmbeddings: false,
  bulkTagInput: "",
  setBulkTagInput: vi.fn(),
  handleBulkSummarize: vi.fn(),
  handleBulkAutoTag: vi.fn(),
  handleBulkAddTag: vi.fn(),
  handleBulkRemoveTag: vi.fn(),
  handleBulkClearTags: vi.fn(),
  handleBulkDelete: vi.fn(),
  handleBulkGenerateOverviews: vi.fn(),
  handleBulkGenerateEmbeddings: vi.fn(),
  handleBulkCleanContent: vi.fn(),
};

// ---------------------------------------------------------------------------
// Provider-info default (used in several overrides)
// ---------------------------------------------------------------------------

export const defaultProviderInfo = {
  provider: "unknown" as const,
  model: "",
  fullSupport: false,
  name: "",
  availableModels: [],
  isConfigured: false,
};
