/**
 * src/hooks/useTranslationSession.ts
 *
 * State machine for the bilingual workspace. Hooks layer: it may consume
 * services (the translation module) but never components or the db layer.
 *
 * It owns exactly what the UI needs to render progressively:
 *  - one row per chunk, UPSERTED by index (never appended blindly: a retry may
 *    re-emit the same index after a cache hit);
 *  - streaming deltas applied to their own row only;
 *  - the engine label and download/init progress;
 *  - the cost snapshot from the pipeline (never recomputed here).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { SUPPORTED_LANGUAGES } from "../constants/locales";
import { logger } from "../utils/logger";
import {
  describeEngine,
  saveTranslationAsDocument,
  translationService,
} from "../modules/translation";
import type {
  TranslationEngineDescriptor,
  TranslationEngineId,
} from "../modules/translation";
import { TranslationEngineUnavailableError } from "../modules/translation";

type TranslationRowStatus = "pending" | "streaming" | "done";

export interface TranslationRowState {
  index: number;
  sourceText: string;
  translation: string;
  kind: "prose" | "code" | "table" | "heading";
  translatable: boolean;
  fromCache: boolean;
  reviewed: boolean;
  status: TranslationRowStatus;
}

type TranslationSessionStatus = "idle" | "running" | "done" | "error";

interface UseTranslationSessionOptions {
  documentId: string;
  title: string;
  sourceText: string;
}

interface CostSnapshot {
  totalUSD: number;
  savedUSD: number;
  isFreePlan: boolean;
}

const SUPPORTED = new Set<string>(SUPPORTED_LANGUAGES.map((language) => language.code));

function baseLocale(value: string | undefined): string {
  const base = String(value || "en").split("-")[0]!.toLowerCase();
  return SUPPORTED.has(base) ? base : "en";
}

/** Map a typed pipeline failure to the key the UI translates. */
function errorKeyFor(error: unknown): string {
  if (error instanceof TranslationEngineUnavailableError) {
    switch (error.code) {
      case "pro-required":
        return "translation_errorPro";
      case "ollama-unreachable":
        return "translation_errorOllama";
      case "not-configured":
        return "translation_errorCloud";
      case "empty-source":
        return "translation_empty";
      default:
        return "translation_errorDevice";
    }
  }
  if ((error as { code?: string } | null)?.code === "empty-source") {
    return "translation_empty";
  }
  return "translation_errorGeneric";
}

export function useTranslationSession({
  documentId,
  title,
  sourceText,
}: UseTranslationSessionOptions) {
  const { i18n } = useTranslation();
  const uiLocale = baseLocale(i18n.language);

  const [sourceLocale, setSourceLocale] = useState(uiLocale);
  const [targetLocale, setTargetLocale] = useState(uiLocale === "es" ? "en" : "es");
  const [engineChoice, setEngineChoice] = useState<TranslationEngineId | "auto">("auto");
  /**
   * Whether the engine the last run RESOLVED to keeps the text on this device.
   * `null` until a run resolves one: the privacy line must never claim "nothing
   * is uploaded" while an automatic choice could still land on the cloud.
   */
  const [resolvedIsLocal, setResolvedIsLocal] = useState<boolean | null>(null);
  const [engines, setEngines] = useState<TranslationEngineDescriptor[]>([]);

  const [status, setStatus] = useState<TranslationSessionStatus>("idle");
  const [rows, setRows] = useState<TranslationRowState[]>([]);
  const [total, setTotal] = useState(0);
  const [completed, setCompleted] = useState(0);
  const [engineLabel, setEngineLabel] = useState<string | null>(null);
  const [modelId, setModelId] = useState<string | null>(null);
  const [modelProgress, setModelProgress] = useState<{
    stage: "download" | "init" | "generate" | "dispose";
    progress: number;
    text: string;
  } | null>(null);
  const [cost, setCost] = useState<CostSnapshot>({
    totalUSD: 0,
    savedUSD: 0,
    isFreePlan: false,
  });
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [resultText, setResultText] = useState("");
  const [savedDocumentId, setSavedDocumentId] = useState<string | null>(null);
  const [pendingConsent, setPendingConsent] = useState<TranslationEngineDescriptor | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  /** One download confirmation per document/session. */
  const consentGiven = useRef(false);
  const runGeneration = useRef(0);

  // A locale change invalidates the engine verdict (NLLB has no FLORES code for
  // some pairs), so the picker is re-resolved whenever either side changes.
  useEffect(() => {
    let cancelled = false;
    void translationService
      .availableEngines(sourceLocale, targetLocale)
      .then((list) => {
        if (!cancelled) {setEngines(list);}
      })
      .catch((error: unknown) => {
        if (cancelled) {return;}
        logger.warn("[translation-ui] could not list engines", {
          error: error instanceof Error ? error.message : String(error),
        });
        setEngines([]);
      });
    return () => {
      cancelled = true;
    };
  }, [sourceLocale, targetLocale]);

  // Leaving the workspace must stop the model: a background 3B generation would
  // keep the user's GPU busy for minutes after the dialog is gone.
  useEffect(() => {
    return () => {
      translationService.cancel(documentId);
    };
  }, [documentId]);

  const resetSession = useCallback(() => {
    translationService.cancel(documentId);
    runGeneration.current += 1;
    setRows([]);
    setTotal(0);
    setCompleted(0);
    setStatus("idle");
    setErrorKey(null);
    setResultText("");
    setSavedDocumentId(null);
    setPendingConsent(null);
    setModelProgress(null);
    setResolvedIsLocal(null);
    setCost({ totalUSD: 0, savedUSD: 0, isFreePlan: false });
  }, [documentId]);

  const execute = useCallback(async () => {
    const generation = ++runGeneration.current;
    setStatus("running");
    setErrorKey(null);
    setRows([]);
    setCompleted(0);
    setTotal(0);
    setResultText("");
    setSavedDocumentId(null);

    try {
      const result = await translationService.translate({
        documentId,
        text: sourceText,
        sourceLocale,
        targetLocale,
        engine: engineChoice,
        onEvent: (event) => {
          if (generation !== runGeneration.current) {return;}
          switch (event.type) {
            case "engine-selected":
              // Label the engine the pipeline actually chose (auto may differ
              // from the pre-flight resolution on a capability race).
              setEngineLabel(describeEngine(event.engine, event.modelId).label);
              setModelId(event.modelId);
              break;
            case "plan":
              setTotal(event.totalChunks);
              break;
            case "model-progress":
              setModelProgress({
                stage: event.stage,
                progress: event.progress,
                text: event.text,
              });
              break;
            case "chunk-start":
              setRows((previous) => {
                const without = previous.filter((row) => row.index !== event.index);
                const row: TranslationRowState = {
                  index: event.index,
                  sourceText: event.sourceText,
                  translation: "",
                  kind: event.kind,
                  translatable: event.translatable,
                  fromCache: event.fromCache,
                  reviewed: false,
                  status: "pending",
                };
                return [...without, row].sort((a, b) => a.index - b.index);
              });
              break;
            case "chunk-delta":
              setRows((previous) =>
                previous.map((row) =>
                  row.index === event.index
                    ? { ...row, translation: row.translation + event.delta, status: "streaming" }
                    : row,
                ),
              );
              break;
            case "chunk-done":
              setRows((previous) =>
                previous.map((row) =>
                  row.index === event.index
                    ? {
                        ...row,
                        translation: event.text,
                        status: "done",
                        fromCache: event.fromCache,
                        reviewed: event.reviewed,
                      }
                    : row,
                ),
              );
              setCompleted((value) => value + 1);
              break;
            case "cost":
              setCost({
                totalUSD: event.totalUSD,
                savedUSD: event.savedUSD,
                isFreePlan: event.isFreePlan,
              });
              break;
            case "phase":
              break;
            case "done":
              setStatus("done");
              break;
          }
        },
      });

      if (generation !== runGeneration.current) {return;}
      setResultText(result.text);
      setStatus("done");
      setTotal(result.chunks.length);
      setCompleted(result.chunks.length);
    } catch (error) {
      if (generation !== runGeneration.current) {return;}
      if (error instanceof DOMException && error.name === "AbortError") {
        // A user cancel is not an error: keep whatever streamed already.
        setStatus("idle");
        return;
      }
      logger.warn("[translation-ui] translation failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      setErrorKey(errorKeyFor(error));
      setStatus("error");
    }
  }, [documentId, engineChoice, sourceLocale, sourceText, targetLocale]);

  /**
   * Start a run, asking for download consent first when the resolved engine
   * would fetch a model. `resolveEngine` does not download anything.
   */
  const start = useCallback(async () => {
    if (!sourceText.trim()) {
      setErrorKey("translation_empty");
      setStatus("error");
      return;
    }
    setErrorKey(null);
    setStatus("idle");
    setPendingConsent(null);

    let descriptor: TranslationEngineDescriptor;
    try {
      descriptor = await translationService.resolveEngine({
        preferred: engineChoice,
        sourceLocale,
        targetLocale,
      });
    } catch (error) {
      setErrorKey(errorKeyFor(error));
      setStatus("error");
      return;
    }

    setEngineLabel(descriptor.label);
    setModelId(descriptor.modelId);
    setResolvedIsLocal(descriptor.isLocal);

    if (
      descriptor.isLocal &&
      descriptor.downloadBytes > 0 &&
      !consentGiven.current
    ) {
      setPendingConsent(descriptor);
      return;
    }
    await execute();
  }, [engineChoice, execute, sourceLocale, sourceText, targetLocale]);

  const confirmDownload = useCallback(async () => {
    consentGiven.current = true;
    setPendingConsent(null);
    await execute();
  }, [execute]);

  const dismissConsent = useCallback(() => {
    setPendingConsent(null);
    setStatus("idle");
  }, []);

  const cancel = useCallback(() => {
    translationService.cancel(documentId);
    runGeneration.current += 1;
    setPendingConsent(null);
    setStatus((current) => (current === "running" ? "idle" : current));
  }, [documentId]);

  const updateRow = useCallback((index: number, translation: string) => {
    setRows((previous) =>
      previous.map((row) => (row.index === index ? { ...row, translation } : row)),
    );
    setSavedDocumentId(null);
  }, []);

  /** Current text: the pipeline result unless the user edited a row. */
  const assembledText = useMemo(() => {
    if (rows.length === 0) {return "";}
    return rows
      .map((row) => row.translation)
      .filter((text) => text.trim().length > 0)
      .join("\n\n")
      .trim();
  }, [rows]);

  const saveAsDocument = useCallback(async () => {
    const text = assembledText || resultText;
    if (!text.trim() || isSaving) {return;}
    setIsSaving(true);
    try {
      const saved = await saveTranslationAsDocument({
        sourceDocumentId: documentId,
        translatedText: text,
        sourceLocale,
        targetLocale,
        title,
      });
      setSavedDocumentId(saved.documentId);
    } catch (error) {
      logger.warn("[translation-ui] could not save the translated document", {
        error: error instanceof Error ? error.message : String(error),
      });
      setErrorKey("translation_errorGeneric");
      setStatus("error");
    } finally {
      setIsSaving(false);
    }
  }, [assembledText, documentId, isSaving, resultText, sourceLocale, targetLocale, title]);

  const copyTranslation = useCallback(async () => {
    const text = assembledText || resultText;
    if (!text) {return;}
    try {
      await navigator.clipboard.writeText(text);
    } catch (error) {
      // INTENTIONAL SILENCE: clipboard permission can be denied by the browser
      // or by a non-secure context; the user can still select the text and the
      // save action remains available.
      logger.warn("[translation-ui] clipboard write denied", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, [assembledText, resultText]);

  useEffect(() => {
    // A new document (editor navigation while the dialog is open) must not show
    // the previous document's rows.
    resetSession();
  }, [documentId, resetSession]);

  return {
    status,
    rows,
    total,
    completed,
    engines,
    engineChoice,
    resolvedIsLocal,
    setEngineChoice,
    sourceLocale,
    setSourceLocale,
    targetLocale,
    setTargetLocale,
    engineLabel,
    modelId,
    modelProgress,
    cost,
    errorKey,
    pendingConsent,
    isSaving,
    savedDocumentId,
    assembledText,
    start,
    cancel,
    confirmDownload,
    dismissConsent,
    resetSession,
    updateRow,
    saveAsDocument,
    copyTranslation,
  };
}

