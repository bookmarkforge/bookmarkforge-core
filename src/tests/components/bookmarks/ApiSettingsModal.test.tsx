import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

const mockToastError = vi.fn();
vi.mock("sonner", () => ({
  toast: { error: mockToastError, success: vi.fn(), info: vi.fn() },
}));

const mockGetProviderInfo = vi.fn();
const mockSetProvider = vi.fn();
const mockGetApiKey = vi.fn();
const mockSetApiKey = vi.fn();
const mockGetOllamaSettings = vi.fn();
const mockSetOllamaSettings = vi.fn();
const mockSetModel = vi.fn();
const mockAiManager = {
  getProviderInfo: mockGetProviderInfo,
  setProvider: mockSetProvider,
  getApiKey: mockGetApiKey,
  setApiKey: mockSetApiKey,
  getOllamaSettings: mockGetOllamaSettings,
  setOllamaSettings: mockSetOllamaSettings,
  setModel: mockSetModel,
};

vi.mock("../../../services/ai/ProviderManager", () => ({
  ProviderManager: vi.fn(),
  AIProvider: {},
  aiManager: mockAiManager,
}));

vi.mock("../../../components/bookmarks/DiagnosticsModal", () => ({
  DiagnosticsModal: ({ show }: { show: boolean }) =>
    show ? <div data-testid="diagnostics" /> : null,
}));

const mockT = vi.fn((key: string) => {
  const map: Record<string, string> = {
    app_aiSettings: "AI Settings",
    app_aiSettingsDesc: "Configure your AI provider",
    app_systemDiagnostics: "System Diagnostics",
    app_open: "OPEN",
    app_aiProviderSelect: "Provider",
    app_cloudAi: "Cloud AI",
    app_gemini: "Gemini",
    app_openai: "OpenAI",
    app_anthropic: "Anthropic",
    app_groq: "Groq",
    app_localAi: "Local AI",
    app_ollama: "Ollama",
    app_ollamaUrl: "Ollama URL",
    app_ollamaUrlPlaceholder: "http://localhost:11434",
    app_ollamaModel: "Model",
    app_ollamaModelPlaceholder: "llama3",
    app_apiKey: "API Key",
    app_apiKeyAllProviders: "Enter your API key",
    app_selectedModel: "Model",
    app_providerDetected: "Provider detected",
    app_fullSupportDesc: "Full support",
    app_partialSupportDesc: "Partial support",
    app_cancel: "Cancel",
    app_save: "Save",
    app_ollamaUrlExample: "http://localhost:11434",
    app_ollamaModelExample: "llama3",
    app_apiKeyAllProvidersExample: "Enter your API key",
  };
  return map[key] || key;
});

const { ApiSettingsModal } =
  await import("../../../components/bookmarks/ApiSettingsModal");

const baseProviderInfo = {
  provider: "gemini" as const,
  name: "Google Gemini",
  fullSupport: true,
  availableModels: ["gemini-2.0-flash"],
  model: "gemini-2.0-flash",
};

describe("ApiSettingsModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetProviderInfo.mockReturnValue(baseProviderInfo);
    mockGetApiKey.mockReturnValue("test-key");
    mockGetOllamaSettings.mockReturnValue({
      url: "http://localhost:11434",
      model: "llama3",
    });
  });

  it("returns null when showApiSettings is false", () => {
    const { container } = render(
      <ApiSettingsModal
        showApiSettings={false}
        setShowApiSettings={vi.fn()}
        aiManager={mockAiManager as any}
        apiKeyInput=""
        setApiKeyInput={vi.fn()}
        providerInfo={baseProviderInfo as any}
        setProviderInfo={vi.fn()}
        t={mockT}
      />,
    );
    expect(
      Array.from(container.children).every((el) => el.tagName === "STYLE"),
    ).toBe(true);
  });

  it("renders AI Settings title", () => {
    const { getByText } = render(
      <ApiSettingsModal
        showApiSettings={true}
        setShowApiSettings={vi.fn()}
        aiManager={mockAiManager as any}
        apiKeyInput=""
        setApiKeyInput={vi.fn()}
        providerInfo={baseProviderInfo as any}
        setProviderInfo={vi.fn()}
        t={mockT}
      />,
    );
    expect(getByText("AI Settings")).toBeTruthy();
  });

  it("llama setShowApiSettings(false) al cerrar", async () => {
    const setShow = vi.fn();
    const { getByText } = render(
      <ApiSettingsModal
        showApiSettings={true}
        setShowApiSettings={setShow}
        aiManager={mockAiManager as any}
        apiKeyInput=""
        setApiKeyInput={vi.fn()}
        providerInfo={baseProviderInfo as any}
        setProviderInfo={vi.fn()}
        t={mockT}
      />,
    );
    await userEvent.click(getByText("Cancel"));
    expect(setShow).toHaveBeenCalledWith(false);
  });

  it("changes the provider when selecting in the dropdown", () => {
    const setProviderInfo = vi.fn();
    mockGetProviderInfo.mockReturnValue({
      ...baseProviderInfo,
      provider: "gemini",
    });
    const { getByLabelText } = render(
      <ApiSettingsModal
        showApiSettings={true}
        setShowApiSettings={vi.fn()}
        aiManager={mockAiManager as any}
        apiKeyInput=""
        setApiKeyInput={vi.fn()}
        providerInfo={baseProviderInfo as any}
        setProviderInfo={setProviderInfo}
        t={mockT}
      />,
    );
    fireEvent.change(getByLabelText("Provider"), {
      target: { value: "openai" },
    });
    expect(mockSetProvider).toHaveBeenCalledWith("openai");
  });

  it("renders Ollama fields when provider is ollama", () => {
    mockGetProviderInfo.mockReturnValue({
      ...baseProviderInfo,
      provider: "ollama",
    });
    const { getByDisplayValue } = render(
      <ApiSettingsModal
        showApiSettings={true}
        setShowApiSettings={vi.fn()}
        aiManager={mockAiManager as any}
        apiKeyInput=""
        setApiKeyInput={vi.fn()}
        providerInfo={{ ...baseProviderInfo, provider: "ollama" } as any}
        setProviderInfo={vi.fn()}
        t={mockT}
      />,
    );
    expect(getByDisplayValue("http://localhost:11434")).toBeTruthy();
    expect(getByDisplayValue("llama3")).toBeTruthy();
  });

  it("shows warning when fullSupport is false", () => {
    mockGetProviderInfo.mockReturnValue({
      ...baseProviderInfo,
      fullSupport: false,
    });
    const { getByText } = render(
      <ApiSettingsModal
        showApiSettings={true}
        setShowApiSettings={vi.fn()}
        aiManager={mockAiManager as any}
        apiKeyInput="key"
        setApiKeyInput={vi.fn()}
        providerInfo={{ ...baseProviderInfo, fullSupport: false } as any}
        setProviderInfo={vi.fn()}
        t={mockT}
      />,
    );
    expect(getByText("Partial support")).toBeTruthy();
  });

  it("does not show warning when there is no apiKey", () => {
    const { queryByText } = render(
      <ApiSettingsModal
        showApiSettings={true}
        setShowApiSettings={vi.fn()}
        aiManager={mockAiManager as any}
        apiKeyInput=""
        setApiKeyInput={vi.fn()}
        providerInfo={baseProviderInfo as any}
        setProviderInfo={vi.fn()}
        t={mockT}
      />,
    );
    expect(queryByText("Full support")).toBeNull();
  });

  it("shows DiagnosticsModal when clicking System Diagnostics", async () => {
    const { getByText, getByTestId } = render(
      <ApiSettingsModal
        showApiSettings={true}
        setShowApiSettings={vi.fn()}
        aiManager={mockAiManager as any}
        apiKeyInput=""
        setApiKeyInput={vi.fn()}
        providerInfo={baseProviderInfo as any}
        setProviderInfo={vi.fn()}
        t={mockT}
      />,
    );
    await userEvent.click(getByText("OPEN"));
    expect(getByTestId("diagnostics")).toBeTruthy();
  });

  it("saves the API key when clicking Save", async () => {
    const setShow = vi.fn();
    const setInfo = vi.fn();
    mockSetApiKey.mockResolvedValue(undefined);
    const { getByText } = render(
      <ApiSettingsModal
        showApiSettings={true}
        setShowApiSettings={setShow}
        aiManager={mockAiManager as any}
        apiKeyInput="new-key"
        setApiKeyInput={vi.fn()}
        providerInfo={baseProviderInfo as any}
        setProviderInfo={setInfo}
        t={mockT}
      />,
    );
    await userEvent.click(getByText("Save"));
    expect(mockSetApiKey).toHaveBeenCalledWith("new-key");
    expect(setInfo).toHaveBeenCalled();
    expect(setShow).toHaveBeenCalledWith(false);
  });

  it("P90: shows toast.error if saving the API key fails", async () => {
    mockSetApiKey.mockRejectedValue(new Error("master password required"));
    const { getByText } = render(
      <ApiSettingsModal
        showApiSettings={true}
        setShowApiSettings={vi.fn()}
        aiManager={mockAiManager as any}
        apiKeyInput="key"
        setApiKeyInput={vi.fn()}
        providerInfo={baseProviderInfo as any}
        setProviderInfo={vi.fn()}
        t={mockT}
      />,
    );
    await userEvent.click(getByText("Save"));
    expect(mockToastError).toHaveBeenCalledWith("master password required");
  });

  it("updates apiKeyInput when typing in the input", () => {
    const setKey = vi.fn();
    const { getByLabelText } = render(
      <ApiSettingsModal
        showApiSettings={true}
        setShowApiSettings={vi.fn()}
        aiManager={mockAiManager as any}
        apiKeyInput=""
        setApiKeyInput={setKey}
        providerInfo={baseProviderInfo as any}
        setProviderInfo={vi.fn()}
        t={mockT}
      />,
    );
    fireEvent.change(getByLabelText("API Key"), {
      target: { value: "abc" },
    });
    expect(setKey).toHaveBeenCalledWith("abc");
  });

  it("changes the selected model in the dropdown", () => {
    const setInfo = vi.fn();
    const { getByLabelText } = render(
      <ApiSettingsModal
        showApiSettings={true}
        setShowApiSettings={vi.fn()}
        aiManager={mockAiManager as any}
        apiKeyInput=""
        setApiKeyInput={vi.fn()}
        providerInfo={baseProviderInfo as any}
        setProviderInfo={setInfo}
        t={mockT}
      />,
    );
    fireEvent.change(getByLabelText("Model"), {
      target: { value: "gemini-2.0-flash" },
    });
    expect(mockSetModel).toHaveBeenCalled();
    expect(setInfo).toHaveBeenCalled();
  });

  it("updates the Ollama URL", () => {
    mockGetProviderInfo.mockReturnValue({
      ...baseProviderInfo,
      provider: "ollama",
    });
    const { getByLabelText } = render(
      <ApiSettingsModal
        showApiSettings={true}
        setShowApiSettings={vi.fn()}
        aiManager={mockAiManager as any}
        apiKeyInput=""
        setApiKeyInput={vi.fn()}
        providerInfo={{ ...baseProviderInfo, provider: "ollama" } as any}
        setProviderInfo={vi.fn()}
        t={mockT}
      />,
    );
    fireEvent.change(getByLabelText("Ollama URL"), {
      target: { value: "http://10.0.0.1:11434" },
    });
    expect(mockSetOllamaSettings).toHaveBeenCalledWith(
      "http://10.0.0.1:11434",
      "llama3",
    );
  });

  it("updates the Ollama model", () => {
    mockGetProviderInfo.mockReturnValue({
      ...baseProviderInfo,
      provider: "ollama",
    });
    const { getByLabelText } = render(
      <ApiSettingsModal
        showApiSettings={true}
        setShowApiSettings={vi.fn()}
        aiManager={mockAiManager as any}
        apiKeyInput=""
        setApiKeyInput={vi.fn()}
        providerInfo={{ ...baseProviderInfo, provider: "ollama" } as any}
        setProviderInfo={vi.fn()}
        t={mockT}
      />,
    );
    fireEvent.change(getByLabelText("Model"), {
      target: { value: "llama3.1" },
    });
    expect(mockSetOllamaSettings).toHaveBeenCalledWith(
      "http://localhost:11434",
      "llama3.1",
    );
  });

  it("shows detection with full support", () => {
    const { getByText } = render(
      <ApiSettingsModal
        showApiSettings={true}
        setShowApiSettings={vi.fn()}
        aiManager={mockAiManager as any}
        apiKeyInput="key"
        setApiKeyInput={vi.fn()}
        providerInfo={baseProviderInfo as any}
        setProviderInfo={vi.fn()}
        t={mockT}
      />,
    );
    expect(getByText("Full support")).toBeTruthy();
  });

  it("shows the model when there are no availableModels", () => {
    const noModels = { ...baseProviderInfo, availableModels: null } as any;
    const { getByText } = render(
      <ApiSettingsModal
        showApiSettings={true}
        setShowApiSettings={vi.fn()}
        aiManager={mockAiManager as any}
        apiKeyInput="key"
        setApiKeyInput={vi.fn()}
        providerInfo={noModels}
        setProviderInfo={vi.fn()}
        t={mockT}
      />,
    );
    expect(getByText("Model: gemini-2.0-flash")).toBeTruthy();
  });

  it("closes the modal with the header X", async () => {
    const setShow = vi.fn();
    const { container } = render(
      <ApiSettingsModal
        showApiSettings={true}
        setShowApiSettings={setShow}
        aiManager={mockAiManager as any}
        apiKeyInput=""
        setApiKeyInput={vi.fn()}
        providerInfo={baseProviderInfo as any}
        setProviderInfo={vi.fn()}
        t={mockT}
      />,
    );
    // The close button is the first button in the header (icon-only X)
    const headerBtn = container.querySelector("button")!;
    await userEvent.click(headerBtn);
    expect(setShow).toHaveBeenCalledWith(false);
  });
});
