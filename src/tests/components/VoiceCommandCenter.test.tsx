import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

vi.mock("react-i18next", () => {
  const t = (key: string, options?: any) =>
    (typeof options === "string" ? options : options?.defaultValue) || key;
  return { useTranslation: () => ({ t, i18n: { language: "en" } }) };
});

vi.mock("lucide-react", () => {
  const mock = (name: string) => {
    const Icon = (props: any) => (
      <svg data-testid={`icon-${name}`} {...props} />
    );
    Icon.displayName = name;
    return Icon;
  };
  return {
    Mic: mock("Mic"),
    MicOff: mock("MicOff"),
    X: mock("X"),
    Search: mock("Search"),
    FileText: mock("FileText"),
    LayoutDashboard: mock("LayoutDashboard"),
    Bookmark: mock("Bookmark"),
  };
});

const recognitionState = vi.hoisted(() => {
  let instance: any = null;
  return {
    setInstance: (inst: any) => {
      instance = inst;
    },
    getInstance: () => instance,
  };
});

vi.mock("../../utils/browser-types", () => ({
  getSpeechRecognitionCtor: () =>
    class FakeRecognition {
      continuous = false;
      interimResults = false;
      lang = "en-US";
      onresult: ((e: any) => void) | null = null;
      onerror: (() => void) | null = null;
      onend: (() => void) | null = null;
      start = vi.fn();
      stop = vi.fn();
      abort = vi.fn();
      constructor() {
        recognitionState.setInstance(this);
      }
    },
}));

describe("VoiceCommandCenter", () => {
  let VoiceCommandCenter: React.FC<{
    onSearch?: (query: string) => void;
    onNavigate?: (page: string) => void;
    onAction?: (action: string, params?: Record<string, unknown>) => void;
    showFloatingButton?: boolean;
  }>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("../../components/VoiceCommandCenter");
    VoiceCommandCenter = mod.default;
  });

  it("renders floating button by default", () => {
    render(<VoiceCommandCenter />);
    expect(screen.getAllByTestId("icon-Mic").length).toBeGreaterThan(0);
  });

  it("does not render floating button when showFloatingButton is false", () => {
    render(<VoiceCommandCenter showFloatingButton={false} />);
    expect(screen.getAllByTestId("icon-Mic").length).toBeGreaterThan(0);
  });

  it("shows panel when clicking Mic", async () => {
    render(<VoiceCommandCenter />);
    await userEvent.click(screen.getAllByTestId("icon-Mic")[0]!);
    expect(screen.getByText("app_listening")).toBeTruthy();
  });

  it("shows X in the panel to close", async () => {
    render(<VoiceCommandCenter />);
    await userEvent.click(screen.getAllByTestId("icon-Mic")[0]!);
    expect(screen.getAllByTestId("icon-X").length).toBeGreaterThan(0);
  });

  it("shows title and description in non-floating mode", () => {
    render(<VoiceCommandCenter showFloatingButton={false} />);
    expect(screen.getByText("app_voiceCommands")).toBeTruthy();
    expect(screen.getByText("app_voiceCommandsDesc")).toBeTruthy();
  });

  it("shows Start Listening button in non-floating mode", () => {
    render(<VoiceCommandCenter showFloatingButton={false} />);
    expect(screen.getByText("app_startListening")).toBeTruthy();
  });

  it("stops listening on second click on Mic", async () => {
    render(<VoiceCommandCenter />);
    await userEvent.click(screen.getAllByTestId("icon-Mic")[0]!);
    expect(screen.getByText("app_listening")).toBeTruthy();
    await userEvent.click(screen.getByTestId("icon-MicOff"));
    expect(screen.getByText("app_commandReceived")).toBeTruthy();
  });

  it("does not show tooltip while listening", async () => {
    render(<VoiceCommandCenter />);
    expect(screen.getByText(/Ctrl\+Shift\+V/)).toBeTruthy();
    await userEvent.click(screen.getAllByTestId("icon-Mic")[0]!);
    expect(screen.queryByText(/Ctrl\+Shift\+V/)).toBeNull();
  });

  it("closes panel when clicking X", async () => {
    render(<VoiceCommandCenter />);
    await userEvent.click(screen.getAllByTestId("icon-Mic")[0]!);
    expect(screen.getByText("app_listening")).toBeTruthy();
    await userEvent.click(screen.getByTestId("icon-X"));
    expect(screen.queryByText("app_listening")).toBeNull();
  });

  it("responds to trigger-voice-command event", async () => {
    render(<VoiceCommandCenter />);
    await act(async () => {
      window.dispatchEvent(new CustomEvent("trigger-voice-command"));
    });
    await waitFor(() => {
      expect(screen.getByText("app_listening")).toBeTruthy();
    });
  });

  it("updates transcript via voice-state-control event", async () => {
    render(<VoiceCommandCenter />);
    await userEvent.click(screen.getAllByTestId("icon-Mic")[0]!);
    await waitFor(() => expect(screen.getByText("app_listening")).toBeTruthy());
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("voice-state-control", {
          detail: { type: "transcript", value: "hola mundo" },
        }),
      );
    });
    await waitFor(() => {
      expect(screen.getByText("hola mundo")).toBeTruthy();
    });
  });

  it("updates isListening via voice-state-control event", async () => {
    render(<VoiceCommandCenter />);
    await userEvent.click(screen.getAllByTestId("icon-Mic")[0]!);
    await waitFor(() => expect(screen.getByText("app_listening")).toBeTruthy());
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("voice-state-control", {
          detail: { type: "listening", value: false },
        }),
      );
    });
    await waitFor(() => {
      expect(screen.getByText("app_commandReceived")).toBeTruthy();
    });
  });

  it("shows app_speakNow placeholder when transcript is empty", async () => {
    render(<VoiceCommandCenter />);
    await userEvent.click(screen.getAllByTestId("icon-Mic")[0]!);
    expect(screen.getByText("app_speakNow")).toBeTruthy();
  });

  it("starts listening when clicking Start Listening in non-floating mode", async () => {
    render(<VoiceCommandCenter showFloatingButton={false} />);
    await userEvent.click(screen.getByText("app_startListening"));
    expect(screen.getByText("app_listening")).toBeTruthy();
  });

  it("switches icon to MicOff while listening", async () => {
    render(<VoiceCommandCenter />);
    expect(screen.getAllByTestId("icon-Mic").length).toBeGreaterThan(0);
    expect(screen.queryByTestId("icon-MicOff")).toBeNull();
    await userEvent.click(screen.getAllByTestId("icon-Mic")[0]!);
    expect(screen.getByTestId("icon-MicOff")).toBeTruthy();
  });

  it("shows command suggestions in panel", async () => {
    render(<VoiceCommandCenter />);
    await userEvent.click(screen.getAllByTestId("icon-Mic")[0]!);
    expect(screen.getByText(/app_voiceSearch/)).toBeTruthy();
    expect(screen.getByText(/app_voiceGoTo/)).toBeTruthy();
    expect(screen.getByText(/app_voiceCreateDoc/)).toBeTruthy();
    expect(screen.getByText(/app_voiceSummarize/)).toBeTruthy();
  });

  it("renders Search, LayoutDashboard, FileText, Bookmark icons in panel", async () => {
    render(<VoiceCommandCenter />);
    await userEvent.click(screen.getAllByTestId("icon-Mic")[0]!);
    expect(screen.getAllByTestId("icon-Search").length).toBeGreaterThan(0);
    expect(
      screen.getAllByTestId("icon-LayoutDashboard").length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByTestId("icon-FileText").length).toBeGreaterThan(0);
    expect(screen.getAllByTestId("icon-Bookmark").length).toBeGreaterThan(0);
  });

  describe("speech recognition", () => {
    it("sets recognition lang to the language", async () => {
      render(<VoiceCommandCenter />);
      const rec = recognitionState.getInstance();
      expect(rec).toBeTruthy();
      expect(rec.lang).toBe("en-US");
      expect(rec.continuous).toBe(false);
      expect(rec.interimResults).toBe(false);
    });

    it("aborts recognition on unmount", async () => {
      const { unmount } = render(<VoiceCommandCenter />);
      const rec = recognitionState.getInstance();
      unmount();
      expect(rec.abort).toHaveBeenCalled();
    });

    it("dispara onSearch con comando 'search <query>'", async () => {
      const onSearch = vi.fn();
      render(<VoiceCommandCenter onSearch={onSearch} />);
      const rec = recognitionState.getInstance();
      await act(async () => {
        rec.onresult({
          results: [{ 0: { transcript: "  search deep learning " }, length: 1 }],
          resultIndex: 0,
        });
      });
      expect(onSearch).toHaveBeenCalledWith("deep learning");
    });

    it("fires onSearch with the 'search <query>' command", async () => {
      const onSearch = vi.fn();
      render(<VoiceCommandCenter onSearch={onSearch} />);
      const rec = recognitionState.getInstance();
      await act(async () => {
        rec.onresult({
          results: [{ 0: { transcript: "buscar docs" }, length: 1 }],
          resultIndex: 0,
        });
      });
      expect(onSearch).toHaveBeenCalledWith("docs");
    });

    it("dispara onNavigate con comando 'go to <page>'", async () => {
      const onNavigate = vi.fn();
      render(<VoiceCommandCenter onNavigate={onNavigate} />);
      const rec = recognitionState.getInstance();
      await act(async () => {
        rec.onresult({
          results: [{ 0: { transcript: "go to settings" }, length: 1 }],
          resultIndex: 0,
        });
      });
      expect(onNavigate).toHaveBeenCalledWith("settings");
    });

    it("dispara onNavigate con comando 'ir a <page>'", async () => {
      const onNavigate = vi.fn();
      render(<VoiceCommandCenter onNavigate={onNavigate} />);
      const rec = recognitionState.getInstance();
      await act(async () => {
        rec.onresult({
          results: [{ 0: { transcript: "ir a favoritos" }, length: 1 }],
          resultIndex: 0,
        });
      });
      expect(onNavigate).toHaveBeenCalledWith("favoritos");
    });

    it("fires onAction with text that is not a command", async () => {
      const onAction = vi.fn();
      render(<VoiceCommandCenter onAction={onAction} />);
      const rec = recognitionState.getInstance();
      await act(async () => {
        rec.onresult({
          results: [{ 0: { transcript: "crea un resumen" }, length: 1 }],
          resultIndex: 0,
        });
      });
      expect(onAction).toHaveBeenCalledWith("crea un resumen");
    });

    it("ignores empty results without calling callbacks", async () => {
      const onSearch = vi.fn();
      const onNavigate = vi.fn();
      const onAction = vi.fn();
      render(
        <VoiceCommandCenter
          onSearch={onSearch}
          onNavigate={onNavigate}
          onAction={onAction}
        />,
      );
      const rec = recognitionState.getInstance();
      await act(async () => {
        rec.onresult({ results: [{ 0: { transcript: "   " }, length: 1 }], resultIndex: 0 });
      });
      expect(onSearch).not.toHaveBeenCalled();
      expect(onNavigate).not.toHaveBeenCalled();
      expect(onAction).not.toHaveBeenCalled();
    });

    it("stops listening on onerror", async () => {
      render(<VoiceCommandCenter />);
      await userEvent.click(screen.getAllByTestId("icon-Mic")[0]!);
      expect(screen.getByText("app_listening")).toBeTruthy();
      const rec = recognitionState.getInstance();
      await act(async () => {
        rec.onerror();
      });
      expect(screen.getByText("app_commandReceived")).toBeTruthy();
    });

    it("stops listening on onend", async () => {
      render(<VoiceCommandCenter />);
      await userEvent.click(screen.getAllByTestId("icon-Mic")[0]!);
      expect(screen.getByText("app_listening")).toBeTruthy();
      const rec = recognitionState.getInstance();
      await act(async () => {
        rec.onend();
      });
      expect(screen.getByText("app_commandReceived")).toBeTruthy();
    });

    it("calls stop on toggle while listening", async () => {
      render(<VoiceCommandCenter />);
      await userEvent.click(screen.getAllByTestId("icon-Mic")[0]!);
      const rec = recognitionState.getInstance();
      expect(rec.start).toHaveBeenCalled();
      await userEvent.click(screen.getByTestId("icon-MicOff"));
      expect(rec.stop).toHaveBeenCalled();
    });

    it("no queda escuchando si start lanza error", async () => {
      render(<VoiceCommandCenter />);
      const rec = recognitionState.getInstance();
      rec.start.mockImplementationOnce(() => {
        throw new Error("not allowed");
      });
      await userEvent.click(screen.getAllByTestId("icon-Mic")[0]!);
      expect(screen.getByText("app_commandReceived")).toBeTruthy();
      expect(screen.queryByText("app_listening")).toBeNull();
    });
  });
});
