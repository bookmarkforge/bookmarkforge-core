import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";

vi.mock("react-i18next", () => ({
  // The pricing/i18n bootstrap chain calls `.use(initReactI18next)`.
  initReactI18next: { type: "3rdParty", init: () => undefined },
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key} ${JSON.stringify(options)}` : key,
    i18n: { language: "en" },
  }),
}));

/**
 * The workspace is driven entirely by the session hook, so the hook is stubbed:
 * these tests are about the copy the header shows for a given engine choice,
 * not about running a translation.
 */
const sessionState = vi.hoisted(() => ({
  value: {} as Record<string, unknown>,
}));

vi.mock("../../hooks/useTranslationSession", () => ({
  useTranslationSession: () => sessionState.value,
}));

const { default: TranslationWorkspace } = await import(
  "../../components/translation/TranslationWorkspace"
);

type SessionOverrides = Partial<{
  engineChoice: string;
  resolvedIsLocal: boolean | null;
  engines: Array<{ id: string; isLocal: boolean }>;
}>;

function setSession({
  engineChoice = "auto",
  resolvedIsLocal = null,
  engines = [],
}: SessionOverrides = {}) {
  sessionState.value = {
    status: "idle",
    rows: [],
    total: 0,
    completed: 0,
    engines,
    engineChoice,
    setEngineChoice: vi.fn(),
    resolvedIsLocal,
    sourceLocale: "en",
    setSourceLocale: vi.fn(),
    targetLocale: "es",
    setTargetLocale: vi.fn(),
    engineLabel: "",
    modelId: "",
    modelProgress: null,
    cost: { totalUSD: 0, savedUSD: 0, isFreePlan: true },
    errorKey: null,
    pendingConsent: null,
    isSaving: false,
    savedDocumentId: null,
    assembledText: "",
    start: vi.fn(),
    cancel: vi.fn(),
    confirmDownload: vi.fn(),
    dismissConsent: vi.fn(),
    resetSession: vi.fn(),
    updateRow: vi.fn(),
    saveAsDocument: vi.fn(),
    copyTranslation: vi.fn(),
  };
}

function renderWorkspace() {
  render(
    <TranslationWorkspace
      onClose={vi.fn()}
      documentId="doc-1"
      title="A document"
      sourceText="Some source text."
    />,
  );
}

describe("TranslationWorkspace privacy line", () => {
  it("stays neutral while an automatic choice is unresolved", () => {
    // A Free session with only a BYOK key resolves to the cloud, so claiming
    // "nothing is uploaded" before the selector runs would be a false promise.
    setSession({ engineChoice: "auto", resolvedIsLocal: null });
    renderWorkspace();
    expect(screen.getByText("translation_subtitleUnknown")).toBeTruthy();
    expect(screen.queryByText("translation_subtitle")).toBeNull();
  });

  it("discloses the cloud engine once the run resolved to it", () => {
    setSession({ engineChoice: "auto", resolvedIsLocal: false });
    renderWorkspace();
    expect(screen.getByText("translation_subtitleCloud")).toBeTruthy();
  });

  it("keeps the local promise for a resolved local engine", () => {
    setSession({ engineChoice: "auto", resolvedIsLocal: true });
    renderWorkspace();
    expect(screen.getByText("translation_subtitle")).toBeTruthy();
  });

  it("discloses the cloud engine when it is chosen explicitly", () => {
    setSession({
      engineChoice: "cloud",
      engines: [
        { id: "cloud", isLocal: false },
        { id: "webllm", isLocal: true },
      ],
    });
    renderWorkspace();
    expect(screen.getByText("translation_subtitleCloud")).toBeTruthy();
  });

  it("keeps the local promise when a local engine is chosen explicitly", () => {
    setSession({
      engineChoice: "webllm",
      engines: [
        { id: "cloud", isLocal: false },
        { id: "webllm", isLocal: true },
      ],
    });
    renderWorkspace();
    expect(screen.getByText("translation_subtitle")).toBeTruthy();
  });

  it("does not guess when the engine list has not been probed yet", () => {
    setSession({ engineChoice: "webllm", engines: [], resolvedIsLocal: null });
    renderWorkspace();
    expect(screen.getByText("translation_subtitleUnknown")).toBeTruthy();
  });
});
