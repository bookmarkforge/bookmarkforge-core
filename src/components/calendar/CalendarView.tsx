import { useState, useMemo, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { formatDate } from "../../utils/localization";
import { motion } from "motion/react";
import { useRxCollection, useRxQuery } from "../../hooks/useRxDB";
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  Plus,
  X,
  Trash2,
} from "lucide-react";
import { logger } from "../../utils/logger";
import { toast } from "sonner";
import type { DocumentDocType } from "../../db/schema";
import { useGuardedActions } from "../../hooks/useGuardedActions";

interface CalendarEvent {
  id: string;
  title: string;
  date: string;
  type?: "task" | "event" | "reminder";
}

interface CalendarViewProps {
  events?: CalendarEvent[];
  onEventClick?: (id: string) => void;
  onDateSelect?: (date: string) => void;
  onCreate?: (event: CalendarEvent) => void;
  onDelete?: (id: string) => void;
}

const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const typeColors: Record<string, string> = {
  task: "var(--color-warning)",
  event: "var(--accent-primary)",
  reminder: "var(--color-success)",
};

let eventCounter = 100;

function dateToIso(date: string): string {
  // Noon avoids UTC day-shift when the date is parsed back to a local cell.
  return new Date(date + "T12:00:00").toISOString();
}

function isoToLocalDate(iso: string): string {
  // createdAt is a UTC ISO string, but calendar cells use LOCAL dates.
  // Reading the local date parts (not slicing the UTC string) keeps a doc
  // created near midnight local on the correct calendar day.
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {return "";}
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function CalendarView({
  events,
  onEventClick: _onEventClick,
  onCreate,
  onDelete,
}: CalendarViewProps) {
  const { t, i18n } = useTranslation();
  // save/remove share ONE guard (blockReentry: false): a save begun mid-save
  // supersedes the previous one, exactly like the old threaded-handle
  // begin(). The onSuccess/onError gates preserve the original flow — the
  // modal closes even on a failed persist (the old code logged the toast
  // and its isCurrent gate still passed), while a superseded or unmounted
  // invocation drops both the toast and the close.
  const { save: saveAction, remove: removeAction } = useGuardedActions<{
    save: void;
    remove: void;
  }>({
    save: {
      blockReentry: false,
      onSuccess: () => closeModal(),
      onError: (error) => {
        const reason = error instanceof Error ? error.message : String(error);
        logger.warn("[CalendarView] Failed to persist event", { reason });
        toast.error(
          t("calendar_save_failed", "Couldn't save event: {{reason}}", {
            reason,
          }),
        );
        closeModal();
      },
    },
    remove: {
      blockReentry: false,
      onSuccess: () => closeModal(),
      onError: (error) => {
        const reason = error instanceof Error ? error.message : String(error);
        logger.warn("[CalendarView] Failed to delete event", { reason });
        toast.error(
          t("calendar_delete_failed", "Couldn't delete event: {{reason}}", {
            reason,
          }),
        );
        closeModal();
      },
    },
  });

  // P92: production must never show fake data. Controlled mode (events prop,
  // used by tests) keeps the old behavior. Uncontrolled mode (the /calendar
  // route) reads REAL documents by their createdAt date — "when did I create
  // this" — and create/edit/delete persist to RxDB.
  const isControlled = events !== undefined;

  const docsCollection = useRxCollection<DocumentDocType>("documents");
  const { result: rxDocs = [] } = useRxQuery(
    docsCollection?.find().where("isDeleted").eq(false),
  );

  const derivedEvents = useMemo<CalendarEvent[]>(
    () =>
      (
        rxDocs as unknown as Array<{
          toJSON(): { id: string; title: string; createdAt: string };
        }>
      ).map((d) => {
        const j = d.toJSON();
        return {
          id: j.id,
          title: j.title || t("app_untitledDocument", "Untitled"),
          date: isoToLocalDate(j.createdAt || ""),
          type: "event" as const,
        };
      })
        .filter((ev) => ev.date !== ""),
    [rxDocs, t],
  );

  const eventList = isControlled ? (events ?? []) : derivedEvents;

  const [today] = useState(new Date());
  const [currentMonth, setCurrentMonth] = useState(today.getMonth());
  const [currentYear, setCurrentYear] = useState(today.getFullYear());
  const [showModal, setShowModal] = useState(false);
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null);
  const [formData, setFormData] = useState({
    title: "",
    date: "",
    type: "event" as CalendarEvent["type"],
  });

  useEffect(() => {
    if (showModal)
      {setFormData({
        title: editingEvent?.title || "",
        date:
          editingEvent?.date ||
          `${currentYear}-${String(currentMonth + 1).padStart(2, "0")}-01`,
        type: editingEvent?.type || "event",
      });}
  }, [showModal, editingEvent, currentYear, currentMonth]);

  const monthGrid = useMemo(() => {
    const firstDay = new Date(currentYear, currentMonth, 1);
    const lastDay = new Date(currentYear, currentMonth + 1, 0);
    const startPad = firstDay.getDay();
    const daysInMonth = lastDay.getDate();
    const totalCells = Math.ceil((startPad + daysInMonth) / 7) * 7;

    return Array.from({ length: totalCells }, (_, i) => {
      const dayNum = i - startPad + 1;
      if (dayNum < 1 || dayNum > daysInMonth) {return null;}
      const date = `${currentYear}-${String(currentMonth + 1).padStart(2, "0")}-${String(dayNum).padStart(2, "0")}`;
      return {
        day: dayNum,
        date,
        isToday:
          today.getDate() === dayNum &&
          today.getMonth() === currentMonth &&
          today.getFullYear() === currentYear,
      };
    });
  }, [currentMonth, currentYear, today]);

  // Chunk the flat month grid into weeks of 7 so each week can be exposed
  // as an ARIA `row` inside the `grid` (axe aria-required-parent requires
  // gridcells to live under a row under a grid).
  const monthWeeks = useMemo(() => {
    const weeks: (typeof monthGrid)[] = [];
    for (let i = 0; i < monthGrid.length; i += 7) {
      weeks.push(monthGrid.slice(i, i + 7));
    }
    return weeks;
  }, [monthGrid]);

  const monthEvents = useMemo(
    () =>
      eventList.filter((ev) => {
        // Match on the local YYYY-MM-DD string directly: parsing "YYYY-MM-DD"
        // as UTC midnight then reading local getMonth() would silently drop
        // day-1 events for negative-offset users (pre-existing filter bug).
        return ev.date.startsWith(
          `${currentYear}-${String(currentMonth + 1).padStart(2, "0")}`,
        );
      }),
    [eventList, currentMonth, currentYear],
  );

  const eventsByDate = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const ev of eventList) {
      const existing = map.get(ev.date) || [];
      existing.push(ev);
      map.set(ev.date, existing);
    }
    return map;
  }, [eventList]);

  const goToToday = () => {
    setCurrentMonth(today.getMonth());
    setCurrentYear(today.getFullYear());
  };
  const goToPrevMonth = () => {
    if (currentMonth === 0) {
      setCurrentMonth(11);
      setCurrentYear(currentYear - 1);
    } else {setCurrentMonth(currentMonth - 1);}
  };
  const goToNextMonth = () => {
    if (currentMonth === 11) {
      setCurrentMonth(0);
      setCurrentYear(currentYear + 1);
    } else {setCurrentMonth(currentMonth + 1);}
  };

  const openCreateModal = (date?: string) => {
    setEditingEvent(null);
    setFormData({
      title: "",
      date:
        date ||
        `${currentYear}-${String(currentMonth + 1).padStart(2, "0")}-01`,
      type: "event",
    });
    setShowModal(true);
  };

  const openEditModal = (ev: CalendarEvent) => {
    setEditingEvent(ev);
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingEvent(null);
  };

  const persistEvent = async (ev: CalendarEvent, isEdit: boolean) => {
    if (isControlled) {
      onCreate?.(ev);
      return;
    }
    if (!docsCollection) {return;}
    if (isEdit) {
      const doc = await docsCollection.findOne(ev.id).exec();
      await doc?.incrementalPatch({
        title: ev.title,
        createdAt: dateToIso(ev.date),
        updatedAt: new Date().toISOString(),
      });
    } else {
      const now = new Date().toISOString();
      await docsCollection.upsert({
        id: "doc-" + Date.now(),
        folderId: "root",
        title: ev.title,
        blocks: [],
        textContent: "",
        tags: [],
        links: [],
        embedding: [],
        processed: false,
        isPrivate: false,
        isDeleted: false,
        createdAt: dateToIso(ev.date),
        updatedAt: now,
      });
    }
  };

  const confirmSave = () => {
    if (!formData.title.trim() || !formData.date) {return;}
    if (editingEvent) {
      const updated: CalendarEvent = {
        ...editingEvent,
        title: formData.title.trim(),
        date: formData.date,
        type: formData.type,
      };
      void saveAction.run(() => persistEvent(updated, true));
    } else {
      const ev: CalendarEvent = {
        id: `evt-${++eventCounter}`,
        title: formData.title.trim(),
        date: formData.date,
        type: formData.type,
      };
      void saveAction.run(() => persistEvent(ev, false));
    }
  };

  const handleDelete = () => {
    if (editingEvent) {
      if (isControlled) {
        onDelete?.(editingEvent.id);
        closeModal();
      } else if (docsCollection) {
        void removeAction.run(async () => {
          const doc = await docsCollection.findOne(editingEvent.id).exec();
          // updatedAt stamp is required: tombstones apply last-write-wins by
          // updatedAt in WebRTC sync, and GarbageCollectionService purges by
          // updatedAt < cutoff — a stale stamp would resurrect the doc on
          // peers or purge it prematurely.
          await doc?.incrementalPatch({
            isDeleted: true,
            updatedAt: new Date().toISOString(),
          });
        });
      }
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex flex-col h-full"
    >
      {/* Header */}
      <div className="flex items-center justify-between p-4 ds-border-divider">
        <div className="flex items-center gap-4">
          <Calendar className="size-5 ds-text-accent" />
          <h1 className="ds-h2">
            {formatDate(new Date(currentYear, currentMonth), {
              month: "long",
              year: "numeric",
            }, i18n.language)}
          </h1>
          <div className="flex items-center gap-1">
            <button
              onClick={goToPrevMonth}
              aria-label={t("app_previousMonth") || "Previous month"}
              className="p-1.5 ds-radius-button hover:ds-bg-accent-soft transition-colors ds-text-muted"
            >
              <ChevronLeft className="rtl-flip size-4" />
            </button>
            <button
              onClick={goToNextMonth}
              aria-label={t("app_nextMonth") || "Next month"}
              className="p-1.5 ds-radius-button hover:ds-bg-accent-soft transition-colors ds-text-muted"
            >
              <ChevronRight className="rtl-flip size-4" />
            </button>
          </div>
          <button
            onClick={goToToday}
            className="truncate ds-btn-text ds-px-md ds-radius-button hover:ds-bg-accent-soft ds-text-accent text-sm font-medium transition-colors"
          >
            {t("today", "Today")}
          </button>
          <span className="ds-text-tiny ds-text-muted">
            {t("app_events_count", "{{count}} events", {
              count: monthEvents.length,
            })}
          </span>
        </div>
        <button
          onClick={() => openCreateModal()}
          className="truncate btn-primary flex items-center gap-1 px-4 py-2"
        >
          <Plus className="size-4" /> {t("add_event", "Add Event")}
        </button>
      </div>

      {/* Event Modal (Create / Edit) */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center ds-bg-overlay p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="ds-card-soft-primary p-6 ds-radius-card w-full max-w-md max-h-[80vh] overflow-y-auto space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="ds-h3 line-clamp-2">
                {editingEvent
                  ? t("edit_event", "Edit Event")
                  : t("new_event", "New Event")}
              </h3>
              <button
                onClick={closeModal}
                className="ds-text-muted hover:ds-text-primary"
              >
                <X className="size-5" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="ds-text-tiny font-semibold uppercase tracking-wider ds-text-muted block mb-1">
                  {t("event_title", "Title")}
                </label>
                <input
                  type="text"
                  value={formData.title}
                  onChange={(e) =>
                    setFormData((p) => ({ ...p, title: e.target.value }))
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {confirmSave();}
                  }}
                  placeholder={t("event_title_placeholder", "Event title...")}
                  aria-label={t("event_title", "Title")}
                  className="w-full px-3 py-2 ds-input ds-radius-input ds-border-divider"
                />
              </div>
              <div>
                <label className="ds-text-tiny font-semibold uppercase tracking-wider ds-text-muted block mb-1">
                  {t("event_date", "Date")}
                </label>
                <input
                  type="date"
                  value={formData.date}
                  onChange={(e) =>
                    setFormData((p) => ({ ...p, date: e.target.value }))
                  }
                  aria-label={t("event_date", "Date")}
                  className="w-full px-3 py-2 ds-input ds-radius-input ds-border-divider"
                />
              </div>
              <div>
                <label className="ds-text-tiny font-semibold uppercase tracking-wider ds-text-muted block mb-1">
                  {t("event_type", "Type")}
                </label>
                <select
                  value={formData.type}
                  onChange={(e) =>
                    setFormData((p) => ({
                      ...p,
                      type: e.target.value as CalendarEvent["type"],
                    }))
                  }
                  className="w-full px-3 py-2 ds-input ds-radius-input ds-border-divider"
                >
                  <option value="event">{t("event", "Event")}</option>
                  <option value="task">{t("task", "Task")}</option>
                  <option value="reminder">{t("reminder", "Reminder")}</option>
                </select>
              </div>
            </div>

            <div className="flex justify-between items-center pt-2">
              {editingEvent ? (
                <button
                  onClick={handleDelete}
                  className="truncate flex items-center gap-1 px-3 py-2 ds-text-danger hover:bg-[var(--color-danger)]/10 ds-radius-button transition-colors"
                >
                  <Trash2 className="size-4" /> {t("delete", "Delete")}
                </button>
              ) : (
                <div />
              )}
              <div className="flex gap-2">
                <button
                  onClick={closeModal}
                  className="truncate ds-btn-text px-4 py-2 ds-radius-button hover:ds-bg-accent-soft transition-colors"
                >
                  {t("cancel", "Cancel")}
                </button>
                <button
                  onClick={confirmSave}
                  disabled={!formData.title.trim() || !formData.date}
                  className="truncate btn-primary px-4 py-2 disabled:opacity-40"
                >
                  {editingEvent ? t("save", "Save") : t("create", "Create")}
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}

      {/* Calendar Grid */}
      <div className="flex-1 p-4 overflow-y-auto">
        <div className="ds-card-soft-primary overflow-hidden" role="grid" aria-label={t("calendar_grid_label", "Month calendar")}>
          <div className="grid grid-cols-7 ds-border-divider" role="row">
            {DAYS.map((d) => (
              <div
                key={d}
                role="columnheader"
                className="p-2 text-center ds-text-muted ds-text-tiny font-semibold uppercase tracking-wider ds-border-divider"
              >
                {t("day_" + d, d.charAt(0).toUpperCase() + d.slice(1, 3))}
              </div>
            ))}
          </div>
          {monthWeeks.map((week, weekIdx) => (
            <div key={"week-" + weekIdx} role="row" className="grid grid-cols-7">
              {week.map((cell, i) => {
                if (!cell)
                  {return (
                    <div
                      key={"empty-" + (weekIdx * 7 + i)}
                      role="gridcell"
                      aria-hidden="true"
                      className="aspect-square p-1 ds-bg-secondary"
                    />
                  );}
                const dayEvents = eventsByDate.get(cell.date) || [];
                return (
                  <div
                    key={cell.date}
                    onClick={() => openCreateModal(cell.date)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ")
                        {openCreateModal(cell.date);}
                    }}
                    role="gridcell"
                    tabIndex={0}
                    className={`aspect-square p-1.5 border-[0.5px] ds-border-divider transition-colors cursor-pointer hover:ds-bg-accent-soft ${cell.isToday ? "ds-bg-accent-soft" : ""}`}
                  >
                    <span
                      className={`text-xs font-semibold ${cell.isToday ? "ds-text-accent" : "ds-text-primary"}`}
                    >
                      {cell.day}
                    </span>
                    <div className="mt-0.5 space-y-0.5">
                      {dayEvents.slice(0, 2).map((ev) => (
                        <div
                          key={ev.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            openEditModal(ev);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.stopPropagation();
                              openEditModal(ev);
                            }
                          }}
                          role="button"
                          tabIndex={0}
                          className="text-[9px] leading-tight px-1 py-0.5 rounded truncate cursor-pointer hover:opacity-80"
                          style={{
                            background: typeColors[ev.type || "event"] + "20",
                            color: typeColors[ev.type || "event"],
                          }}
                          title={ev.title}
                        >
                          {ev.title}
                        </div>
                      ))}
                      {dayEvents.length > 2 && (
                        <div className="text-[9px] ds-text-muted px-1">
                          {t("app_more_events", "+{{count}} more", {
                            count: dayEvents.length - 2,
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}
