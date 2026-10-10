import React, { useState, useRef, useEffect } from "react";
import {
  Share2,
  Copy,
  Check,
  Shield,
  Users,
  Wifi,
  WifiOff,
} from "lucide-react";
import { collaborationService } from "../services/CollaborationService";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useRxDB } from "../hooks/useRxDB";
import { sanitizeUrl } from "../services/SanitizationService";
import { useGuardedAction } from "../hooks/useGuardedAction";
import { useGuardedDataLoad } from "../hooks/useGuardedDataLoad";

export const Collaboration: React.FC = () => {
  const { t } = useTranslation();
  const db = useRxDB();
  const locationSearch =
    typeof window !== "undefined"
      ? sanitizeUrl(window.location.search)
      : "";
  const locationHash =
    typeof window !== "undefined"
      ? window.location.hash.replace(/[<>"']/g, "")
      : "";
  const [sharePassword, setSharePassword] = useState("");
  const [sharePayload, setSharePayload] = useState("");
  const [importPayload, setImportPayload] = useState("");
  const [importPassword, setImportPassword] = useState("");
  const [copied, setCopied] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const ownsSyncRef = useRef(false);

  // Each flow keeps its own guard (share / import / sync are independent
  // sessions — starting one must never invalidate another), migrated to the
  // helper family: the in-flight refs become blockReentry, the loading flags
  // become isRunning, and the URL-room sync start is a useGuardedDataLoad
  // whose signal aborts the session start on unmount or supersede.
  const share = useGuardedAction<string | null>({
    onSuccess: (payload) => {
      if (payload) {
        setSharePayload(payload);
        toast.success(t("app_sharePayloadGenerated"));
      }
    },
    onError: (error) => {
      if (!(error instanceof Error && error.name === "AbortError")) {
        toast.error(t("app_importFailed"));
      }
    },
  });
  const importVault = useGuardedAction<boolean>({
    onSuccess: (success) => {
      if (success) {
        toast.success(t("app_vaultImportedSuccessfully"));
        ownsSyncRef.current = true;
        setIsSyncing(true);
      } else {
        toast.error(t("app_importFailed"));
      }
    },
  });
  const syncLoad = useGuardedDataLoad<void>(
    async (signal) => {
      const roomId = new URLSearchParams(locationSearch).get("room");
      const secretValue = new URLSearchParams(
        locationHash.replace(/^#/, ""),
      ).get("secret");
      const roomSecret =
        secretValue && /^[0-9a-f]{64}$/i.test(secretValue)
          ? secretValue
          : undefined;
      if (!roomId || !roomSecret) {return;}
      await collaborationService.start(db, roomId, roomSecret, signal);
    },
    {
      autoLoad: false,
      initialLoading: false,
      onSuccess: () => setIsSyncing(true),
      onError: (error) => {
        if (!(error instanceof Error && error.name === "AbortError")) {
          toast.error(t("app_importFailed"));
        }
      },
    },
  );
  const isGeneratingShare = share.isRunning;
  const isImporting = importVault.isRunning;

  const handleGenerateShare = async () => {
    if (!sharePassword) {
      toast.error(t("app_masterPasswordRequired"));
      return;
    }
    await share.runWithSignal(async (signal) => {
      return collaborationService.generateSharePayload(
        sharePassword,
        signal,
      );
    });
  };

  const handleImportShare = async () => {
    if (!importPayload || !importPassword) {
      toast.error(t("app_missingFields"));
      return;
    }
    await importVault.runWithSignal(async (signal) => {
      return collaborationService.importSharedVault(
        importPayload,
        importPassword,
        db,
        signal,
      );
    });
  };

  const copyTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    const roomId = new URLSearchParams(locationSearch).get("room");
    const secretValue = new URLSearchParams(
      locationHash.replace(/^#/, ""),
    ).get("secret");
    const roomSecret =
      secretValue && /^[0-9a-f]{64}$/i.test(secretValue)
        ? secretValue
        : undefined;
    if (!roomId || !roomSecret) {return;}

    ownsSyncRef.current = true;
    void syncLoad.load();
    return () => {
      // A newer load (or unmount) already aborts the in-flight start via the
      // guard signal; stopping the owned session is the only cleanup needed.
      if (ownsSyncRef.current) {
        ownsSyncRef.current = false;
        void collaborationService.stop();
      }
    };
  }, [syncLoad.load, db, locationHash, locationSearch]);

  useEffect(() => {
    return () => {
      share.cancel();
      importVault.cancel();
      if (ownsSyncRef.current) {
        ownsSyncRef.current = false;
        void collaborationService.stop();
      }
    };
  }, [share.cancel, importVault.cancel]);

  useEffect(() => {
    return () => clearTimeout(copyTimerRef.current);
  }, []);

  const copyToClipboard = () => {
    navigator.clipboard.writeText(sharePayload);
    setCopied(true);
    clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => setCopied(false), 2000);
    toast.success(t("app_copiedToClipboard"));
  };

  return (
    <div className="space-y-8 max-w-2xl mx-auto p-6">
      <div className="flex items-center gap-3 mb-6">
        <div className="p-2 rounded-lg ds-bg-accent-soft">
          <Users className="size-6 ds-text-accent" />
        </div>
        <div>
          <h1 className="ds-h2">{t("app_collaborationTitle")}</h1>
          <p className="text-sm ds-text-secondary">
            {t("app_collaborationDesc")}
          </p>
        </div>
      </div>

      {/* Sync Status */}
      <div className="p-6 rounded-3xl shadow-xl relative overflow-hidden ds-bg-accent-primary ds-shadow-accent-xl">
        <div className="absolute top-0 end-0 p-8 opacity-10">
          <Shield className="size-32" />
        </div>

        <div className="relative z-10 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-[#04121f]">
                {isSyncing ? (
                  <Wifi className="size-6 text-white animate-pulse" />
                ) : (
                  <WifiOff className="size-6 text-white/70" />
                )}
              </div>
              <div>
                <h2 className="font-semibold tracking-tight text-xl text-[var(--text-on-accent)]">
                  {isSyncing ? t("app_syncActive") : t("app_syncInactive")}
                </h2>
                <div className="flex items-center gap-2 text-xs font-bold text-[var(--text-on-accent)] uppercase tracking-widest">
                  <Shield className="size-3" />
                  <span>{t("app_zeroKnowledgeBranding")}</span>
                </div>
              </div>
            </div>
            {isSyncing && (
              <div className="px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-tighter ds-bg-white-20">
                {t("app_encryptedEndToEnd")}
              </div>
            )}
          </div>

          <p className="text-sm text-[var(--text-on-accent)] max-w-md leading-relaxed">
            {t("app_collaborationBrandingDesc")}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Generate Share */}
        <div className="p-6 rounded-2xl space-y-4 ds-card">
          <h2 className="ds-label-section flex items-center gap-2 ds-text-primary min-w-0 line-clamp-2">
            <Share2 className="size-4" /> {t("app_shareBookmark")}
          </h2>
          <p className="text-xs ds-text-muted">{t("app_collaborationDesc")}</p>
          <input
            type="password"
            aria-label={t("app_masterPassword")}
            placeholder={t("app_masterPassword")}
            className="w-full px-4 py-2 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/30 ds-bg-secondary ds-text-primary"
            value={sharePassword}
            onChange={(e) => setSharePassword(e.target.value)}
          />
          <button
            onClick={handleGenerateShare}
            disabled={isGeneratingShare}
            className="truncate btn-primary w-full py-2 disabled:opacity-50"
          >
            {t("app_share")}
          </button>

          {sharePayload && (
            <div className="mt-4 p-3 rounded-lg relative group ds-bg-secondary">
              <p className="text-[10px] font-mono break-all line-clamp-3 ds-text-muted">
                {sharePayload}
              </p>
              <button
                onClick={copyToClipboard}
                className="truncate absolute top-2 end-2 p-1.5 rounded-md shadow-sm opacity-0 group-hover:opacity-100 transition-opacity ds-bg-card"
              >
                {copied ? (
                  <Check className="size-3 ds-text-success" />
                ) : (
                  <Copy className="size-3" />
                )}
              </button>
            </div>
          )}
        </div>

        {/* Import Share */}
        <div className="p-6 rounded-2xl space-y-4 ds-card">
          <h2 className="ds-label-section flex items-center gap-2 ds-text-primary min-w-0 line-clamp-2">
            <Users className="size-4" /> {t("app_importData")}
          </h2>
          <p className="text-xs ds-text-muted">{t("app_p2pSyncDesc")}</p>
          <textarea
            aria-label={t("app_roomIdPlaceholder")}
            placeholder={t("app_roomIdPlaceholder")}
            className="w-full px-4 py-2 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/30 h-20 resize-none ds-bg-secondary ds-text-primary"
            value={importPayload}
            onChange={(e) => setImportPayload(e.target.value)}
          />
          <input
            type="password"
            aria-label={t("app_masterPassword")}
            placeholder={t("app_masterPassword")}
            className="w-full px-4 py-2 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/30 ds-bg-secondary ds-text-primary"
            value={importPassword}
            onChange={(e) => setImportPassword(e.target.value)}
          />
          <button
            onClick={handleImportShare}
            disabled={isImporting}
            className="truncate btn-primary-outline w-full py-2 disabled:opacity-50"
          >
            {t("app_import")}
          </button>
        </div>
      </div>
    </div>
  );
};
