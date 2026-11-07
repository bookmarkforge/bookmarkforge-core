import { lazy, Suspense, useState } from "react";
import type { BlockNoteEditor } from "@blocknote/core";
import type { PartialBlock } from "@blocknote/core";
import {
  Undo,
  Redo,
  Sun,
  Moon,
  History,
  Eye,
  Link as LinkIcon,
  Brain,
  Tags,
  Volume2,
  Loader2,
  Wand2,
  MessageSquare,
  BrainCircuit,
  Folder,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { VoiceDictation } from "../VoiceDictation";
import { normalizeTemplateBlocksToBlockNote } from "../../services/DocumentTemplateService";

const PdfUploader = lazy(() =>
  import("../PdfUploader").then((m) => ({ default: m.PdfUploader })),
);
const TtsPlayer = lazy(() =>
  import("../TtsPlayer").then((m) => ({ default: m.TtsPlayer })),
);
const TemplateManager = lazy(() =>
  import("../TemplateManager").then((m) => ({ default: m.TemplateManager })),
);
const ImageGenerator = lazy(() =>
  import("../ImageGenerator").then((m) => ({ default: m.ImageGenerator })),
);

interface EditorToolbarProps {
  theme: "light" | "dark";
  setTheme: (theme: "light" | "dark") => void;
  isPrivate: boolean;
  setIsPrivate: (isPrivate: boolean) => void;
  saveStatus: string;
  showHistory: boolean;
  setShowHistory: (show: boolean) => void;
  showPreview: boolean;
  setShowPreview: (show: boolean) => void;
  showSuggestions: boolean;
  setShowSuggestions: (show: boolean) => void;
  showCopilot: boolean;
  setShowCopilot: (show: boolean) => void;
  showExpertAgents: boolean;
  setShowExpertAgents: (show: boolean) => void;
  showChat: boolean;
  setShowChat: (show: boolean) => void;
  isZenMode: boolean;
  setIsZenMode: (isZenMode: boolean) => void;
  isTagging: boolean;
  isGeneratingCards: boolean;
  isSpeaking: boolean;
  isSuggestingFolder: boolean;
  editorText: string;
  editor: BlockNoteEditor;
  onVoiceTranscript: (text: string) => void;
  onPdfText: (text: string) => void;
  onGenerateFlashcards: () => void;
  onAudioSummary: () => void;
  onSuggestFolder: () => void;
  autoTag: () => void;
}

export function EditorToolbar({
  theme,
  setTheme,
  isPrivate,
  setIsPrivate,
  saveStatus: _saveStatus,
  showHistory,
  setShowHistory,
  showPreview,
  setShowPreview,
  showSuggestions,
  setShowSuggestions,
  showCopilot,
  setShowCopilot,
  showExpertAgents,
  setShowExpertAgents,
  showChat,
  setShowChat,
  isZenMode,
  setIsZenMode,
  isTagging,
  isGeneratingCards,
  isSpeaking,
  isSuggestingFolder,
  editorText,
  editor,
  onVoiceTranscript,
  onPdfText,
  onGenerateFlashcards,
  onAudioSummary,
  onSuggestFolder,
  autoTag,
}: EditorToolbarProps) {
  const { t } = useTranslation();
  const [showAdvanced, setShowAdvanced] = useState(false);
  const toolbarLabel = t("app_actions");

  const handleImageInsert = (url: string) => {
    if (editor?.document[0]) {
      editor?.insertBlocks(
        [{ type: "image", props: { url } }],
        editor.document[0],
        "after",
      );
    }
  };

  const handleTemplateApply = (blocks: PartialBlock[]) => {
    if (editor?.document[0]) {
      // Templates stored from the sidebar may use shorthand block types
      // (bulletList/numberedList); normalize so insertBlocks never feeds an
      // invalid BlockNote spec to the live editor.
      const normalized = normalizeTemplateBlocksToBlockNote(
        blocks,
      ) as PartialBlock[];
      editor?.insertBlocks(normalized, editor.document[0], "after");
    }
  };

  return (
    <div className="flex items-center gap-1.5 flex-wrap justify-center text-theme">
      <button
        onClick={() => {
          setIsPrivate(!isPrivate);
        }}
        className={`truncate px-3 py-1.5 rounded-lg transition-all flex items-center gap-2 text-xs font-medium ${isPrivate ? "ds-bg-success/10 ds-text-success dark:ds-text-success border border-[var(--success-soft-border)]/20" : "bg-[var(--bg-secondary)] dark:bg-[var(--bg-card)] text-[var(--text-secondary)] dark:text-[var(--text-muted)] border border-transparent hover:bg-[var(--state-hover-bg)] dark:hover:bg-[var(--state-hover-bg)]"}`}
        title={isPrivate ? t("app_privateDoc") : t("app_publicDoc")}
      >
        <div
          className={`size-1.5 rounded-full ${isPrivate ? "ds-bg-success" : "bg-[var(--text-muted)]"}`}
        />
        {isPrivate ? t("app_private") : t("app_public")}
      </button>
      <div className="h-4 w-px bg-[var(--bg-secondary)] dark:bg-[var(--bg-card)] mx-1"></div>
      <VoiceDictation onTranscript={onVoiceTranscript} />
      <button
        onClick={() => setShowHistory(!showHistory)}
        className={`p-2 rounded-lg transition-all hover:scale-105 active:scale-95 ${showHistory ? "bg-blue-500 ds-text-on-accent shadow-md shadow-blue-500/20" : "ds-ghost-bg text-[var(--text-secondary)] dark:text-[var(--text-muted)]"}`}
        title={t("app_history")} aria-label={t("app_history")}
      >
        <History className="size-4" aria-hidden="true" />
      </button>
      <button
        onClick={() => setShowPreview(!showPreview)}
        className={`p-2 rounded-lg transition-all hover:scale-105 active:scale-95 ${showPreview ? "bg-blue-500 ds-text-on-accent shadow-md shadow-blue-500/20" : "ds-ghost-bg text-[var(--text-secondary)] dark:text-[var(--text-muted)]"}`}
        title={t("app_toggleMarkdownPreview")} aria-label={t("app_toggleMarkdownPreview")}
      >
        <Eye className="size-4" aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={() => setShowAdvanced((open) => !open)}
        aria-expanded={showAdvanced}
        aria-controls="editor-advanced-tools"
        className="truncate flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium ds-ghost-bg text-[var(--text-secondary)] dark:text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)]"
        title={toolbarLabel}
        aria-label={toolbarLabel}
      >
        {t("app_actions")}
        <span aria-hidden="true" className={`text-[10px] transition-transform ${showAdvanced ? "rotate-180" : ""}`}>⌄</span>
      </button>
      <div
        id="editor-advanced-tools"
        hidden={!showAdvanced}
        className="contents"
      >
      <button
        onClick={() => setShowSuggestions(!showSuggestions)}
        className={`p-2 rounded-lg transition-all hover:scale-105 active:scale-95 ${showSuggestions ? "bg-cyan-500 ds-text-on-accent shadow-md shadow-cyan-500/20" : "ds-ghost-bg text-[var(--text-secondary)] dark:text-[var(--text-muted)]"}`}
        title={t("app_smartSuggestions")} aria-label={t("app_smartSuggestions")}
      >
        <LinkIcon className="size-4" aria-hidden="true" />
      </button>
      <button
        onClick={() => setShowCopilot(!showCopilot)}
        className={`p-2 rounded-lg transition-all hover:scale-105 active:scale-95 ${showCopilot ? "bg-cyan-500 ds-text-on-accent shadow-md shadow-cyan-500/20" : "ds-ghost-bg text-[var(--text-secondary)] dark:text-[var(--text-muted)]"}`}
        title={t("app_aiCopilot")} aria-label={t("app_aiCopilot")}
      >
        <Wand2 className="size-4" aria-hidden="true" />
      </button>
      <button
        onClick={() => setShowExpertAgents(!showExpertAgents)}
        className={`p-2 rounded-lg transition-all hover:scale-105 active:scale-95 ${showExpertAgents ? "bg-rose-500 ds-text-on-accent shadow-md shadow-rose-500/20" : "ds-ghost-bg text-[var(--text-secondary)] dark:text-[var(--text-muted)]"}`}
        title={t("app_expertAgents")} aria-label={t("app_expertAgents")}
      >
        <BrainCircuit className="size-4" aria-hidden="true" />
      </button>
      <button
        onClick={onSuggestFolder}
        disabled={isSuggestingFolder}
        className={`truncate p-2 rounded-lg transition-all hover:scale-105 active:scale-95 ds-ghost-bg text-[var(--text-secondary)] dark:text-[var(--text-muted)] ${isSuggestingFolder ? "opacity-50" : ""}`}
        title={t("app_suggestFolder")} aria-label={t("app_suggestFolder")}
      >
        {isSuggestingFolder ? (
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        ) : (
          <Folder className="size-4" aria-hidden="true" />
        )}
      </button>
      <button
        onClick={() => setShowChat(!showChat)}
        className={`p-2 rounded-lg transition-all hover:scale-105 active:scale-95 ${showChat ? "bg-blue-500 ds-text-on-accent shadow-md shadow-blue-500/20" : "ds-ghost-bg text-[var(--text-secondary)] dark:text-[var(--text-muted)]"}`}
        title={t("app_chat")} aria-label={t("app_chat")}
      >
        <MessageSquare className="size-4" aria-hidden="true" />
      </button>
      <button
        onClick={autoTag}
        disabled={isTagging}
        className="truncate p-2 ds-ghost-bg text-[var(--text-secondary)] dark:text-[var(--text-muted)] rounded-lg transition-all hover:scale-105 active:scale-95"
        title={t("app_autoTag")} aria-label={t("app_autoTag")}
      >
        {isTagging ? (
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        ) : (
          <Tags className="size-4" aria-hidden="true" />
        )}
      </button>
      <button
        onClick={onGenerateFlashcards}
        disabled={isGeneratingCards}
        className="truncate p-2 ds-ghost-bg text-[var(--text-secondary)] dark:text-[var(--text-muted)] rounded-lg transition-all hover:scale-105 active:scale-95"
        title={t("app_generateFlashcards")} aria-label={t("app_generateFlashcards")}
      >
        {isGeneratingCards ? (
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        ) : (
          <Brain className="size-4" aria-hidden="true" />
        )}
      </button>
      <button
        onClick={onAudioSummary}
        disabled={isSpeaking}
        className="truncate p-2 ds-ghost-bg text-[var(--text-secondary)] dark:text-[var(--text-muted)] rounded-lg transition-all hover:scale-105 active:scale-95"
        title={t("app_audioSummary")} aria-label={t("app_audioSummary")}
      >
        {isSpeaking ? (
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        ) : (
          <Volume2 className="size-4" aria-hidden="true" />
        )}
      </button>
      <div className="h-4 w-px bg-[var(--bg-secondary)] dark:bg-[var(--bg-card)] mx-1"></div>
      <button
        onClick={() => setTheme(theme === "light" ? "dark" : "light")}
        className="truncate p-2 ds-ghost-bg text-[var(--text-secondary)] dark:text-[var(--text-muted)] rounded-lg transition-all hover:scale-105 active:scale-95"
        title={theme === "light" ? t("app_switchToDark", "Switch to dark mode") : t("app_switchToLight", "Switch to light mode")}
        aria-label={theme === "light" ? t("app_switchToDark", "Switch to dark mode") : t("app_switchToLight", "Switch to light mode")}
      >
        {theme === "light" ? (
          <Moon className="size-4" aria-hidden="true" />
        ) : (
          <Sun className="size-4" aria-hidden="true" />
        )}
      </button>
      <button
        onClick={() => setIsZenMode(!isZenMode)}
        className={`p-2 rounded-lg transition-all hover:scale-105 active:scale-95 ${isZenMode ? "bg-cyan-500 ds-text-on-accent shadow-md shadow-cyan-500/20" : "ds-ghost-bg text-[var(--text-secondary)] dark:text-[var(--text-muted)]"}`}
        title={t("app_zenMode")}
        aria-label={t("app_zenMode")}
      >
        <Eye className="size-4" aria-hidden="true" />
      </button>
      <div className="h-4 w-px bg-[var(--bg-secondary)] dark:bg-[var(--bg-card)] mx-1"></div>
      <button
        onClick={() => editor?.undo()}
        className="p-2 ds-ghost-bg text-[var(--text-secondary)] dark:text-[var(--text-muted)] rounded-lg transition-all hover:scale-105 active:scale-95"
        aria-label={t("app_undo", "Undo")}
      >
        <Undo className="size-4" aria-hidden="true" />
      </button>
      <button
        onClick={() => editor?.redo()}
        className="p-2 ds-ghost-bg text-[var(--text-secondary)] dark:text-[var(--text-muted)] rounded-lg transition-all hover:scale-105 active:scale-95"
        aria-label={t("app_redo", "Redo")}
      >
        <Redo className="size-4" aria-hidden="true" />
      </button>
      <div className="h-4 w-px bg-[var(--bg-secondary)] dark:bg-[var(--bg-card)] mx-1"></div>
      <Suspense
        fallback={
          <div className="size-8 flex items-center justify-center">
            <Loader2 className="size-4 animate-spin text-[var(--text-muted)]" />
          </div>
        }
      >
        <PdfUploader onTextExtracted={onPdfText} />
        <TtsPlayer text={editorText} isPrivate={isPrivate} />
        <ImageGenerator onImageGenerated={handleImageInsert} />
        <TemplateManager onApply={handleTemplateApply as unknown as (blocks: unknown[]) => void} />
      </Suspense>
      </div>
    </div>
  );
}
