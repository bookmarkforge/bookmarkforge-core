import {
  Routes,
  Route,
  Navigate,
  useNavigate,
  useLocation,
} from "react-router";
import { motion, AnimatePresence } from "motion/react";
import { RouteErrorBoundary } from "../errors/RouteErrorBoundary";
import { SuspenseFallback } from "../SuspenseFallback";
import {
  HomeDashboard,
  BlockEditor,
  DocumentManager,
  BookmarksTable,
  SupportChat,
  Chat,
  GraphView,
  CanvasView,
  SharedDocumentView,
  KnowledgeDashboard,
  SecurityDashboard,
  Collaboration,
  VoiceCommandCenterWrapper,
  Settings,
  DatabaseView,
  KanbanView,
  CalendarView,
  ListView,
  GalleryView,
  TimelineView,
  PrivacyPage,
} from "./lazyComponents";
import { Suspense } from "react";
import { useTranslation } from "react-i18next";

interface AppRoutesProps {
  currentDocId: string;
  onNavigate: (tab: string) => void;
  onSelectDocument: (id: string) => void;
  onChatSelectSource: (type: "document" | "bookmark", id: string) => void;
  onVoiceSearch: () => void;
  onVoiceNavigate: (p: string) => void;
  onVoiceAction: (
    action: string,
    params: Record<string, unknown>,
  ) => Promise<void>;
}

export function AppRoutes({
  currentDocId,
  onNavigate,
  onSelectDocument,
  onChatSelectSource,
  onVoiceSearch,
  onVoiceNavigate,
  onVoiceAction,
}: AppRoutesProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  return (
    <Suspense fallback={<SuspenseFallback />}>
      <AnimatePresence mode="wait">
        <motion.div
          key={location.pathname}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          transition={{ duration: 0.2, ease: "easeInOut" }}
        >
          <Routes location={location}>
            <Route
              path="/"
              element={
                <RouteErrorBoundary>
                  <HomeDashboard
                    onNavigate={onNavigate}
                    onSelectDocument={onSelectDocument}
                  />
                </RouteErrorBoundary>
              }
            />
            {/* /app is the canonical app entry and renders the same dashboard
                so refreshes and PWA launches stay in-app. */}
            <Route
              path="/app"
              element={
                <RouteErrorBoundary>
                  <HomeDashboard
                    onNavigate={onNavigate}
                    onSelectDocument={onSelectDocument}
                  />
                </RouteErrorBoundary>
              }
            />
            <Route
              path={t("routeEditor", "/editor")}
              element={
                <RouteErrorBoundary showReset>
                  {/* onSelectDocument wires Backlinks clicks to real document
                      navigation (setCurrentDocId + editor tab) — the Backlinks
                      panel previously received a dead no-op. */}
                  <BlockEditor
                    documentId={currentDocId}
                    onSelectDocument={onSelectDocument}
                  />
                </RouteErrorBoundary>
              }
            />
            <Route
              path={t("routeDocuments", "/documents")}
              element={
                <RouteErrorBoundary showReset>
                  <div className="w-full h-full overflow-auto">
                    <DocumentManager onSelectDocument={onSelectDocument} />
                  </div>
                </RouteErrorBoundary>
              }
            />
            <Route
              path={t("routeBookmarks", "/bookmarks")}
              element={
                <RouteErrorBoundary showReset>
                  <BookmarksTable />
                </RouteErrorBoundary>
              }
            />
            <Route
              path={t("routeChat", "/chat")}
              element={
                <RouteErrorBoundary showReset>
                  <div className="max-w-3xl mx-auto p-4 md:p-8 h-full">
                    <SupportChat />
                  </div>
                </RouteErrorBoundary>
              }
            />
            <Route
              path={t("routeGraph", "/graph")}
              element={
                <RouteErrorBoundary showReset>
                  <GraphView />
                </RouteErrorBoundary>
              }
            />
            <Route
              path={t("routeCanvas", "/canvas")}
              element={
                <RouteErrorBoundary showReset>
                  <CanvasView />
                </RouteErrorBoundary>
              }
            />
            <Route
              path={t("routeShared", "/shared")}
              element={
                <RouteErrorBoundary showReset>
                  <div className="max-w-4xl mx-auto p-4 md:p-8 h-full">
                    <SharedDocumentView
                      onBack={() => onNavigate("dashboard")}
                    />
                  </div>
                </RouteErrorBoundary>
              }
            />
            <Route
              path={t("routeChatLocal", "/chatLocal")}
              element={
                <RouteErrorBoundary showReset>
                  <div className="flex items-center justify-center min-h-[400px] md:min-h-[500px] h-full p-4">
                    <Chat onSelectSource={onChatSelectSource} />
                  </div>
                </RouteErrorBoundary>
              }
            />
            <Route
              path={t("routeAnalytics", "/analytics")}
              element={
                <RouteErrorBoundary showReset>
                  <div className="max-w-4xl mx-auto p-4 md:p-8 h-full">
                    <KnowledgeDashboard />
                  </div>
                </RouteErrorBoundary>
              }
            />
            {/* Vault security health. Its own destination (sidebar tab +
                /security) so it is reachable without opening Settings; the
                "Security Settings" action navigates to the settings route
                instead of scrolling. */}
            <Route
              path="/security"
              element={
                <RouteErrorBoundary showReset>
                  <div className="max-w-4xl mx-auto p-4 md:p-8 h-full">
                    <SecurityDashboard
                      onOpenSettings={() => onNavigate("settings")}
                    />
                  </div>
                </RouteErrorBoundary>
              }
            />
            <Route
              path={t("routeCollaboration", "/collaboration")}
              element={
                <RouteErrorBoundary showReset>
                  <div className="max-w-4xl mx-auto p-4 md:p-8 h-full">
                    <Collaboration />
                  </div>
                </RouteErrorBoundary>
              }
            />
            <Route
              path={t("routeVoiceLocal", "/voiceLocal")}
              element={
                <RouteErrorBoundary showReset>
                  <Suspense
                    fallback={
                      <div className="flex items-center justify-center min-h-[400px] md:min-h-[500px]">
                        <div className="animate-spin rounded-full size-8 border-b-2 border-[var(--divider)]" />
                      </div>
                    }
                  >
                    <div className="flex items-center justify-center min-h-[400px] md:min-h-[500px] h-full p-4">
                      <VoiceCommandCenterWrapper
                        onSearch={onVoiceSearch}
                        onNavigate={onVoiceNavigate}
                        onAction={onVoiceAction}
                      />
                    </div>
                  </Suspense>
                </RouteErrorBoundary>
              }
            />
            <Route
              path={t("routeSettings", "/settings")}
              element={
                <RouteErrorBoundary showReset>
                  <Settings onClose={() => navigate("/app")} />
                </RouteErrorBoundary>
              }
            />
            <Route
              path={t("routeDatabase", "/database")}
              element={
                <RouteErrorBoundary showReset>
                  <div className="max-w-5xl mx-auto p-4 md:p-8 h-full">
                    {/* P91: wire the view to the real bookmarks collection —
                        DatabaseView reads it reactively (no demo data, no
                        permanently-empty page).
                        P94: the bookmark schema                        requires url/urlHash/processed/isPrivate/isDeleted —
                        without these defaults every "New" upsert fails RxDB
                        validation and nothing ever persists. timestamps are
                        stamped at click time. */}
                    <DatabaseView
                      collection="bookmarks"
                      schema={{}}
                      newRecordDefaults={{
                        url: "",
                        urlHash: "",
                        processed: false,
                        isPrivate: false,
                        isDeleted: false,
                      }}
                    />
                  </div>
                </RouteErrorBoundary>
              }
            />
            <Route
              path={t("routeKanban", "/kanban")}
              element={
                <RouteErrorBoundary showReset>
                  <div className="max-w-6xl mx-auto p-4 md:p-8 h-full">
                    {/* P92: no hardcoded empty columns — the view reads real
                        documents grouped by folders reactively. */}
                    <KanbanView />
                  </div>
                </RouteErrorBoundary>
              }
            />
            <Route
              path={t("routeCalendar", "/calendar")}
              element={
                <RouteErrorBoundary showReset>
                  <div className="max-w-5xl mx-auto p-4 md:p-8 h-full">
                    {/* P92: no hardcoded empty events — the view reads real
                        documents by createdAt reactively. */}
                    <CalendarView />
                  </div>
                </RouteErrorBoundary>
              }
            />
            <Route
              path={t("routeList", "/list")}
              element={
                <RouteErrorBoundary showReset>
                  <div className="max-w-5xl mx-auto p-4 md:p-8 h-full">
                    <ListView
                      onSelectDocument={onSelectDocument}
                      onSelectBookmark={() => onNavigate("bookmarks")}
                    />
                  </div>
                </RouteErrorBoundary>
              }
            />
            <Route
              path={t("routeGallery", "/gallery")}
              element={
                <RouteErrorBoundary showReset>
                  <div className="max-w-6xl mx-auto p-4 md:p-8 h-full">
                    <GalleryView
                      onSelectDocument={onSelectDocument}
                      onSelectBookmark={() => onNavigate("bookmarks")}
                    />
                  </div>
                </RouteErrorBoundary>
              }
            />
            <Route
              path={t("routeTimeline", "/timeline")}
              element={
                <RouteErrorBoundary showReset>
                  <div className="max-w-4xl mx-auto p-4 md:p-8 h-full">
                    <TimelineView
                      onSelectDocument={onSelectDocument}
                      onSelectBookmark={() => onNavigate("bookmarks")}
                    />
                  </div>
                </RouteErrorBoundary>
              }
            />
            {/* Legal pages — available both as static HTML and in-app routes */}
            <Route
              path="/privacy"
              element={
                <RouteErrorBoundary showReset>
                  <PrivacyPage onBack={() => navigate("/app")} />
                </RouteErrorBoundary>
              }
            />
            <Route
              path="/terms"
              element={
                <RouteErrorBoundary showReset>
                  <PrivacyPage onBack={() => navigate("/app")} />
                </RouteErrorBoundary>
              }
            />
            <Route path="*" element={<Navigate to="/app" replace />} />
          </Routes>
        </motion.div>
      </AnimatePresence>
    </Suspense>
  );
}
