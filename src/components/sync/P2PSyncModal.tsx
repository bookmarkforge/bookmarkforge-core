import React, { useState, useEffect, useRef, useMemo, lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import {
  X,
  Smartphone,
  Monitor,
  Scan,
  Wifi,
  Shield,
  ShieldCheck,
  Key,
  Loader2,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Lightbulb,
  Copy,
  Check,
} from "lucide-react";
import { motion } from "motion/react";
import type { SyncState } from "../../services/WebRTCSyncService";
import { ProRequiredState } from "../ProRequiredState";
import { toUserErrorMessage } from "../../utils/userFacingError";
// ADR-066: the transfer behind this modal is Pro; the modal resolves it
// through the seam, so a Free session gets the shared Pro panel instead of an
// inert placeholder.
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
type PairingModeChoice = "standard" | "verify" | "code";

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
  // Mutual-pairing UI state (audit 2026-11-05 M2): the host picks the mode,
  // the client follows whatever the scanned offer declares.
  const [pairingMode, setPairingMode] = useState<PairingModeChoice>("standard");
  const [sasCode, setSasCode] = useState<string | null>(null);
  const [awaitingPairingCode, setAwaitingPairingCode] = useState(false);
  const [pairingCodeInput, setPairingCodeInput] = useState("");
  // Camera-less pairing path: users without a working camera copy the SDP
  // blob on one device and paste it on the other. The pairing secret still
  // travels out-of-band ("code" mode) or via the in-band verifier ("verify").
  const [manualOfferInput, setManualOfferInput] = useState("");
  const [manualAnswerInput, setManualAnswerInput] = useState("");
  const [showManualOffer, setShowManualOffer] = useState(false);
  const [showManualAnswer, setShowManualAnswer] = useState(false);
  const [copiedPairingData, setCopiedPairingData] = useState(false);
  const codePromptResolver = useRef<((code: string | null) => void) | null>(
    null,
  );

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
        setErrorMessage(toUserErrorMessage(err, t("app_error", "Error"))),
    },
    scanAnswer: {
      blockReentry: false,
      onSuccess: (result) => serviceRef.current?.processClientAnswer(result),
      onError: (err) =>
        setErrorMessage(toUserErrorMessage(err, t("app_error", "Error"))),
    },
    client: {
      blockReentry: false,
      onSuccess: (answerStr) => {
        setEncodedSDP(answerStr);
        setSyncState("ready_to_share");
      },
      onError: (err) =>
        setErrorMessage(toUserErrorMessage(err, t("app_error", "Error"))),
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
      (event) => {
        if (cancelled) {return;}
        if (event.type === "sas") {
          setSasCode(event.code);
        } else if (event.type === "failed") {
          setErrorMessage(
            toUserErrorMessage(event.message, t("app_error", "Error")),
          );
        }
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
    codePromptResolver.current?.(null);
    codePromptResolver.current = null;
    serviceRef.current?.disconnect();
    setRole("none");
    setSyncState("disconnected");
    setProgress(0);
    setEncodedSDP("");
    setErrorMessage("");
    setSasCode(null);
    setAwaitingPairingCode(false);
    setPairingCodeInput("");
    setManualOfferInput("");
    setManualAnswerInput("");
    setShowManualOffer(false);
    setShowManualAnswer(false);
    setCopiedPairingData(false);
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
    void hostAction.run(async () =>
      service.startHost({
        pairing: pairingMode === "standard" ? undefined : pairingMode,
      }),
    );
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

  // Shared offer handling for the camera and paste paths: the offer declares
  // the host's pairing mode — "code" requires the typed code before the
  // session is armed, anything unexpected fails closed.
  const processOfferText = async (offerText: string, signal: AbortSignal) => {
    const service = serviceRef.current;
    if (!service) {
      throw new Error("Sync service unavailable");
    }
    const offerPairing = service.describeOfferPairing(offerText);
    if (offerPairing === "invalid") {
      throw new Error("Invalid pairing data in the QR code");
    }
    if (offerPairing === "code") {
      const code = await promptForPairingCode();
      if (signal.aborted || code === null) {
        throw new DOMException("Aborted", "AbortError");
      }
      return service.startClient(offerText, { pairingCode: code });
    }
    return service.startClient(offerText);
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
    if (!serviceRef.current) {return;} // gated state; the entry buttons are disabled
    setRole("client");
    setErrorMessage("");
    setSyncState("connecting"); // Update UI to show scanner
    void clientAction.runWithSignal(async (signal) => {
      const offerText = await startScannerSession(signal);
      if (signal.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }
      return processOfferText(offerText, signal);
    });
  };

  // Camera-less client path: the user pastes the offer blob the host copied.
  const submitManualOffer = () => {
    const offerText = manualOfferInput.trim();
    if (!offerText) {return;}
    setRole("client");
    setErrorMessage("");
    setSyncState("connecting");
    void clientAction.runWithSignal(async (signal) =>
      processOfferText(offerText, signal),
    );
  };

  // Camera-less host path: the user pastes the answer blob the client copied.
  // Reuses the scanAnswer guard; onSuccess already routes the text into
  // service.processClientAnswer, identical to a decoded QR.
  const submitManualAnswer = () => {
    const answerText = manualAnswerInput.trim();
    if (!answerText) {return;}
    void scanAnswerAction.run(async () => answerText);
  };

  const copyPairingData = async () => {
    try {
      await navigator.clipboard.writeText(encodedSDP);
      setCopiedPairingData(true);
      setTimeout(() => setCopiedPairingData(false), 2000);
    } catch {
      setErrorMessage(
        t("app_p2pCopyFailed", "Could not copy — select the data manually."),
      );
    }
  };

  /**
   * Show the code-entry screen and resolve with the typed code (or null on
   * cancel/close). The guarded client operation awaits this promise, so the
   * scan→connect sequence stays inside one guard session.
   */
  const promptForPairingCode = (): Promise<string | null> =>
    new Promise((resolve) => {
      codePromptResolver.current?.(null);
      codePromptResolver.current = resolve;
      setAwaitingPairingCode(true);
      setPairingCodeInput("");
    });

  const submitPairingCode = () => {
    const resolver = codePromptResolver.current;
    codePromptResolver.current = null;
    setAwaitingPairingCode(false);
    resolver?.(pairingCodeInput);
  };

  const cancelPairingCodePrompt = () => {
    const resolver = codePromptResolver.current;
    codePromptResolver.current = null;
    setAwaitingPairingCode(false);
    setPairingCodeInput("");
    resolver?.(null);
  };

  const confirmPairingCodes = () => {
    serviceRef.current?.confirmPairing();
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

              {/* Pairing security: the device that shows the first QR picks
                  the mode. "standard" is the classic flow; "verify" embeds a
                  secret in the QR and both screens show a code to compare;
                  "code" additionally requires typing a short code shown on
                  the host. The other device follows the scanned offer. */}
              <fieldset className="space-y-2">
                <legend className="text-xs font-bold uppercase tracking-wide ds-text-muted text-center">
                  {t("app_p2pPairingModeLabel", "Pairing security")}
                </legend>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {(
                    [
                      ["standard", "app_p2pPairingStandard", "QR only", "app_p2pPairingStandardDesc", "Fastest — anyone with the QR can connect"],
                      ["verify", "app_p2pPairingVerify", "QR + verify code", "app_p2pPairingVerifyDesc", "Both devices show a code to compare"],
                      ["code", "app_p2pPairingCode", "QR + pairing code", "app_p2pPairingCodeDesc", "Other device must type a code shown here"],
                    ] as const
                  ).map(([value, labelKey, labelFallback, descKey, descFallback]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setPairingMode(value)}
                      aria-pressed={pairingMode === value}
                      className={`truncate flex flex-col items-start gap-1 p-3 rounded-xl border text-left transition-colors ${
                        pairingMode === value
                          ? "border-[var(--accent-primary)] bg-[var(--accent-soft)]"
                          : "ds-border ds-bg-secondary hover:ds-bg-muted"
                      }`}
                    >
                      <span className="flex items-center gap-1.5 text-sm font-bold ds-text-primary">
                        {value === "standard" ? (
                          <Scan className="size-4 ds-text-muted" />
                        ) : (
                          <ShieldCheck className="size-4 ds-text-accent" />
                        )}
                        {t(labelKey, labelFallback)}
                      </span>
                      <span className="text-[11px] leading-snug ds-text-muted">
                        {t(descKey, descFallback)}
                      </span>
                    </button>
                  ))}
                </div>
              </fieldset>

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

              {/* Camera-less path: paste the offer blob the host copied. */}
              <div className="w-full max-w-sm mx-auto">
                <button
                  onClick={() => setShowManualOffer((v) => !v)}
                  className="w-full text-xs font-semibold ds-text-muted hover:ds-text-primary transition-colors py-2 truncate"
                >
                  {showManualOffer
                    ? t("app_p2pManualHide", "Hide manual pairing")
                    : t(
                        "app_p2pManualToggle",
                        "No camera? Pair by copying data instead",
                      )}
                </button>
                {showManualOffer && (
                  <div className="mt-2 space-y-3 p-4 rounded-2xl ds-card">
                    <textarea
                      value={manualOfferInput}
                      onChange={(e) => setManualOfferInput(e.target.value)}
                      placeholder={t(
                        "app_p2pPasteOfferPlaceholder",
                        "Paste the pairing data shown on the other device",
                      )}
                      aria-label={t(
                        "app_p2pPasteOfferPlaceholder",
                        "Paste the pairing data shown on the other device",
                      )}
                      className="w-full h-24 px-3 py-2 rounded-lg text-xs font-mono resize-none ds-input"
                    />
                    <button
                      onClick={submitManualOffer}
                      disabled={!manualOfferInput.trim()}
                      className="w-full py-2.5 rounded-xl font-bold btn-primary disabled:opacity-50 truncate"
                    >
                      {t("app_p2pConnect", "Connect")}
                    </button>
                  </div>
                )}
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

                  {/* Camera-less pairing: copy the blob, paste it on the other device. */}
                  <button
                    onClick={copyPairingData}
                    className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold ds-text-muted hover:ds-text-primary transition-colors max-w-full"
                  >
                    {copiedPairingData ? (
                      <Check className="size-3.5 ds-text-success shrink-0" />
                    ) : (
                      <Copy className="size-3.5 shrink-0" />
                    )}
                    <span className="truncate">
                      {copiedPairingData
                        ? t("app_copiedToClipboard", "Copied")
                        : t("app_p2pCopyData", "No camera? Copy pairing data")}
                    </span>
                  </button>

                  {role === "host" && (
                    <button
                      onClick={hostScanAnswer}
                      className="truncate mt-6 w-full py-3 btn-primary flex items-center justify-center gap-2"
                    >
                      <Scan className="size-4" />
                      {t("app_p2pScanAnswerBtn", "Step 2: Scan answer")}
                    </button>
                  )}

                  {role === "host" && (
                    <div className="w-full">
                      <button
                        onClick={() => setShowManualAnswer((v) => !v)}
                        className="w-full text-xs font-semibold ds-text-muted hover:ds-text-primary transition-colors py-2 truncate"
                      >
                        {showManualAnswer
                          ? t("app_p2pManualHide", "Hide manual pairing")
                          : t(
                              "app_p2pPasteAnswerToggle",
                              "No camera? Paste the answer instead",
                            )}
                      </button>
                      {showManualAnswer && (
                        <div className="mt-2 space-y-3 p-4 rounded-xl ds-card">
                          <textarea
                            value={manualAnswerInput}
                            onChange={(e) =>
                              setManualAnswerInput(e.target.value)
                            }
                            placeholder={t(
                              "app_p2pPasteAnswerPlaceholder",
                              "Paste the pairing data shown on the other device",
                            )}
                            aria-label={t(
                              "app_p2pPasteAnswerPlaceholder",
                              "Paste the pairing data shown on the other device",
                            )}
                            className="w-full h-24 px-3 py-2 rounded-lg text-xs font-mono resize-none ds-input"
                          />
                          <button
                            onClick={submitManualAnswer}
                            disabled={!manualAnswerInput.trim()}
                            className="w-full py-2.5 rounded-xl font-bold btn-primary disabled:opacity-50 truncate"
                          >
                            {t("app_p2pSubmitPasted", "Submit pasted data")}
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {role === "host" && pairingMode === "code" && (
                    <div className="mt-4 w-full p-4 rounded-xl ds-bg-warning-soft border ds-border-warning text-center">
                      <p className="text-xs font-bold uppercase tracking-wide ds-text-warning">
                        {t(
                          "app_p2pPairingCodeShown",
                          "Pairing code — enter it on the other device",
                        )}
                      </p>
                      <p className="mt-1 text-2xl font-mono font-bold tracking-widest ds-text-primary">
                        {(() => {
                          const code = serviceRef.current?.getPairingCode();
                          return code
                            ? `${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8)}`
                            : "····-····-····";
                        })()}
                      </p>
                    </div>
                  )}

                  {pairingMode !== "standard" && (
                    <p className="mt-3 text-xs font-medium text-center ds-text-muted flex items-start gap-1.5">
                      <ShieldCheck className="size-3.5 shrink-0 mt-0.5 ds-text-accent" />
                      <span>
                        {pairingMode === "verify"
                          ? t(
                              "app_p2pVerifyHint",
                              "After connecting, both devices will show a verification code — only continue if they match.",
                            )
                          : t(
                              "app_p2pCodeHint",
                              "The other device must type the pairing code shown above before syncing starts.",
                            )}
                      </span>
                    </p>
                  )}
                </div>
              )}

              {awaitingPairingCode && (
                <div className="flex flex-col items-center w-full max-w-sm mx-auto space-y-4">
                  <div className="size-14 rounded-2xl flex items-center justify-center ds-icon-tint-cyan">
                    <Key className="size-7 ds-text-accent" />
                  </div>
                  <div className="text-center">
                    <h3 className="ds-h3 truncate">
                      {t("app_p2pEnterCodeTitle", "Enter the pairing code")}
                    </h3>
                    <p className="text-sm font-medium ds-text-muted mt-1">
                      {t(
                        "app_p2pEnterCodeDesc",
                        "Type the code shown on the other device's screen.",
                      )}
                    </p>
                  </div>
                  <input
                    type="text"
                    value={pairingCodeInput}
                    onChange={(e) =>
                      setPairingCodeInput(
                        e.target.value.toUpperCase().slice(0, 14),
                      )
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {submitPairingCode();}
                    }}
                    placeholder={t(
                      "app_p2pEnterCodePlaceholder",
                      "XXXX-XXXX-XXXX",
                    )}
                    autoFocus
                    autoComplete="off"
                    spellCheck={false}
                    className="w-full text-center text-xl font-mono font-bold tracking-[0.3em] uppercase rounded-xl px-4 py-3 ds-input"
                    aria-label={t(
                      "app_p2pEnterCodeTitle",
                      "Enter the pairing code",
                    )}
                  />
                  <div className="flex gap-3 w-full">
                    <button
                      onClick={cancelPairingCodePrompt}
                      className="flex-1 py-2.5 rounded-xl font-bold ds-text-secondary card-inactive truncate"
                    >
                      {t("app_cancel", "Cancel")}
                    </button>
                    <button
                      onClick={submitPairingCode}
                      disabled={pairingCodeInput.replace(/[^0-9A-Z]/g, "").length !== 12}
                      className="flex-1 py-2.5 rounded-xl font-bold btn-primary disabled:opacity-50 truncate"
                    >
                      {t("app_p2pConnect", "Connect")}
                    </button>
                  </div>
                </div>
              )}

              {syncState === "pairing" && (
                <div className="flex flex-col items-center w-full max-w-sm mx-auto space-y-5">
                  <div className="size-14 rounded-2xl flex items-center justify-center ds-icon-tint-cyan">
                    <ShieldCheck className="size-7 ds-text-accent" />
                  </div>
                  <div className="text-center">
                    <h3 className="ds-h3 truncate">
                      {t("app_p2pVerifyTitle", "Verify it's your device")}
                    </h3>
                    <p className="text-sm font-medium ds-text-muted mt-1">
                      {t(
                        "app_p2pVerifyDesc",
                        "Both devices must show the same code. Only continue if they match.",
                      )}
                    </p>
                  </div>
                  <div className="px-6 py-4 rounded-2xl ds-card text-center">
                    <p className="text-4xl font-mono font-bold tracking-[0.25em] ds-text-primary">
                      {sasCode
                        ? `${sasCode.slice(0, 3)} ${sasCode.slice(3)}`
                        : "··· ···"}
                    </p>
                  </div>
                  <div className="flex gap-3 w-full">
                    <button
                      onClick={handleClose}
                      className="flex-1 py-2.5 rounded-xl font-bold ds-text-secondary card-inactive truncate"
                    >
                      {t("app_cancel", "Cancel")}
                    </button>
                    <button
                      onClick={confirmPairingCodes}
                      disabled={!sasCode}
                      className="flex-1 py-2.5 rounded-xl font-bold btn-primary disabled:opacity-50 truncate"
                    >
                      {t("app_p2pVerifyConfirm", "Codes match — continue")}
                    </button>
                  </div>
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
