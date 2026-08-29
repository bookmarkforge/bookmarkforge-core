import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { act } from "react";
import userEvent from "@testing-library/user-event";
import React from "react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (s: string, opts?: any) => opts?.defaultValue || s,
    i18n: { language: "en" },
  }),
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
    Undo: mock("Undo"),
    Redo: mock("Redo"),
    Sun: mock("Sun"),
    Moon: mock("Moon"),
    History: mock("History"),
    Eye: mock("Eye"),
    Link: mock("Link"),
    Brain: mock("Brain"),
    Tags: mock("Tags"),
    Volume2: mock("Volume2"),
    Loader2: mock("Loader2"),
    Wand2: mock("Wand2"),
    MessageSquare: mock("MessageSquare"),
    BrainCircuit: mock("BrainCircuit"),
    Folder: mock("Folder"),
  };
});

vi.mock("../../components/VoiceDictation", () => ({
  VoiceDictation: ({ onTranscript }: any) => (
    <button
      data-testid="voice-dictation"
      onClick={() => onTranscript("test")}
    />
  ),
}));
vi.mock("../../components/PdfUploader", () => ({
  PdfUploader: () => <div data-testid="pdf-uploader" />,
}));
vi.mock("../../components/TtsPlayer", () => ({
  TtsPlayer: () => <div data-testid="tts-player" />,
}));
vi.mock("../../components/TemplateManager", () => ({
  TemplateManager: ({ onApply }: any) => (
    <button
      data-testid="template-manager"
      onClick={() => onApply([{ type: "paragraph", props: {} }])}
    />
  ),
}));
vi.mock("../../components/ImageGenerator", () => ({
  ImageGenerator: ({ onImageGenerated }: any) => (
    <button
      data-testid="image-generator"
      onClick={() => onImageGenerated("https://img.png")}
    />
  ),
}));

const mockEditor = {
  undo: vi.fn(),
  redo: vi.fn(),
  document: [{ id: "block1" }],
  insertBlocks: vi.fn(),
};

const defaultProps = {
  theme: "light" as const,
  setTheme: vi.fn(),
  isPrivate: false,
  setIsPrivate: vi.fn(),
  saveStatus: "saved",
  showHistory: false,
  setShowHistory: vi.fn(),
  showPreview: false,
  setShowPreview: vi.fn(),
  showSuggestions: false,
  setShowSuggestions: vi.fn(),
  showCopilot: false,
  setShowCopilot: vi.fn(),
  showExpertAgents: false,
  setShowExpertAgents: vi.fn(),
  showChat: false,
  setShowChat: vi.fn(),
  isZenMode: false,
  setIsZenMode: vi.fn(),
  isTagging: false,
  isGeneratingCards: false,
  isSpeaking: false,
  isSuggestingFolder: false,
  editorText: "hello",
  editor: mockEditor as any,
  onVoiceTranscript: vi.fn(),
  onPdfText: vi.fn(),
  onGenerateFlashcards: vi.fn(),
  onAudioSummary: vi.fn(),
  onSuggestFolder: vi.fn(),
  autoTag: vi.fn(),
};

describe("EditorToolbar", () => {
  let EditorToolbar: React.FC<any>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("../../components/BlockEditorParts/EditorToolbar");
    EditorToolbar = mod.EditorToolbar;
  });

  it("renders public/private button", async () => {
    const { unmount } = render(<EditorToolbar {...defaultProps} />);
    expect(screen.getByText("app_public")).toBeTruthy();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    unmount();
  });

  it("toggles private when clicked", async () => {
    const setPrivate = vi.fn();
    render(<EditorToolbar {...defaultProps} setIsPrivate={setPrivate} />);
    await userEvent.click(screen.getByText("app_public"));
    expect(setPrivate).toHaveBeenCalledWith(true);
  });

  it("llama setShowHistory", async () => {
    const fn = vi.fn();
    render(<EditorToolbar {...defaultProps} setShowHistory={fn} />);
    await userEvent.click(screen.getByTitle("app_history"));
    expect(fn).toHaveBeenCalledWith(true);
  });

  it("llama editor.undo", async () => {
    render(<EditorToolbar {...defaultProps} />);
    await userEvent.click(screen.getByLabelText("app_undo", { exact: false }));
    expect(mockEditor.undo).toHaveBeenCalled();
  });

  it("llama editor.redo", async () => {
    render(<EditorToolbar {...defaultProps} />);
    await userEvent.click(screen.getByLabelText("app_redo", { exact: false }));
    expect(mockEditor.redo).toHaveBeenCalled();
  });

  it("llama autoTag", async () => {
    const fn = vi.fn();
    render(<EditorToolbar {...defaultProps} autoTag={fn} />);
    await userEvent.click(screen.getByTitle("app_autoTag"));
    expect(fn).toHaveBeenCalled();
  });

  it("llama onGenerateFlashcards", async () => {
    const fn = vi.fn();
    render(<EditorToolbar {...defaultProps} onGenerateFlashcards={fn} />);
    await userEvent.click(screen.getByTitle("app_generateFlashcards"));
    expect(fn).toHaveBeenCalled();
  });

  it("llama onAudioSummary", async () => {
    const fn = vi.fn();
    render(<EditorToolbar {...defaultProps} onAudioSummary={fn} />);
    await userEvent.click(screen.getByTitle("app_audioSummary"));
    expect(fn).toHaveBeenCalled();
  });

  it("renders VoiceDictation", () => {
    render(<EditorToolbar {...defaultProps} />);
    expect(screen.getByTestId("voice-dictation")).toBeTruthy();
  });

  it("renders PdfUploader, TtsPlayer, TemplateManager, ImageGenerator", () => {
    render(<EditorToolbar {...defaultProps} />);
    expect(screen.getByTestId("pdf-uploader")).toBeTruthy();
    expect(screen.getByTestId("tts-player")).toBeTruthy();
    expect(screen.getByTestId("template-manager")).toBeTruthy();
    expect(screen.getByTestId("image-generator")).toBeTruthy();
  });

  it("toggle de tema de light a dark", async () => {
    const setTheme = vi.fn();
    render(<EditorToolbar {...defaultProps} setTheme={setTheme} />);
    await userEvent.click(screen.getByTitle("app_switchToDark"));
    expect(setTheme).toHaveBeenCalledWith("dark");
  });

  it("theme toggle from dark to light shows Sun icon", async () => {
    const setTheme = vi.fn();
    render(<EditorToolbar {...defaultProps} theme="dark" setTheme={setTheme} />);
    expect(screen.getByTestId("icon-Sun")).toBeTruthy();
    await userEvent.click(screen.getByTitle("app_switchToLight"));
    expect(setTheme).toHaveBeenCalledWith("light");
  });

  it("toggle showPreview", async () => {
    const fn = vi.fn();
    render(<EditorToolbar {...defaultProps} setShowPreview={fn} />);
    await userEvent.click(screen.getByTitle("app_toggleMarkdownPreview"));
    expect(fn).toHaveBeenCalledWith(true);
  });

  it("toggle showSuggestions", async () => {
    const fn = vi.fn();
    render(<EditorToolbar {...defaultProps} setShowSuggestions={fn} />);
    await userEvent.click(screen.getByTitle("app_smartSuggestions"));
    expect(fn).toHaveBeenCalledWith(true);
  });

  it("toggle showCopilot", async () => {
    const fn = vi.fn();
    render(<EditorToolbar {...defaultProps} setShowCopilot={fn} />);
    await userEvent.click(screen.getByTitle("app_aiCopilot"));
    expect(fn).toHaveBeenCalledWith(true);
  });

  it("toggle showExpertAgents", async () => {
    const fn = vi.fn();
    render(<EditorToolbar {...defaultProps} setShowExpertAgents={fn} />);
    await userEvent.click(screen.getByTitle("app_expertAgents"));
    expect(fn).toHaveBeenCalledWith(true);
  });

  it("toggle showChat", async () => {
    const fn = vi.fn();
    render(<EditorToolbar {...defaultProps} setShowChat={fn} />);
    await userEvent.click(screen.getByTitle("app_chat"));
    expect(fn).toHaveBeenCalledWith(true);
  });

  it("toggle zen mode", async () => {
    const fn = vi.fn();
    render(<EditorToolbar {...defaultProps} setIsZenMode={fn} />);
    await userEvent.click(screen.getByTitle("app_zenMode"));
    expect(fn).toHaveBeenCalledWith(true);
  });

  it("llama onSuggestFolder", async () => {
    const fn = vi.fn();
    render(<EditorToolbar {...defaultProps} onSuggestFolder={fn} />);
    await userEvent.click(screen.getByTitle("app_suggestFolder"));
    expect(fn).toHaveBeenCalled();
  });

  it("disables and shows spinner during isSuggestingFolder", () => {
    render(<EditorToolbar {...defaultProps} isSuggestingFolder={true} />);
    const btn = screen.getByTitle("app_suggestFolder") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(screen.getAllByTestId("icon-Loader2").length).toBeGreaterThan(0);
  });

  it("disables autoTag during isTagging", () => {
    render(<EditorToolbar {...defaultProps} isTagging={true} />);
    const btn = screen.getByTitle("app_autoTag") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it("disables flashcards during isGeneratingCards", () => {
    render(<EditorToolbar {...defaultProps} isGeneratingCards={true} />);
    const btn = screen.getByTitle("app_generateFlashcards") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it("disables audio during isSpeaking", () => {
    render(<EditorToolbar {...defaultProps} isSpeaking={true} />);
    const btn = screen.getByTitle("app_audioSummary") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it("releva la transcripcion de voz a onVoiceTranscript", async () => {
    const fn = vi.fn();
    render(<EditorToolbar {...defaultProps} onVoiceTranscript={fn} />);
    await userEvent.click(screen.getByTestId("voice-dictation"));
    expect(fn).toHaveBeenCalledWith("test");
  });

  it("inserts an image block via ImageGenerator", async () => {
    render(<EditorToolbar {...defaultProps} />);
    await userEvent.click(screen.getByTestId("image-generator"));
    expect(mockEditor.insertBlocks).toHaveBeenCalledWith(
      [{ type: "image", props: { url: "https://img.png" } }],
      mockEditor.document[0],
      "after",
    );
  });

  it("applies TemplateManager blocks via insertBlocks", async () => {
    render(<EditorToolbar {...defaultProps} />);
    await userEvent.click(screen.getByTestId("template-manager"));
    expect(mockEditor.insertBlocks).toHaveBeenCalledWith(
      [{ type: "paragraph", props: {} }],
      mockEditor.document[0],
      "after",
    );
  });
});
