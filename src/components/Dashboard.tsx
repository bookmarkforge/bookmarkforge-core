import React, { useState, lazy, Suspense, useEffect, useRef } from "react";
import {
  Network,
  BarChart3,
  X,
  Sparkles,
  Scissors,
  Info,
  Database,
  Upload,
  Download,
} from "lucide-react";
import ExportDialog from "./ExportDialog";
import ImportDialog from "./ImportDialog";
import { P2PSyncModal } from "./sync/P2PSyncModal";
const GraphView = lazy(() => import("./GraphView"));
import { ProgressiveComponent } from "./streaming-hydration/ProgressiveComponent";
import KnowledgeDashboard from "./KnowledgeDashboard";
import { useTranslation } from "react-i18next";
import "../../extension/capture-url.js";

type CaptureUrlApi = {
  createBookmarklet: (baseUrl: string) => string;
};

const captureUrlApi = (globalThis as typeof globalThis & {
  BookmarkForgeCaptureUrl: CaptureUrlApi;
}).BookmarkForgeCaptureUrl;

function createDashboardBookmarklet(baseUrl: string): string {
  if (!captureUrlApi) {
    throw new Error("Capture URL builder is unavailable");
  }
  return captureUrlApi.createBookmarklet(baseUrl);
}

interface DashboardProps {
  onClose: () => void;
}

export const Dashboard: React.FC<DashboardProps> = ({ onClose }) => {
  const [activeTab, setActiveTab] = useState<
    "stats" | "graph" | "clipper" | "data"
  >("stats");
  const { t } = useTranslation();

  const [isImportOpen, setIsImportOpen] = useState(false);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [isP2POpen, setIsP2POpen] = useState(false);

  // H-02 (audit): the bookmarklet opens the capture route with a fragment,
  // never a query string. The captured URL/title/text therefore stay out of
  // CDN/access logs and Referer headers on the initial navigation.
  const clipperCode = createDashboardBookmarklet(window.location.origin);
  const clipperLinkRef = useRef<HTMLAnchorElement>(null);
  // React 19 blocks `javascript:` URLs in the `href` prop ("blocked as a
  // security precaution"), which would kill the draggable bookmarklet. The
  // string is a compile-time constant authored by us (no user input), so
  // setting the raw attribute via a ref is the standard bookmarklet pattern.
  // The anchor only mounts when the clipper tab is active, so the effect
  // re-runs on tab switch to attach the href then.
  useEffect(() => {
    clipperLinkRef.current?.setAttribute("href", clipperCode);
  }, [clipperCode, activeTab]);

  return (
    <div className="ds-modal-overlay z-50 p-1 md:p-2 lg:p-3 animate-in fade-in duration-300">
      <div className="ds-card w-full max-w-[100vw] max-h-[98vh] shadow-2xl flex flex-col overflow-hidden relative">
        <div className="absolute top-0 start-0 w-full h-1 bg-accent"></div>
        <div className="p-4 md:p-5 flex items-center justify-between gap-4 sticky top-0 z-10 ds-topbar">
          <div className="flex items-center gap-3">
            <h2 className="ds-text-primary text-lg md:text-xl font-semibold flex items-center gap-2 tracking-tight min-w-0 truncate">
              <Sparkles className="size-5 ds-text-accent" />
              {t("intelligenceCenter")}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <div className="hidden md:flex p-1.5 shadow-inner rounded-[var(--radius-item)] ds-bg-secondary border border-[var(--divider)]">
              <button
                onClick={() => setActiveTab("stats")}
                className={`truncate px-3 lg:px-4 py-1.5 flex items-center gap-2 text-[10px] lg:text-xs font-bold uppercase tracking-wider transition-all ${activeTab === "stats" ? "bg-app-card ds-text-accent" : "bg-transparent ds-text-muted"}`}
              >
                <BarChart3 className="size-3.5" /> {t("analytics")}
              </button>
              <button
                onClick={() => setActiveTab("graph")}
                className={`truncate px-3 lg:px-4 py-1.5 flex items-center gap-2 text-[10px] lg:text-xs font-bold uppercase tracking-wider transition-all ${activeTab === "graph" ? "bg-app-card ds-text-accent" : "bg-transparent ds-text-muted"}`}
              >
                <Network className="size-3.5" /> {t("knowledgeGraph")}
              </button>
              <button
                onClick={() => setActiveTab("clipper")}
                className={`truncate px-3 lg:px-4 py-1.5 flex items-center gap-2 text-[10px] lg:text-xs font-bold uppercase tracking-wider transition-all ${activeTab === "clipper" ? "bg-app-card ds-text-accent" : "bg-transparent ds-text-muted"}`}
              >
                <Scissors className="size-3.5" /> {t("webClipper")}
              </button>
              <button
                onClick={() => setActiveTab("data")}
                className={`truncate px-3 lg:px-4 py-1.5 flex items-center gap-2 text-[10px] lg:text-xs font-bold uppercase tracking-wider transition-all ${activeTab === "data" ? "bg-app-card ds-text-accent" : "bg-transparent ds-text-muted"}`}
              >
                <Database className="size-3.5" />{" "}
                {t("app_dataManagement", "Data")}
              </button>
            </div>
            <button
              onClick={onClose}
              className="p-2 ms-2 transition-all shadow-sm rounded-full ds-bg-secondary ds-text-secondary"
              aria-label={t("app_close", "Close")}
            >
              <X className="size-5" />
            </button>
          </div>
        </div>{" "}
        <div className="md:hidden flex flex-wrap p-2 mx-4 mt-2 shadow-inner rounded-[var(--radius-item)] ds-bg-secondary border border-[var(--divider)]">
          <button
            onClick={() => setActiveTab("stats")}
            aria-current={activeTab === "stats" ? "page" : undefined}
            className={`truncate flex-1 min-w-1/4 py-2 flex items-center justify-center gap-1.5 text-[10px] font-bold uppercase tracking-wider transition-all ${activeTab === "stats" ? "bg-app-card ds-text-accent" : "bg-transparent ds-text-muted"}`}
          >
            <BarChart3 className="size-3.5" /> {t("analytics")}
          </button>
          <button
            onClick={() => setActiveTab("graph")}
            aria-current={activeTab === "graph" ? "page" : undefined}
            className={`truncate flex-1 min-w-1/4 py-2 flex items-center justify-center gap-1.5 text-[10px] font-bold uppercase tracking-wider transition-all ${activeTab === "graph" ? "bg-app-card ds-text-accent" : "bg-transparent ds-text-muted"}`}
          >
            <Network className="size-3.5" /> {t("knowledgeGraph")}
          </button>
          <button
            onClick={() => setActiveTab("clipper")}
            aria-current={activeTab === "clipper" ? "page" : undefined}
            className={`truncate flex-1 min-w-1/4 py-2 flex items-center justify-center gap-1.5 text-[10px] font-bold uppercase tracking-wider transition-all ${activeTab === "clipper" ? "bg-app-card ds-text-accent" : "bg-transparent ds-text-muted"}`}
          >
            <Scissors className="size-3.5" /> {t("webClipper")}
          </button>
          <button
            onClick={() => setActiveTab("data")}
            aria-current={activeTab === "data" ? "page" : undefined}
            className={`truncate flex-1 min-w-1/4 py-2 flex items-center justify-center gap-1.5 text-[10px] font-bold uppercase tracking-wider transition-all ${activeTab === "data" ? "bg-app-card ds-text-accent" : "bg-transparent ds-text-muted"}`}
          >
            <Database className="size-3.5" /> {t("app_dataManagement", "Data")}
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 md:p-6 custom-scrollbar bg-app-bg">
          {activeTab === "stats" && <KnowledgeDashboard />}

          {activeTab === "graph" && (
            <div className="h-full min-h-[600px] overflow-hidden shadow-inner ds-surface-secondary border border-[var(--divider)]">
              <ProgressiveComponent priority="low" placeholderHeight={600}>
                <Suspense
                  fallback={
                    <div className="flex items-center justify-center h-full text-[var(--text-muted)] font-medium tracking-wide animate-pulse">
                      {t("app_loadingGraph", "Loading Graph...")}
                    </div>
                  }
                >
                  <GraphView />
                </Suspense>
              </ProgressiveComponent>
            </div>
          )}

          {activeTab === "clipper" && (
            <div className="max-w-xl mx-auto space-y-6 py-8">
              <div className="text-center space-y-4 mb-10">
                <div className="size-24 rounded-[var(--radius-card)] flex items-center justify-center mx-auto ds-icon-tint-cyan">
                  <Scissors className="size-10 ds-text-accent" />
                </div>
                <h3 className="ds-text-primary text-3xl font-semibold tracking-tight line-clamp-2">
                  {t(
                    "bookmarkForgeWebClipper",
                    "BookmarkForge {{webClipper}}",
                    { webClipper: t("webClipper") },
                  )}
                </h3>
                <p className="ds-text-secondary leading-relaxed max-w-md mx-auto">
                  {t("webClipperDesc")}
                </p>
              </div>

              <div className="ds-card p-8 space-y-8 shadow-xl">
                <div className="flex items-start gap-4">
                  <div className="size-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ds-bg-secondary ds-text-accent border border-[var(--state-inactive-border)]">
                    1
                  </div>
                  <p className="text-sm font-medium pt-1.5 ds-text-secondary">
                    {t("dragButton")}
                  </p>
                </div>

                <div className="flex justify-center py-6 ds-surface-secondary border border-[var(--state-inactive-border)]">
                  <a
                    ref={clipperLinkRef}
                    aria-label={t("saveToForge")}
                    className="px-8 py-4 text-white font-bold hover:scale-105 active:scale-95 transition-transform cursor-move flex items-center gap-3 ds-accent-filled ds-shadow-accent"
                    onClick={(e) => e.preventDefault()}
                  >
                    <Scissors className="size-5" />+ {t("saveToForge")}
                  </a>
                </div>

                <div className="flex items-start gap-4">
                  <div className="size-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ds-bg-secondary ds-text-accent border border-[var(--state-inactive-border)]">
                    2
                  </div>
                  <p className="text-sm font-medium pt-1.5 ds-text-secondary">
                    {t("clipperStep2")}
                  </p>
                </div>

                <div className="ds-card p-5 flex items-start gap-3 ds-bg-hover ds-border-accent-glow">
                  <Info className="size-5 mt-0.5 shrink-0 ds-text-accent" />
                  <p className="text-xs leading-relaxed font-medium ds-text-secondary">
                    {t("clipperNote")}
                  </p>
                </div>
              </div>
            </div>
          )}
          {activeTab === "data" && (
            <div className="max-w-4xl mx-auto py-8 space-y-10">
              <div className="text-center space-y-4">
                <div className="size-24 rounded-[var(--radius-card)] flex items-center justify-center mx-auto ds-icon-tint-cyan">
                  <Database className="size-10 ds-text-accent" />
                </div>
                <h3 className="ds-text-primary text-3xl font-semibold tracking-tight line-clamp-2">
                  {t("app_dataSovereignty", "Sovereignty Management")}
                </h3>
                <p className="ds-text-secondary max-w-lg mx-auto font-medium">
                  {t(
                    "app_dataSovereigntyDesc",
                    "Import and export your knowledge freely. Your digital brain has no borders.",
                  )}
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Import Card */}
                <div className="p-8 transition-all group card-inactive">
                  <div className="flex items-center gap-5 mb-8">
                    <div className="size-14 rounded-[var(--radius-widget)] flex items-center justify-center group-hover:scale-110 transition-all ds-icon-tint-cyan">
                      <Upload className="size-7 ds-text-accent" />
                    </div>
                    <div>
                      <h4 className="ds-text-primary text-xl font-semibold tracking-tight line-clamp-2">
                        {t("app_importData", "Import")}
                      </h4>
                      <p className="ds-text-secondary text-sm font-medium mt-1">
                        {t(
                          "app_importDataDesc",
                          "Load data from Notion or CSV",
                        )}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => setIsImportOpen(true)}
                    className="truncate w-full py-3.5 font-bold text-sm transition-colors shadow-sm ds-bg-secondary ds-text-primary border border-[var(--state-inactive-border)]"
                    aria-label={t("app_openImporter", "Open Importer")}
                  >
                    {t("app_openImporter", "Open Importer")}
                  </button>
                </div>

                {/* Export Card */}
                <div className="p-8 transition-all group ds-radius-card ds-bg-card ds-border-inactive">
                  <div className="flex items-center gap-5 mb-8">
                    {" "}
                    <div className="size-14 rounded-[var(--radius-widget)] flex items-center justify-center group-hover:scale-110 transition-all ds-icon-tint-cyan">
                      <Download
                        className="size-7 ds-text-accent"
                        aria-hidden="true"
                      />
                    </div>
                    <div>
                      <h4
                        className="ds-text-primary text-xl font-semibold tracking-tight line-clamp-2"
                        id="export-heading"
                      >
                        {t("app_exportData", "Export")}
                      </h4>
                      <p className="ds-text-secondary text-sm font-medium mt-1">
                        {t(
                          "app_exportDataDesc",
                          "Export data to Notion, Obsidian or PDF",
                        )}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => setIsExportOpen(true)}
                    className="truncate w-full py-3.5 font-bold text-sm transition-colors shadow-sm ds-bg-secondary ds-text-primary border border-[var(--state-inactive-border)]"
                    aria-label={t("app_openExporter", "Open Exporter")}
                  >
                    {t("app_openExporter", "Open Exporter")}
                  </button>
                </div>

                {/* P2P Sync Card */}
                <div className="md:col-span-2 p-8 transition-all group ds-radius-card ds-accent-hover-border">
                  <div className="flex flex-col sm:flex-row items-center gap-6 mb-6 text-center sm:text-start">
                    <div className="size-16 rounded-[var(--radius-widget)] flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform shadow-sm ds-icon-tint-cyan">
                      <Network className="size-8 ds-text-accent" />
                    </div>
                    <div>
                      <h4 className="ds-text-primary text-xl font-semibold tracking-tight mb-2 line-clamp-2">
                        {t("app_p2pSyncBtn", "Secure P2P Sync")}
                      </h4>
                      <p className="ds-text-secondary text-sm font-medium max-w-md leading-relaxed">
                        {t(
                          "app_p2pSyncBtnDesc",
                          "Sync in real-time with another device on your local network via WebRTC. Zero servers. Zero footprint.",
                        )}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => setIsP2POpen(true)}
                    className="truncate w-full py-4 text-white font-bold text-sm transition-transform hover:scale-[1.02] active:scale-[0.98] shadow-md ds-accent-filled ds-shadow-accent"
                  >
                    {t("app_startP2P", "Start Local Connection")}
                  </button>
                </div>
              </div>

              <div className="p-5 flex items-start gap-4 ds-badge-warning-soft ds-radius-card">
                <Info className="size-5 mt-0.5 shrink-0 ds-text-warning" />
                <p className="text-sm leading-relaxed font-medium ds-text-warning">
                  <strong className="font-bold">{t("app_tip", "Tip:")}</strong>{" "}
                  {t(
                    "app_exportTip",
                    "You can export in JSON format compatible with Notion to migrate your entire knowledge base in seconds.",
                  )}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      <ImportDialog
        isOpen={isImportOpen}
        onClose={() => setIsImportOpen(false)}
      />
      <ExportDialog
        isOpen={isExportOpen}
        onClose={() => setIsExportOpen(false)}
      />
      <P2PSyncModal isOpen={isP2POpen} onClose={() => setIsP2POpen(false)} />
    </div>
  );
};
