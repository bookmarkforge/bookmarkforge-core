import { useState, useEffect, useMemo } from "react";
import { ttsService, VoiceSettings } from "../services/ai/TTSService";
import {
  Play,
  Pause,
  Square,
  Download,
  Loader2,
  Volume2,
  Settings,
  Music,
  Mic2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { logger } from "../utils/logger";
import { useGuardedActions } from "../hooks/useGuardedActions";

interface TtsPlayerProps {
  text: string;
  compact?: boolean;
  /** Missing metadata fails closed and keeps synthesis local/web-speech only. */
  isPrivate?: boolean;
}

export const TtsPlayer = ({
  text,
  compact = false,
  isPrivate = true,
}: TtsPlayerProps) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  // Shared guard across play/download: starting one invalidates the other's
  // in-flight UI effects. The loading flag is shared — either action in
  // flight disables both buttons.
  const {
    play: playAction,
    download: downloadAction,
  } = useGuardedActions({
    play: {
      onStart: () => setCurrentChunk(""),
      onSuccess: () => {
        setIsPlaying(true);
        setIsPaused(false);
      },
      onError: (error) => {
        logger.error(error);
        toast.error(t("app_errorGeneratingAudio"));
      },
    },
    download: {
      onSuccess: () => {
        toast.success(t("app_audioDownloaded"));
      },
      onError: (error) => {
        logger.error(error);
        toast.error(t("app_errorDownloadingAudio"));
      },
    },
  });
  const loading = playAction.isRunning || downloadAction.isRunning;
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [voiceSettings, setVoiceSettings] = useState<VoiceSettings>({
    rate: 1,
    pitch: 1,
    volume: 1,
  });
  const availableVoices = useMemo(
    () =>
      ttsService.isWebSpeechAvailable()
        ? ttsService.getVoicesForLanguage(lang)
        : [],
    [lang],
  );
  const [selectedVoice, setSelectedVoice] = useState(() => {
    if (ttsService.isWebSpeechAvailable()) {
      const voices = ttsService.getVoicesForLanguage(lang);
      return voices.length > 0 ? voices[0]!.voiceURI : "";
    }
    return "";
  });

  // Karaoke State
  const [currentChunk, setCurrentChunk] = useState<string>("");

  useEffect(() => {
    const handleHighlight = (e: CustomEvent<{ text: string }>) => {
      setCurrentChunk(e.detail.text);
    };
    window.addEventListener(
      "tts-word-highlight",
      handleHighlight as EventListener,
    );
    return () =>
      window.removeEventListener(
        "tts-word-highlight",
        handleHighlight as EventListener,
      );
  }, []);

  // A player that unmounts must not keep the utterance running in the
  // background; stop playback and invalidate any in-flight synthesis.
  useEffect(() => {
    return () => ttsService.stop();
  }, []);

  const handlePlay = async () => {
    if (!text) {return;}

    // Resume SpeechSynthesis if it was paused
    if (isPaused) {
      ttsService.resume();
      setIsPaused(false);
      return;
    }

    // Ensure speech synthesis is ready
    if (typeof window === "undefined" || !window.speechSynthesis) {
      toast.error(t("app_errorGeneratingAudio"));
      return;
    }

    await playAction.run(async () => {
      const settings: VoiceSettings = {
        ...voiceSettings,
        voiceURI: selectedVoice || undefined,
      };
      await ttsService.speak(text, lang, settings, { isPrivate });
    });
  };

  const handlePause = () => {
    ttsService.pause();
    setIsPaused(true);
  };

  const handleStop = () => {
    ttsService.stop();
    setIsPlaying(false);
    setIsPaused(false);
    setCurrentChunk("");
  };

  const handleDownload = async () => {
    if (!text) {return;}
    await downloadAction.run(async () => {
      const settings: VoiceSettings = {
        ...voiceSettings,
        voiceURI: selectedVoice || undefined,
      };
      await ttsService.downloadAudio(text, lang, settings, { isPrivate });
    });
  };

  if (compact) {
    return (
      <button
        onClick={isPlaying ? (isPaused ? handlePlay : handlePause) : handlePlay}
        disabled={loading || !text}
        className="truncate flex items-center gap-2 px-3 py-1.5 bg-[var(--bg-secondary)] dark:bg-[var(--bg-card)] rounded-lg hover:bg-[var(--state-hover-bg)] dark:hover:bg-[var(--state-hover-bg)] transition-colors disabled:opacity-50 relative group"
        title={t("listen", "Listen")}
      >
        {loading ? (
          <Loader2 className="size-4 animate-spin" />
        ) : isPaused ? (
          <Play className="size-4 ds-text-warning" />
        ) : isPlaying ? (
          <Pause className="size-4 ds-text-success" />
        ) : (
          <Music className="size-4" />
        )}

        {/* Compact Karaoke Tooltip */}
        {isPlaying && currentChunk && (
          <div className="absolute top-full mt-2 left-1/2 -translate-x-1/2 w-48 bg-[var(--bg-primary)] text-white text-[10px] p-2 rounded shadow-xl opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50 overflow-hidden line-clamp-3">
            {currentChunk}
          </div>
        )}
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-3 w-full">
      <div className="flex items-center gap-2 relative">
        <button
          onClick={
            isPlaying ? (isPaused ? handlePlay : handlePause) : handlePlay
          }
          disabled={loading || !text}
          className="truncate flex items-center gap-2 px-4 py-2 bg-[var(--bg-secondary)] dark:bg-[var(--bg-card)] rounded-xl hover:bg-[var(--state-hover-bg)] dark:hover:bg-[var(--state-hover-bg)] transition-all disabled:opacity-50"
          title={
            isPlaying
              ? isPaused
                ? t("app_resume")
                : t("app_pause")
              : t("app_listen")
          }
          aria-label={
            isPlaying
              ? isPaused
                ? t("app_resume")
                : t("app_pause")
              : t("app_listen")
          }
        >
          {loading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : isPaused ? (
            <Play className="size-4 ds-text-warning" />
          ) : isPlaying ? (
            <Pause className="size-4 ds-text-success" />
          ) : (
            <Music className="size-4" />
          )}
          <span className="text-sm font-semibold">
            {loading
              ? t("app_processing") + "..."
              : isPaused
                ? t("app_resume")
                : isPlaying
                  ? t("app_pause")
                  : t("app_listen")}
          </span>
        </button>
        {isPlaying && (
          <button
            onClick={handleStop}
            className="p-2.5 bg-[var(--bg-secondary)] dark:bg-[var(--bg-card)] rounded-xl hover:bg-[var(--danger-soft)] dark:hover:bg-[var(--color-danger)]/30 hover:ds-text-danger transition-all"
            title={t("app_stop")}
            aria-label={t("app_stop", "Stop")}
          >
            <Square className="size-4" />
          </button>
        )}{" "}
        <button
          onClick={handleDownload}
          disabled={loading || !text}
          className="p-2.5 bg-[var(--bg-secondary)] dark:bg-[var(--bg-card)] rounded-xl hover:bg-[var(--state-hover-bg)] dark:hover:bg-[var(--state-hover-bg)] transition-all disabled:opacity-50"
          title={t("app_downloadAudio")}
          aria-label={t("app_downloadAudio", "Download Audio")}
        >
          <Download className="size-4" />
        </button>
        <button
          onClick={() => setShowSettings(!showSettings)}
          className={`p-2.5 rounded-xl transition-all ${showSettings ? "bg-cyan-100 dark:bg-cyan-900/30 text-cyan-600" : "bg-[var(--bg-secondary)] dark:bg-[var(--bg-card)] hover:bg-[var(--state-hover-bg)] dark:hover:bg-[var(--state-hover-bg)]"}`}
          title={t("app_settings")}
        >
          <Settings className="size-4" />
        </button>
        {showSettings && (
          <div className="absolute start-0 top-14 bg-white dark:bg-[var(--bg-primary)] border border-[var(--divider)] dark:border-[var(--divider)] rounded-xl shadow-2xl p-5 w-80 z-50 animate-in fade-in slide-in-from-top-2">
            <h4 className="text-sm font-semibold mb-4 flex items-center gap-2 text-[var(--text-secondary)] dark:text-[var(--text-muted)]">
              <Volume2 className="size-4 text-cyan-500" />
              {t("voiceSettings", "Voice Settings")}
            </h4>

            <div className="space-y-4">
              <div>
                <div className="flex justify-between mb-1.5">
                  <span className="text-xs font-semibold text-[var(--text-secondary)] dark:text-[var(--text-muted)]">
                    {t("speed", "Speed")}
                  </span>
                  <span className="text-xs text-[var(--text-muted)]">
                    {voiceSettings.rate}
                    {t("app_rateX", "x")}
                  </span>
                </div>
                <input
                  type="range"
                  min="0.5"
                  max="2"
                  step="0.1"
                  aria-label={t("speed", "Speed")}
                  value={voiceSettings.rate}
                  onChange={(e) =>
                    setVoiceSettings({
                      ...voiceSettings,
                      rate: parseFloat(e.target.value),
                    })
                  }
                  className="w-full accent-cyan-500"
                />
              </div>

              <div>
                <div className="flex justify-between mb-1.5">
                  <span className="text-xs font-semibold text-[var(--text-secondary)] dark:text-[var(--text-muted)]">
                    {t("pitch", "Pitch")}
                  </span>
                  <span className="text-xs text-[var(--text-muted)]">
                    {voiceSettings.pitch}
                  </span>
                </div>
                <input
                  type="range"
                  min="0.5"
                  max="2"
                  step="0.1"
                  aria-label={t("pitch", "Pitch")}
                  value={voiceSettings.pitch}
                  onChange={(e) =>
                    setVoiceSettings({
                      ...voiceSettings,
                      pitch: parseFloat(e.target.value),
                    })
                  }
                  className="w-full accent-cyan-500"
                />
              </div>

              <div>
                <div className="flex justify-between mb-1.5">
                  <span className="text-xs font-semibold text-[var(--text-secondary)] dark:text-[var(--text-muted)]">
                    {t("volume", "Volume")}
                  </span>
                  <span className="text-xs text-[var(--text-muted)]">
                    {Math.round(voiceSettings.volume * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.1"
                  aria-label={t("volume", "Volume")}
                  value={voiceSettings.volume}
                  onChange={(e) =>
                    setVoiceSettings({
                      ...voiceSettings,
                      volume: parseFloat(e.target.value),
                    })
                  }
                  className="w-full accent-cyan-500"
                />
              </div>

              {availableVoices.length > 0 && (
                <div className="pt-2 border-t border-[var(--divider)] dark:border-[var(--divider)]">
                  <span className="text-xs font-semibold text-[var(--text-secondary)] dark:text-[var(--text-muted)] block mb-2">
                    {t("localVoice", "Local Voice")}
                  </span>
                  <select
                    aria-label={t("localVoice", "Local Voice")}
                    value={selectedVoice}
                    onChange={(e) => setSelectedVoice(e.target.value)}
                    className="w-full bg-[var(--bg-secondary)] dark:bg-[var(--bg-card)] border border-[var(--divider)] dark:border-[var(--divider)] rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-cyan-500 outline-none"
                  >
                    {availableVoices.map((voice) => (
                      <option key={voice.voiceURI} value={voice.voiceURI}>
                        {voice.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Karaoke Display Area */}
      {isPlaying && currentChunk && (
        <div className="w-full p-4 bg-cyan-50/50 dark:bg-cyan-900/10 border border-cyan-100 dark:border-cyan-900/30 rounded-xl animate-in fade-in slide-in-from-top-1">
          <div className="flex items-center gap-2 mb-2 opacity-50">
            <Mic2 className="size-3.5 text-cyan-600 dark:text-cyan-400 animate-pulse" />
            <span className="text-[10px] font-bold uppercase tracking-widest text-cyan-600 dark:text-cyan-400">
              {t("readingNow", "Reading now")}
            </span>
          </div>
          <p className="text-sm font-medium text-[var(--text-secondary)] dark:text-[var(--text-muted)] leading-relaxed transition-all duration-300">
            {currentChunk}
          </p>
        </div>
      )}
    </div>
  );
};
