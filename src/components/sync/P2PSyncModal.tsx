import React, { useState, useEffect, useRef, useMemo, lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import {
  X,
  Smartphone,
  Monitor,
  Scan,
  Wifi,
  Shield,
  Loader2,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Lightbulb,
} from "lucide-react";
import { motion } from "motion/react";
import type { SyncState } from "../../services/WebRTCSyncService";
import { ProRequiredState } from "../ProRequiredState";
import {
  loadWebRTCSyncService,
  type WebRTCSyncServiceType,
} from "../../services/pro-access";
import type { IScannerControls } from "@zxing/browser";

import { useFocusTrap } from "../../hooks/useFocusTrap";
import { useGuardedActions } from "../../hooks/useGuardedActions";

const LazyQRCode = lazy(() => import("react-qr-code"));

interface P2PSyncModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type Role = "none" | "host" | "client";

export const P2PSyncModal: React.FC<P2PSyncModalProps> = ({
  isOpen,
  onClose,
}) => {
  const { t } = useTranslation();
  // Graceful fallback for engines without the WebRTC API (e.g. some WebKit
  // builds): the role chooser is replaced by an explanatory banner instead of
  // letting the flows throw a raw ReferenceError.
  // P2P sync is a Pro feature: the implementation is resolved behind the
  // hasProAccess gate when the modal opens. `webrtcUnsupported` keeps its
  // free-engine meaning (browser without the WebRTC API); a Free user gets
  // the same graceful degradation through `proRequired` — an explanation
  // banner plus the upgrade CTA instead of a dead modal.
  const webrtcUnsupported = useMemo(
    () => typeof globalThis.RTCPeerConnection === "undefined",
    [],
  );
  const [role, setRole] = useState<Role>("none");
  const [syncState, setSyncState] = useState<SyncState>("disconnected");
  const [proState, setProState] = useState<
    "probing" | "unavailable" | "ready"
  >("probing");
  const serviceRef = useRef<WebRTCSyncServiceType | null>(null);
  const proRequired = !webrtcUnsupported && proState === "unavailable";

  useEffect(() => {
    if (!isOpen || webrtcUnsupported) {return;}
    let cancelled = false;
    loadWebRTCSyncService()
      .then((service) => {
        if (cancelled) {return;}
        serviceRef.current = service;
        setProState("ready");
      })
      .catch(() => {
        if (cancelled) {return;}
        setProState("unavailable");
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, webrtcUnsupported]);
  const [errorMessage, setErrorMessage] = useState("");
  const [progress, setProgress] = useState(0);
  const [encodedSDP, setEncodedSDP] = useState(""); // Host Offer or Client Answer

  const videoRef = useRef<HTMLVideoElement>(null);
  const scannerControls = useRef<IScannerControls | null>(null);
  // host/scanAnswer/client share ONE guard: the camera session stops at the
  // first QR code, so each flow is a terminal operation — the scanAnswer/
  // client operations resolve with the decoded text and their onSuccess
  // handles it (gated by the guard, so a stale decode after a newer flow or
  // modal close is dropped exactly like the old generation checks).
  // cancelFlow on close/cleanup invalidates a pending session so a reopen
  // never hits the blockReentry no-op.
  const {
    host: hostAction,
    scanAnswer: scanAnswerAction,
    client: clientAction,
    cancel: cancelFlow,
  } = useGuardedActions<{
    host: string;
    scanAnswer: string;
    client: string;
  }>({
    host: {
      blockReentry: false,
      onSuccess: (offerStr) => setEncodedSDP(offerStr),
      onError: (err) =>
        setErrorMessage(err instanceof Error ? err.message : String(err)),
    },
    scanAnswer: {
      blockReentry: false,
      onSuccess: (result) => serviceRef.current?.processClientAnswer(result),
      onError: (err) =>
        setErrorMessage(err instanceof Error ? err.message : String(err)),
    },
    client: {
      blockReentry: false,
      onSuccess: (answerStr) => {
        setEncodedSDP(answerStr);
        setSyncState("ready_to_share");
      },
      onError: (err) =>
        setErrorMessage(err instanceof Error ? err.message : String(err)),
    },
  });

  useEffect(() => {
    if (proState !== "ready") {return;}
    const service = serviceRef.current;
    if (!service) {return;}
    // The service is a singleton: after unmount its callbacks would keep
    // firing on a component that is gone, so swallow them via `cancelled`.
    let cancelled = false;
    service.registerCallbacks(
      (state, msg) => {
        if (cancelled) {return;}
        setSyncState(state);
        if (state === "error" && msg) {setErrorMessage(msg);}
      },
      (p) => {
        if (cancelled) {return;}
        setProgress(p);
      },
    );

    return () => {
      cancelled = true;
      stopScanner();
      cancelFlow();
      service.disconnect();
    };
  }, [proState]);

  const handleClose = () => {
    stopScanner();
    cancelFlow();
    serviceRef.current?.disconnect();
    setRole("none");
    setSyncState("disconnected");
    setProgress(0);
    setEncodedSDP("");
    setErrorMessage("");
    onClose();
  };

  const stopScanner = () => {
    if (scannerControls.current) {
      scannerControls.current.stop();
      scannerControls.current = null;
    }
  };

  // Camera session: resolves with the decoded text at the first QR code
  // (the reader stops there), rejects on camera failure or abort. The caller
  // flow checks the guard's signal after the session so a decode that
  // outlived a newer flow / modal close is dropped.
  const startScannerSession = (
    signal: AbortSignal,
  ): Promise<string> =>
    (async () => {
      const { BrowserQRCodeReader } = await import("@zxing/browser");
      const codeReader = new BrowserQRCodeReader();
      return new Promise<string>((resolve, reject) => {
        codeReader
          .decodeFromVideoDevice(
            undefined,
            videoRef.current!,
            (result, _error, controls) => {
              if (result) {
                controls.stop();
                if (signal.aborted) {
                  reject(new DOMException("Aborted", "AbortError"));
                } else {
                  resolve(result.getText());
                }
              }
            },
          )
          .then((controls) => {
            scannerControls.current = controls;
          })
          .catch(reject);
      });
    })();

  // --- HOST FLOW ---
  const startHostFlow = () => {
    if (webrtcUnsupported) {
      setErrorMessage(
        t(
          "app_p2pUnsupported",
          "WebRTC is not supported by this browser, so P2P sync is unavailable.",
        ),
      );
      return;
    }
    const service = serviceRef.current;
    if (!service) {return;} // gated state; the entry buttons are disabled
    setRole("host");
    setErrorMessage("");
    void hostAction.run(async () => service.startHost());
  };

  const hostScanAnswer = () => {
    setSyncState("connecting"); // Update UI to show scanner
    void scanAnswerAction.runWithSignal(async (signal) => {
      const result = await startScannerSession(signal);
      if (signal.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }
      return result;
    });
  };

  // --- CLIENT FLOW ---
  const startClientFlow = () => {
    if (webrtcUnsupported) {
      setErrorMessage(
        t(
          "app_p2pUnsupported",
          "WebRTC is not supported by this browser, so P2P sync is unavailable.",
        ),
      );
      return;
    }
    const service = serviceRef.current;
    if (!service) {return;} // gated state; the entry buttons are disabled
    setRole("client");
    setErrorMessage("");
    setSyncState("connecting"); // Update UI to show scanner
    void clientAction.runWithSignal(async (signal) => {
      const result = await startScannerSession(signal);
      if (signal.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }
      return service.startClient(result);
    });
  };

  const trapRef = useFocusTrap(isOpen);

  if (!isOpen) {return null;}

  return (
    <div
      className="ds-modal-overlay z-[600] p-4 font-sans"
      role="dialog"
      aria-modal="true"
      aria-label={t("app_p2pSyncTitle")}
    >
      <motion.div
        ref={trapRef}
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="w-full max-w-xl rounded-[32px] shadow-2xl overflow-hidden flex flex-col ds-card"
      >
        <div className="p-6 flex items-center justify-between ds-divider-b">
          <div className="flex items-center gap-3">
            <div className="size-10 rounded-xl flex items-center justify-center ds-icon-tint-cyan">
              <Wifi className="size-5 ds-text-accent" />
            </div>
            <div>
              <h2 className="ds-h2 truncate">
                {t("app_p2pSyncTitle", "Secure P2P Sync")}
              </h2>
              <p className="text-xs font-medium flex items-center gap-1.5 ds-text-muted">
                <Shield className="size-3 ds-text-success" />
                {t("app_airGapped", "Direct Local Connection (Air-Gapped)")}
              </p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="ds-ghost-btn-icon"
            aria-label={t("app_close", "Close")}
          >
            <X className="size-5" />
          </button>
        </div>

        <div className="p-6 md:p-8 flex-1 bg-app-bg">
          {role === "none" && (
            <div className="space-y-6">
              <p className="text-sm font-medium text-center max-w-md mx-auto leading-relaxed ds-text-secondary">
                {t(
                  "app_p2pSyncDesc",
                  "Sync your data between devices instantly by scanning a QR code. Data never goes through the internet.",
                )}
              </p>

              {/* Same-LAN requirement: pairing is LAN-only by design
                  (iceServers: []), so devices on different networks — most
                  commonly a phone on mobile data — can never connect. Say so
                  up front, where the user picks a role, not only as an error
                  after a failed attempt. */}
              <div
                role="note"
                aria-label={t("app_p2pLanWarningTitle")}
                className="flex items-start gap-3 p-4 ds-bg-warning-soft border ds-border-warning rounded-xl"
              >
                <AlertTriangle className="size-5 ds-text-warning shrink-0 mt-0.5" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold ds-text-warning leading-snug">
                    {t(
                      "app_p2pLanWarningTitle",
                      "Both devices must be on the same Wi-Fi network",
                    )}
                  </p>
                  <p className="text-sm ds-text-warning/80 mt-1 leading-relaxed">
                    {t(
                      "app_p2pLanWarningBody",
                      "This sync works device-to-device over your local network, never through the internet. If the devices are on different networks (for example, one on mobile data), pairing and syncing will fail.",
                    )}
                  </p>
                  <p className="text-xs ds-text-warning/70 mt-2 leading-relaxed flex items-start gap-1.5">
                    <Lightbulb className="size-3.5 shrink-0 mt-0.5" />
                    <span>
                      {t(
                        "app_p2pLanWarningHint",
                        "Tip: turn off mobile data on your phone and connect it to the same Wi-Fi as your computer.",
                      )}
                    </span>
                  </p>
                </div>
              </div>

              {webrtcUnsupported && (
                <div className="flex items-start gap-3 p-4 bg-[var(--danger-soft)] dark:bg-[var(--color-danger)]/10 border border-[var(--danger-soft-border)] dark:border-[var(--danger-soft-border)]/20 rounded-xl">
                  <AlertCircle className="size-5 ds-text-danger shrink-0 mt-0.5" />
                  <div className="text-sm ds-text-danger dark:ds-text-danger font-medium leading-relaxed">
                    {t(
                      "app_p2pUnsupported",
                      "WebRTC is not supported by this browser, so P2P sync is unavailable.",
                    )}
                  </div>
                </div>
              )}

              {proRequired && (
                <ProRequiredState
                  feature="P2P sync"
                  reason="license"
                  variant="banner"
                />
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <button
                  onClick={startHostFlow}
                  disabled={webrtcUnsupported || proState !== "ready"}
                  aria-disabled={webrtcUnsupported || proState !== "ready"}
                  className="truncate flex flex-col items-center justify-center p-6 rounded-2xl transition-all group card-inactive disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <div className="size-14 rounded-xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform ds-icon-tint-cyan">
                    <Monitor className="size-7 ds-text-accent" />
                  </div>
                  <h3 className="font-semibold mb-1 ds-text-primary truncate">
                    {t("app_p2pHost", "This is the host")}
                  </h3>
                  <p className="text-xs font-medium text-center ds-text-muted">
                    {t(
                      "app_p2pHostDesc",
                      "Generate a QR for another device to scan.",
                    )}
                  </p>
                </button>

                <button
                  onClick={startClientFlow}
                  disabled={webrtcUnsupported || proState !== "ready"}
                  aria-disabled={webrtcUnsupported || proState !== "ready"}
                  className="truncate flex flex-col items-center justify-center p-6 rounded-2xl transition-all group card-inactive disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <div className="size-14 rounded-xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform ds-icon-tint-cyan">
                    <Smartphone className="size-7 ds-text-accent" />
                  </div>
                  <h3 className="font-semibold mb-1 ds-text-primary truncate">
                    {t("app_p2pClient", "Link this device")}
                  </h3>
                  <p className="text-xs font-medium text-center ds-text-muted">
                    {t(
                      "app_p2pClientDesc",
                      "Scan the QR shown on your main device.",
                    )}
                  </p>
                </button>
              </div>
            </div>
          )}

          {/* SHARED UI FOR SCANNER AND PROGRESS */}
          {role !== "none" && (
            <div className="flex flex-col items-center justify-center space-y-6">
              {syncState === "gathering" && (
                <div className="flex flex-col items-center py-8">
                  <Loader2 className="size-10 animate-spin mb-4 ds-text-accent" />
                  <p className="font-bold ds-text-primary">
                    {t("app_p2pGenerating", "Generating secure tunnel...")}
                  </p>
                </div>
              )}

              {syncState === "ready_to_share" && encodedSDP && (
                <div className="flex flex-col items-center p-6 rounded-2xl shadow-sm ds-card">
                  <div className="bg-white p-2 rounded-xl">
                    <Suspense fallback={<div className="size-[200px] animate-pulse ds-bg-secondary rounded" />}>
                      <LazyQRCode value={encodedSDP} size={200} level="L" />
                    </Suspense>
                  </div>
                  <p className="text-sm font-bold mt-4 text-center ds-text-primary">
                    {role === "host"
                      ? t(
                          "app_p2pScanMe",
                          "Step 1: Scan this QR with your second device.",
                        )
                      : t(
                          "app_p2pScanMeAnswer",
                          "Step 2: Show this QR to your main device camera.",
                        )}
                  </p>

                  {role === "host" && (
                    <button
                      onClick={hostScanAnswer}
                      className="truncate mt-6 w-full py-3 btn-primary flex items-center justify-center gap-2"
                    >
                      <Scan className="size-4" />
                      {t("app_p2pScanAnswerBtn", "Step 2: Scan answer")}
                    </button>
                  )}
                </div>
              )}

              {syncState === "connecting" && (
                <div className="flex flex-col items-center w-full">
                  <p className="font-bold mb-4 text-center ds-text-primary">
                    {role === "host"
                      ? t(
                          "app_p2pScanAnswer",
                          "Point the camera at the second device QR.",
                        )
                      : t(
                          "app_p2pScanOffer",
                          "Point the camera at the main device QR.",
                        )}
                  </p>
                  <div className="w-full max-w-sm aspect-square bg-black rounded-2xl overflow-hidden relative shadow-inner ds-border">
                    <video
                      ref={videoRef}
                      aria-label={t("aria_qr_scanner", "QR Scanner")}
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute inset-0 border-4 border-dashed m-8 rounded-xl opacity-50 animate-pulse ds-border-accent-primary"></div>
                  </div>
                </div>
              )}

              {syncState === "syncing" && (
                <div className="flex flex-col items-center w-full py-8">
                  <Wifi className="size-12 animate-pulse mb-6 ds-text-accent" />
                  <h3 className="ds-h3 mb-2 truncate">
                    {t("app_p2pSyncing", "Syncing vaults...")}
                  </h3>
                  <div className="w-full max-w-xs h-3 rounded-full overflow-hidden shadow-inner mt-4 ds-bg-muted">
                    <div
                      className="h-full transition-all duration-300 ds-bg-accent"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  <p className="text-sm font-bold mt-3 ds-text-accent">
                    {Math.round(progress)}%
                  </p>
                </div>
              )}

              {syncState === "completed" && (
                <div className="flex flex-col items-center py-8">
                  <div className="size-16 rounded-full flex items-center justify-center mb-4 ds-bg-success-soft">
                    <CheckCircle2 className="size-8 ds-text-success" />
                  </div>
                  <h3 className="ds-h3 mb-2 truncate">
                    {t("app_p2pSuccess", "Sync Successful!")}
                  </h3>
                  <p className="text-sm font-medium ds-text-muted">
                    {t("app_p2pSuccessDesc", "Both devices are up to date.")}
                  </p>
                </div>
              )}

              {errorMessage && (
                <div className="flex items-start gap-3 p-4 bg-[var(--danger-soft)] dark:bg-[var(--color-danger)]/10 border border-[var(--danger-soft-border)] dark:border-[var(--danger-soft-border)]/20 rounded-xl w-full">
                  <AlertCircle className="size-5 ds-text-danger shrink-0" />
                  <p className="text-sm ds-text-danger dark:ds-text-danger font-medium">
                    {errorMessage}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
};
