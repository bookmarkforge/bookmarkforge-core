import { lazy, useMemo, useState, useCallback, useRef, useEffect } from "react";
import {
  Sparkles,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  CheckSquare,
  Code,
  Quote,
  Image as ImageIcon,
  Minus,
  ListChecks,
  MessagesSquare,
  Columns2,
  Columns3,
  type LucideIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { BlockEditorState } from "./useBlockEditorState";
import { insertOrUpdateBlockForSlashMenu, type PartialBlock } from "@blocknote/core";
import { createEditorFocusHandler } from "./editorFocusWarmup";
import { initDB } from "../../container/database";
import { attachmentStore } from "../../services/documentAttachments";
import { logger } from "../../utils/logger";
import {
  chatPanelImport,
  versionHistoryImport,
  backlinksImport,
  expertAgentsPanelImport,
  aiCopilotPanelImport,
  suggestionsPanelImport,
  editorToolbarImport,
} from "./lazy-editor-components";

const ChatPanelLazy = lazy(chatPanelImport);
const VersionHistoryLazy = lazy(versionHistoryImport);
const BacklinksLazy = lazy(backlinksImport);
const ExpertAgentsPanelLazy = lazy(expertAgentsPanelImport);
const AICopilotPanel = lazy(aiCopilotPanelImport);
const SuggestionsPanel = lazy(suggestionsPanelImport);
const EditorToolbar = lazy(editorToolbarImport);

interface UseBlockEditorLogicParams {
  documentId: string;
  state: BlockEditorState;
  /** Live getter for the current editor blocks; null until the editor mounts. */
  getBlocks?: () => PartialBlock[] | null;
}

interface BlockNoteEditor {
  getTextCursorPosition: () => { block: { id: string } };
  updateBlock: (block: { id: string }, update: Record<string, unknown>) => void;
}

interface SlashMenuItem {
  id: string;
  title: string;
  description: string;
  icon: LucideIcon;
  group: "basic" | "lists" | "media" | "advanced";
  keywords: string[];
  onItemClick: (editor: BlockNoteEditor) => void;
}

const STOP_WORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "but",
  "in",
  "on",
  "at",
  "to",
  "for",
  "of",
  "with",
  "by",
  "from",
  "as",
  "is",
  "was",
  "are",
  "were",
  "be",
  "been",
  "being",
  "have",
  "has",
  "had",
  "do",
  "does",
  "did",
  "will",
  "would",
  "should",
  "could",
  "may",
  "might",
  "can",
  "this",
  "that",
  "these",
  "those",
  "i",
  "you",
  "he",
  "she",
  "it",
  "we",
  "they",
  "el",
  "la",
  "los",
  "las",
  "un",
  "una",
  "de",
  "del",
  "en",
  "con",
  "por",
  "para",
  "que",
  "se",
  "es",
  "son",
  "fue",
  "ser",
  "estar",
  "este",
  "esta",
  "esto",
  "ese",
  "esa",
  "eso",
  "y",
  "o",
  "pero",
  "si",
  "no",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\wáéíóúñü\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w));
}

function extractTagsFromText(text: string, max = 8): string[] {
  const counts = new Map<string, number>();
  for (const token of tokenize(text)) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([word]) => word);
}

function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 10 && s.length <= 200);
}

function extractFlashcards(
  text: string,
  max = 6,
): Array<{ front: string; back: string }> {
  const sentences = splitSentences(text);
  const cards: Array<{ front: string; back: string }> = [];
  for (const sentence of sentences) {
    if (cards.length >= max) {break;}
    // Heuristic 1: "X is Y" or "X are Y" — front = X, back = definition
    const defMatch = sentence.match(
      /^(.+?)\s+(?:is|are|es|son|significa)\s+(.+?)[.!?]?$/i,
    );
    if (defMatch) {
      cards.push({ front: defMatch[1]!.trim(), back: defMatch[2]!.trim() });
      continue;
    }
    // Heuristic 2: "X: Y" — front = X, back = Y
    const colonMatch = sentence.match(/^([^:]{3,60}):\s*(.+?)[.!?]?$/);
    if (colonMatch) {
      cards.push({ front: colonMatch[1]!.trim(), back: colonMatch[2]!.trim() });
      continue;
    }
    // Heuristic 3: cloze-style — first half is front, second half is back
    const half = Math.floor(sentence.length / 2);
    if (half > 10) {
      cards.push({ front: sentence.slice(0, half) + "…", back: sentence });
    }
  }
  return cards;
}

const FOLDER_HINTS: Record<string, string[]> = {
  tech: [
    "javascript",
    "typescript",
    "react",
    "python",
    "rust",
    "code",
    "api",
    "github",
    "programming",
    "developer",
  ],
  work: [
    "meeting",
    "project",
    "client",
    "deadline",
    "report",
    "kpi",
    "okr",
    "agile",
    "sprint",
  ],
  learning: [
    "tutorial",
    "course",
    "learn",
    "study",
    "book",
    "guide",
    "documentation",
    "docs",
  ],
  recipes: ["recipe", "cook", "food", "meal", "ingredient", "kitchen", "bake"],
  news: ["news", "article", "today", "update", "announcement", "press"],
  personal: [
    "family",
    "friend",
    "home",
    "life",
    "diary",
    "journal",
    "thoughts",
  ],
  shopping: ["buy", "shop", "price", "review", "product", "amazon", "store"],
  health: [
    "health",
    "fitness",
    "workout",
    "medical",
    "doctor",
    "exercise",
    "diet",
  ],
  finance: ["money", "invest", "stock", "crypto", "bank", "budget", "tax"],
  travel: [
    "travel",
    "trip",
    "flight",
    "hotel",
    "vacation",
    "tour",
    "destination",
  ],
};

function suggestFolder(text: string): string {
  const tokens = new Set(tokenize(text));
  let best = { folder: "general", score: 0 };
  for (const [folder, keywords] of Object.entries(FOLDER_HINTS)) {
    const score = keywords.reduce((s, k) => s + (tokens.has(k) ? 1 : 0), 0);
    if (score > best.score) {best = { folder, score };}
  }
  return best.folder;
}

const SUGGESTION_ICONS: Record<string, LucideIcon> = {
  improve: Sparkles,
  expand: Sparkles,
  shorten: Sparkles,
  tag: Sparkles,
  folder: Sparkles,
  flashcards: Sparkles,
  audio: Sparkles,
  default: Sparkles,
};

const SUGGESTION_COLORS: Record<string, "cyan" | "amber" | "rose" | "blue"> = {
  improve: "cyan",
  expand: "amber",
  shorten: "rose",
  tag: "blue",
  folder: "cyan",
  flashcards: "cyan",
  audio: "amber",
  default: "cyan",
};

/**
 * BlockEditor logic hook.
 * Implements local heuristics (no external AI required) for:
 * - Auto-tagging (keyword extraction)
 * - Flashcard generation (sentence parsing)
 * - Folder suggestion (keyword clustering)
 * - Functional slash menu with filtering
 * - Copilot action dispatch
 * The functions are designed to fail with a clear error when an external
 * dependency (TTS, etc.) is unavailable, without breaking the UI.
 */
export function useBlockEditorLogic({
  documentId,
  state,
  getBlocks,
}: UseBlockEditorLogicParams) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;

  const [isConnected] = useState(false);
  const [activeUsers, setActiveUsers] = useState<string[]>([]);
  const [isTagging, setIsTagging] = useState(false);
  const [isGeneratingCards, setIsGeneratingCards] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isCopilotThinking, setIsCopilotThinking] = useState(false);
  const [isSuggestingFolder, setIsSuggestingFolder] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  // documentId is used in copilot actions to scope operations to the current doc
  const documentIdRef = useRef(documentId);
  documentIdRef.current = documentId;

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") {return;}
    const channel = new BroadcastChannel("block-editor-presence");
    const handler = (e: MessageEvent) => {
      const { type, users } = e.data ?? {};
      if (type === "presence" && Array.isArray(users)) {
        setActiveUsers(users.filter((u): u is string => typeof u === "string"));
      }
    };
    channel.addEventListener("message", handler);
    return () => {
      channel.removeEventListener("message", handler);
      channel.close();
    };
  }, []);

  // Populate the smart-links panel when it opens: rank OTHER documents by
  // keyword overlap with the current text (local heuristic, no LLM needed)
  // and surface the top titles. The panel was wired in the JSX but nothing
  // ever called setSuggestions, so it always showed the empty state.
  // Debounced 400ms so typing in the open panel doesn't re-query per keystroke.
  useEffect(() => {
    if (!state.showSuggestions) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const keywords = new Set(
          extractTagsFromText(state.editorText ?? "", 12),
        );
        if (keywords.size === 0) {
          if (!cancelled) state.setSuggestions?.([]);
          return;
        }
        const db = await initDB();
        const docs = await db.documents.find({ limit: 100 }).exec();
        const scored = docs
          .map((d: { id: string; title?: string; textContent?: string }) => {
            const body =
              `${d.title ?? ""} ${d.textContent ?? ""}`.toLowerCase();
            let score = 0;
            for (const k of keywords) {
              if (body.includes(k)) score += 1;
            }
            return { doc: d, score };
          })
          .filter(
            (r: { doc: { id: string }; score: number }) =>
              r.score > 0 && r.doc.id !== documentIdRef.current,
          )
          .sort(
            (
              a: { score: number },
              b: { score: number },
            ) => b.score - a.score,
          )
          .slice(0, 6)
          .map((r: { doc: { title?: string } }) => r.doc.title || "Untitled");
        if (!cancelled) state.setSuggestions?.(scored);
      } catch (error) {
        logger.warn("[useBlockEditorLogic] Smart-links query failed", { error });
        if (!cancelled) state.setSuggestions?.([]);
      }
    }, 400);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [state.showSuggestions, state.editorText]);

  // Load the document from the DB on mount (title, plain text, blocks). The
  // editor is created before this resolves; once the blocks arrive BlockEditor
  // replaces them into the live editor via `editor.replaceBlocks`.
  useEffect(() => {
    let cancelled = false;
    // Setters are optional-chained: hook-level tests may pass a partial state
    // to exercise copilot/helper actions without wiring full editor state.
    state.setInitialContent?.("loading");
    (async () => {
      try {
        const db = await initDB();
        const result = await db.documents.findOne(documentId).exec();
        if (cancelled) return;
        if (result) {
          state.setDocTitle?.(result.title || "");
          state.setIsPrivate?.(!!result.isPrivate);
          // lastVersionSavedAt is a UI-only field (not in the RxDB schema), so
          // read it defensively — absent docs start with null (no version yet).
          const lastVersion = (result as unknown as {
            lastVersionSavedAt?: number | null;
          }).lastVersionSavedAt;
          state.setLastVersionSavedAt?.(lastVersion ?? null);
          const rawBlocks = Array.isArray(result.blocks) ? result.blocks : [];
          // Attachments are persisted as `bmf-attachment://<id>` refs; hydrate
          // them into fresh ObjectURLs so stored images render again and the
          // text preview resolves, then autosave round-trips them back to refs.
          const blocks = (
            rawBlocks.length > 0
              ? await attachmentStore.hydrateBlocks(documentId, rawBlocks)
              : rawBlocks
          ) as PartialBlock[];
          state.setInitialContent?.(blocks.length > 0 ? blocks : "empty");
          state.setEditorText?.(
            await attachmentStore.hydrateText(
              documentId,
              result.textContent || "",
            ),
          );
        } else {
          await db.documents.upsert({
            id: documentId,
            folderId: "root",
            // Localized: an empty title must not be persisted as the
            // English string, or the display fallback (BlockEditor:189)
            // would never trigger for non-English users.
            title: t("app_untitledDocument", "Untitled Document"),
            blocks: [],
            textContent: "",
            tags: [],
            links: [],
            processed: false,
            isDeleted: false,
            isPrivate: false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
          if (!cancelled) state.setInitialContent?.("empty");
        }
      } catch (error) {
        logger.warn("[BlockEditor] failed to load document", { error });
        if (!cancelled) state.setInitialContent?.("empty");
      }
    })();
    return () => {
      cancelled = true;
      // Release hydrated attachment ObjectURLs when the document unmounts or
      // switches, so opening/leaving documents with images does not pin their
      // blobs in memory for the lifetime of the page.
      attachmentStore.revokeDocumentUrls(documentId);
    };
  }, [documentId]);

  // Debounced autosave: 2s after the last title/content change, persist the
  // document and (throttled to 5 min) snapshot a version for history.
  useEffect(() => {
    if (state.initialContent === "loading") return;
    state.setSaveStatus?.("unsaved");
    const timer = window.setTimeout(async () => {
      state.setSaveStatus?.("saving");
      try {
        const db = await initDB();
        const doc = await db.documents.findOne(documentId).exec();
        const rawBlocks = getBlocks?.() ?? [];
        // Persist attachments deterministically: live `blob:` URLs become
        // `bmf-attachment://<id>` refs (and the bytes live in the encrypted
        // documentAttachments collection), so reloads and exports resolve them.
        const blocks = (await attachmentStore.persistBlocks(
          documentId,
          rawBlocks,
        )) as PartialBlock[];
        const textContent = await attachmentStore.persistText(
          documentId,
          state.editorText || "",
        );
        const now = new Date().toISOString();
        const patch = {
          title: state.docTitle || t("app_untitledDocument", "Untitled Document"),
          blocks,
          textContent,
          processed: false,
          updatedAt: now,
          isPrivate: state.isPrivate,
        };
        if (doc) {
          await doc.incrementalPatch(patch);
        } else {
          await db.documents.upsert({
            id: documentId,
            folderId: "root",
            ...patch,
            tags: [],
            links: [],
            isDeleted: false,
            createdAt: now,
          });
        }
        const last = state.lastVersionSavedAt;
        if (last === null || Date.now() - last >= 300_000) {
          await db.versions.upsert({
            id: `ver-${documentId}-${Date.now()}`,
            documentId,
            blocks,
            createdAt: now,
          });
          state.setLastVersionSavedAt?.(Date.now());
        }
      } catch (error) {
        logger.warn("[BlockEditor] autosave failed", { error });
      } finally {
        state.setSaveStatus?.("saved");
      }
    }, 2000);
    return () => window.clearTimeout(timer);
  }, [state.initialContent, state.docTitle, state.editorText, state.isPrivate]);

  const getText = useCallback((): string => {
    return state.editorText ?? "";
  }, [state.editorText]);

  const autoTag = useCallback(async (): Promise<string[]> => {
    setIsTagging(true);
    setAiError(null);
    try {
      const text = getText();
      if (!text.trim()) {
        throw new Error(
          t("editor_no_content_to_tag") ?? "There is no content to tag",
        );
      }
      return extractTagsFromText(text);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setAiError(msg);
      state.setError?.(msg);
      return [];
    } finally {
      setIsTagging(false);
    }
  }, [getText, state, t]);

  const generateFlashcards = useCallback(async (): Promise<
    Array<{ front: string; back: string }>
  > => {
    setIsGeneratingCards(true);
    setAiError(null);
    try {
      const text = getText();
      if (!text.trim()) {
        throw new Error(
          t("editor_no_content_for_flashcards") ??
            "No hay contenido para generar flashcards",
        );
      }
      return extractFlashcards(text);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setAiError(msg);
      state.setError?.(msg);
      return [];
    } finally {
      setIsGeneratingCards(false);
    }
  }, [getText, state, t]);

  const audioSummary = useCallback(async (): Promise<void> => {
    setIsSpeaking(true);
    setAiError(null);
    try {
      if (typeof window === "undefined" || !("speechSynthesis" in window)) {
        throw new Error(
          t("editor_tts_not_available") ??
            "Text-to-Speech no disponible en este navegador",
        );
      }
      const text = getText();
      if (!text.trim()) {
        throw new Error(
          t("editor_no_content_to_speak") ?? "There is no content to read aloud",
        );
      }
      const utterance = new SpeechSynthesisUtterance(text.slice(0, 5000));
      utterance.lang = lang;
      window.speechSynthesis.speak(utterance);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setAiError(msg);
      state.setError?.(msg);
    } finally {
      setIsSpeaking(false);
    }
  }, [getText, state, t, lang]);

  const suggestFolderFn = useCallback(async (): Promise<string> => {
    setIsSuggestingFolder(true);
    setAiError(null);
    try {
      const text = getText();
      if (!text.trim()) {
        throw new Error(
          t("editor_no_content_to_suggest") ??
            "There is no content to analyze",
        );
      }
      return suggestFolder(text);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setAiError(msg);
      state.setError?.(msg);
      return "general";
    } finally {
      setIsSuggestingFolder(false);
    }
  }, [getText, state, t]);

  const copilotAction = useCallback(
    async (
      action: string,
      params?: Record<string, unknown>,
    ): Promise<unknown> => {
      setIsCopilotThinking(true);
      setAiError(null);
      try {
        switch (action) {
          case "tag":
            return await autoTag();
          case "flashcards":
            return await generateFlashcards();
          case "audio":
            await audioSummary();
            return { ok: true };
          case "folder":
            return await suggestFolderFn();
          case "improve":
          case "expand":
          case "shorten":
          case "summarize":
          case "continue":
          case "fix":
          case "translate":
          case "rewrite": {
            // Without an LLM, return the current text annotated with the action
            const text = getText();
            return {
              action,
              documentId: documentIdRef.current,
              length: text.length,
              note:
                t("editor_copilot_local_only") ??
                "Copilot is available only with local AI",
            };
          }
          case "export":
            return { ok: true, params };
          default:
            throw new Error(`Unknown copilot action: ${action}`);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setAiError(msg);
        state.setError?.(msg);
        return { ok: false, error: msg };
      } finally {
        setIsCopilotThinking(false);
      }
    },
    [
      autoTag,
      generateFlashcards,
      audioSummary,
      suggestFolderFn,
      getText,
      state,
      t,
    ],
  );

  // Opportunistic local-AI preload on first editor focus. The BlockEditor
  // tests have always described this behavior; this wiring is what makes it
  // real. warmup() guards init() with canRunLocalLLM() (WebGPU + f16 + RAM)
  // and init() is idempotent for the loaded model, so capable devices preload
  // once per editor while GPU-less devices skip silently.
  const handleEditorFocus = useCallback(
    createEditorFocusHandler({
      setAiError,
      isWarmedUpRef: state.isWarmedUpRef,
    }),
    [setAiError, state.isWarmedUpRef],
  );

  const handlePdfText = useCallback(
    async (text: string) => {
      state.setEditorText?.(text);
    },
    [state],
  );

  const handleVoiceTranscript = useCallback(
    async (text: string) => {
      const current = state.editorText ?? "";
      state.setEditorText?.(current ? `${current} ${text}` : text);
    },
    [state],
  );

  const handleGenerateFlashcards = generateFlashcards;
  const handleAudioSummary = audioSummary;
  const handleSuggestFolder = suggestFolderFn;
  const handleCopilotAction = copilotAction;

  const getSuggestionIcon = useCallback((suggestion: string): LucideIcon => {
    return SUGGESTION_ICONS[suggestion] ?? SUGGESTION_ICONS.default!;
  }, []);

  const getSuggestionColor = useCallback(
    (suggestion: string): "cyan" | "amber" | "rose" | "blue" => {
      return SUGGESTION_COLORS[suggestion] ?? SUGGESTION_COLORS.default!;
    },
    [],
  );

  const slashMenuItems: SlashMenuItem[] = useMemo(
    () => [
      {
        id: "heading-1",
        title: t("editor_slash_h1") ?? "Heading 1",
        description: t("editor_slash_h1_desc") ?? "Add a large heading",
        icon: Heading1,
        group: "basic",
        keywords: ["heading", "title", "h1", "titulo"],
        onItemClick: (editor: BlockNoteEditor) =>
          insertOrUpdateBlockForSlashMenu(
            editor as Parameters<typeof insertOrUpdateBlockForSlashMenu>[0],
            { type: "heading", props: { level: 1 } } as Record<
              string,
              unknown
            > as Parameters<typeof insertOrUpdateBlockForSlashMenu>[1],
          ),
      },
      {
        id: "heading-2",
        title: t("editor_slash_h2") ?? "Heading 2",
        description: t("editor_slash_h2_desc") ?? "Add a medium heading",
        icon: Heading2,
        group: "basic",
        keywords: ["heading", "subtitle", "h2", "subtitulo"],
        onItemClick: (editor: BlockNoteEditor) =>
          insertOrUpdateBlockForSlashMenu(
            editor as Parameters<typeof insertOrUpdateBlockForSlashMenu>[0],
            { type: "heading", props: { level: 2 } } as Record<
              string,
              unknown
            > as Parameters<typeof insertOrUpdateBlockForSlashMenu>[1],
          ),
      },
      {
        id: "heading-3",
        title: t("editor_slash_h3") ?? "Heading 3",
        description: t("editor_slash_h3_desc") ?? "Add a small heading",
        icon: Heading3,
        group: "basic",
        keywords: ["heading", "section", "h3", "seccion"],
        onItemClick: (editor: BlockNoteEditor) =>
          insertOrUpdateBlockForSlashMenu(
            editor as Parameters<typeof insertOrUpdateBlockForSlashMenu>[0],
            { type: "heading", props: { level: 3 } } as Record<
              string,
              unknown
            > as Parameters<typeof insertOrUpdateBlockForSlashMenu>[1],
          ),
      },
      {
        id: "toggle-list",
        title: t("editor_slash_toggle") ?? "Toggle List",
        description: t("editor_slash_toggle_desc") ?? "Add a collapsible toggle",
        icon: ListChecks,
        group: "lists",
        keywords: ["toggle", "collapse", "plegable", "expand"],
        onItemClick: (editor: BlockNoteEditor) =>
          insertOrUpdateBlockForSlashMenu(
            editor as Parameters<typeof insertOrUpdateBlockForSlashMenu>[0],
            { type: "toggleListItem" } as Parameters<
              typeof insertOrUpdateBlockForSlashMenu
            >[1],
          ),
      },
      {
        id: "bullet-list",
        title: t("editor_slash_bullet") ?? "Bullet List",
        description: t("editor_slash_bullet_desc") ?? "Create a bullet list",
        icon: List,
        group: "lists",
        keywords: ["list", "bullet", "lista", "viñeta"],
        onItemClick: (editor: BlockNoteEditor) =>
          insertOrUpdateBlockForSlashMenu(
            editor as Parameters<typeof insertOrUpdateBlockForSlashMenu>[0],
            { type: "bulletListItem" } as Parameters<
              typeof insertOrUpdateBlockForSlashMenu
            >[1],
          ),
      },
      {
        id: "numbered-list",
        title: t("editor_slash_numbered") ?? "Numbered List",
        description: t("editor_slash_numbered_desc") ?? "Create a numbered list",
        icon: ListOrdered,
        group: "lists",
        keywords: ["list", "numbered", "numerada", "orden"],
        onItemClick: (editor: BlockNoteEditor) =>
          insertOrUpdateBlockForSlashMenu(
            editor as Parameters<typeof insertOrUpdateBlockForSlashMenu>[0],
            { type: "numberedListItem" } as Parameters<
              typeof insertOrUpdateBlockForSlashMenu
            >[1],
          ),
      },
      {
        id: "todo",
        title: t("editor_slash_todo") ?? "To-do",
        description: t("editor_slash_todo_desc") ?? "Create a to-do list",
        icon: CheckSquare,
        group: "lists",
        keywords: ["todo", "check", "task", "tarea"],
        onItemClick: (editor: BlockNoteEditor) =>
          insertOrUpdateBlockForSlashMenu(
            editor as Parameters<typeof insertOrUpdateBlockForSlashMenu>[0],
            { type: "checkListItem" } as Parameters<
              typeof insertOrUpdateBlockForSlashMenu
            >[1],
          ),
      },
      {
        id: "callout",
        title: t("editor_slash_callout") ?? "Callout",
        description:
          t("editor_slash_callout_desc") ?? "Add a callout block",
        icon: MessagesSquare,
        group: "basic",
        keywords: ["callout", "note", "tip", "warning", "nota"],
        onItemClick: (editor: BlockNoteEditor) =>
          insertOrUpdateBlockForSlashMenu(
            editor as Parameters<typeof insertOrUpdateBlockForSlashMenu>[0],
            { type: "callout", props: { icon: "💡", color: "blue" } } as Record<
              string,
              unknown
            > as Parameters<typeof insertOrUpdateBlockForSlashMenu>[1],
          ),
      },
      {
        id: "columns-2",
        title: t("editor_slash_columns_2") ?? "2 Columns",
        description: t("editor_slash_columns_2_desc") ?? "Create two columns",
        icon: Columns2 as unknown as LucideIcon,
        group: "advanced",
        keywords: ["columns", "layout", "grid", "columnas"],
        onItemClick: (editor: BlockNoteEditor) => {
          const cursorPosition = editor.getTextCursorPosition();
          editor.updateBlock(cursorPosition.block, {
            type: "columnLayout",
            props: { count: 2 },
            children: [
              { type: "column", props: {}, content: [] },
              { type: "column", props: {}, content: [] },
            ],
          });
        },
      },
      {
        id: "columns-3",
        title: t("editor_slash_columns_3") ?? "3 Columns",
        description: t("editor_slash_columns_3_desc") ?? "Create three columns",
        icon: Columns3 as unknown as LucideIcon,
        group: "advanced",
        keywords: ["columns", "layout", "grid", "columnas"],
        onItemClick: (editor: BlockNoteEditor) => {
          const cursorPosition = editor.getTextCursorPosition();
          editor.updateBlock(cursorPosition.block, {
            type: "columnLayout",
            props: { count: 3 },
            children: [
              { type: "column", props: {}, content: [] },
              { type: "column", props: {}, content: [] },
              { type: "column", props: {}, content: [] },
            ],
          });
        },
      },
      {
        id: "code",
        title: t("editor_slash_code") ?? "Code",
        description: t("editor_slash_code_desc") ?? "Add a code block",
        icon: Code,
        group: "advanced",
        keywords: ["code", "snippet", "codigo"],
        onItemClick: (editor: BlockNoteEditor) =>
          insertOrUpdateBlockForSlashMenu(
            editor as Parameters<typeof insertOrUpdateBlockForSlashMenu>[0],
            { type: "codeBlock" } as Parameters<
              typeof insertOrUpdateBlockForSlashMenu
            >[1],
          ),
      },
      {
        id: "quote",
        title: t("editor_slash_quote") ?? "Quote",
        description: t("editor_slash_quote_desc") ?? "Add a quote block",
        icon: Quote,
        group: "advanced",
        keywords: ["quote", "citation", "cita"],
        onItemClick: (editor: BlockNoteEditor) =>
          insertOrUpdateBlockForSlashMenu(
            editor as Parameters<typeof insertOrUpdateBlockForSlashMenu>[0],
            { type: "quote" } as Parameters<
              typeof insertOrUpdateBlockForSlashMenu
            >[1],
          ),
      },
      {
        id: "divider",
        title: t("editor_slash_divider") ?? "Divider",
        description: t("editor_slash_divider_desc") ?? "Add a divider",
        icon: Minus,
        group: "advanced",
        keywords: ["divider", "separator", "linea", "separador"],
        onItemClick: (editor: BlockNoteEditor) =>
          insertOrUpdateBlockForSlashMenu(
            editor as Parameters<typeof insertOrUpdateBlockForSlashMenu>[0],
            { type: "divider" } as Parameters<
              typeof insertOrUpdateBlockForSlashMenu
            >[1],
          ),
      },
      {
        id: "image",
        title: t("editor_slash_image") ?? "Image",
        description: t("editor_slash_image_desc") ?? "Insert an image",
        icon: ImageIcon as unknown as LucideIcon,
        group: "media",
        keywords: ["image", "photo", "imagen", "foto"],
        onItemClick: (editor: BlockNoteEditor) =>
          insertOrUpdateBlockForSlashMenu(
            editor as Parameters<typeof insertOrUpdateBlockForSlashMenu>[0],
            { type: "image" } as Parameters<
              typeof insertOrUpdateBlockForSlashMenu
            >[1],
          ),
      },
    ],
    [t],
  );

  const filterSlashMenuItems = useCallback(
    async (query: string, items: unknown[]) => {
      if (!query.trim()) {return items as SlashMenuItem[];}
      const q = query.toLowerCase();
      return (items as SlashMenuItem[]).filter(
        (item) =>
          item.title.toLowerCase().includes(q) ||
          item.description.toLowerCase().includes(q) ||
          item.keywords.some((k) => k.toLowerCase().includes(q)),
      );
    },
    [],
  );

  return {
    t,
    lang,
    isConnected,
    activeUsers,
    isTagging,
    isGeneratingCards,
    isSpeaking,
    isCopilotThinking,
    isSuggestingFolder,
    aiError,
    setAiError,
    autoTag,
    generateFlashcards,
    audioSummary,
    suggestFolder: suggestFolderFn,
    copilotAction,
    slashMenuItems,
    filterSlashMenuItems,
    ChatPanelLazy,
    VersionHistoryLazy,
    BacklinksLazy,
    ExpertAgentsPanelLazy,
    AICopilotPanel,
    SuggestionsPanel,
    EditorToolbar,
    handleEditorFocus,
    handlePdfText,
    handleVoiceTranscript,
    handleGenerateFlashcards,
    handleAudioSummary,
    handleSuggestFolder,
    handleCopilotAction,
    getSuggestionIcon,
    getSuggestionColor,
  };
}

// Export helpers for testing
export const _internal = {
  tokenize,
  extractTagsFromText,
  splitSentences,
  extractFlashcards,
  suggestFolder,
};
