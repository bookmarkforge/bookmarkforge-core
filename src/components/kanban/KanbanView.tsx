import { useState, useCallback, useRef, useMemo, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { motion } from "motion/react";
import { useRxCollection, useRxQuery } from "../../hooks/useRxDB";
import { Columns, Plus, GripVertical, X, Check } from "lucide-react";
import { logger } from "../../utils/logger";
import { toast } from "sonner";
import type { DocumentDocType, FolderDocType } from "../../db/schema";
import { useGuardedActions } from "../../hooks/useGuardedActions";

interface KanbanItem {
  id: string;
  title: string;
  description?: string;
  type?: "task" | "bug" | "feature";
}

interface KanbanColumn {
  id: string;
  title: string;
  items: KanbanItem[];
}

interface KanbanViewProps {
  columns?: KanbanColumn[];
  onItemClick?: (id: string) => void;
  onItemMove?: (itemId: string, fromColumn: string, toColumn: string) => void;
  onItemDelete?: (itemId: string, columnId: string) => void;
}

const typeColors: Record<string, string> = {
  task: "var(--accent-primary)",
  bug: "var(--color-danger)",
  feature: "var(--color-success)",
};

let cardCounter = 100;

export default function KanbanView({
  columns,
  onItemClick,
  onItemMove,
  onItemDelete,
}: KanbanViewProps) {
  const { t } = useTranslation();
  const focusTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  // Call-time metadata for the shared-guard error logs (see DatabaseView
  // for the same pattern: the callbacks resolve asynchronously and would
  // otherwise read the LATEST values, not the ones at invocation time).
  const deleteItemIdRef = useRef<string | undefined>(undefined);
  const {
    deleteItem: { run: runDeleteItem },
    addColumn: { run: runAddColumn },
    drop: { run: runDrop },
    addCard: { run: runAddCard },
  } = useGuardedActions({
    deleteItem: {
      blockReentry: false,
      onError: (e) => {
        const reason = e instanceof Error ? e.message : String(e);
        logger.warn("[KanbanView] Failed to delete card", {
          itemId: deleteItemIdRef.current,
          reason,
        });
        toast.error(
          t("kanban_delete_failed", "Couldn't delete card: {{reason}}", {
            reason,
          }),
        );
      },
    },
    addColumn: {
      blockReentry: false,
      onError: (e) => {
        const reason = e instanceof Error ? e.message : String(e);
        logger.warn("[KanbanView] Failed to add column", { reason });
        toast.error(
          t("kanban_add_failed", "Couldn't add column: {{reason}}", {
            reason,
          }),
        );
      },
    },
    drop: {
      blockReentry: false,
      onSuccess: () => {
        setDraggedItem(null);
        dropTarget.current = null;
      },
      onError: (e) => {
        const reason = e instanceof Error ? e.message : String(e);
        logger.warn("[KanbanView] Failed to move card", { reason });
        toast.error(
          t("kanban_move_failed", "Couldn't move card: {{reason}}", {
            reason,
          }),
        );
      },
    },
    addCard: {
      blockReentry: false,
      onSuccess: () => {
        setAddingTo(null);
        setNewCardTitle("");
      },
      onError: (e) => {
        const reason = e instanceof Error ? e.message : String(e);
        logger.warn("[KanbanView] Failed to add card", { reason });
        toast.error(
          t("kanban_add_failed", "Couldn't add card: {{reason}}", {
            reason,
          }),
        );
      },
    },
  });

  // An unmounted board must not keep a pending focus timer scheduled.
  useEffect(() => {
    return () => clearTimeout(focusTimerRef.current);
  }, []);

  // P92: production must never show fake data. Controlled mode (columns prop,
  // used by tests) keeps the old local-state behavior. Uncontrolled mode (the
  // /kanban route) reads REAL documents grouped by REAL folders reactively,
  // and every write (move/delete/add) persists to RxDB.
  const isControlled = columns !== undefined;

  const docsCollection = useRxCollection<DocumentDocType>("documents");
  const foldersCollection = useRxCollection<FolderDocType>("folders");
  const { result: rxDocs = [] } = useRxQuery(
    docsCollection?.find().where("isDeleted").eq(false),
  );
  const { result: rxFolders = [] } = useRxQuery(foldersCollection?.find());

  const rxColumns = useMemo<KanbanColumn[]>(() => {
    if (isControlled) {return [];}
    const folders = (
      rxFolders as unknown as Array<{ toJSON(): { id: string; title: string } }>
    ).map((f) => f.toJSON());
    const docs = (
      rxDocs as unknown as Array<{
        toJSON(): { id: string; title: string; folderId: string };
      }>
    ).map((d) => d.toJSON());
    const cols: KanbanColumn[] = folders.map((f) => ({
      id: f.id,
      title: f.title,
      items: [],
    }));
    // Documents at the root (folderId "root" per DocumentManager) or in a
    // folder that no longer exists land in an honest "Unfiled" column.
    const unfiled: KanbanColumn = {
      id: "root",
      title: t("unfiled", "Unfiled"),
      items: [],
    };
    for (const doc of docs) {
      const col = cols.find((c) => c.id === doc.folderId) ?? unfiled;
      col.items.push({ id: doc.id, title: doc.title });
    }
    const result = [...cols];
    if (unfiled.items.length > 0) {result.push(unfiled);}
    return result;
  }, [isControlled, rxDocs, rxFolders, t]);

  const [localCols, setLocalCols] = useState<KanbanColumn[]>(columns ?? []);
  const [draggedItem, setDraggedItem] = useState<{
    itemId: string;
    from: string;
  } | null>(null);
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [newCardTitle, setNewCardTitle] = useState("");
  const dropTarget = useRef<{ columnId: string; index: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const displayCols = isControlled ? localCols : rxColumns;

  const handleDragStart = useCallback((itemId: string, colId: string) => {
    setDraggedItem({ itemId, from: colId });
  }, []);

  const handleDragOver = useCallback(
    (colId: string, e: React.DragEvent, containerEl: HTMLElement | null) => {
      e.preventDefault();
      const cards = containerEl?.querySelectorAll("[data-drag-index]");
      let insertIdx = 0;
      if (cards) {
        const mouseY = e.clientY;
        for (let i = 0; i < cards.length; i++) {
          const rect = cards[i]!.getBoundingClientRect();
          const mid = rect.top + rect.height / 2;
          if (mouseY > mid) {insertIdx = i + 1;}
        }
      }
      dropTarget.current = { columnId: colId, index: insertIdx };
    },
    [],
  );

  const handleDelete = useCallback(
    (itemId: string, colId: string) => {
      if (isControlled) {
        setLocalCols((prev) =>
          prev.map((col) =>
            col.id === colId
              ? { ...col, items: col.items.filter((it) => it.id !== itemId) }
              : col,
          ),
        );
        onItemDelete?.(itemId, colId);
        return;
      }
      // P92: real write — soft delete the document (GC purges it later).
      if (!docsCollection) {return;}
      deleteItemIdRef.current = itemId;
      void runDeleteItem(async () => {
        const doc = await docsCollection.findOne(itemId).exec();
        // updatedAt stamp: tombstones apply LWW by updatedAt in sync, and
        // GarbageCollectionService purges by updatedAt < cutoff.
        await doc?.incrementalPatch({
          isDeleted: true,
          updatedAt: new Date().toISOString(),
        });
      });
    },
    [isControlled, onItemDelete, docsCollection, runDeleteItem],
  );

  const addColumn = useCallback(() => {
    if (isControlled) {
      const newCol: KanbanColumn = {
        id: `col-${Date.now()}`,
        title: t("new_column", "New Column"),
        items: [],
      };
      setLocalCols((prev) => [...prev, newCol]);
      return;
    }
    // P92: real write — create a folder.
    if (!foldersCollection) {return;}
    void runAddColumn(async () => {
      await foldersCollection.upsert({
        id: "folder-" + Date.now(),
        title: t("new_column", "New Column"),
        parentId: "",
        createdAt: new Date().toISOString(),
      });
    });
  }, [isControlled, foldersCollection, t, runAddColumn]);

  const handleDrop = useCallback(() => {
    if (!draggedItem || !dropTarget.current) {
      setDraggedItem(null);
      dropTarget.current = null;
      return;
    }
    const { columnId: toColId, index: insertIdx } = dropTarget.current;
    if (isControlled) {
      setLocalCols((prev) => {
        const next = prev.map((col) => ({ ...col, items: [...col.items] }));
        const fromCol = next.find((c) => c.id === draggedItem.from);
        const toCol = next.find((c) => c.id === toColId);
        if (!fromCol || !toCol) {return prev;}
        const idx = fromCol.items.findIndex((it) => it.id === draggedItem.itemId);
        if (idx === -1) {return prev;}
        const [moved] = fromCol.items.splice(idx, 1);
        const targetIdx = Math.min(insertIdx, toCol.items.length);
        toCol.items.splice(targetIdx, 0, moved!);
        return next;
      });
      if (draggedItem.from !== toColId)
        {onItemMove?.(draggedItem.itemId, draggedItem.from, toColId);}
      setDraggedItem(null);
      dropTarget.current = null;
      return;
    }
    // P92: real write — move the document to the target folder. Skip the
    // query entirely for same-column drops (nothing to persist).
    if (!docsCollection || draggedItem.from === toColId) {
      setDraggedItem(null);
      dropTarget.current = null;
      return;
    }
    void runDrop(async () => {
      const doc = await docsCollection.findOne(draggedItem.itemId).exec();
      if (doc) {
        await doc.incrementalPatch({ folderId: toColId });
      }
    });
  }, [draggedItem, isControlled, onItemMove, docsCollection, runDrop]);

  const startAddCard = (colId: string) => {
    setAddingTo(colId);
    setNewCardTitle("");
    clearTimeout(focusTimerRef.current);
    focusTimerRef.current = setTimeout(() => inputRef.current?.focus(), 50);
  };

  const confirmAddCard = () => {
    if (!addingTo || !newCardTitle.trim()) {return;}
    const title = newCardTitle.trim();
    if (isControlled) {
      const card: KanbanItem = {
        id: `card-${++cardCounter}`,
        title,
        type: "task",
      };
      setLocalCols((prev) =>
        prev.map((col) =>
          col.id === addingTo ? { ...col, items: [...col.items, card] } : col,
        ),
      );
      setAddingTo(null);
      setNewCardTitle("");
      return;
    }
    // P92: real write — create a document in the target folder.
    if (!docsCollection) {return;}
    void runAddCard(async () => {
      const now = new Date().toISOString();
      await docsCollection.upsert({
        id: "doc-" + Date.now(),
        folderId: addingTo,
        title,
        blocks: [],
        textContent: "",
        tags: [],
        links: [],
        embedding: [],
        processed: false,
        isPrivate: false,
        isDeleted: false,
        createdAt: now,
        updatedAt: now,
      });
    });
  };

  const cancelAddCard = () => {
    setAddingTo(null);
    setNewCardTitle("");
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex flex-col h-full"
    >
      {/* Header */}
      <div className="flex items-center justify-between p-4 ds-border-divider">
        <div className="flex items-center gap-2">
          <Columns className="size-5 ds-text-accent" />
          <h1 className="ds-h2">{t("kanban_title", "Kanban Board")}</h1>
          <span className="ds-text-tiny ds-text-muted ms-2">
            {displayCols.reduce((s, c) => s + c.items.length, 0)}{" "}
            {t("app_cards", "cards")}
          </span>
        </div>
        <button
          onClick={addColumn}
          className="truncate btn-primary flex items-center gap-1 px-4 py-2"
        >
          <Plus className="size-4" />
          {t("add_column", "Add Column")}
        </button>
      </div>

      {/* Board */}
      {displayCols.length === 0 ? (
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="text-center ds-text-muted">
            <Columns className="size-10 mx-auto mb-3 opacity-40" />
            <p className="ds-text-secondary">
              {t("kanban_empty", "No columns yet")}
            </p>
            <p className="ds-text-tiny mt-1">
              {t(
                "kanban_empty_hint",
                "Add a column to organize your documents.",
              )}
            </p>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-x-auto p-4">
          <div className="flex gap-4 h-full min-w-max">
            {displayCols.map((column) => (
              <div
                key={column.id}
                role="region"
                aria-label={column.title}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  handleDrop();
                }}
                className={`flex flex-col w-72 ds-bg-card-soft ds-radius-card ds-border-soft shrink-0 transition-shadow ${
                  dropTarget.current?.columnId === column.id
                    ? "ds-shadow-accent"
                    : ""
                }`}
              >
                {/* Column Header */}
                <div className="flex items-center justify-between p-3 ds-border-divider">
                  <div className="flex items-center gap-2">
                    <GripVertical className="size-4 ds-text-muted cursor-grab" />
                    <h2 className="ds-card-title truncate">{column.title}</h2>
                    <span className="ds-text-tiny ds-text-muted bg-[var(--bg-secondary)] px-1.5 py-0.5 rounded-full">
                      {column.items.length}
                    </span>
                  </div>
                  <button
                    onClick={() => startAddCard(column.id)}
                    aria-label={t("add_card", "Add card to {{column}}", {
                      column: column.title,
                    })}
                    className="ds-text-muted hover:ds-text-accent transition-colors"
                  >
                    <Plus className="size-4" />
                  </button>
                </div>

                {/* Column Items */}
                <div
                  role="list"
                  className="flex-1 overflow-y-auto p-2 space-y-2"
                  onDragOver={(e) =>
                    handleDragOver(column.id, e, e.currentTarget)
                  }
                >
                  {column.items.length === 0 && addingTo !== column.id && (
                    <div className="p-4 text-center ds-text-muted ds-text-tiny">
                      {t("no_cards", "No cards")}
                    </div>
                  )}
                  {column.items.map((item, idx) => (
                    <div
                      key={item.id}
                      data-drag-index={idx}
                      draggable
                      onDragStart={() => handleDragStart(item.id, column.id)}
                      className={`group ds-card-soft-primary p-3 ds-radius-card ds-border-soft cursor-grab active:cursor-grabbing hover:ds-shadow-sm transition-all flex items-start gap-1 ${
                        draggedItem?.itemId === item.id ? "opacity-40" : ""
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => onItemClick?.(item.id)}
                        className="truncate flex items-start gap-2 flex-1 min-w-0 text-start"
                      >
                        {item.type && (
                          <span
                            className="mt-1 size-2 rounded-full shrink-0"
                            style={{ background: typeColors[item.type] }}
                          />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="ds-card-subtitle truncate">
                            {item.title}
                          </p>
                          {item.description && (
                            <p className="ds-text-tiny ds-text-muted mt-1 line-clamp-2">
                              {item.description}
                            </p>
                          )}
                        </div>
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(item.id, column.id);
                        }}
                        className="opacity-0 group-hover:opacity-100 p-0.5 ds-text-muted hover:ds-text-danger transition-all shrink-0"
                        title={t("delete_card", "Delete")}
                        aria-label={t("delete_card", "Delete")}
                      >
                        <X className="size-3.5" />
                      </button>
                    </div>
                  ))}

                  {/* Inline Add Card */}
                  {addingTo === column.id && (
                    <div className="ds-card-soft-primary p-2 ds-radius-card ds-border-soft">
                      <input
                        ref={inputRef}
                        type="text"
                        value={newCardTitle}
                        onChange={(e) => setNewCardTitle(e.target.value)}
                        aria-label={t("new_card_title", "New card title")}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {confirmAddCard();}
                          if (e.key === "Escape") {cancelAddCard();}
                        }}
                        placeholder={t("card_title_placeholder", "Card title...")}
                        className="w-full px-2 py-1.5 text-sm ds-input ds-radius-input ds-border-divider mb-2"
                      />
                      <div className="flex items-center gap-1 justify-end">
                        <button
                          onClick={confirmAddCard}
                          disabled={!newCardTitle.trim()}
                          className="p-1 ds-text-success hover:bg-[var(--color-success)]/10 rounded transition-colors disabled:opacity-30"
                          aria-label={t("app_confirm", "Confirm")}
                        >
                          <Check className="size-4" />
                        </button>
                        <button
                          onClick={cancelAddCard}
                          className="p-1 ds-text-muted hover:ds-text-danger rounded transition-colors"
                          aria-label={t("app_cancel", "Cancel")}
                        >
                          <X className="size-4" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </motion.div>
  );
}
