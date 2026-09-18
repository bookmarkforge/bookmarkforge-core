import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  waitFor,
  fireEvent,
  act,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import React from "react";

const mockToastError = toast.error as ReturnType<typeof vi.fn>;
const mockToastSuccess = toast.success as ReturnType<typeof vi.fn>;

vi.mock("react-i18next", () => {
  const t = (key: string, fb?: string) => fb || key;
  return { useTranslation: () => ({ t, i18n: { language: "en" } }) };
});

const mockSpeak = vi.fn().mockResolvedValue(undefined);
const mockPause = vi.fn();
const mockStop = vi.fn();
const mockResume = vi.fn();
const mockDownloadAudio = vi.fn().mockResolvedValue(undefined);
const mockIsWebSpeechAvailable = vi.fn().mockReturnValue(false);
const mockGetVoicesForLanguage = vi.fn().mockReturnValue([]);

vi.mock("../../services/ai/TTSService", () => ({
  ttsService: {
    isWebSpeechAvailable: mockIsWebSpeechAvailable,
    getVoicesForLanguage: mockGetVoicesForLanguage,
    speak: mockSpeak,
    pause: mockPause,
    stop: mockStop,
    resume: mockResume,
    downloadAudio: mockDownloadAudio,
  },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("lucide-react", () => {
  const mock = (name: string) => {
    const Icon = (props: any) => (
      <svg data-testid={`icon-${name}`} {...props} />
    );
    Icon.displayName = name;
    return Icon;
  };
  return {
    Play: mock("Play"),
    Pause: mock("Pause"),
    Square: mock("Square"),
    Download: mock("Download"),
    Loader2: mock("Loader2"),
    Volume2: mock("Volume2"),
    Settings: mock("Settings"),
    Music: mock("Music"),
    Mic2: mock("Mic2"),
  };
});

describe("TtsPlayer", () => {
  let TtsPlayer: React.FC<any>;

  beforeAll(() => {
    // Mock speechSynthesis for play flow
    Object.defineProperty(window, "speechSynthesis", {
      value: {
        speak: vi.fn(),
        cancel: vi.fn(),
        pause: vi.fn(),
        resume: vi.fn(),
        getVoices: vi.fn().mockReturnValue([]),
      },
      writable: true,
      configurable: true,
    });
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    // Restore default implementations the module-level mocks were created
    // with (clearAllMocks only wipes call history, not implementations).
    mockIsWebSpeechAvailable.mockReturnValue(false);
    mockGetVoicesForLanguage.mockReturnValue([]);
    mockSpeak.mockResolvedValue(undefined);
    mockDownloadAudio.mockResolvedValue(undefined);
    const mod = await import("../../components/TtsPlayer");
    TtsPlayer = mod.TtsPlayer;
  });

  it("renders without errors", () => {
    const { container } = render(<TtsPlayer text="Hello world" />);
    expect(container).toBeTruthy();
  });

  it("renders play button", () => {
    render(<TtsPlayer text="Hello world" />);
    expect(screen.getByTestId("icon-Music")).toBeTruthy();
  });

  it("renders download buttons", () => {
    render(<TtsPlayer text="Hello world" />);
    expect(screen.getAllByTestId("icon-Download").length).toBeGreaterThan(0);
  });

  it("renders settings buttons", () => {
    render(<TtsPlayer text="Hello world" />);
    expect(screen.getAllByTestId("icon-Settings").length).toBeGreaterThan(0);
  });

  it("renders in compact mode", () => {
    render(<TtsPlayer text="Hello world" compact />);
    expect(screen.getByTestId("icon-Music")).toBeTruthy();
  });

  it("opens settings when clicked", async () => {
    render(<TtsPlayer text="Hello world" />);
    await userEvent.click(screen.getAllByTestId("icon-Settings")[0]!);
    expect(screen.getByText("Voice Settings")).toBeTruthy();
  });

  it("calls speak when clicking play", async () => {
    render(<TtsPlayer text="Hello world" />);
    await userEvent.click(screen.getByTestId("icon-Music"));
    await waitFor(() => expect(mockSpeak).toHaveBeenCalled());
  });

  it("calls pause when clicking pause (playing state)", async () => {
    render(<TtsPlayer text="Hello world" />);
    await userEvent.click(screen.getByTestId("icon-Music"));
    await waitFor(() => expect(mockSpeak).toHaveBeenCalled());
    await waitFor(() => {
      const pauseIcons = screen.queryAllByTestId("icon-Pause");
      expect(pauseIcons.length).toBeGreaterThan(0);
    });
    const pauseIcons = screen.queryAllByTestId("icon-Pause");
    if (pauseIcons.length > 0) {
      await userEvent.click(pauseIcons[0]!);
      expect(mockPause).toHaveBeenCalled();
    }
  });

  it("shows stop button while playing", async () => {
    render(<TtsPlayer text="Hello world" />);
    await userEvent.click(screen.getByTestId("icon-Music"));
    await waitFor(() => expect(mockSpeak).toHaveBeenCalled());
    await waitFor(() => {
      expect(screen.queryAllByTestId("icon-Square").length).toBeGreaterThan(0);
    });
  });

  it("calls downloadAudio when clicking download", async () => {
    render(<TtsPlayer text="Hello world" />);
    await userEvent.click(screen.getAllByTestId("icon-Download")[0]!);
    await waitFor(() => expect(mockDownloadAudio).toHaveBeenCalled());
  });

  it("shows loader during playback", async () => {
    mockSpeak.mockImplementationOnce(() => new Promise(() => {}));
    render(<TtsPlayer text="Hello world" />);
    await userEvent.click(screen.getByTestId("icon-Music"));
    expect(screen.getByTestId("icon-Loader2")).toBeTruthy();
  });

  it("uses available voices and preselects the first when WebSpeech is active", async () => {
    mockIsWebSpeechAvailable.mockReturnValue(true);
    mockGetVoicesForLanguage.mockReturnValue([
      { voiceURI: "v1", name: "Voice One", lang: "en", default: true },
      { voiceURI: "v2", name: "Voice Two", lang: "en", default: false },
    ]);
    render(<TtsPlayer text="Hello" />);
    // Open settings to see the local voice selector.
    await userEvent.click(screen.getAllByTestId("icon-Settings")[0]!);
    const select = screen.getByLabelText("Local Voice") as HTMLSelectElement;
    expect(select.value).toBe("v1");
    expect(select.options.length).toBe(2);
    // Cambiar de voz.
    fireEvent.change(select, { target: { value: "v2" } });
    expect(select.value).toBe("v2");
  });

  it("resumes synthesis if it was paused", async () => {
    render(<TtsPlayer text="Hello world" />);
    await userEvent.click(screen.getByTestId("icon-Music"));
    await waitFor(() => expect(mockSpeak).toHaveBeenCalled());
    await waitFor(() => {
      expect(screen.queryAllByTestId("icon-Pause").length).toBeGreaterThan(0);
    });
    // Pausar.
    await userEvent.click(screen.getAllByTestId("icon-Pause")[0]!);
    expect(mockPause).toHaveBeenCalled();
    // Click again → handlePlay detects isPaused → resume.
    const playAgain = screen.getAllByTestId("icon-Play");
    expect(playAgain.length).toBeGreaterThan(0);
    await userEvent.click(playAgain[0]!);
    expect(mockResume).toHaveBeenCalled();
  });

  it("stops playback with the stop button", async () => {
    render(<TtsPlayer text="Hello world" />);
    await userEvent.click(screen.getByTestId("icon-Music"));
    await waitFor(() => expect(mockSpeak).toHaveBeenCalled());
    await waitFor(() => {
      expect(screen.queryAllByTestId("icon-Square").length).toBeGreaterThan(0);
    });
    await userEvent.click(screen.getAllByTestId("icon-Square")[0]!);
    expect(mockStop).toHaveBeenCalled();
  });

  it("shows error toast if speak fails", async () => {
    mockSpeak.mockRejectedValueOnce(new Error("tts boom"));
    render(<TtsPlayer text="Hello world" />);
    await userEvent.click(screen.getByTestId("icon-Music"));
    await waitFor(() => expect(mockToastError).toHaveBeenCalled());
    // Flush the setLoading(false) from the finally block inside act().
    await waitFor(() =>
      expect(screen.queryByTestId("icon-Loader2")).toBeNull(),
    );
  });

  it("shows error toast if downloadAudio fails", async () => {
    mockDownloadAudio.mockRejectedValueOnce(new Error("dl boom"));
    render(<TtsPlayer text="Hello world" />);
    await userEvent.click(screen.getAllByTestId("icon-Download")[0]!);
    await waitFor(() => expect(mockToastError).toHaveBeenCalled());
    // Flush the setLoading(false) from the finally block inside act().
    await waitFor(() =>
      expect(screen.queryByTestId("icon-Loader2")).toBeNull(),
    );
  });

  it("shows success toast when downloading audio", async () => {
    render(<TtsPlayer text="Hello world" />);
    await userEvent.click(screen.getAllByTestId("icon-Download")[0]!);
    await waitFor(() => expect(mockToastSuccess).toHaveBeenCalled());
  });

  it("ajusta los sliders de velocidad, tono y volumen", async () => {
    render(<TtsPlayer text="Hello world" />);
    await userEvent.click(screen.getAllByTestId("icon-Settings")[0]!);

    const speed = screen.getByLabelText("Speed") as HTMLInputElement;
    fireEvent.change(speed, { target: { value: "1.5" } });
    expect(screen.getByText("1.5x")).toBeTruthy();

    const pitch = screen.getByLabelText("Pitch") as HTMLInputElement;
    fireEvent.change(pitch, { target: { value: "1.4" } });
    expect(screen.getByText("1.4")).toBeTruthy();

    const volume = screen.getByLabelText("Volume") as HTMLInputElement;
    fireEvent.change(volume, { target: { value: "0.5" } });
    expect(screen.getByText("50%")).toBeTruthy();
  });

  it("shows the karaoke chunk when receiving the tts-word-highlight event", async () => {
    render(<TtsPlayer text="Hello world" />);
    await userEvent.click(screen.getByTestId("icon-Music"));
    await waitFor(() => expect(mockSpeak).toHaveBeenCalled());
    // The event is emitted by the TTS service during playback.
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("tts-word-highlight", {
          detail: { text: "reading now" },
        }),
      );
    });
    expect(screen.getByText("reading now")).toBeTruthy();
  });

  it("button disabled without text", () => {
    render(<TtsPlayer text="" />);
    const play = screen.getByTestId("icon-Music").closest("button");
    expect((play as HTMLButtonElement).disabled).toBe(true);
  });

  it("does not touch state or show toasts if speak resolves after unmount", async () => {
    let resolveSpeak: (value: void) => void;
    mockSpeak.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveSpeak = resolve;
      }),
    );

    const { unmount } = render(<TtsPlayer text="Hello world" />);
    await userEvent.click(screen.getByTestId("icon-Music"));
    unmount();

    await act(async () => {
      resolveSpeak!();
    });

    expect(mockToastError).not.toHaveBeenCalled();
    expect(mockToastSuccess).not.toHaveBeenCalled();
  });

  it("does not show toast if speak fails after unmount", async () => {
    let rejectSpeak: (reason: Error) => void;
    mockSpeak.mockReturnValue(
      new Promise<void>((_, reject) => {
        rejectSpeak = reject;
      }),
    );

    const { unmount } = render(<TtsPlayer text="Hello world" />);
    await userEvent.click(screen.getByTestId("icon-Music"));
    unmount();

    await act(async () => {
      rejectSpeak!(new Error("late boom"));
    });

    expect(mockToastError).not.toHaveBeenCalled();
  });

  it("stops synthesis on unmount while playing", async () => {
    const { unmount } = render(<TtsPlayer text="Hello world" />);
    await userEvent.click(screen.getByTestId("icon-Music"));
    await waitFor(() => expect(mockSpeak).toHaveBeenCalled());

    unmount();

    expect(mockStop).toHaveBeenCalled();
  });

  it("does not show toast if the download resolves after unmount", async () => {
    let resolveDownload: (value: void) => void;
    mockDownloadAudio.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveDownload = resolve;
      }),
    );

    const { unmount } = render(<TtsPlayer text="Hello world" />);
    await userEvent.click(screen.getAllByTestId("icon-Download")[0]!);
    unmount();

    await act(async () => {
      resolveDownload!();
    });

    expect(mockToastSuccess).not.toHaveBeenCalled();
  });
});
