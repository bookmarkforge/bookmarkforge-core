import React, { useState, useCallback, useMemo, useEffect, useTransition } from "react";
import { motion, AnimatePresence } from "motion/react";
import { initDB } from "../container/database";
import {
  Search,
  FileText,
  Plus,
  Trash2,
  Folder as FolderIcon,
  Sparkles,
  ChevronRight,
  LayoutGrid,
  List,
  Loader2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatDate } from "../utils/localization";
import { useRxCollection, useRxQuery } from "../hooks/useRxDB";
import { Document, Folder } from "../types";
import { toast } from "sonner";
import { logger } from "../utils/logger";
import { ragEngine } from "../services/ai/RAGEngine";
import {
  runWithTimeout,
  semanticSearchService,
} from "../services/ai/SemanticSearchService";
import { EmbeddingProgressIndicator } from "./EmbeddingProgressIndicator";
import { generateId } from "../utils/id";
import { useGuardedDataLoad } from "../hooks/useGuardedDataLoad";
import { useGuardedActions } from "../hooks/useGuardedActions";

const DocumentManager = ({ onSelectDocument }: { onSelectDocument: (id: string) => void }) => {
    const [searchTerm, setSearchTerm] = useState("");
    const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
    const [selectedFolderId, setSelectedFolderId] = useState<string>("all");
    const { t, i18n } = useTranslation();
    const [, startTransition] = useTransition();

    const [isSemanticSearch, setIsSemanticSearch] = useState(false);
    const [semanticResults, setSemanticResults] = useState<Document[]>([]);
    const [semanticSearchError, setSemanticSearchError] = useState(false);
    const [debouncedSearchTerm, setDebouncedSearchTerm] = useState("");
    // Semantic search: refresh-style data-load (a newer query supersedes the
    // in-flight one via the shared guard). autoLoad off — the effect drives
    // the trigger; its else branch calls cancel (the fixed cancel resets the
    // loading flag) instead of load() so the spinner never flashes for the
    // no-op path, and any in-flight search is invalidated exactly like the
    // original begin() at the top of the effect.
    const {
      load: runSearch,
      loading: isSearching,
      cancel: cancelSearch,
    } = useGuardedDataLoad<Document[]>(
      async (signal) => {
        const expandedQuery = await runWithTimeout(
          (searchSignal) =>
            semanticSearchService.expandQuery(
              debouncedSearchTerm,
              searchSignal,
            ),
          8_000,
          signal,
        );
        if (signal.aborted) {return [];}
        return runWithTimeout(
          (searchSignal) =>
            ragEngine.searchSimilar(
              expandedQuery,
              documents.filter((d) => !d.isDeleted),
              10,
              searchSignal,
            ),
          15_000,
          signal,
        );
      },
      {
        autoLoad: false,
        // No search is pending at mount; the spinner only appears once a
        // query actually starts. Also avoids a mount-time re-render (the
        // else branch's cancel would flip an initial true to false).
        initialLoading: false,
        onSuccess: (results) => {
          setSemanticSearchError(false);
          setSemanticResults(results);
        },
        onError: (err) => {
          setSemanticSearchError(true);
          logger.error("[DocumentManager] Semantic search failed", {
            error: err,
          });
        },
      },
      );
    // Mutations share one guard: any mutation invalidates the others'
    // in-flight toasts. blockReentry: false preserves the original
    // begin()-per-call semantics (a double-click creates two documents, only
    // the last toast shows). cancelMutations on folder switch drops an
    // in-flight mutation's toast (the original cancelMutation effect).
    const {
      create: createAction,
      createFolder: createFolderAction,
      delete: deleteAction,
      cancel: cancelMutations,
    } = useGuardedActions<{
      create: string;
      createFolder: void;
      delete: boolean;
    }>({
      create: {
        blockReentry: false,
        onSuccess: (id) => {
          toast.success(t("app_documentCreated"));
          onSelectDocument(id);
        },
        onError: (error) => {
          toast.error(t("app_createDocError"));
          logger.error(error);
        },
      },
      createFolder: {
        blockReentry: false,
        onSuccess: () => {
          toast.success(t("app_folderCreated"));
        },
        onError: (error) => {
          toast.error(t("app_createFolderError"));
          logger.error(error);
        },
      },
      delete: {
        blockReentry: false,
        onSuccess: (deleted) => {
          if (deleted) {
            toast.success(t("app_documentDeleted"));
          }
        },
        onError: (error) => {
          toast.error(t("app_deleteError"));
          logger.error(error);
        },
      },
    });

    const docsCollection = useRxCollection("documents");
    const foldersCollection = useRxCollection("folders");

    const { result: docsResult = [] } = useRxQuery(docsCollection?.find());
    const { result: foldersResult = [] } = useRxQuery(
      foldersCollection?.find(),
    );

    // Derived arrays must be memoized on their RxQuery result: a bare
    // `.map()` here would create a new array reference on every render, which
    // (combined with the semantic-search effect below depending on
    // `documents`) would re-trigger the effect on every render and, via the
    // `else` branch's setState, spin an infinite render loop until the heap
    // runs out. useMemo keys on the query result, so identity is stable.
    const documents: Document[] = useMemo(
      () => docsResult.map((d) => d.toJSON() as Document),
      [docsResult],
    );
    const folders: Folder[] = useMemo(
      () => foldersResult.map((f) => f.toJSON() as Folder),
      [foldersResult],
    );

    useEffect(() => {
      const timer = setTimeout(() => {
        setDebouncedSearchTerm(searchTerm);
      }, 400);
      return () => clearTimeout(timer);
    }, [searchTerm]);

    useEffect(() => cancelMutations, [cancelMutations, selectedFolderId]);

    useEffect(() => {
      if (isSemanticSearch) {
        void ragEngine.prefetch();
      }
    }, [isSemanticSearch]);

    useEffect(() => {
      if (isSemanticSearch && debouncedSearchTerm.trim().length > 2) {
        setSemanticSearchError(false);
        setSemanticResults((prev) => (prev.length > 0 ? [] : prev));
        void runSearch();
      } else {
        // Explicitly stop the spinner when the query becomes too short or
        // semantic mode is off. cancelSearch invalidates any in-flight
        // expansion or embedding search (its late result is dropped) and
        // resets the loading flag.
        cancelSearch();
        setSemanticSearchError(false);
        // Functional update: when the results are already empty this returns
        // the same reference, so React bails out instead of re-rendering.
        setSemanticResults((prev) => (prev.length > 0 ? [] : prev));
      }
    }, [debouncedSearchTerm, isSemanticSearch, documents, runSearch, cancelSearch]);

    const folderCounts = useMemo(() => {
      const counts = new Map<string, number>();
      for (const doc of documents) {
        if (doc.folderId) {
          counts.set(doc.folderId, (counts.get(doc.folderId) || 0) + 1);
        }
      }
      return counts;
    }, [documents]);

    const filteredDocs = useMemo(() => {
      const base = documents.filter((d) => {
        const matchesFolder =
          selectedFolderId === "all" || d.folderId === selectedFolderId;
        return matchesFolder && !d.isDeleted;
      });

      if (!debouncedSearchTerm.trim()) {return base;}

      const query = debouncedSearchTerm.toLowerCase();

      // O(n) lookup once per query: the `base.find` calls inside the semantic
      // loops were O(n×m) (with 100k documents and 20 results = 2M
      // comparisons per query).
      const baseIds = new Set<string>();
      for (const d of base) {
        baseIds.add(d.id);
      }

      if (isSemanticSearch && semanticResults.length > 0) {
        const textIds = new Set(
          base
            .filter((doc) => {
              const title = doc.title.toLowerCase().includes(query);
              const tags = doc.tags?.some((tag: string) =>
                tag.toLowerCase().includes(query),
              );
              return title || tags;
            })
            .map((d) => d.id),
        );

        const seen = new Set<string>();
        const hybrid: Document[] = [];

        for (const doc of base) {
          if (textIds.has(doc.id) && !seen.has(doc.id)) {
            hybrid.push(doc);
            seen.add(doc.id);
          }
        }

        for (const doc of semanticResults) {
          if (!seen.has(doc.id) && baseIds.has(doc.id)) {
            hybrid.push(doc);
            seen.add(doc.id);
          }
        }

        return hybrid;
      }

      if (semanticResults.length > 0) {
        return semanticResults.filter((sr) => baseIds.has(sr.id));
      }

      return base.filter((doc) => {
        const title = doc.title.toLowerCase().includes(query);
        const tags = doc.tags?.some((tag: string) =>
          tag.toLowerCase().includes(query),
        );
        return title || tags;
      });
    }, [
      documents,
      debouncedSearchTerm,
      selectedFolderId,
      isSemanticSearch,
      semanticResults,
      semanticSearchError,
    ]);

    const createNew = useCallback(async () => {
      await createAction.run(async () => {
        const db = await initDB();
        const id = `doc-${generateId()}`;
        await db.documents.upsert({
          id,
          folderId: selectedFolderId === "all" ? "root" : selectedFolderId,
          title: t("app_untitledDocument"),
          blocks: [],
          textContent: "",
          tags: [],
          links: [],
          embedding: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          processed: false,
          isPrivate: false,
          isDeleted: false,
        });
        return id;
      });
    }, [createAction.run, selectedFolderId, t]);

    const createNewFolder = useCallback(async () => {
      await createFolderAction.run(async () => {
        const db = await initDB();
        await db.folders.upsert({
          id: `folder-${generateId()}`,
          title: t("app_newFolder"),
          parentId: "",
          createdAt: new Date().toISOString(),
        });
      });
    }, [createFolderAction.run, t]);

    const deleteDocument = useCallback(
      async (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        await deleteAction.run(async () => {
          const db = await initDB();
          const doc = await db.documents.findOne(id).exec();
          if (!doc) {return false;}
          await doc.incrementalPatch({
            isDeleted: true,
            updatedAt: new Date().toISOString(),
          });
          return true;
        });
      },
      [deleteAction.run],
    );

    return (
      <div className="flex h-full bg-white dark:bg-app-bg">
        {/* Sidebar - Folders */}
        <div className="w-64 lg:w-72 sidebar-rail hidden md:flex flex-col p-4 space-y-8 border-r border-[var(--divider)] dark:border-[var(--divider)]/50 shrink-0">
          <div className="flex items-center justify-between px-2">
            <h3 className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--text-muted)]">
              {t("app_workspace")}
            </h3>
            <button
              onClick={createNewFolder}
              aria-label={t("app_newFolder", "New folder")}
              className="p-1 ds-ghost-bg rounded-md transition-colors text-[var(--text-muted)] hover:text-[var(--text-primary)] dark:hover:text-white"
            >
              <Plus className="size-3.5" />
            </button>
          </div>

          <nav className="space-y-0.5">
            <button
              onClick={() => setSelectedFolderId("all")}
              className={`truncate w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-all ${selectedFolderId === "all" ? "bg-[var(--bg-secondary)] dark:bg-[var(--bg-card)] text-[var(--text-primary)] dark:text-white shadow-sm" : "text-[var(--text-muted)] hover:bg-[var(--state-hover-bg)] dark:hover:bg-[var(--state-hover-bg)]/50 hover:text-[var(--text-primary)] dark:hover:text-[var(--text-secondary)]"}`}
            >
              <LayoutGrid className="size-4" />
              {t("app_allDocuments")}
            </button>

            <div className="pt-4 pb-2 px-2">
              <h4 className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--text-muted)]">
                {t("app_folders")}
              </h4>
            </div>

            {folders.map((folder) => (
              <button
                key={folder.id}
                onClick={() => setSelectedFolderId(folder.id)}
                className={`truncate w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-all group ${selectedFolderId === folder.id ? "bg-[var(--bg-secondary)] dark:bg-[var(--bg-card)] text-[var(--text-primary)] dark:text-white shadow-sm" : "text-[var(--text-muted)] ds-ghost-bg hover:text-[var(--text-primary)] dark:hover:text-[var(--text-secondary)]"}`}
              >
                <FolderIcon
                  className={`size-4 ${selectedFolderId === folder.id ? "text-blue-500" : "text-[var(--text-muted)] group-hover:text-[var(--text-secondary)] dark:group-hover:text-[var(--text-muted)]"}`}
                />
                <span className="truncate flex-1 text-start">
                  {folder.title}
                </span>
                <span className="text-[10px] text-[var(--text-muted)] opacity-0 group-hover:opacity-100 transition-opacity">
                  {folderCounts.get(folder.id) ?? 0}
                </span>
              </button>
            ))}
          </nav>

          <div className="mt-auto pt-8 border-t border-[var(--divider)] dark:border-[var(--divider)]/50"></div>
        </div>

        {/* Main Content */}
        <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">
          <div className="p-6 md:p-12 space-y-10 max-w-6xl mx-auto w-full">
            {/* Breadcrumbs & Actions */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-[var(--text-muted)]">
                  <span
                    className="hover:text-[var(--text-secondary)] cursor-pointer transition-colors"
                    onClick={() => setSelectedFolderId("all")}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) =>
                      e.key === "Enter" && setSelectedFolderId("all")
                    }
                  >
                    {t("app_documents")}
                  </span>
                  {selectedFolderId !== "all" && (
                    <>
                      <ChevronRight className="rtl-flip size-3" />
                      <span className="text-[var(--text-primary)] dark:text-[var(--text-accent)]">
                        {folders.find((f) => f.id === selectedFolderId)?.title}
                      </span>
                    </>
                  )}
                </div>
                <h1 className="text-4xl font-semibold tracking-tight text-[var(--text-primary)] dark:text-white">
                  {selectedFolderId === "all"
                    ? t("app_myDocuments")
                    : folders.find((f) => f.id === selectedFolderId)?.title}
                </h1>
              </div>

              <div className="flex items-center gap-3">
                <div className="flex bg-[var(--bg-secondary)] dark:bg-[var(--bg-primary)] p-1 rounded-xl border border-[var(--divider)] dark:border-[var(--divider)]">
                  <button
                    onClick={() => setViewMode("grid")}
                    aria-label={t("app_gridView", "Grid view")}
                    className={`p-2 rounded-lg transition-all ${viewMode === "grid" ? "bg-white dark:bg-[var(--bg-card)] shadow-sm text-blue-500" : "text-[var(--text-muted)] ds-ghost-bg hover:text-[var(--text-secondary)] dark:hover:text-[var(--text-secondary)]"}`}
                  >
                    <LayoutGrid className="size-4" />
                  </button>
                  <button
                    onClick={() => setViewMode("list")}
                    aria-label={t("app_listView", "List view")}
                    className={`p-2 rounded-lg transition-all ${viewMode === "list" ? "bg-white dark:bg-[var(--bg-card)] shadow-sm text-blue-500" : "text-[var(--text-muted)] hover:text-[var(--text-secondary)] dark:hover:text-[var(--text-secondary)]"}`}
                  >
                    <List className="size-4" />
                  </button>
                </div>
                <button
                  data-testid="new-document-button"
                  onClick={createNew}
                  className="truncate flex items-center gap-2 bg-cyan-700 hover:bg-cyan-800 text-white dark:bg-cyan-600 dark:hover:bg-cyan-700 px-5 py-2.5 rounded-xl font-bold transition-all shadow-xl shadow-black/5 hover:scale-105 active:scale-95"
                >
                  <Plus className="size-4" />
                  {t("app_newDocument")}
                </button>
              </div>
            </div>

            {/* Search & Filter Bar */}
            <div className="space-y-3">
              <div className="flex gap-4">
                <div className="relative flex-1 group">
                  {isSearching ? (
                    <Loader2 className="absolute start-4 top-1/2 -translate-y-1/2 size-4.5 text-blue-500 animate-spin" />
                  ) : (
                    <Search className="absolute start-4 top-1/2 -translate-y-1/2 size-4.5 text-[var(--text-muted)] group-focus-within:text-blue-500 transition-colors" />
                  )}
                  <input
                    type="text"
                    aria-label={t("app_searchPlaceholder")}
                    placeholder={
                      isSemanticSearch
                        ? (t("app_semanticSearchPlaceholder") ??
                          "Search documents by meaning...")
                        : t("app_searchPlaceholder")
                    }
                    value={searchTerm}
                    onChange={(e) => startTransition(() => setSearchTerm(e.target.value))}
                    className="w-full ps-12 pe-4 py-3.5 rounded-2xl bg-[var(--bg-secondary)] dark:bg-[var(--bg-primary)]/50 border border-[var(--divider)] dark:border-[var(--divider)] focus:ring-4 focus:ring-blue-500/5 focus:border-blue-500 transition-all outline-none text-sm font-medium"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setIsSemanticSearch(!isSemanticSearch)}
                  aria-label={t("app_aiSearch", "AI Search")}
                  aria-pressed={isSemanticSearch}
                  className={`truncate flex items-center gap-2 px-4 py-3.5 text-xs font-bold transition-all shadow-sm hover:scale-105 active:scale-95 rounded-xl ${
                    isSemanticSearch
                      ? "bg-blue-500 text-white shadow-blue-500/20"
                      : "bg-[var(--bg-secondary)] dark:bg-[var(--bg-primary)]/50 text-[var(--text-muted)] border border-[var(--divider)]"
                  }`}
                >
                  <Sparkles
                    className={`size-4 ${isSemanticSearch ? "animate-pulse" : ""}`}
                  />
                  <span className="hidden sm:inline uppercase tracking-widest">
                    {t("app_aiSearch", "AI Search")}
                  </span>
                </button>
              </div>
              <div className="flex items-center gap-3">
                <EmbeddingProgressIndicator />
                {isSemanticSearch && semanticSearchError && (
                  <motion.p
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="text-xs font-bold uppercase tracking-widest ps-2 flex items-center gap-2 text-blue-500"
                  >
                    <Sparkles className="size-3.5" />
                    {t("app_semanticSearchUnavailable", {
                      defaultValue:
                        "Semantic search is temporarily unavailable; showing text matches",
                    })}
                  </motion.p>
                )}
              </div>
            </div>

            {/* Document Grid/List */}
            <AnimatePresence mode="wait">
              {filteredDocs.length === 0 ? (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex flex-col items-center justify-center py-24 text-center"
                >
                  <div className="size-20 bg-[var(--bg-secondary)] dark:bg-[var(--bg-primary)] rounded-full flex items-center justify-center mb-6">
                    <FileText className="size-10 text-[var(--text-secondary)]" />
                  </div>
                  <h2 className="text-xl font-semibold mb-2">
                    {t("app_noDocumentsYet")}
                  </h2>
                  <p className="text-[var(--text-muted)] max-w-xs mx-auto text-sm">
                    {searchTerm
                      ? t("app_noResultsFound")
                      : t("app_createFirstDocument")}
                  </p>
                </motion.div>
              ) : viewMode === "grid" ? (
                <motion.div
                  key="grid"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6"
                >
                  {filteredDocs.map((doc) => (
                    <div
                      key={doc.id}
                      className="bento-item p-5 group cursor-pointer flex flex-col h-48"
                    >
                      <div className="flex items-start justify-between mb-4">
                        <div className="p-2 bg-[var(--bg-secondary)] dark:bg-[var(--bg-card)] rounded-lg group-hover:bg-blue-50 dark:group-hover:bg-blue-900/20 transition-colors" aria-hidden="true">
                          <FileText className="size-5 text-[var(--text-muted)] group-hover:text-blue-500 transition-colors" />
                        </div>
                        <button
                          onClick={(e) => deleteDocument(doc.id, e)}
                          className="p-2 opacity-0 group-hover:opacity-100 hover:bg-[var(--danger-soft)] dark:hover:bg-[var(--color-danger)]/20 text-[var(--text-muted)] hover:ds-text-danger rounded-lg transition-all"
                          title={t("app_delete")}
                          aria-label={t("app_delete")}
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </div>

                      <button
                        type="button"
                        onClick={() => onSelectDocument(doc.id)}
                        className="truncate flex-1 min-w-0 text-start"
                      >
                        <h2 className="font-semibold text-[var(--text-primary)] dark:text-white truncate group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors mb-1">
                          {doc.title}
                        </h2>
                        <p className="text-xs text-[var(--text-muted)] line-clamp-2 leading-relaxed">
                          {doc.textContent || t("app_emptyDocument")}
                        </p>
                      </button>

                      <div className="mt-4 flex items-center justify-between pt-4 border-t border-[var(--divider)]/30 dark:border-[var(--divider)]/50">
                        <div className="flex gap-1">
                          {doc.tags?.slice(0, 2).map((tag) => (
                            <span
                              key={tag}
                              className="text-[10px] px-1.5 py-0.5 bg-[var(--bg-secondary)] dark:bg-[var(--bg-card)] text-[var(--text-muted)] rounded"
                            >
                              #{tag}
                            </span>
                          ))}
                        </div>
                        <span className="text-[10px] font-medium text-[var(--text-muted)]">
                          {formatDate(
                            doc.updatedAt || doc.createdAt,
                            {},
                            i18n.language,
                          )}
                        </span>
                      </div>

                      {doc.processed === false && (
                        <div className="absolute top-2 end-2" aria-hidden="true">
                          <Sparkles className="size-3 text-cyan-500 animate-pulse" />
                        </div>
                      )}
                    </div>
                  ))}
                </motion.div>
              ) : (
                <motion.div
                  key="list"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="border border-[var(--divider)] dark:border-[var(--divider)] rounded-xl overflow-hidden"
                >
                  <table className="w-full text-start text-sm">
                    <thead className="bg-[var(--bg-secondary)] dark:bg-[var(--bg-primary)]/50 border-bottom border-[var(--divider)] dark:border-[var(--divider)]">
                      <tr>
                        <th className="px-6 py-3 font-bold text-[var(--text-muted)] uppercase tracking-wider text-[10px]">
                          {t("app_title")}
                        </th>
                        <th className="px-6 py-3 font-bold text-[var(--text-muted)] uppercase tracking-wider text-[10px]">
                          {t("app_tags")}
                        </th>
                        <th className="px-6 py-3 font-bold text-[var(--text-muted)] uppercase tracking-wider text-[10px]">
                          {t("app_updated")}
                        </th>
                        <th className="px-6 py-3" aria-hidden="true"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--divider)] dark:divide-[var(--divider)]">
                      {filteredDocs.map((doc) => (
                        <tr
                          key={doc.id}
                          className="hover:bg-[var(--state-hover-bg)] dark:hover:bg-[var(--state-hover-bg)]/30 cursor-pointer group transition-colors"
                        >
                          <td className="truncate px-6 py-4">
                            <button
                              type="button"
                              onClick={() => onSelectDocument(doc.id)}
                              className="truncate flex items-center gap-3 text-start"
                            >
                              <FileText className="size-4 text-[var(--text-muted)] group-hover:text-blue-500" aria-hidden="true" />
                              <span className="font-bold text-[var(--text-primary)] dark:text-white group-hover:text-blue-600 transition-colors">
                                {doc.title}
                              </span>
                            </button>
                          </td>
                          <td className="truncate px-6 py-4">
                            <div className="flex gap-1">
                              {doc.tags?.map((tag) => (
                                <span
                                  key={tag}
                                  className="text-[10px] px-1.5 py-0.5 bg-[var(--bg-secondary)] dark:bg-[var(--bg-card)] text-[var(--text-muted)] rounded"
                                >
                                  #{tag}
                                </span>
                              ))}
                            </div>
                          </td>
                          <td className="truncate px-6 py-4 text-[var(--text-muted)] text-xs">
                            {formatDate(
                              doc.updatedAt || doc.createdAt,
                              {},
                              i18n.language,
                            )}
                          </td>
                          <td className="px-6 py-4 text-end">
                            <button
                              onClick={(e) => deleteDocument(doc.id, e)}
                              className="p-2 opacity-0 group-hover:opacity-100 hover:bg-[var(--danger-soft)] dark:hover:bg-[var(--color-danger)]/20 text-[var(--text-muted)] hover:ds-text-danger rounded-lg transition-all"
                              title={t("app_delete")}
                              aria-label={t("app_delete")}
                            >
                              <Trash2 className="size-4" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    );
  };

export default DocumentManager;
