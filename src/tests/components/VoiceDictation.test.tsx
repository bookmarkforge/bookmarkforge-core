import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { act } from "react";
import userEvent from "@testing-library/user-event";
import React from "react";

vi.mock("react-i18next", () => {
  const t = (key: string, options?: any) => options?.defaultValue || key;
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
  return { Mic: mock("Mic"), Loader2: mock("Loader2") };
});

describe("VoiceDictation", () => {
  let VoiceDictation: React.FC<{ onTranscript: (text: string) => void }>;
  let recognitionInstance: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    recognitionInstance = {
      lang: "",
      continuous: false,
      interimResults: false,
      start: vi.fn(),
      abort: vi.fn(),
      set onstart(v: any) {
        this._onstart = v;
      },
      get onstart() {
        return this._onstart;
      },
      set onresult(v: any) {
        this._onresult = v;
      },
      get onresult() {
        return this._onresult;
      },
      set onerror(v: any) {
        this._onerror = v;
      },
      get onerror() {
        return this._onerror;
      },
      set onend(v: any) {
        this._onend = v;
      },
      get onend() {
        return this._onend;
      },
    };
    const SpeechRecognitionMock = vi.fn(function () {
      return recognitionInstance;
    }) as any;
    SpeechRecognitionMock.prototype = {};
    (window as any).SpeechRecognition = SpeechRecognitionMock;
    const mod = await import("../../components/VoiceDictation");
    VoiceDictation = mod.VoiceDictation;
  });

  afterEach(() => {
    delete (window as any).SpeechRecognition;
  });

  it("renders mic button when SpeechRecognition is supported", () => {
    render(<VoiceDictation onTranscript={vi.fn()} />);
    expect(screen.getByTestId("icon-Mic")).toBeTruthy();
  });

  it("renders nothing when SpeechRecognition is not supported", () => {
    delete (window as any).SpeechRecognition;
    const { container } = render(<VoiceDictation onTranscript={vi.fn()} />);
    expect(
      Array.from(container.children).every((el) => el.tagName === "STYLE"),
    ).toBe(true);
  });

  it("switches to loader after onstart", async () => {
    render(<VoiceDictation onTranscript={vi.fn()} />);
    await userEvent.click(screen.getByTestId("icon-Mic"));
    await act(async () => {
      recognitionInstance.onstart();
    });
    await waitFor(() => {
      expect(screen.getByTestId("icon-Loader2")).toBeTruthy();
    });
  });

  it("calls onTranscript when there is a result", async () => {
    const onTranscript = vi.fn();
    render(<VoiceDictation onTranscript={onTranscript} />);
    await userEvent.click(screen.getByTestId("icon-Mic"));
    recognitionInstance.onresult({
      results: [[{ transcript: "hello world" }]],
    });
    expect(onTranscript).toHaveBeenCalledWith("hello world");
  });

  it("handles recognition error gracefully", async () => {
    render(<VoiceDictation onTranscript={vi.fn()} />);
    await userEvent.click(screen.getByTestId("icon-Mic"));
    recognitionInstance.onerror({ error: "not-allowed" });
    expect(screen.getByTestId("icon-Mic")).toBeTruthy();
  });

  it("stops recording when clicking again", async () => {
    render(<VoiceDictation onTranscript={vi.fn()} />);
    await userEvent.click(screen.getByTestId("icon-Mic"));
    await act(async () => {
      recognitionInstance.onstart();
    });
    const loader2 = await screen.findByTestId("icon-Loader2");
    await userEvent.click(loader2);
    expect(screen.getByTestId("icon-Mic")).toBeTruthy();
  });

  it("calls onTranscript even if the result is empty", async () => {
    const onTranscript = vi.fn();
    render(<VoiceDictation onTranscript={onTranscript} />);
    await userEvent.click(screen.getByTestId("icon-Mic"));
    recognitionInstance.onresult({ results: [[{ transcript: "" }]] });
    expect(onTranscript).toHaveBeenCalledWith("");
  });
});
