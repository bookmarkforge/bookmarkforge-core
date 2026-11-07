import { describe, it, expect, vi } from "vitest";

// The import factories in lazy-editor-components resolve their target modules
// at runtime. Execute each factory with mocked target modules to validate
// both the wiring (the factory resolves the RIGHT component) and the
// `{ default: ... }` normalization shape each consumer relies on.
vi.mock("../../../components/ChatPanel", () => ({
  ChatPanel: { isChatPanel: true },
}));
vi.mock("../../../components/VersionHistory", () => ({
  VersionHistory: { isVersionHistory: true },
}));
vi.mock("../../../components/Backlinks", () => ({
  Backlinks: { isBacklinks: true },
}));
vi.mock("../../../components/ai/ExpertAgentsPanel", () => ({
  default: { isExpertAgentsPanel: true },
}));
vi.mock("../../../components/BlockEditorParts/AICopilotPanel", () => ({
  default: { isAICopilotPanel: true },
}));
vi.mock("../../../components/BlockEditorParts/SuggestionsPanel", () => ({
  SuggestionsPanel: { isSuggestionsPanel: true },
}));
vi.mock("../../../components/BlockEditorParts/EditorToolbar", () => ({
  EditorToolbar: { isEditorToolbar: true },
}));

import {
  chatPanelImport,
  versionHistoryImport,
  backlinksImport,
  expertAgentsPanelImport,
  aiCopilotPanelImport,
  suggestionsPanelImport,
  editorToolbarImport,
} from "../../../components/block-editor/lazy-editor-components";

describe("lazy-editor-components import factories", () => {
  it("chatPanelImport resolves ChatPanel as default", async () => {
    const m = await chatPanelImport();
    expect((m.default as unknown as { isChatPanel: boolean }).isChatPanel).toBe(true);
  });

  it("versionHistoryImport resolves VersionHistory as default", async () => {
    const m = await versionHistoryImport();
    expect(
      (m.default as unknown as { isVersionHistory: boolean }).isVersionHistory,
    ).toBe(true);
  });

  it("backlinksImport resolves Backlinks as default", async () => {
    const m = await backlinksImport();
    expect(
      (m.default as unknown as { isBacklinks: boolean }).isBacklinks,
    ).toBe(true);
  });

  it("expertAgentsPanelImport resolves the default export", async () => {
    const m = await expertAgentsPanelImport();
    expect(
      (m.default as unknown as { isExpertAgentsPanel: boolean })
        .isExpertAgentsPanel,
    ).toBe(true);
  });

  it("aiCopilotPanelImport resolves the default export", async () => {
    const m = await aiCopilotPanelImport();
    expect(
      (m.default as unknown as { isAICopilotPanel: boolean }).isAICopilotPanel,
    ).toBe(true);
  });

  it("suggestionsPanelImport resolves SuggestionsPanel as default", async () => {
    const m = await suggestionsPanelImport();
    expect(
      (m.default as unknown as { isSuggestionsPanel: boolean })
        .isSuggestionsPanel,
    ).toBe(true);
  });

  it("editorToolbarImport resolves EditorToolbar as default", async () => {
    const m = await editorToolbarImport();
    expect(
      (m.default as unknown as { isEditorToolbar: boolean }).isEditorToolbar,
    ).toBe(true);
  });
});
