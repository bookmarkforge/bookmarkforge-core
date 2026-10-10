import { useState, useEffect, useCallback, useRef } from "react";
import {
  Mic,
  MicOff,
  X,
  Search,
  FileText,
  LayoutDashboard,
  Bookmark,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  getSpeechRecognitionCtor,
  type SpeechRecognitionEventLike,
  type SpeechRecognitionErrorEventLike,
  type SpeechRecognitionInstance,
} from "../utils/browser-types";
import { logger } from "../utils/logger";
import { toBcp47SpeechLang } from "../utils/localization";

interface VoiceCommandCenterProps {
  onSearch?: (query: string) => void;
  onNavigate?: (page: string) => void;
  onAction?: (action: string, params?: Record<string, unknown>) => void;
  showFloatingButton?: boolean;
}

const VoiceCommandCenter = ({
  showFloatingButton = true,
  onSearch,
  onNavigate,
  onAction,
}: VoiceCommandCenterProps) => {
  const { t, i18n } = useTranslation();
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [showPanel, setShowPanel] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const propsRef = useRef({ onSearch, onNavigate, onAction });
  propsRef.current = { onSearch, onNavigate, onAction };

  useEffect(() => {
    const handleStateEvent = (e: CustomEvent) => {
      const { type, value } = e.detail;
      if (type === "transcript") {setTranscript(value);}
      if (type === "listening") {setIsListening(value);}
    };
    window.addEventListener(
      "voice-state-control",
      handleStateEvent as EventListener,
    );

    const RecognitionCtor = getSpeechRecognitionCtor();
    if (RecognitionCtor) {
      const recognition = new RecognitionCtor();
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.lang = toBcp47SpeechLang(i18n.language);
      recognition.onresult = (event: SpeechRecognitionEventLike) => {
        const text = event.results[0]?.[0]?.transcript?.trim() ?? "";
        if (!text) {return;}
        setTranscript(text);
        const lower = text.toLowerCase();
        if (lower.startsWith("search ") || lower.startsWith("buscar ")) {
          propsRef.current.onSearch?.(text.slice(text.indexOf(" ") + 1));
        } else if (lower.startsWith("go to ") || lower.startsWith("ir a ")) {
          const prefixLen = lower.startsWith("go to ") ? 6 : 5;
          propsRef.current.onNavigate?.(text.slice(prefixLen).trim());
        } else {
          propsRef.current.onAction?.(text);
        }
      };
      recognition.onerror = (event?: SpeechRecognitionErrorEventLike) => {
        logger.warn(
          "[VoiceCommandCenter] Speech recognition error",
          event?.error ?? "unknown",
        );
        setIsListening(false);
      };
      recognition.onend = () => setIsListening(false);
      recognitionRef.current = recognition;
    }

    return () => {
      window.removeEventListener(
        "voice-state-control",
        handleStateEvent as EventListener,
      );
      recognitionRef.current?.abort();
      recognitionRef.current = null;
    };
  }, [i18n.language]);

  const toggleListening = useCallback(() => {
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
    } else {
      setTranscript("");
      setShowPanel(true);
      try {
        recognitionRef.current?.start();
        setIsListening(true);
      } catch (err) {
        logger.error("[VoiceCommandCenter] Failed to start recognition", err);
        setIsListening(false);
      }
    }
  }, [isListening]);

  useEffect(() => {
    const handleTrigger = () => toggleListening();
    window.addEventListener("trigger-voice-command", handleTrigger);
    return () =>
      window.removeEventListener("trigger-voice-command", handleTrigger);
  }, [toggleListening]);

  return (
    <>
      {showFloatingButton && (
        <button
          onClick={toggleListening}
          className={`truncate fixed bottom-8 end-8 z-50 p-4 rounded-full shadow-2xl transition-all duration-500 group ${isListening ? "bg-[var(--color-danger)] scale-110" : "bg-cyan-600 hover:bg-cyan-500"}`}
        >
          {isListening ? (
            <MicOff className="size-6 text-white animate-pulse" />
          ) : (
            <Mic className="size-6 text-white group-hover:scale-110 transition-transform" />
          )}
          {!isListening && (
            <span className="absolute end-full me-4 top-1/2 -translate-y-1/2 bg-[var(--bg-primary)] text-white text-xs px-3 py-1.5 rounded-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all whitespace-nowrap border border-[var(--divider)] pointer-events-none">
              {t("app_voiceCommands")} ({t("app_voiceShortcut", "Ctrl+Shift+V")}
              )
            </span>
          )}
        </button>
      )}

      {!showFloatingButton && !showPanel && (
        <div className="flex flex-col items-center justify-center gap-8 p-12 bg-white dark:bg-[var(--bg-primary)]/50 border border-[var(--divider)] dark:border-[var(--divider)] rounded-3xl max-w-2xl mx-auto shadow-sm">
          <div className="size-24 bg-cyan-500/10 rounded-full flex items-center justify-center border border-cyan-500/20">
            <Mic className="size-12 text-cyan-600 dark:text-cyan-400" />
          </div>
          <div className="text-center space-y-3">
            <h1 className="ds-h2 ds-text-primary">{t("app_voiceCommands")}</h1>
            <p className="max-w-md mx-auto ds-text-secondary">
              {t("app_voiceCommandsDesc")}
            </p>
          </div>
          <button
            onClick={toggleListening}
            className="truncate px-8 py-4 bg-cyan-700 hover:bg-cyan-600 text-white font-bold rounded-2xl shadow-lg shadow-cyan-500/20 transition-all hover:scale-105 active:scale-95 flex items-center gap-3"
          >
            <Mic className="size-5" />
            {t("app_startListening")}
          </button>

          <div className="grid grid-cols-2 gap-4 w-full mt-4">
            <div className="p-4 bg-[var(--bg-secondary)] dark:bg-[var(--bg-card)]/30 rounded-xl border border-[var(--divider)] dark:border-[var(--divider)]/50">
              <p className="text-[10px] font-bold text-[var(--text-muted)] uppercase mb-1">
                {t("app_trySaying")}
              </p>
              <p className="text-sm text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">
                "{t("app_voiceSearch")}"
              </p>
            </div>
            <div className="p-4 bg-[var(--bg-secondary)] dark:bg-[var(--bg-card)]/30 rounded-xl border border-[var(--divider)] dark:border-[var(--divider)]/50">
              <p className="text-[10px] font-bold text-[var(--text-muted)] uppercase mb-1">
                {t("app_trySaying")}
              </p>
              <p className="text-sm text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">
                "{t("app_voiceGoTo")}"
              </p>
            </div>
            <div className="p-4 bg-[var(--bg-secondary)] dark:bg-[var(--bg-card)]/30 rounded-xl border border-[var(--divider)] dark:border-[var(--divider)]/50 col-span-2">
              <p className="text-[10px] font-bold text-[var(--text-muted)] uppercase mb-1">
                {t("app_trySaying")}
              </p>
              <p className="text-sm text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">
                "
                {t("app_voiceRAGExample", "What do my documents say about AI?")}
                "
              </p>
            </div>
          </div>
        </div>
      )}

      {showPanel && (
        <div className="ds-modal-overlay z-40 p-4 animate-in fade-in">
          <div className="bg-[var(--bg-primary)] border border-[var(--divider)] rounded-2xl w-full max-w-lg p-8 shadow-2xl relative overflow-hidden">
            <div className="absolute top-0 start-0 w-full h-1 ds-bg-accent-primary"></div>

            <button
              onClick={() => setShowPanel(false)}
              className="absolute top-4 end-4 text-[var(--text-muted)] hover:text-white transition-colors"
            >
              <X className="size-5" />
            </button>

            <div className="flex flex-col items-center text-center gap-6">
              <div className="p-6 rounded-full bg-cyan-500/10 text-cyan-500">
                <Mic
                  className={`size-12 ${isListening ? "animate-bounce" : ""}`}
                />
              </div>

              <div className="space-y-2">
                <h2 className="text-2xl font-semibold text-white">
                  {isListening ? t("app_listening") : t("app_commandReceived")}
                </h2>
                <p className="text-[var(--text-muted)] text-sm">
                  {t("app_voiceTry")}
                </p>
              </div>

              <div className="w-full rounded-xl p-6 min-h-[100px] flex flex-col items-center justify-center border border-[var(--divider)]/50 relative ds-bg-secondary">
                <p
                  className={`text-xl font-medium ${transcript ? "text-white" : "text-[var(--text-secondary)] italic"}`}
                >
                  {transcript || t("app_speakNow")}
                </p>
              </div>
            </div>

            <div className="mt-8 grid grid-cols-2 gap-3">
              <div className="flex items-center gap-2 text-[10px] text-[var(--text-muted)] bg-[var(--bg-card)]/30 px-3 py-2 rounded-lg">
                <Search className="size-3" /> "{t("app_voiceSearch")}"
              </div>
              <div className="flex items-center gap-2 text-[10px] text-[var(--text-muted)] bg-[var(--bg-card)]/30 px-3 py-2 rounded-lg">
                <LayoutDashboard className="size-3" /> "{t("app_voiceGoTo")}"
              </div>
              <div className="flex items-center gap-2 text-[10px] text-[var(--text-muted)] bg-[var(--bg-card)]/30 px-3 py-2 rounded-lg">
                <FileText className="size-3" /> "{t("app_voiceCreateDoc")}"
              </div>
              <div className="flex items-center gap-2 text-[10px] text-[var(--text-muted)] bg-[var(--bg-card)]/30 px-3 py-2 rounded-lg">
                <Bookmark className="size-3" /> "{t("app_voiceSummarize")}"
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default VoiceCommandCenter;
