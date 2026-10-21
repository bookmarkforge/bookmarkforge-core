import { describe, it, expect, vi } from "vitest";

describe("barrel: src/components/app", () => {
  it("should export components", async () => {
    const mod = await vi.importActual("../../components/app/index");
    expect(mod).not.toHaveProperty("MainApp");
    expect(mod).not.toHaveProperty("AppRoutes");
    expect(mod).toHaveProperty("AppContent");
  }, 30000);

  it("should NOT re-export lazy application shell components", async () => {
    const mod = await vi.importActual("../../components/app/index");
    // MainApp, AppRoutes, and CaptureApp are mounted via lazy() in
    // AppContent/App.tsx and must be imported from their source files
    // directly. AppRoutes statically imports motion/react (ui-runtime
    // vendor chunk), so re-exporting it through this eager barrel would
    // drag ui-runtime onto the entry critical path. Re-exporting MainApp
    // or CaptureApp would drag the authenticated shell or the capture
    // route into the entry critical path.
    expect(mod).not.toHaveProperty("MainApp");
    expect(mod).not.toHaveProperty("AppRoutes");
    expect(mod).not.toHaveProperty("CaptureApp");
  }, 30000);
});

describe("barrel: src/components/settings", () => {
  it("should export settings components", async () => {
    const mod = await vi.importActual("../../hooks/useSettings");
    expect(mod).toHaveProperty("useSettings");
  });
});

describe("barrel: src/components/bookmarks", () => {
  it("should export bookmark components and hooks", async () => {
    const mod = await vi.importActual("../../components/bookmarks/index");
    expect(mod).toHaveProperty("BookmarkRow");
    expect(mod).toHaveProperty("ExpandedBookmarkRow");
    expect(mod).toHaveProperty("BookmarkToolbar");
    expect(mod).toHaveProperty("SearchBar");
    expect(mod).toHaveProperty("BulkActionsBar");
    expect(mod).toHaveProperty("EmptyState");
    expect(mod).toHaveProperty("SkeletonLoader");
    expect(mod).toHaveProperty("TagFilterBar");
    expect(mod).toHaveProperty("ShareBookmarkModal");
    expect(mod).toHaveProperty("BookmarkReaderModal");
    expect(mod).toHaveProperty("ApiSettingsModal");
    expect(mod).toHaveProperty("useBookmarkSearch");
    expect(mod).toHaveProperty("useBookmarkSelection");
    expect(mod).toHaveProperty("useBookmarkBulkActions");
    expect(mod).toHaveProperty("SortIcon");
    expect(mod).toHaveProperty("exportJSON");
    expect(mod).toHaveProperty("exportCSV");
    expect(mod).toHaveProperty("exportMarkdown");
    expect(mod).toHaveProperty("exportPDF");
  });
});

describe("barrel: src/components/BlockEditorParts", () => {
  it("should export editor toolbar", async () => {
    const mod = await vi.importActual(
      "../../components/BlockEditorParts/EditorToolbar",
    );
    expect(mod).toBeDefined();
  });
});
