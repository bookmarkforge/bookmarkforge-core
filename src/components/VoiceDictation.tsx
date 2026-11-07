import React, { useState, useRef, useEffect } from "react";
import { Mic, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { logger } from "../utils/logger";
import { toBcp47SpeechLang } from "../utils/localization";

interface VoiceDictationProps {
  onTranscript: (text: string) => void;
}

interface SpeechRecognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onstart: (this: SpeechRecognition, ev: Event) => void;
  onresult: (this: SpeechRecognition, ev: SpeechRecognitionEvent) => void;
  onerror: (this: SpeechRecognition, ev: SpeechRecognitionError) => void;
  onend: (this: SpeechRecognition, ev: Event) => void;
  start(): void;
  abort(): void;
}

interface SpeechRecognitionEvent {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}

interface SpeechRecognitionResultList {
  [index: number]: SpeechRecognitionResult;
  length: number;
  item(index: number): SpeechRecognitionResult;
}

interface SpeechRecognitionResult {
  [index: number]: SpeechRecognitionAlternative;
  length: number;
  item(index: number): SpeechRecognitionAlternative;
  isFinal: boolean;
}

interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

interface SpeechRecognitionError {
  error: string;
  message: string;
}

export const VoiceDictation: React.FC<VoiceDictationProps> = ({
  onTranscript,
}) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const isSupported =
    "webkitSpeechRecognition" in window || "SpeechRecognition" in window;

  // Abort recognition on unmount: otherwise the mic keeps listening (and the
  // indicator keeps pulsing) after the user navigates away.
  useEffect(() => {
    return () => {
      recognitionRef.current?.abort();
      recognitionRef.current = null;
    };
  }, []);

  const toggleListening = () => {
    if (isListening) {
      recognitionRef.current?.abort();
      recognitionRef.current = null;
      setIsListening(false);
    } else {
      startListening();
    }
  };

  const startListening = () => {
    const SpeechRecognition =
      (
        window as unknown as {
          SpeechRecognition: new () => SpeechRecognition;
          webkitSpeechRecognition: new () => SpeechRecognition;
        }
      ).SpeechRecognition ||
      (
        window as unknown as {
          SpeechRecognition: new () => SpeechRecognition;
          webkitSpeechRecognition: new () => SpeechRecognition;
        }
      ).webkitSpeechRecognition;
    if (!SpeechRecognition) {return;}
    const recognition = new SpeechRecognition();
    recognitionRef.current = recognition;

    recognition.lang = toBcp47SpeechLang(lang);
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.onstart = () => {
      setIsListening(true);
    };

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      const transcript = event.results[0]![0]!.transcript;
      onTranscript(transcript);
      setIsListening(false);
      recognitionRef.current = null;
    };

    recognition.onerror = (event: SpeechRecognitionError) => {
      logger.error("Speech recognition error", event.error);
      setIsListening(false);
      recognitionRef.current = null;
    };

    recognition.onend = () => {
      setIsListening(false);
      recognitionRef.current = null;
    };

    recognition.start();
  };

  if (!isSupported) {
    return null;
  }

  return (
    <button
      onClick={toggleListening}
      className={`truncate p-2 rounded-lg transition-colors ${isListening ? "ds-text-danger animate-pulse bg-[var(--danger-soft)]" : "text-[var(--text-muted)] hover:bg-[var(--state-hover-bg)] dark:hover:bg-[var(--state-hover-bg)]"}`}
      title={t("app_voiceCommands")}
    >
      {isListening ? (
        <Loader2 className="size-5 animate-spin" />
      ) : (
        <Mic className="size-5" />
      )}
    </button>
  );
};
