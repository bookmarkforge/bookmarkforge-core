import { useState, useMemo, useRef, useCallback, useEffect, useTransition } from "react";
import { useTranslation } from "react-i18next";
import { motion } from "motion/react";
import { useRxCollection, useRxQuery } from "../../hooks/useRxDB";
import {
  Table,
  Filter,
  Plus,
  Search,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  X,
  Check,
  Trash2,
} from "lucide-react";
import { logger } from "../../utils/logger";
import { toast } from "sonner";
import { useGuardedActions } from "../../hooks/useGuardedActions";

interface DatabaseRow {
  id: string;
  [key: string]: unknown;
}

interface DatabaseViewProps {
  collection: string;
  schema?: Record<string, unknown>;
  rows?: DatabaseRow[];
  onRowClick?: (id: string) => void;
  onCellEdit?: (rowId: string, column: string, value: unknown) => void;
  /**
   * P94: required-field defaults for new records (schema-valid payload).
   * The /database route wires the real `bookmarks` collection whose schema
   * requires url/createdAt/updatedAt/processed/isPrivate/isDeleted — without
   * these, every upsert fails RxDB validation and "New" silently never
   * persists. Passed from AppRoutes for bookmarks; other collections can
   * supply their own. createdAt/updatedAt are always stamped at click time.
   */
  newRecordDefaults?: Partial<DatabaseRow>;
}

type SortDir = "asc" | "desc";

interface FilterRule {
  column: string;
  value: string;
}

function detectColumns(rows: DatabaseRow[]): string[] {
  const keys = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (key === "id") {continue;}
      // Skip RxDB internals (_id/_rev/_meta…) that toJSON() may leak.
      if (key.startsWith("_")) {continue;}
      const value = row[key];
      // Skip blob columns: object payloads (block trees) and huge arrays
      // (1536-float embeddings) must never render as giant table cells.
      // Small arrays like tags/relatedLinks stay visible.
      if (Array.isArray(value)) {
        if (value.length > 10) {continue;}
      } else if (typeof value === "object" && value !== null) {
        continue;
      }
      keys.add(key);
    }
  }
  return Array.from(keys);
}

/**
 * P94: coerce the inline editor's raw string back to the column's real type
 * so the RxDB patch/upsert passes schema validation. Arrays (tags) are
 * comma-split; booleans and numbers parse from their string forms; anything
 * else stays a string. Unknown originals default to the raw string.
 */
function coerceEditValue(original: unknown, raw: string): unknown {
  if (Array.isArray(original)) {
    return raw
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }
  if (typeof original === "boolean") {
    const s = raw.trim().toLowerCase();
    return s === "true" || s === "1" || s === "yes" || s === "on";
  }
  if (typeof original === "number") {
    const n = Number(raw);
    return Number.isNaN(n) ? original : n;
  }
  return raw;
}

function getUniqueValues(rows: DatabaseRow[], col: string): string[] {
  const vals = new Set<string>();
  for (const row of rows) {
    const v = String(row[col] ?? "");
    if (v) {
      vals.add(v);
      // Only columns with ≤5 unique values matter (editor select). With
      // large collections (100k bookmarks), title/url/dates have high
      // cardinality: without this early-exit every column was scanned
      // fully only to discard the result afterwards. The sixth distinct
      // value already guarantees the column does not qualify — returning []
      // is equivalent (the caller excludes length-0 maps just like the >5 case).
      if (vals.size > 5) {return [];}
    }
  }
  return Array.from(vals).sort();
}

export default function DatabaseView({
  collection,
  schema,
  rows,
  onRowClick,
  onCellEdit,
  newRecordDefaults,
}: DatabaseViewProps) {
  const { t } = useTranslation();
  // Call-time metadata for the shared-guard error logs: the guard callbacks
  // resolve asynchronously, so reading state there would show the LATEST
  // values instead of the ones captured when the action was invoked.
  const editMetaRef = useRef<{ rowId: string; column: string } | null>(null);
  const deleteCountRef = useRef(0);
  const {
    addRow: { run: runAddRow },
    edit: { run: runEdit },
    delete: { run: runDelete },
  } = useGuardedActions({
    addRow: {
      blockReentry: false,
      onError: (e: unknown) => {
        const reason = e instanceof Error ? e.message : String(e);
        logger.warn("[DatabaseView] Failed to persist new record", {
          collection,
          error: reason,
        });
        toast.error(
          t("database_add_failed", "Couldn't add record: {{reason}}", {
            reason,
          }),
        );
      },
    },
    edit: {
      blockReentry: false,
      onSuccess: () => setEditingCell(null),
      onError: (e: unknown) => {
        const meta = editMetaRef.current;
        const reason = e instanceof Error ? e.message : String(e);
        logger.warn("[DatabaseView] Failed to persist edit", {
          collection,
          rowId: meta?.rowId,
          column: meta?.column,
          error: reason,
        });
        toast.error(
          t("database_edit_failed", "Couldn't save edit: {{reason}}", {
            reason,
          }),
        );
      },
    },
    delete: {
      blockReentry: false,
      onSuccess: () => setSelectedRows(new Set()),
      onError: (e: unknown) => {
        const reason = e instanceof Error ? e.message : String(e);
        logger.warn("[DatabaseView] Failed to delete records", {
          collection,
          count: deleteCountRef.current,
          error: reason,
        });
        toast.error(
          t("database_delete_failed", "Couldn't delete records: {{reason}}", {
            reason,
          }),
        );
      },
    },
  });

  // P91: when no `rows` prop is provided (the /database route), read the
  // RxDB collection reactively — real user data, live updates on write.
  // Controlled mode (rows passed in, e.g. tests) keeps the old behavior.
  const rxCollection = useRxCollection<DatabaseRow>(collection);
  const { result: rxDocs = [] } = useRxQuery(rxCollection?.find());
  const isControlled = rows !== undefined;

  const [, startTransition] = useTransition();
  const [searchQuery, setSearchQuery] = useState("");
  const [sortField, setSortField] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilterRules] = useState<FilterRule[]>([]);
  const [editingCell, setEditingCell] = useState<{
    rowId: string;
    column: string;
  } | null>(null);
  const [editValue, setEditValue] = useState("");
  // P90: no demo fallback — production must never show fake records that
  // look like real user data. Without `rows` the view is honestly empty.
  const [localData, setLocalData] = useState<DatabaseRow[]>(rows ?? []);
  const editInputRef = useRef<HTMLInputElement | HTMLSelectElement>(null);

  const liveData = useMemo(
    () =>
      (rxDocs as unknown as Array<{ toJSON(): DatabaseRow }>)
        .map((d) => d.toJSON())
        // P94: soft-deleted records (bookmarks schema) must never resurface
        // in the reactive view after Delete. Collections without an
        // isDeleted field pass through untouched.
        .filter((r) => r.isDeleted !== true),
    [rxDocs],
  );

  // Controlled (rows prop) uses local editable state; uncontrolled uses the
  // reactive RxDB stream so edits/adds persist and re-render automatically.
  const data = isControlled ? localData : liveData;
  const columns = useMemo(() => {
    if (schema && Object.keys(schema).length > 0) {return Object.keys(schema);}
    return detectColumns(data);
  }, [schema, data]);

  const columnUniques = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const col of columns) {
      const vals = getUniqueValues(data, col);
      if (vals.length <= 5 && vals.length > 0) {map.set(col, vals);}
    }
    return map;
  }, [data, columns]);

  const filtered = useMemo(() => {
    let result = data;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter((row) =>
        columns.some((col) =>
          String(row[col] ?? "")
            .toLowerCase()
            .includes(q),
        ),
      );
    }
    for (const f of filters) {
      if (!f.value.trim()) {continue;}
      const q = f.value.toLowerCase();
      result = result.filter((row) =>
        String(row[f.column] ?? "")
          .toLowerCase()
          .includes(q),
      );
    }
    return result;
  }, [data, columns, searchQuery, filters]);

  const sorted = useMemo(() => {
    if (!sortField) {return filtered;}
    return [...filtered].sort((a, b) => {
      const va = String(a[sortField] ?? "");
      const vb = String(b[sortField] ?? "");
      const cmp = va.localeCompare(vb);
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [filtered, sortField, sortDir]);

  useEffect(() => {
    if (editingCell) {
      editInputRef.current?.focus();
    }
  }, [editingCell]);

  const toggleSort = (field: string) => {
    startTransition(() => {
      if (sortField === field) {setSortDir((d) => (d === "asc" ? "desc" : "asc"));}
      else {
        setSortField(field);
        setSortDir("asc");
      }
    });
  };

  const toggleRow = (id: string) => {
    setSelectedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {next.delete(id);}
      else {next.add(id);}
      return next;
    });
  };

  const addFilter = () => {
    if (columns.length === 0) {return;}
    setFilterRules((prev) => [
      ...prev,
      { column: columns[0] ?? "", value: "" },
    ]);
    setShowFilters(true);
  };

  const updateFilter = (idx: number, patch: Partial<FilterRule>) => {
    startTransition(() => {
      setFilterRules((prev) =>
        prev.map((f, i) => (i === idx ? { ...f, ...patch } : f)),
      );
    });
  };

  const removeFilter = (idx: number) => {
    setFilterRules((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleAddRow = async () => {
    // P94: schema-valid payload. The bookmarks schema requires
    // url/urlHash/createdAt/updatedAt/processed/isPrivate/isDeleted; a bare
    // {id, title} upsert always fails RxDB validation (the P91 wiring
    // shipped without these, so "New" never persisted on the real route).
    // newRecordDefaults carries the static required fields; timestamps are
    // stamped fresh so sorting by createdAt stays meaningful. The id uses
    // a random suffix so two rapid clicks cannot collide.
    const now = new Date().toISOString();
    const newRow: DatabaseRow = {
      ...newRecordDefaults,
      id: `row-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
      title: t("new_record_title", "New record"),
      createdAt: now,
      updatedAt: now,
    };
    // P94: fill only STRING columns with "". Writing "" into array
    // (tags/relatedLinks), number (visitCount) or boolean (broken)
    // columns would be REJECTED by RxDB schema validation — a seeded
    // vault has tags present, so the old blanket fill made every "New"
    // upsert fail. Arrays/numbers/booleans stay absent → the cell shows
    // "—" and the row remains schema-valid. Sample the type from the
    // first live row to stay collection-agnostic.
    const firstRow = data[0];
    for (const col of columns) {
      if (col in newRow) {continue;}
      if (typeof firstRow?.[col] === "string") {newRow[col] = "";}
    }
    if (isControlled) {
      setLocalData((prev) => [...prev, newRow]);
      return;
    }
    if (!rxCollection) {
      logger.warn("[DatabaseView] No RxDB collection to add a row into", {
        collection,
      });
      return;
    }
    runAddRow(async () => {
      // Generic inserts can fail schema validation (required fields per
      // collection, e.g. bookmarks needs url/createdAt). Never break the
      // view — but DO tell the user the insert didn't persist, instead of
      // silently doing nothing (handled by onError).
      await rxCollection.upsert(newRow);
    });
  };

  const startEditing = useCallback(
    (rowId: string, column: string, currentValue: unknown) => {
      setEditingCell({ rowId, column });
      setEditValue(String(currentValue ?? ""));
    },
    [],
  );

  const commitEdit = useCallback(async () => {
    if (!editingCell) {return;}
    const { rowId, column } = editingCell;
    // P94: coerce the editor's raw string back to the column's real type.
    // tags (array), processed/isPrivate/isDeleted (boolean) and visitCount
    // (number) would otherwise be patched as strings and REJECTED by RxDB
    // schema validation — the same class of silent-failure as handleAddRow.
    const existingRow = data.find((r) => r.id === rowId);
    const original = existingRow?.[column];
    const value = coerceEditValue(original, editValue);
    if (isControlled) {
      setLocalData((prev) =>
        prev.map((row) =>
          row.id === rowId ? { ...row, [column]: value } : row,
        ),
      );
      onCellEdit?.(rowId, column, value);
      setEditingCell(null);
      return;
    }
    if (!rxCollection) {
      setEditingCell(null);
      return;
    }
    editMetaRef.current = { rowId, column };
    runEdit(async () => {
      const doc = await rxCollection.findOne(rowId).exec();
      if (doc) {
        await doc.incrementalPatch({ [column]: value });
      } else {
        // P91 fix: never upsert a bare {id, column} — that would REPLACE the
        // whole document with only two fields, wiping url/title/tags/etc.
        // Rebuild the full row from the live data we already have.
        if (existingRow) {
          await rxCollection.upsert({ ...existingRow, [column]: value });
        } else {
          logger.warn("[DatabaseView] Row vanished before edit commit", {
            collection,
            rowId,
          });
        }
      }
    });
  }, [
    editingCell,
    editValue,
    isControlled,
    rxCollection,
    collection,
    onCellEdit,
    data,
    t,
    runEdit,
  ]);

  const cancelEdit = useCallback(() => {
    setEditingCell(null);
  }, []);

  const handleDeleteSelected = async () => {
    if (selectedRows.size === 0) {return;}
    if (isControlled) {
      setLocalData((prev) => prev.filter((r) => !selectedRows.has(r.id)));
      setSelectedRows(new Set());
      return;
    }
    if (!rxCollection) {
      logger.warn("[DatabaseView] No RxDB collection to delete rows from", {
        collection,
      });
      setSelectedRows(new Set());
      return;
    }
    deleteCountRef.current = selectedRows.size;
    runDelete(async () => {
      for (const rowId of selectedRows) {
        const doc = await rxCollection.findOne(rowId).exec();
        if (!doc) {continue;}
        // P94: soft-delete via the schema's isDeleted flag (bookmarks),
        // falling back to hard remove for collections without one.
        if ("isDeleted" in doc) {
          // updatedAt stamp: tombstones apply LWW by updatedAt in sync, and
          // GarbageCollectionService purges by updatedAt < cutoff.
          await doc.incrementalPatch({
            isDeleted: true,
            updatedAt: new Date().toISOString(),
          });
        } else {
          await doc.remove();
        }
      }
    });
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex flex-col h-full"
    >
      {/* Toolbar */}
      <div className="flex items-center justify-between p-4 ds-border-divider">
        <div className="flex items-center gap-2">
          <Table className="size-5 ds-text-accent" />
          <h1 className="ds-h2">{t("database_title", "Database")}</h1>
          <span className="ds-badge ds-badge-soft">{collection}</span>
          <span className="ds-text-tiny ds-text-muted ms-2">
            {t("app_records_count", "{{count}} records", {
              count: data.length,
            })}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`truncate ds-btn-text flex items-center gap-1 ds-px-md ds-radius-button ${showFilters ? "ds-text-accent ds-bg-accent-soft" : "ds-text-muted hover:ds-bg-accent-soft"}`}
          >
            <Filter className="size-4" />
            {t("filter", "Filter")}
            {filters.length > 0 && (
              <span className="ds-text-tiny bg-[var(--accent-primary)] text-white rounded-full px-1.5 py-0.5">
                {filters.length}
              </span>
            )}
          </button>
          <button
            onClick={handleAddRow}
            className="truncate btn-primary flex items-center gap-1 px-4 py-2"
          >
            <Plus className="size-4" />
            {t("new_record", "New")}
          </button>
          <button
            onClick={handleDeleteSelected}
            disabled={selectedRows.size === 0}
            aria-label={t("database_delete_selected", "Delete selected records")}
            className="truncate flex items-center gap-1 px-4 py-2 ds-btn-text ds-text-danger disabled:opacity-40 disabled:cursor-not-allowed hover:ds-bg-accent-soft"
          >
            <Trash2 className="size-4" />
            {t("delete_selected", "Delete")}
            {selectedRows.size > 0 && (
              <span className="ds-text-tiny bg-[var(--accent-primary)] text-white rounded-full px-1.5 py-0.5">
                {selectedRows.size}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Filter Panel */}
      {showFilters && (
        <div className="px-4 py-3 ds-bg-secondary ds-border-divider space-y-2">
          <div className="flex items-center justify-between">
            <span className="ds-text-tiny font-semibold uppercase tracking-wider ds-text-muted">
              {t("active_filters", "Active Filters")}
            </span>
            <button
              onClick={addFilter}
              className="truncate ds-text-tiny ds-text-accent hover:underline"
            >
              + {t("add_filter", "Add Filter")}
            </button>
          </div>
          {filters.length === 0 && (
            <p className="ds-text-tiny ds-text-muted">
              {t(
                "no_filters",
                "No filters applied. Click 'Add Filter' to start.",
              )}
            </p>
          )}
          {filters.map((f, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <select
                value={f.column}
                onChange={(e) => updateFilter(idx, { column: e.target.value })}
                aria-label={t("filter_column", "Filter column")}
                className="ds-input ds-radius-input ds-border-divider px-2 py-1 text-sm"
              >
                {columns.map((col) => (
                  <option key={col} value={col}>
                    {col}
                  </option>
                ))}
              </select>
              <input
                type="text"
                value={f.value}
                onChange={(e) => updateFilter(idx, { value: e.target.value })}
                placeholder={t("filter_value", "Value...")}
                aria-label={t("filter_value", "Value...")}
                className="ds-input ds-radius-input ds-border-divider px-2 py-1 text-sm flex-1"
              />
              <button
                onClick={() => removeFilter(idx)}
                aria-label={t("remove_filter", "Remove filter")}
                className="p-1 ds-text-muted hover:ds-text-danger transition-colors"
              >
                <X className="size-4" />
              </button>
            </div>
          ))}
          {filters.length > 0 && filtered.length < data.length && (
            <p className="ds-text-tiny ds-text-muted">
              {t("filter_results", "Showing {{count}} of {{total}} records", {
                count: filtered.length,
                total: data.length,
              })}
            </p>
          )}
        </div>
      )}

      {/* Search */}
      <div className="px-4 py-2">
        <div className="relative max-w-md">
          <Search className="absolute start-3 top-1/2 -translate-y-1/2 size-4 ds-text-muted" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => startTransition(() => setSearchQuery(e.target.value))}
            placeholder={t("search_database", "Search records...")}
            aria-label={t("search_database", "Search records...")}
            className="w-full ps-10 pe-4 py-2 ds-input ds-radius-input ds-border-divider"
          />
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto p-4 pt-2">
        <div className="ds-card-soft-primary overflow-hidden">
          <table className="w-full border-collapse">
            <thead>
              <tr className="ds-border-divider">
                <th className="w-8 p-2 text-start">
                  <input
                    type="checkbox"
                    className="cursor-pointer"
                    aria-label={t("select_all_records", "Select all records")}
                    checked={
                      selectedRows.size === sorted.length && sorted.length > 0
                    }
                    onChange={() => {
                      if (selectedRows.size === sorted.length)
                        {setSelectedRows(new Set());}
                      else {setSelectedRows(new Set(sorted.map((r) => r.id)));}
                    }}
                  />
                </th>
                {columns.map((col) => (
                  <th
                    key={col}
                    onClick={() => toggleSort(col)}
                    className="p-2 text-start ds-text-tiny font-semibold uppercase tracking-wider ds-text-muted cursor-pointer hover:ds-text-accent select-none"
                  >
                    <div className="flex items-center gap-1">
                      {col}
                      {sortField === col ? (
                        sortDir === "asc" ? (
                          <ArrowUp className="size-3" />
                        ) : (
                          <ArrowDown className="size-3" />
                        )
                      ) : (
                        <ArrowUpDown className="size-3 opacity-30" />
                      )}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 ? (
                <tr>
                  <td colSpan={columns.length + 1} className="truncate p-8 text-center">
                    <div className="flex flex-col items-center gap-2 ds-text-muted">
                      <Table className="size-8" />
                      <p className="ds-text-secondary">
                        {t("no_records", "No records found")}
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                sorted.map((row) => (
                  <tr
                    key={row.id}
                    onClick={() => {
                      onRowClick?.(row.id);
                      toggleRow(row.id);
                    }}
                    className="ds-border-divider cursor-pointer hover:ds-bg-accent-soft transition-colors"
                  >
                    <td
                      className="w-8 p-2 text-start"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        checked={selectedRows.has(row.id)}
                        onChange={() => toggleRow(row.id)}
                        className="cursor-pointer"
                        aria-label={t("select_record", "Select record")}
                      />
                    </td>
                    {columns.map((col) => {
                      const isEditing =
                        editingCell?.rowId === row.id &&
                        editingCell?.column === col;
                      const currentVal = String(row[col] ?? "");
                      const uniques = columnUniques.get(col);

                      return (
                        <td
                          key={col}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (!isEditing)
                              {startEditing(row.id, col, currentVal);}
                          }}
                          className="truncate p-2 ds-text-small ds-text-primary"
                        >
                          {isEditing ? (
                            <div className="flex items-center gap-1">
                              {uniques ? (
                                <select
                                  ref={
                                    editInputRef as React.Ref<HTMLSelectElement>
                                  }
                                  value={editValue}
                                  onChange={(e) => setEditValue(e.target.value)}
                                  onBlur={commitEdit}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") {commitEdit();}
                                    if (e.key === "Escape") {cancelEdit();}
                                  }}
                                  aria-label={t("edit_value", "Edit value")}
                                  className="w-full px-1 py-0.5 text-sm ds-input ds-radius-input ds-border-divider"
                                >
                                  {uniques.map((v) => (
                                    <option key={v} value={v}>
                                      {v}
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                <input
                                  ref={
                                    editInputRef as React.Ref<HTMLInputElement>
                                  }
                                  type="text"
                                  value={editValue}
                                  onChange={(e) => setEditValue(e.target.value)}
                                  onBlur={commitEdit}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") {commitEdit();}
                                    if (e.key === "Escape") {cancelEdit();}
                                  }}
                                  aria-label={t("edit_value", "Edit value")}
                                  className="w-full px-1 py-0.5 text-sm ds-input ds-radius-input ds-border-divider"
                                />
                              )}
                              <button
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={commitEdit}
                                aria-label={t("confirm_edit", "Confirm edit")}
                                className="p-0.5 ds-text-success shrink-0"
                              >
                                <Check className="size-3" />
                              </button>
                            </div>
                          ) : (
                            <span className="block min-h-5 truncate max-w-64">
                              {currentVal || (
                                <span className="ds-text-muted italic">
                                  {t("app_dash", "—")}
                                </span>
                              )}
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </motion.div>
  );
}
