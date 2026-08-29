import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string, defaultValue?: string) => defaultValue ?? key }),
}));

const mockToast = { success: vi.fn(), error: vi.fn() };
vi.mock("sonner", () => ({ toast: mockToast }));

const mockAiManager = {
  getProviderInfo: vi.fn(() => ({
    provider: "gemini",
    name: "Gemini",
    model: "gemini-2.0-flash",
    availableModels: undefined,
  })),
  getApiKey: vi.fn(() => ""),
  setApiKey: vi.fn(),
  setProvider: vi.fn(),
  getOllamaSettings: vi.fn(() => ({ url: "", model: "" })),
  setOllamaSettings: vi.fn(),
  getCustomBaseUrl: vi.fn(() => ""),
  setCustomBaseUrl: vi.fn(),
  setModel: vi.fn(),
  setWebLlmModel: vi.fn(),
};
vi.mock("../../../services/ai/ProviderManager", () => ({
  aiManager: mockAiManager,
}));

vi.mock("../../../components/QuantizationPanel", () => ({
  QuantizationPanel: () => null,
}));

vi.mock("lucide-react", () => {
  const mock = (name: string) => {
    const Icon = (props: Record<string, unknown>) => (
      <svg data-testid={`icon-${name}`} {...props} />
    );
    Icon.displayName = name;
    return Icon;
  };
  return {
    Sparkles: mock("Sparkles"),
    Loader2: mock("Loader2"),
    Key: mock("Key"),
  };
});

describe("AIConfigSection", () => {
  let AIConfigSection: typeof import("../../../components/settings/AIConfigSection").AIConfigSection;

  beforeEach(async () => {
    vi.clearAllMocks();
    let ollamaSettings = { url: "", model: "" };
    mockAiManager.getOllamaSettings.mockImplementation(() => ollamaSettings);
    mockAiManager.setOllamaSettings.mockImplementation((url: string, model: string) => {
      ollamaSettings = { url, model };
      return Promise.resolve();
    });
    mockAiManager.getProviderInfo.mockReturnValue({
      provider: "gemini",
      name: "Gemini",
      model: "gemini-2.0-flash",
      availableModels: undefined,
    });
    mockAiManager.setApiKey.mockResolvedValue(undefined);
    const mod = await import("../../../components/settings/AIConfigSection");
    AIConfigSection = mod.AIConfigSection;
  });

  it("ignores a second API key save while the first is still in progress", async () => {
    let resolveSave: (() => void) | undefined;
    mockAiManager.setApiKey.mockImplementation(
      () => new Promise<void>((resolve) => {
        resolveSave = resolve;
      }),
    );
    const setApiKey = vi.fn();
    render(
      <AIConfigSection
        apiKey="sk-secret"
        setApiKey={setApiKey}
        canRunWebLLM={true}
        webLlmProgress={null}
        onShowDiagnostics={vi.fn()}
        t={((key: string) => key) as Parameters<typeof AIConfigSection>[0]["t"]}
      />,
    );

    const saveButton = screen.getByText("app_save");
    await userEvent.click(saveButton);
    await userEvent.click(saveButton);

    expect(mockAiManager.setApiKey).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolveSave?.();
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(mockToast.success).toHaveBeenCalled();
    });
  });

  it("shows and persists the configured Ollama URL", async () => {
    mockAiManager.getProviderInfo.mockReturnValue({
      provider: "ollama",
      name: "Ollama (Local)",
      model: "llama3.2",
      availableModels: undefined,
    });
    let ollamaSettings = {
      url: "http://localhost:11434/api/generate",
      model: "llama3.2",
    };
    mockAiManager.getOllamaSettings.mockImplementation(() => ollamaSettings);
    mockAiManager.setOllamaSettings.mockImplementation((url: string, model: string) => {
      ollamaSettings = { url, model };
      return Promise.resolve();
    });

    render(
      <AIConfigSection
        apiKey=""
        setApiKey={vi.fn()}
        canRunWebLLM={true}
        webLlmProgress={null}
        onShowDiagnostics={vi.fn()}
        t={((key: string, fallback?: string) => fallback ?? key) as Parameters<typeof AIConfigSection>[0]["t"]}
      />,
    );

    const urlInput = screen.getByLabelText("Ollama URL");
    expect(urlInput).toHaveValue("http://localhost:11434/api/generate");
    await userEvent.clear(urlInput);
    await userEvent.type(urlInput, "http://127.0.0.1:11434/api/generate");

    expect(mockAiManager.setOllamaSettings).toHaveBeenLastCalledWith(
      "http://127.0.0.1:11434/api/generate",
      "llama3.2",
    );
  });

  it("does not show a toast if the save finishes after unmount", async () => {
    let resolveSave: (() => void) | undefined;
    mockAiManager.setApiKey.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveSave = resolve;
        }),
    );
    const setApiKey = vi.fn();

    const { unmount } = render(
      <AIConfigSection
        apiKey="sk-secret"
        setApiKey={setApiKey}
        canRunWebLLM={true}
        webLlmProgress={null}
        onShowDiagnostics={vi.fn()}
        t={((key: string) => key) as Parameters<typeof AIConfigSection>[0]["t"]}
      />,
    );

    await userEvent.click(screen.getByText("app_save"));
    unmount();
    await act(async () => {
      resolveSave?.();
      await Promise.resolve();
    });

    expect(mockToast.success).not.toHaveBeenCalled();
    expect(mockToast.error).not.toHaveBeenCalled();
  });
});
