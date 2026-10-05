import { lazy, Suspense, useEffect, useState, useCallback } from "react";
import {
  FileText,
  HelpCircle,
  Bookmark,
  Sparkles,
  ArrowRight,
  Folder,
  MessageSquare,
  Activity,
  Clock,
  Plus,
  Share2,
  Mic,
  Users,
  Search,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatDate } from "../utils/localization";
import { motion, Variants, AnimatePresence } from "motion/react";
import { EASE_OUT, DURATION_MENU } from "../constants/motion";
import { securityVault } from "../services/SecurityVault";
import { initDB } from "../container/database";
import { fileSystemService } from "../services/FileSystemService";
import { toast } from "sonner";
import { Document } from "../types";
import type { DocumentDocument } from "../db/types";
import {
  crossPollinationService,
  Insight,
} from "../services/ai/CrossPollinationService";
import InsightCards from "./ai/InsightCards";
import { notificationService } from "../services/NotificationService";
import {
  documentTemplateService,
  DocumentTemplate,
  normalizeTemplateBlocksToBlockNote,
  templateBlocksToPlainText,
} from "../services/DocumentTemplateService";
import { ForgottenConnections } from "./ai/ForgottenConnections";
import { NavCard } from "./dashboard/components/NavCard";
import { logger } from "../utils/logger";
import { EvictionBanner } from "./dashboard/components/EvictionBanner";
import { BackupReminderBanner } from "./dashboard/components/BackupReminderBanner";
import { FreeTierNudge } from "./dashboard/components/FreeTierNudge";
import { useFreeTierUsage } from "../hooks/useFreeTierUsage";
import { SRSReviewCard } from "./dashboard/components/SRSReviewCard";
import { TemplateModal } from "./dashboard/components/TemplateModal";
import { QuickTips } from "./QuickTips";
import { FirstRunChecklist } from "./dashboard/components/FirstRunChecklist";
import { useFirstRunChecklist } from "../hooks/useFirstRunChecklist";
import {
  StorageStatus,
  getLatestBackupAgeMs,
  BACKUP_STALE_MS,
  BACKUP_REFRESH_INTERVAL_MS,
} from "./StorageStatus";
import { ResearchAssistant } from "./ResearchAssistant";
import { safeGet, safeSet } from "../store/safeStorage";
import { STORAGE_KEYS } from "../constants/storage-keys";
import { useGuardedActions } from "../hooks/useGuardedActions";
import { useGuardedDataLoad } from "../hooks/useGuardedDataLoad";

const ImportDialog = lazy(() => import("./ImportDialog"));

interface HomeDashboardProps {
  onNavigate: (
    tab:
      | "documents"
      | "chatLocal"
      | "bookmarks"
      | "analytics"
      | "voiceLocal"
      | "chat"
      | "graph"
      | "collaboration",
  ) => void;
  onSelectDocument: (id: string) => void;
}

const container: Variants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.04 },
  },
};

const item: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: DURATION_MENU, ease: EASE_OUT },
  },
};

async function shouldShowBackupBanner(): Promise<boolean> {
  try {
    const dismissedUntil = safeGet(STORAGE_KEYS.BACKUP_BANNER_DISMISSED_UNTIL);
    if (dismissedUntil && Date.now() < parseInt(dismissedUntil, 10)) {
      return false;
    }
  } catch (e: unknown) {
    logger.warn("[HomeDashboard] Failed to read backup dismissal", {
      error: e instanceof Error ? e.message : String(e),
    });
  }
  // F0-3: remind when the latest external copy (auto or manual) is over
  // 48 h old — or has never run. A fresh daily auto-backup (F0-1) keeps the
  // banner quiet on its own, so the reminder only fires when protection is
  // actually missing.
  const ageMs = await getLatestBackupAgeMs();
  return ageMs === null || ageMs > BACKUP_STALE_MS;
}

/**
 * The SAME decision as shouldShowBackupBanner, computed synchronously so the
 * dashboard's FIRST PAINT can already be final (ADR-055): both timestamps the
 * decision reads — the dismissal snooze and the last-backup markers (manual
 * + auto, the very keys getLatestBackupAgeMs reads) — live in localStorage.
 * The async round-trip only ever adds getAutoBackupInfo's `available` flag,
 * which the decision never uses. One divergence is handled explicitly: on a
 * Safari/iOS surface with the eviction banner undismissed, the async eviction
 * check (vault secret, cannot be read synchronously) may win the slot, so the
 * sync decision stays quiet there and lets the async pipeline resolve.
 */
function shouldShowBackupBannerSync(): boolean {
  try {
    const dismissedUntil = safeGet(STORAGE_KEYS.BACKUP_BANNER_DISMISSED_UNTIL);
    if (dismissedUntil && Date.now() < parseInt(dismissedUntil, 10)) {
      return false;
    }
    const ua = navigator.userAgent;
    const isSafariIOS =
      /iPad|iPhone|iPod/.test(ua) ||
      (ua.includes("Mac") && "ontouchend" in document);
    if (
      isSafariIOS &&
      safeGet(STORAGE_KEYS.EVICTION_BANNER_DISMISSED) !== "true"
    ) {
      return false;
    }
  } catch {
    return false; // unreadable storage: let the async check decide
  }
  const timestamps: number[] = [];
  const manualRaw = safeGet(STORAGE_KEYS.LAST_MANUAL_BACKUP_DATE);
  if (manualRaw && Number.isFinite(parseInt(manualRaw, 10))) {
    timestamps.push(parseInt(manualRaw, 10));
  }
  const autoRaw = safeGet(STORAGE_KEYS.AUTO_BACKUP_TIMESTAMP);
  if (autoRaw && Number.isFinite(parseInt(autoRaw, 10))) {
    timestamps.push(parseInt(autoRaw, 10));
  }
  if (timestamps.length === 0) {
    return true; // never backed up
  }
  return Date.now() - Math.max(...timestamps) > BACKUP_STALE_MS;
}

const HomeDashboard = function HomeDashboard({
  onNavigate,
  onSelectDocument,
}: HomeDashboardProps) {
  const { t, i18n } = useTranslation();
  const [recentDocs, setRecentDocs] = useState<Document[]>([]);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [dueCardsCount, setDueCardsCount] = useState(0);
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [templates, setTemplates] = useState<DocumentTemplate[]>([]);
  const [showEvictionBanner, setShowEvictionBanner] = useState(false);
  // ADR-055: the show decision is computed synchronously BEFORE first paint
  // (both backup timestamps and the dismissal snooze live in localStorage),
  // so the common cases render already-final. "held" = the sync decision
  // says the banner WILL show: the surface holds its natural height with a
  // shimmer until the async check below confirms, and the reveal is a
  // visibility flip — zero layout shift. "hidden" = sync says no: the box
  // collapses from the start, no reservation for a banner that is not
  // coming. The async check re-validates once the backup service settles
  // (it reads the same keys, so disagreement is a corner of a corner) and
  // owns the state from then on, including the per-minute refresh (F0-3).
  const [backupBannerState, setBackupBannerState] = useState<
    "hidden" | "held" | "shown"
  >(() => (shouldShowBackupBannerSync() ? "held" : "hidden"));
  /** null = never backed up; number = age in ms of the latest backup */
  const [backupAgeMs, setBackupAgeMs] = useState<number | null>(null);
  const [showResearch, setShowResearch] = useState(false);
  const [showImportDialog, setShowImportDialog] = useState(false);
  // Two deliberately separate guards, preserved as two hook instances:
  // - dashboardLoad owns the data-load generation so a user mutation never
  //   invalidates an in-flight refresh (and vice versa);
  // - the mutations share ONE guard so a newer mutation supersedes an
  //   in-flight one — the original begin()-per-call semantics (blockReentry
  //   false: double-click really creates two documents, as before).
  const dashboardLoad = useGuardedDataLoad<{
    recentDocs: Document[];
    dueCardsCount: number;
    insights: Insight[];
    templates: DocumentTemplate[];
  }>(
    async (signal) => {
      const db = await initDB();
      const docs = await db.documents
        .find({
          selector: { isDeleted: { $ne: true } },
          sort: [{ updatedAt: "desc" }],
          limit: 3,
        })
        .exec();
      if (signal.aborted) {
        throw new DOMException("Dashboard load aborted", "AbortError");
      }
      const now = new Date().toISOString();
      const dueCards = await db.flashcards
        .find({
          selector: { nextReview: { $lte: now } },
        })
        .exec();
      if (signal.aborted) {
        throw new DOMException("Dashboard load aborted", "AbortError");
      }
      const newInsights = await crossPollinationService.generateInsights(
        i18n.language,
        signal,
      );
      if (signal.aborted) {
        throw new DOMException("Dashboard load aborted", "AbortError");
      }
      const weeklyCuration =
        await crossPollinationService.generateWeeklyCuration(
          i18n.language,
          signal,
        );
      if (signal.aborted) {
        throw new DOMException("Dashboard load aborted", "AbortError");
      }
      return {
        recentDocs: docs.map(
          (d: DocumentDocument) => d.toJSON() as Document,
        ),
        dueCardsCount: dueCards.length,
        insights: weeklyCuration
          ? [weeklyCuration, ...newInsights]
          : newInsights,
        templates: documentTemplateService.getAllTemplates(),
      };
    },
    {
      autoLoad: false,
      initialLoading: false,
      onSuccess: (data) => {
        setRecentDocs(data.recentDocs);
        setDueCardsCount(data.dueCardsCount);
        if (data.dueCardsCount > 0) {
          notificationService.scheduleSRSNotification(data.dueCardsCount);
        }
        setInsights(data.insights);
        setTemplates(data.templates);
      },
      onError: (err) => {
        const isAbortError =
          (err instanceof Error || err instanceof DOMException) &&
          err.name === "AbortError";
        if (!isAbortError) {
          logger.error("Error fetching dashboard data:", err);
        }
      },
    },
  );

  const mutations = useGuardedActions<{
    createFromTemplate: { id: string; name: string };
    openFolder: "indexed" | "denied" | "unsupported";
  }>({
    createFromTemplate: {
      blockReentry: false,
      onSuccess: (doc) => {
        onSelectDocument(doc.id);
        onNavigate("documents");
        setShowTemplateModal(false);
        toast.success(
          t(
            "app_documentCreated",
            `Document created from "${doc.name}" template`,
          ),
        );
      },
      onError: (err) => {
        logger.error("Error creating document from template:", err);
        toast.error(
          t("app_failedCreateDocument", "Failed to create document"),
        );
      },
    },
    openFolder: {
      blockReentry: false,
      onSuccess: (result) => {
        if (result === "unsupported") {
          toast.error(t("app_browserNotSupported"));
        } else if (result === "denied") {
          toast.error(t("app_directoryAccessDenied"));
        } else {
          toast.success(t("app_folderOpenedSuccess"));
        }
      },
      onError: (err) => {
        logger.error("Error indexing files:", err);
        toast.error(t("app_indexingError"));
      },
    },
  });

  useEffect(() => {
    let cancelled = false;
    const checkEvictionRisk = async () => {
      try {
        const ua = navigator.userAgent;
        const isSafariIOS =
          /iPad|iPhone|iPod/.test(ua) ||
          (ua.includes("Mac") && "ontouchend" in document);
        if (!isSafariIOS) {return;}
        if (safeGet(STORAGE_KEYS.EVICTION_BANNER_DISMISSED) === "true") {return;}
        const hasCloudConfig =
          await securityVault.hasSecret("cloud_sync_config");
        if (!cancelled && !hasCloudConfig) {setShowEvictionBanner(true);}
      } catch (e: unknown) {
        if (!cancelled) {
          logger.warn("[HomeDashboard] Failed to check eviction risk", {
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
    };
    checkEvictionRisk();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (showEvictionBanner) {
      // Eviction outranks the reminder (data-loss > backup nag). Resetting
      // to "hidden" (not "held") also releases any pending hold.
      if (backupBannerState !== "hidden") setBackupBannerState("hidden");
      return;
    }
    let cancelled = false;
    const refresh = async () => {
      const shouldShow = await shouldShowBackupBanner();
      if (!cancelled) {
        setBackupBannerState(shouldShow ? "shown" : "hidden");
        // Also capture the age so the banner can show a stale-specific message.
        const age = await getLatestBackupAgeMs();
        setBackupAgeMs(age);
      }
    };
    void refresh();
    // F0-3: re-evaluate every minute (mirrors StorageStatus) so the banner
    // appears automatically when the backup crosses the 48 h threshold while
    // the panel stays open — not only on mount.
    const interval = setInterval(() => void refresh(), BACKUP_REFRESH_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [showEvictionBanner, backupBannerState]);

  const handleDismissBackupBanner = useCallback(() => {
    setBackupBannerState("hidden");
    // F0-3: align the dismissal window with the 48 h stale threshold so a
    // dismissed reminder does not stay silent for a full week while the
    // backup is still overdue.
    safeSet(
      STORAGE_KEYS.BACKUP_BANNER_DISMISSED_UNTIL,
      (Date.now() + BACKUP_STALE_MS).toString(),
    );
  }, []);

  // Free-tier wall nudge (design doc surface 2): the one full Pro pitch,
  // shown once — the first time a Free user is AT the wall (count = 1,000).
  // Dismissal = 30-day cooldown. Yields to data-loss banners: eviction >
  // backup > this.
  const { atWall: freeTierAtWall, isFree: freeTierIsFree } =
    useFreeTierUsage();
  const [showFreeWallNudge, setShowFreeWallNudge] = useState(false);

  // First-run path: while the user has produced nothing yet, the three-step
  // checklist IS the dashboard's answer to "what do I do now?". Once every
  // step is done (or the user dismisses it) the checklist disappears for
  // good and the feature grid returns to being the dashboard.
  const firstRun = useFirstRunChecklist();
  const firstRunComplete =
    (firstRun.bookmarkCount ?? 0) > 0 &&
    (firstRun.documentCount ?? 0) > 0 &&
    firstRun.searchTried;
  const showFirstRun = !firstRun.dismissed && !firstRunComplete;

  const handleTrySearch = useCallback(() => {
    // Routed through the shell: the Omnibar lives in MainApp, and the same
    // event also serves any other surface that wants to open search.
    window.dispatchEvent(new Event("forge:open-search"));
  }, []);

  useEffect(() => {
    if (!freeTierIsFree || !freeTierAtWall) {return;}
    const raw = safeGet(STORAGE_KEYS.FREE_TIER_WALL_DISMISSED_AT);
    const dismissedAt = raw ? parseInt(raw, 10) : NaN;
    const cooldownOk =
      !Number.isFinite(dismissedAt) ||
      Date.now() - dismissedAt > 30 * 24 * 60 * 60 * 1000;
    // Show only on a real wall event — either a blocked save since the last
    // visit (flag persisted by the toast surfaces — works across routing),
    // or one firing live while the dashboard is open. Not on every visit
    // while at the wall.
    const pending =
      safeGet(STORAGE_KEYS.FREE_TIER_WALL_HIT_PENDING) === "1";
    if (!cooldownOk) {return;}
    if (pending) {
      safeSet(STORAGE_KEYS.FREE_TIER_WALL_HIT_PENDING, "");
      setShowFreeWallNudge(true);
    }
    const onWallHit = () => {
      const dRaw = safeGet(STORAGE_KEYS.FREE_TIER_WALL_DISMISSED_AT);
      const dAt = dRaw ? parseInt(dRaw, 10) : NaN;
      if (
        !Number.isFinite(dAt) ||
        Date.now() - dAt > 30 * 24 * 60 * 60 * 1000
      ) {
        setShowFreeWallNudge(true);
        safeSet(STORAGE_KEYS.FREE_TIER_WALL_HIT_PENDING, "");
      }
    };
    window.addEventListener("bmf:free-wall-hit", onWallHit);
    return () =>
      window.removeEventListener("bmf:free-wall-hit", onWallHit);
  }, [freeTierIsFree, freeTierAtWall]);

  // Language changes re-run the dashboard load (the original effect's deps
  // included i18n.language); the new load supersedes any in-flight one.
  useEffect(() => {
    void dashboardLoad.load();
  }, [dashboardLoad.load, i18n.language]);

  const handleCreateFromTemplate = useCallback(
    async (template: DocumentTemplate) => {
      await mutations.createFromTemplate.run(async () => {
        const db = await initDB();
        // Store the template's real blocks so the editor can load them, and
        // derive a plain-text `textContent` for search/embeddings instead of
        // dumping the raw JSON into the visible text.
        const isRawText = typeof template.content === "string";
        // Guard non-string non-array content (corrupt localStorage) so a
        // template with `content: null` can't hit the RxDB schema validation.
        const hasBlocks = Array.isArray(template.content);
        const newDoc = await db.documents.insert({
          id: crypto.randomUUID(),
          folderId: "root",
          title: template.name,
          // Normalize shorthand template blocks (bulletList/numberedList) to
          // BlockNote-valid specs so the editor can load them without crashing.
          blocks:
            isRawText || !hasBlocks
              ? []
              : normalizeTemplateBlocksToBlockNote(template.content),
          // Direct typeof check (not the alias) so TS narrows to string.
          textContent:
            typeof template.content === "string"
              ? template.content
              : templateBlocksToPlainText(hasBlocks ? template.content : []),
          tags: template.tags,
          links: [],
          processed: false,
          isDeleted: false,
          isPrivate: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
        return { id: newDoc.id, name: template.name };
      });
    },
    [mutations.createFromTemplate.run, onSelectDocument, onNavigate, t],
  );

  const handleOpenFolder = useCallback(() => {
    void mutations.openFolder.runWithSignal(async (signal) => {
      if (!fileSystemService.isSupported()) {
        return "unsupported";
      }
      const success = await fileSystemService.requestDirectoryAccess();
      if (!success) {
        return "denied";
      }
      if (signal.aborted) {
        throw new DOMException("Folder open aborted", "AbortError");
      }
      toast.loading(t("app_indexingFiles"));
      const db = await initDB();
      if (signal.aborted) {
        throw new DOMException("Folder open aborted", "AbortError");
      }
      await fileSystemService.syncFiles(db);
      return "indexed";
    });
  }, [mutations.openFolder.runWithSignal, t]);

  return (
    <div className="max-w-7xl mx-auto px-4 md:px-8 py-6 md:py-10 space-y-8 md:space-y-12 overflow-x-hidden font-sans">
      {/* Each banner owns its own collapse: one animated height box, hidden
          with `visibility` while it is off (ADR-055). No spacer wrapper here
          — a banner that should not be on screen must cost no layout space. */}
      <EvictionBanner
        show={showEvictionBanner}
        onDismiss={() => {
          setShowEvictionBanner(false);
          safeSet(STORAGE_KEYS.EVICTION_BANNER_DISMISSED, "true");
        }}
        onConfigureSync={() => {
          window.dispatchEvent(
            new CustomEvent("forge:open-settings", {
              detail: { section: "cloud-sync" },
            }),
          );
        }}
      />

      <BackupReminderBanner
        // ADR-055: "held" reserves the measured height through the async
        // confirmation window, so the reveal is a visibility flip (no shift);
        // the banner itself stays inert until state flips to "shown".
        show={backupBannerState === "shown"}
        pending={backupBannerState === "held"}
        backupAgeMs={backupAgeMs}
        onDismiss={handleDismissBackupBanner}
      />

      <FreeTierNudge
        // Data-loss warnings take precedence; the Pro pitch reappears after
        // the higher-priority banner is dismissed.
        show={
          showFreeWallNudge &&
          !showEvictionBanner &&
          backupBannerState !== "shown"
        }
        onDismiss={() => {
          setShowFreeWallNudge(false);
          safeSet(
            STORAGE_KEYS.FREE_TIER_WALL_DISMISSED_AT,
            Date.now().toString(),
          );
        }}
        onSeePro={() => {
          setShowFreeWallNudge(false);
          safeSet(
            STORAGE_KEYS.FREE_TIER_WALL_DISMISSED_AT,
            Date.now().toString(),
          );
          // Existing navigation bridge (same pattern EvictionBanner uses
          // for cloud-sync): Settings is a modal, not a routed section.
          window.dispatchEvent(new CustomEvent("forge:open-settings"));
        }}
      />

      {/* First-run checklist — replaces the daily tip while the user has not
          yet captured anything, so the two onboarding surfaces never
          compete for the same glance. */}
      {showFirstRun && (
        <FirstRunChecklist
          bookmarkCount={firstRun.bookmarkCount}
          documentCount={firstRun.documentCount}
          searchTried={firstRun.searchTried}
          onCaptureBookmark={() => onNavigate("bookmarks")}
          onCreateDocument={() => onNavigate("documents")}
          onTrySearch={handleTrySearch}
          onDismiss={firstRun.dismiss}
        />
      )}

      {/* Quick Tips — daily onboarding tip, dismissible. Audit-endorsed
          ("Buen feedback") but was never wired into any screen. */}
      {!showFirstRun && <QuickTips />}

      {/* Welcome Section */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col md:flex-row md:items-end justify-between gap-6"
      >
        <div className="space-y-4">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 text-xs font-bold uppercase tracking-widest rounded-full ds-bg-secondary ds-text-secondary border border-[var(--state-inactive-border)]">
            <Sparkles className="size-3.5 ds-text-accent" />
            <span>{t("app_localFirstAi")}</span>
          </div>
          <h1 className="ds-h1 flex flex-wrap items-center gap-4">
            {t("app_welcome")}
            <span className="text-xs font-bold px-3 py-1 ds-badge-success">
              {t("app_version", "v1.0.0")}
            </span>
            {/* Live item count — previously orphaned component. */}
            <StorageStatus />
          </h1>
          <p className="text-base md:text-lg max-w-2xl leading-relaxed ds-text-secondary">
            {t("app_welcomeSub")}
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={() => setShowImportDialog(true)}
            className="truncate px-5 py-3 text-sm font-bold transition-all flex items-center gap-2 hover:scale-105 active:scale-95 btn-primary-outline"
            aria-label={t("app_openImporter", "Open Importer")}
          >
            {t("app_openImporter", "Open Importer")}
          </button>
          <button
            onClick={() => onNavigate("documents")}
            className="truncate px-6 py-3 text-sm font-bold transition-all flex items-center gap-2 hover:scale-105 active:scale-95 btn-primary-outline ds-shadow-accent-strong"
          >
            <Plus className="size-5" />
            {t("app_newDocument")}
          </button>
        </div>
      </motion.div>

      {/* AI Insights — always reserves space to prevent CLS */}
      <div style={{ minHeight: insights.length > 0 ? undefined : 0, overflow: 'hidden' }}>
      <AnimatePresence>
        {insights.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
          >
            <InsightCards
              insights={insights}
              onAction={(insight: Insight) => {
                if (insight.relatedIds.length > 0)
                  {onSelectDocument(insight.relatedIds[0] ?? "");}
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>
      </div>

      {/* Bento Grid */}
      <motion.div
        variants={container}
        initial="hidden"
        animate="show"
        className="grid grid-cols-1 md:grid-cols-6 lg:grid-cols-12 gap-4 md:gap-5"
        style={{ minHeight: 400 }}
      >
        {dueCardsCount > 0 && (
          <SRSReviewCard
            dueCardsCount={dueCardsCount}
            onStartReview={() => onNavigate("analytics")}
          />
        )}

        {/* Documents Card */}
        <motion.div
          variants={item}
          onClick={() => onNavigate("documents")}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onNavigate("documents");
            }
          }}
          className="md:col-span-6 lg:col-span-8 bento-item group cursor-pointer text-start w-full"
        >
          <div className="flex flex-col h-full justify-between">
            <div className="space-y-4">
              <div className="flex items-start justify-between">
                <div className="size-12 flex items-center justify-center group-hover:scale-110 transition-transform ds-icon-tint-cyan ds-radius-widget">
                  <FileText className="size-6 ds-text-accent" />
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowTemplateModal(true);
                  }}
                  className="truncate px-4 py-2 text-xs font-bold transition-colors flex items-center gap-1.5 btn-primary-outline"
                >
                  <Plus className="size-3.5" /> {t("app_templates")}
                </button>
              </div>
              <h2 className="text-xl font-semibold tracking-tight ds-text-primary">
                {t("app_documents")}
              </h2>
              <p className="text-sm leading-relaxed max-w-md ds-text-secondary">
                {t("app_documentsDesc")}
              </p>
            </div>
            <div className="mt-6 pt-5 ds-divider-t">
              <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-widest mb-3 ds-text-muted">
                <div className="flex items-center gap-2">
                  <Clock className="size-3.5" />
                  <span>{t("app_recent")}</span>
                </div>
                <ArrowRight className="rtl-flip size-3.5 group-hover:translate-x-2 transition-transform ds-text-muted" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {recentDocs.length > 0 ? (
                  recentDocs.map((doc) => (
                    <div
                      key={doc.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectDocument(doc.id);
                      }}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) =>
                        e.key === "Enter" && onSelectDocument(doc.id)
                      }
                      className="p-3 transition-colors ds-bg-secondary border border-[var(--state-inactive-border)] rounded-lg"
                    >
                      <h3 className="font-semibold truncate text-sm mb-1 ds-text-primary">
                        {doc.title}
                      </h3>
                      <span className="text-xs ds-text-muted">
                        {formatDate(
                          doc.updatedAt || doc.createdAt,
                          {},
                          i18n.language,
                        )}
                      </span>
                    </div>
                  ))
                ) : (
                  <div className="col-span-3 py-5 px-4 text-center text-sm rounded-lg ds-bg-secondary ds-text-muted border border-dashed border-[var(--state-inactive-border)]">
                    {t("app_noDocumentsYet")}
                  </div>
                )}
              </div>
            </div>
          </div>
        </motion.div>

        {/* Local AI Chat Card */}
        <motion.div
          variants={item}
          onClick={() => onNavigate("chatLocal")}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onNavigate("chatLocal");
            }
          }}
          role="button"
          className="md:col-span-3 lg:col-span-4 bento-item group cursor-pointer text-start w-full flex flex-col justify-between"
          tabIndex={0}
        >
          <div className="space-y-4">
            <div className="size-12 flex items-center justify-center group-hover:scale-110 transition-transform mb-4 ds-icon-tint-cyan ds-radius-widget">
              <MessageSquare className="size-6 ds-text-accent" />
            </div>
            <h2 className="text-lg font-semibold tracking-tight ds-text-primary">
              {t("app_chatLocal")}
            </h2>
            <p className="text-sm leading-relaxed ds-text-secondary">
              {t("app_localRagDesc")}
            </p>
          </div>
          <div className="mt-6 flex justify-end">
            <div className="size-10 flex items-center justify-center group-hover:scale-110 transition-transform rounded-lg ds-accent-filled ds-shadow-accent-strong">
              <ArrowRight className="rtl-flip size-4" />
            </div>
          </div>
        </motion.div>

        {/* Nav Cards */}
        <NavCard
          icon={Bookmark}
          iconAccent="cyan"
          title={t("app_bookmarksTitle")}
          description={t("app_bookmarksDesc")}
          onClick={() => onNavigate("bookmarks")}
          className="md:col-span-2 lg:col-span-3"
        />
        <NavCard
          icon={Activity}
          iconAccent="cyan"
          title={t("app_analytics")}
          description={t("app_analyticsDesc")}
          onClick={() => onNavigate("analytics")}
          className="md:col-span-2 lg:col-span-3"
        />
        <NavCard
          icon={Share2}
          iconAccent="cyan"
          title={t("app_graph")}
          description={t("app_knowledgeGraph")}
          onClick={() => onNavigate("graph")}
          className="md:col-span-2 lg:col-span-3"
        />
        <NavCard
          icon={HelpCircle}
          iconAccent="cyan"
          title={t("app_supportChatTitle", "Support & Help")}
          description={t("app_supportChatDesc")}
          onClick={() => onNavigate("chat")}
          className="md:col-span-2 lg:col-span-3"
        />
        <NavCard
          icon={Folder}
          iconAccent="cyan"
          title={t("app_localFolder")}
          description={t("app_localFolderDesc")}
          onClick={handleOpenFolder}
          className="md:col-span-2 lg:col-span-3 border-dashed ds-border-inactive ds-bg-secondary"
        />
        <NavCard
          icon={Mic}
          iconAccent="cyan"
          title={t("app_voiceLocal")}
          description={t("app_voiceCommandsDesc")}
          onClick={() => onNavigate("voiceLocal")}
          className="md:col-span-2 lg:col-span-3"
        />
        <NavCard
          icon={Users}
          iconAccent="cyan"
          title={t("app_collaborationTitle")}
          description={t("app_collaborationDesc")}
          onClick={() => onNavigate("collaboration")}
          className="md:col-span-3 lg:col-span-4"
        />

        {/* Web Research — AI-powered search modal (previously orphaned). */}
        <NavCard
          icon={Search}
          iconAccent="cyan"
          title={t("app_webResearchTitle", "Web Research")}
          description={t("app_webResearchDesc", "AI-powered search with sources")}
          onClick={() => setShowResearch(true)}
          className="md:col-span-2 lg:col-span-3"
        />

        {/* Forgotten Connections */}
        <motion.div variants={item} className="md:col-span-6 lg:col-span-12">
          <ForgottenConnections
            onSelect={(_id) => {
              onNavigate("bookmarks");
            }}
          />
        </motion.div>
      </motion.div>

      <TemplateModal
        show={showTemplateModal}
        templates={templates}
        onClose={() => {
          mutations.cancel();
          setShowTemplateModal(false);
        }}
        onCreateFromTemplate={handleCreateFromTemplate}
      />

      <ResearchAssistant
        isOpen={showResearch}
        onClose={() => setShowResearch(false)}
      />
      <Suspense fallback={null}>
        <ImportDialog
          isOpen={showImportDialog}
          onClose={() => setShowImportDialog(false)}
        />
      </Suspense>
    </div>
  );
};

export { HomeDashboard };
