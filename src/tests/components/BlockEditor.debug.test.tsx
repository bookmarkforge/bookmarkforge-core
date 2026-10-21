import { describe, it, expect, vi, afterEach } from "vitest";
import { render } from "@testing-library/react";
import React from "react";

// Debug: isolate the exact undefined component
const mockT = (key: string) => key;

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: mockT, i18n: { language: "en" } }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("@blocknote/mantine", () => ({
  BlockNoteView: ({ children }: any) => <div data-testid="bnv">{children}</div>,
}));

vi.mock("@blocknote/react", () => ({
  useCreateBlockNote: vi.fn(() => ({})),
  SuggestionMenuController: () => <div data-testid="smc" />,
}));

vi.mock("@blocknote/core", () => ({
  createBlockConfig: vi.fn(() => () => ({
    type: "callout",
    propSchema: {},
    content: "inline",
  })),
  createBlockSpec: vi.fn(() => () => ({
    config: {},
    implementation: {},
    extensions: [],
  })),
  createExtension: vi.fn(() => ({ key: "mock" })),
  defaultBlockSpecs: {},
  defaultProps: {
    backgroundColor: { default: "default" },
    textColor: { default: "default" },
  },
  BlockNoteSchema: { create: vi.fn(() => ({})) },
  defaultInlineContentSchema: {},
  defaultStyleSchema: {},
  insertOrUpdateBlockForSlashMenu: vi.fn(),
  filterSuggestionItems: vi.fn((items) => items),
}));

vi.mock("lucide-react", () => {
  const mock = (name: string) => {
    const Icon = (props: any) => (
      <svg data-testid={`icon-${name}`} {...props} />
    );
    Icon.displayName = name;
    return Icon;
  };
  return { Undo: mock("Undo"), Sparkles: mock("Sparkles"), X: mock("X") };
});

vi.mock("react-markdown", () => ({
  default: ({ children }: any) => <div data-testid="md">{children}</div>,
}));
vi.mock("remark-gfm", () => ({ default: () => {} }));

// No db mock - just check if the component loads without it

describe("BlockEditor debug", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("loads the component module", async () => {
    const mod = await import("../../components/block-editor/BlockEditor");
    expect(mod.default).toBeDefined();
  });
});
