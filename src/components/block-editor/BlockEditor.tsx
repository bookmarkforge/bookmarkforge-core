import React, { useCallback, useEffect, useRef, useState, Suspense } from "react";
import { useBlockEditorState } from "./useBlockEditorState";
import { useBlockEditorLogic } from "./useBlockEditorLogic";
import { BlockNoteView } from "@blocknote/mantine";
import { useCreateBlockNote, SuggestionMenuController } from "@blocknote/react";
import { en, es } from "@blocknote/core/locales";
import { schema } from "./blocknoteSchema";
import Markdown from "react-markdown";
import { Sparkles, Undo, Link } from "lucide-react";
import { sanitizeText } from "../../services/SanitizationService";
import { ExportMenu } from "../ExportMenu";
import { ShareButton } from "../ShareButton";
import { initDB } from "../../container/database";
import { normalizeTemplateBlocksToBlockNote } from "../../services/DocumentTemplateService";
import { filterSuggestionItems, type PartialBlock, type Block } from "@blocknote/core";
import { ObjectUrlRegistry } from "../../utils/objectUrlRegistry";
import { attachmentStore } from "../../services/documentAttachments";
import { logRateLimited } from "../../utils/boundedLog";
import "./customBlocks/columnLayout.css";

export default function BlockEditor({
  documentId,
  onSelectDocument,
}: {
  documentId: string;
  onSelectDocument?: (id: string) => void;
}) {
  const state = useBlockEditorState();
  const logic = useBlockEditorLogic({
    documentId,
    state,
    getBlocks: () => editorRef.current?.document ?? null,
  });

  const {
    initialContent,
    setInitialContent,
    docTitle,
    setDocTitle,
    editorText,
    setEditorText,
    theme,
    setTheme,
    saveStatus,
    showChat,
    setShowChat,
    showPreview,
    setShowPreview,
    showSuggestions,
    setShowSuggestions,
    showCopilot,
    setShowCopilot,
    showExpertAgents,
    setShowExpertAgents,
    showHistory,
    setShowHistory,
    isZenMode,
    setIsZenMode,
    isPrivate,
    setIsPrivate,
    suggestions,
    error,
    setError,
  } = state;

  const {
    t,
    lang,
    isConnected,
    activeUsers,
    slashMenuItems,
    handleEditorFocus,
    isTagging,
    isGeneratingCards,
    isSpeaking,
    isSuggestingFolder,
    isCopilotThinking,
    EditorToolbar,
    VersionHistoryLazy,
    ChatPanelLazy,
    BacklinksLazy,
    ExpertAgentsPanelLazy,
    AICopilotPanel,
    SuggestionsPanel,
    handleVoiceTranscript,
    handlePdfText,
    handleGenerateFlashcards,
    handleAudioSummary,
    handleSuggestFolder,
    handleCopilotAction,
    autoTag,
  } = logic;

  const uploadedObjectUrlsRef = useRef(new ObjectUrlRegistry());

  const editor = useCreateBlockNote({
    schema,
    // `initialContent` is a union of "loading" | "empty" | PartialBlock[].
    // Only NON-EMPTY real arrays are valid BlockNote content: the old guard
    // (`!== "loading" && length > 0`) treated the STRING "empty" as blocks
    // ("empty".length > 0) crashing new-document creation, and passing an
    // EMPTY array also crashes BlockNote (its own check throws on
    // `t.length === 0`). Normalized defensively: if blocks are already loaded
    // before mount (instead of via replaceBlocks), template shorthand types
    // must be converted to valid BlockNote specs.
    dictionary: lang.startsWith("es") ? es : en,
    initialContent:
      Array.isArray(initialContent) && initialContent.length > 0
        ? (normalizeTemplateBlocksToBlockNote(initialContent) as PartialBlock[])
        : undefined,
    uploadFile: async (file: File) => {
      // Use ObjectURL instead of base64 data URL to avoid bloating editor state.
      // Track every URL so images do not remain pinned after leaving the editor.
      const url = uploadedObjectUrlsRef.current.create(file);
      // Persist the bytes (encrypted, in a dedicated collection) and bind the
      // live ObjectURL to the stable attachment id, so autosave can rewrite
      // `blob:` refs to `bmf-attachment://<id>` and the image survives reload
      // and export. Persistence failure must NOT break the upload: the image
      // still renders for this session, just like before this feature.
      try {
        const attachmentId = await attachmentStore.persistFile(documentId, file);
        attachmentStore.register(url, attachmentId);
      } catch (error) {
        logRateLimited(
          "warn",
          "block-editor-upload-persist",
          "Failed to persist attachment bytes; the image will not survive reload",
          { error: error instanceof Error ? error.message : String(error) },
        );
      }
      return url;
    },
  });

  // Keep a stable ref so the autosave closure always reads the CURRENT editor
  // even though the hook is created before the editor instance.
  const editorRef = useRef<ReturnType<typeof useCreateBlockNote> | null>(null);
  editorRef.current = editor;

  useEffect(() => {
    return () => {
      uploadedObjectUrlsRef.current.revokeAll();
    };
  }, []);

  const [_editorVersion, setEditorVersion] = useState(0);

  // Blocks loaded from the DB (a non-empty array) are pushed into the live
  // editor after mount — BlockNote only honours `initialContent` at creation,
  // so late-loaded content must go through replaceBlocks. Template blocks use
  // shorthand types (`bulletList`/`numberedList`) that aren't valid BlockNote
  // block specs, so they're normalized first (otherwise BlockNote throws
  // "Cannot read properties of undefined (reading 'isInGroup')").
  useEffect(() => {
    if (
      editor &&
      Array.isArray(initialContent) &&
      initialContent.length > 0
    ) {
      const blocks = normalizeTemplateBlocksToBlockNote(
        initialContent,
      ) as PartialBlock[];
      editor.replaceBlocks(editor.document, blocks);
      uploadedObjectUrlsRef.current.revokeUnreferenced(blocks);
      setInitialContent("empty");
    }
  }, [initialContent, editor, setInitialContent]);

  // Restore a saved version: replace the live editor content with the
  // version's blocks (normalized, in case they were stored before the
  // template-shorthand fix) and clear the initial-content state so autosave
  // picks up the restored document.
  const handleRestoreVersion = useCallback(
    async (blocks: unknown[]) => {
      if (!editor) {return;}
      // Version snapshots persist `bmf-attachment://` refs; restore the bytes
      // as fresh ObjectURLs so the image renders and re-saves correctly.
      const hydrated = (await attachmentStore.hydrateBlocks(
        documentId,
        blocks,
      )) as PartialBlock[];
      const normalized = normalizeTemplateBlocksToBlockNote(
        hydrated,
      ) as PartialBlock[];
      editor.replaceBlocks(editor.document, normalized);
      uploadedObjectUrlsRef.current.revokeUnreferenced(normalized);
      // Mirror the restored blocks into plain text so the preview and the
      // autosave reflect the restored version immediately (replaceBlocks
      // does not always fire BlockNoteView's onChange).
      try {
        const md =
          editor.blocksToMarkdownLossy?.(editor.document ?? []) ?? "";
        if (md) setEditorText(md);
      } catch (error) {
        // Keep the editor usable, but retain a bounded diagnostic for failed
        // markdown conversion so preview/autosave regressions are observable.
        logRateLimited(
          "warn",
          "block-editor-restore-markdown",
          "Failed to convert restored blocks to markdown; keeping current text",
          { error: error instanceof Error ? error.message : String(error) },
        );
      }
      setInitialContent("empty");
    },
    [editor, documentId, setInitialContent, setEditorText],
  );

  const getMentionItems = useCallback(
    async (query: string) => {
      try {
        const db = await initDB();
        const q = query.toLowerCase();
        const docs = await db.documents.find({ limit: 200 }).exec();
        const results = docs
          .filter(
            (d: { id: string; title?: string }) =>
              d.id !== documentId && d.title?.toLowerCase().includes(q),
          )
          .slice(0, 10)
          .map((d: { id: string; title?: string }) => ({
            id: d.id,
            title: d.title || t("app_untitledDocument", "Untitled Document"),
          }));
        return results.map((doc: { id: string; title: string }) => ({
          key: doc.id,
          title: doc.title,
          onItemClick: () => {
            const selection = editor.getSelection();
            if (selection && selection.blocks.length === 1) {
              const block = selection.blocks[0]!;
              (editor as unknown as { updateBlock: (block: unknown, props: unknown) => void }).updateBlock(block, {
                type: block.type,
                props: block.props,
              });
            }
            editor.insertInlineContent([
              {
                type: "link",
                href: `bookmark://doc/${doc.id}`,
                content: [{ type: "text", text: doc.title, styles: {} }],
              },
            ]);
          },
          icon: React.createElement(Link, { className: "size-4" }),
          group: "documents",
          aliases: [doc.title],
        }));
      } catch (_err) {
        return [];
      }
    },
    [editor, documentId],
  );

  if (initialContent === "loading") {
    return (
      <div className="p-8 animate-pulse ds-text-muted">{t("app_loading")}</div>
    );
  }

  return (
    <div
      data-testid="block-editor"
      className={`${showPreview || showSuggestions || showCopilot || showChat || showExpertAgents ? "max-w-7xl" : "max-w-6xl"} mx-auto py-8 transition-all duration-300 hover:bg-[var(--state-hover-bg)] dark:hover:bg-[var(--state-hover-bg)]/20 rounded-2xl`}
    >
      {error && (
        <div className="mx-4 md:mx-12 mb-6 p-4 bg-[var(--color-danger)]/10 border border-[var(--danger-soft-border)]/50 rounded-xl flex items-center justify-between animate-in fade-in slide-in-from-top-4">
          <div className="flex items-center gap-3 ds-text-danger">
            <Sparkles className="size-5" />
            <p className="text-sm font-medium">{error}</p>
          </div>
          <button
            onClick={() => setError(null)}
            className="ds-text-danger/50 hover:ds-text-danger transition-colors"
          >
            <Undo className="size-4" />
          </button>
        </div>
      )}
      <div className="flex flex-col gap-6 mb-8 px-4 md:px-12">
        <input
          type="text"
          aria-label={t("app_title")}
          value={docTitle}
          onChange={(e) => setDocTitle(sanitizeText(e.target.value))}
          className="w-full bg-transparent text-3xl sm:text-5xl font-bold outline-none text-center tracking-tight transition-colors ds-text-primary"
          placeholder={t("app_title")}
        />
        <div className="flex items-center justify-center gap-2 flex-wrap p-2 md:p-3 shadow-sm ds-radius-card ds-bg-card ds-border">
          <div className="flex items-center gap-1 me-2">
            {activeUsers.map((user, idx) => (
              <div
                key={idx}
                className="size-8 rounded-full border-2 flex items-center justify-center text-xs font-bold shadow-sm -ms-3 first:ms-0 hover:z-10 transition-transform hover:scale-110 ds-bg-accent-primary ds-border-card ds-text-white"
                title={user}
              >
                {user.substring(0, 2).toUpperCase()}
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <div
              className={`size-2 rounded-full ${isConnected ? "ds-bg-success animate-pulse" : "bg-[var(--text-muted)]"}`}
            ></div>
            <span
              className={`text-xs font-medium uppercase tracking-wider ${isConnected ? "ds-text-success" : "text-[var(--text-muted)]"}`}
            >
              {isConnected ? t("app_live") : t("app_offline")}
            </span>
          </div>{" "}
          <div className="h-4 w-px mx-2 hidden sm:block ds-bg-divider"></div>
          <div className="flex items-center gap-2">
            {editor && <ExportMenu editor={editor as unknown as Parameters<typeof ExportMenu>[0]['editor']} title={docTitle} />}
            {editor && (
              <ShareButton
                documentId={documentId}
                title={docTitle}
                content={(editor as unknown as { document: Block[] }).document}
              />
            )}
          </div>
        </div>
        {/* Full editing toolbar — was never rendered in production (the hook
            exposed it but the JSX ignored it). Now wired: PDF upload, voice
            dictation, TTS, history, preview toggle, AI panels, auto-tag,
            flashcards, audio summary, folder suggestion, theme, undo/redo. */}
        {editor && (
          <Suspense fallback={null}>
            <EditorToolbar
              theme={theme}
              setTheme={setTheme}
              isPrivate={isPrivate}
              setIsPrivate={setIsPrivate}
              saveStatus={saveStatus}
              showHistory={showHistory}
              setShowHistory={setShowHistory}
              showPreview={showPreview}
              setShowPreview={setShowPreview}
              showSuggestions={showSuggestions}
              setShowSuggestions={setShowSuggestions}
              showCopilot={showCopilot}
              setShowCopilot={setShowCopilot}
              showExpertAgents={showExpertAgents}
              setShowExpertAgents={setShowExpertAgents}
              showChat={showChat}
              setShowChat={setShowChat}
              isZenMode={isZenMode}
              setIsZenMode={setIsZenMode}
              isTagging={isTagging}
              isGeneratingCards={isGeneratingCards}
              isSpeaking={isSpeaking}
              isSuggestingFolder={isSuggestingFolder}
              editorText={editorText}
              editor={editor as unknown as Parameters<typeof EditorToolbar>[0]['editor']}
              onVoiceTranscript={handleVoiceTranscript}
              onPdfText={handlePdfText}
              onGenerateFlashcards={handleGenerateFlashcards}
              onAudioSummary={handleAudioSummary}
              onSuggestFolder={handleSuggestFolder}
              autoTag={autoTag}
            />
          </Suspense>
        )}
        <div
          className="flex flex-col lg:flex-row gap-6 justify-center"
          role="presentation"
        >
          <div
            className="w-full lg:flex-1 lg:min-w-0 max-w-7xl blocknote-theme-wrapper"
            data-theme={theme}
            onFocus={handleEditorFocus}
            role="presentation"
          >
            <BlockNoteView
              editor={editor}
              theme={theme}
              onChange={() => {
                uploadedObjectUrlsRef.current.revokeUnreferenced(editor.document);
                setEditorVersion((v) => v + 1);
                // Mirror the live editor content into plain text (used for
                // embeddings + the preview) so autosave persists it.
                try {
                  const md =
                    editor.blocksToMarkdownLossy?.(editor.document ?? []) ?? "";
                  setEditorText(md);
                } catch (error) {
                  // BlockNote updates must not break the editor event loop;
                  // report conversion failures without logging document text.
                  logRateLimited(
                    "warn",
                    "block-editor-change-markdown",
                    "Failed to convert editor blocks to markdown; keeping previous text",
                    { error: error instanceof Error ? error.message : String(error) },
                  );
                }
              }}
              slashMenu={false}
            >
              <SuggestionMenuController
                triggerCharacter="/"
                getItems={async (query: string) =>
                  filterSuggestionItems(slashMenuItems, query)
                }
                suggestionMenuComponent={(() => null) as unknown as React.FC}
                onItemClick={() => {}}
              />
              <SuggestionMenuController
                triggerCharacter="@"
                suggestionMenuComponent={(() => null) as unknown as React.FC}
                onItemClick={() => {}}
                getItems={getMentionItems}
                minQueryLength={1}
              />
            </BlockNoteView>
            {/* Markdown preview is gated on the toolbar's showPreview toggle
                (it previously rendered unconditionally, so the toggle only
                widened the container instead of showing/hiding the preview). */}
            {showPreview && (
              <div className="px-4 md:px-12">
                <div className="markdown-body prose dark:prose-invert max-w-none">
                  <Markdown>{editorText}</Markdown>
                </div>
              </div>
            )}
          </div>
          {/* Side panels — the hook exposed all of these as lazy components
              but the JSX never rendered them, so history/chat/suggestions/
              copilot/expert-agents were unreachable in production. */}
          {showSuggestions && editor && (
            // The panels carry their own widths (md:w-80/lg:w-96); the
            // wrapper only prevents them from shrinking in the flex row.
            <div className="shrink-0">
              <Suspense fallback={null}>
                <SuggestionsPanel
                  isOpen={showSuggestions}
                  onClose={() => setShowSuggestions(false)}
                  suggestions={suggestions.map((s) => ({
                    id: s,
                    title: s,
                  }))}
                  onInsertSuggestion={() => setShowSuggestions(false)}
                  editor={editor as unknown as Parameters<typeof SuggestionsPanel>[0]['editor']}
                />
              </Suspense>
            </div>
          )}
          {showCopilot && (
            <div className="shrink-0">
              <Suspense fallback={null}>
                <AICopilotPanel
                  isOpen={showCopilot}
                  onClose={() => setShowCopilot(false)}
                  isThinking={isCopilotThinking}
                  onAction={handleCopilotAction as (action: string) => void}
                />
              </Suspense>
            </div>
          )}
        </div>
        {showChat && (
          <div className="w-full md:w-96 self-center mt-4">
            <Suspense fallback={null}>
              <ChatPanelLazy
                documentId={documentId}
                textContent={editorText}
                isPrivate={isPrivate}
              />
            </Suspense>
          </div>
        )}
        {showHistory && (
          <Suspense fallback={null}>
            <VersionHistoryLazy
              documentId={documentId}
              onRestore={handleRestoreVersion}
              onClose={() => setShowHistory(false)}
            />
          </Suspense>
        )}
        {showExpertAgents && (
          <div className="px-4 md:px-12">
            <Suspense fallback={null}>
              <ExpertAgentsPanelLazy
                content={editorText}
                isPrivate={isPrivate}
              />
            </Suspense>
          </div>
        )}
        {editor && (
          <div className="px-4 md:px-12">
            <Suspense fallback={null}>
              <BacklinksLazy
                documentId={documentId}
                onSelect={(id: string) => onSelectDocument?.(id)}
              />
            </Suspense>
          </div>
        )}
      </div>
    </div>
  );
}
