export const chatPanelImport = () =>
  import("../ChatPanel").then((m) => ({ default: m.ChatPanel }));
export const versionHistoryImport = () =>
  import("../VersionHistory").then((m) => ({ default: m.VersionHistory }));
export const backlinksImport = () =>
  import("../Backlinks").then((m) => ({ default: m.Backlinks }));
export const expertAgentsPanelImport = () =>
  import("../ai/ExpertAgentsPanel").then((m) => ({ default: m.default }));
export const aiCopilotPanelImport = () =>
  import("../BlockEditorParts/AICopilotPanel").then((m) => ({
    default: m.default,
  }));
export const suggestionsPanelImport = () =>
  import("../BlockEditorParts/SuggestionsPanel").then((m) => ({
    default: m.SuggestionsPanel,
  }));
export const editorToolbarImport = () =>
  import("../BlockEditorParts/EditorToolbar").then((m) => ({
    default: m.EditorToolbar,
  }));
