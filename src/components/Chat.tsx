import { useState, useMemo, useEffect, useRef, useDeferredValue } from "react";
import { motion, AnimatePresence } from "motion/react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { agentService } from "../services/ai/AgentService";
import type { AIProvider } from "../services/ai/types";
import type { RAGResult } from "../services/ai-types";
import { loadWebLLMService, ProUnavailableError } from "../services/pro-access";
import { useRxCollection, useRxQuery } from "../hooks/useRxDB";
import {
  Send,
  Sparkles,
  Copy,
  Check,
  ExternalLink,
  FileText,
  Bookmark,
  Info,
  ChevronRight,
  Globe,
  Square,
  Shield,
  ShieldOff,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { safeGet, safeRemove } from "../store/safeStorage";
import { STORAGE_KEYS } from "../constants/storage-keys";
import { logger } from "../utils/logger";
import { sanitizeUrl } from "../services/SanitizationService";
import { useRequestGuard } from "../hooks/useRequestGuard";

interface GroundingChunk {
  id: string;
  content: string;
  title?: string;
  url?: string;
  score?: number;
  web?: {
    uri: string;
    title: string;
  };
}

interface GroundingMetadata {
  groundingChunks?: GroundingChunk[];
  sources?: RAGResult[];
}

/**
 * Represents a chat message.
 */
interface Message {
  id?: string;
  role: "user" | "assistant";
  content: string;
  sources?: RAGResult[];
  groundingMetadata?: GroundingMetadata;
  isTranslationKey?: boolean;
  sourceOrigin?: "local" | "web";
  isError?: boolean;
  retryQuery?: string;
}

/** Shared response shape of the local RAG chat and the web-search chat. */
interface ChatResponse {
  text: string;
  sources?: RAGResult[];
  groundingMetadata?: GroundingMetadata;
}

interface ChatProps {
  onSelectSource?: (type: "document" | "bookmark", id: string) => void;
}

type ChatErrorAction = "offline" | "settings";

const CHAT_PERSIST_TIMEOUT_MS = 5_000;

type MessagesCollection = {
  insert: (document: Record<string, unknown>) => Promise<unknown>;
};

async function persistChatMessage(
  collection: MessagesCollection | null | undefined,
  document: Record<string, unknown>,
): Promise<boolean> {
  if (!collection) {return true;}

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      collection.insert(document),
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error("chat message persistence timed out")),
          CHAT_PERSIST_TIMEOUT_MS,
        );
      }),
    ]);
    return true;
  } catch (error) {
    logger.warn("[Chat] Message persistence did not complete", { error });
    return false;
  } finally {
    if (timeoutId !== undefined) {clearTimeout(timeoutId);}
  }
}

function classifyChatError(error: unknown): ChatErrorAction {
  const message = String(error).toLowerCase();
  if (
    (typeof navigator !== "undefined" && !navigator.onLine) ||
    /network|offline|fetch|timeout|connection/.test(message)
  ) {
    return "offline";
  }
  return "settings";
}

/**
 * Chat component - Provides an AI-powered chat interface with RAG capabilities.
 */
export default function Chat({ onSelectSource }: ChatProps) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const messagesCollection = useRxCollection("messages");
  const messagesQuery = useRxQuery(
    messagesCollection?.find().sort({ createdAt: "asc" }),
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const dbMessages = useMemo(() => {
    return messagesQuery.result || [];
  }, [messagesQuery.result]);

  const messages: Message[] = useMemo(() => {
    const defaultMsg: Message = {
      role: "assistant",
      content: "app_chatWelcome",
      isTranslationKey: true,
    };
    if (dbMessages.length === 0) {
      return [defaultMsg];
    }
    return dbMessages.map((msg) => msg.toJSON() as Message);
  }, [dbMessages]);

  const pendingQueryRef = useRef<string | null>(null);
  // Authoritative lock against concurrent sends. isTyping is state, so a
  // rapid second Enter press in the same tick would read the stale value;
  // the ref is set synchronously and is the real guard.
  const sendInFlightRef = useRef(false);

  // Cancellation: a synchronous flag (checked inside onChunk so late chunks
  // are dropped) plus a resolver for a never-resolving promise raced against
  // the generation. The AbortController now propagates cancellation through
  // RAG, memory recall, provider fetches, and worker-backed embeddings; the
  // race still unwinds the UI immediately as a second safety net.
  const cancelFlagRef = useRef(false);
  const cancelResolveRef = useRef<(() => void) | null>(null);
  const mountedRef = useRef(true);
  // Deliberate manual guard: handleSend races the generation against a
  // user-cancel reject (cancelPromise) to preserve PARTIAL streamed text on
  // Stop, persists mid-flow into messagesCollection, and classifies errors
  // into retry actions — the useGuardedAction contract (terminal
  // onSuccess/onError + boolean isRunning) cannot express partial-save-on-
  // cancel or the persisted-error pipeline.
  const { begin, isCurrent, cancel } = useRequestGuard();

  const handleStopGeneration = () => {
    cancelFlagRef.current = true;
    cancel();
    // Clear the transient UI even if a stale generation already released the
    // request lock but left its stream bubble rendered after a late update.
    if (mountedRef.current) {
      setIsTyping(false);
      setStreamingContent(null);
      setStreamingProvider(null);
    }
    // Wake the Promise.race in handleSend so it unwinds right away instead
    // of waiting for the abandoned provider call to settle.
    cancelResolveRef.current?.();
  };

  const [input, setInput] = useState(() => {
    const pendingQuery = safeGet(STORAGE_KEYS.PENDING_AI_QUERY);
    if (pendingQuery) {
      safeRemove(STORAGE_KEYS.PENDING_AI_QUERY);
      pendingQueryRef.current = pendingQuery;
      return pendingQuery;
    }
    return "";
  });
  const [isTyping, setIsTyping] = useState(false);
  const [isWebSearch, setIsWebSearch] = useState(false);
  const [isPrivateMode, setIsPrivateMode] = useState(false);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<{
    text: string;
    progress: number;
  } | null>(null);
  const [streamingContent, setStreamingContent] = useState<string | null>(null);
  // Ollama emits a terminal frame before the surrounding RAG/memory promise
  // resolves. Keep the response bubble visible, but hide the active-generation
  // controls as soon as the provider has definitively finished streaming.
  const [streamFinished, setStreamFinished] = useState(false);
  // Defer the streaming content so React can prioritize user interactions
  // (scrolling, typing) over re-rendering the markdown-heavy response bubble.
  const deferredStreamingContent = useDeferredValue(streamingContent);
  // Keep provider errors visible even when the RxDB messages collection is
  // temporarily unavailable. Persistence is best-effort; the user must still
  // receive feedback instead of an apparently dead Send button.
  const [errorContent, setErrorContent] = useState<string | null>(null);
  const [lastFailedQuery, setLastFailedQuery] = useState<string | null>(null);
  const [errorAction, setErrorAction] = useState<ChatErrorAction | null>(null);
  // Provider actually generating the current stream (reported by
  // streamGenerateText via onProvider before tokens arrive). Rendered as a
  // pill in the chat header while the response is being produced.
  const [streamingProvider, setStreamingProvider] = useState<AIProvider | null>(
    null,
  );

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isTyping, errorContent]);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;
    // Pro resolution through the loader: without Pro (or in an Open Core
    // export) the download-progress card simply never appears.
    loadWebLLMService()
      .then((webLLMService) => {
        if (cancelled) {return;}
        unsubscribe = webLLMService.onProgress((progress) => {
          if (cancelled || !mountedRef.current) {return;}
          if (progress.progress < 1) {
            setDownloadProgress(progress);
          } else {
            setDownloadProgress(null);
          }
        });
      })
      .catch((err) => {
        if (cancelled || err instanceof ProUnavailableError) {return;}
        logger.debug("[Chat] WebLLM not available", { error: err });
      });
    return () => {
      cancelled = true;
      if (unsubscribe) {unsubscribe();}
    };
  }, []);

  useEffect(() => {
    return () => clearTimeout(copyTimerRef.current);
  }, []);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      cancelFlagRef.current = true;
      cancel();
      cancelResolveRef.current?.();
    };
  }, [cancel]);

  const copyToClipboard = (text: string, id: number) => {
    navigator.clipboard.writeText(text).catch(() => {
      // Silently ignore clipboard denial — user may have revoked permission.
    });
    setCopiedId(id);
    clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => setCopiedId(null), 2000);
  };

  const handleSend = async (overrideInput?: string) => {
    // Guard against concurrent sends (e.g. rapid Enter presses while a
    // response is streaming) — the send button is disabled via isTyping,
    // but the Enter handler is not. The ref is the real lock because it is
    // set synchronously, before any await.
    if (sendInFlightRef.current || isTyping) {
      return;
    }
    const queryToSend = (overrideInput ?? input).trim();
    if (!queryToSend) {
      // Do not leave the synchronous lock engaged when Enter is pressed on
      // an empty/whitespace-only input. The lock is set only after validation
      // so a later valid query can still be submitted.
      return;
    }
    sendInFlightRef.current = true;
    setErrorContent(null);
    setLastFailedQuery(null);
    setErrorAction(null);

    const userMsg = queryToSend;
    if (!overrideInput) {setInput("");}

    try {
      const persisted = await persistChatMessage(messagesCollection, {
        id: crypto.randomUUID(),
        role: "user",
        content: userMsg,
        createdAt: new Date().toISOString(),
      });
      if (!persisted) {
        throw new Error("user message persistence failed");
      }
    } catch (error) {
      // A failed user-message write must not leave the synchronous send lock
      // engaged. Show the same local feedback used for provider failures and
      // let the finally-equivalent cleanup restore the composer.
      const errorText = t(
        "app_aiError",
        "Sorry, I encountered an error processing your request. Please try again.",
      );
      setErrorContent(errorText);
      setLastFailedQuery(userMsg);
      setErrorAction(classifyChatError(error));
      setIsTyping(false);
      sendInFlightRef.current = false;
      logger.warn("[Chat] Failed to persist user message", { error });
      return;
    }
    setIsTyping(true);
    setStreamingContent("");
    setStreamingProvider(null);
    setStreamFinished(false);
    cancelFlagRef.current = false;
    const { generation, signal } = begin();
    const msgId = crypto.randomUUID();
    let fullText = "";
    // Race partner: REJECTS when the user cancels, so the generation result
    // is never undefined (no accidental `response.text` TypeError — the
    // cancellation is explicit and routed through the catch below).
    let cancelled = false;
    const cancelPromise = new Promise<never>((_resolve, reject) => {
      cancelResolveRef.current = () => {
        cancelled = true;
        reject(new Error("generation cancelled by user"));
      };
    });

    try {
      // Single response path for both modes. The local RAG chat streams real
      // tokens through onChunk; web search (Google grounding) delivers the
      // full text at once, so it is assigned directly.
      const response = (await Promise.race([
        isWebSearch
          ? agentService.webSearch(
              userMsg,
              lang,
              isPrivateMode,
              signal,
            )
          : agentService.globalChat(
              userMsg,
              lang,
              isPrivateMode,
              undefined,
              (chunk) => {
                // Drop chunks that arrive after the user pressed Stop.
                if (cancelFlagRef.current || !isCurrent(generation)) {return;}
                fullText += chunk;
                setStreamingContent(fullText);
              },
              undefined,
              (provider) => {
                if (!cancelFlagRef.current && isCurrent(generation)) {
                  setStreamingProvider(provider);
                }
              },
              signal,
              () => {
                if (!cancelFlagRef.current && isCurrent(generation)) {
                  setStreamFinished(true);
                }
              },
            ),
        cancelPromise,
      ])) as ChatResponse;

      if (cancelled || !isCurrent(generation)) {return;}
      // The provider has returned its complete response. Release the visual
      // generation controls before waiting for the durable RxDB insert; the
      // persistence timeout below must never keep `Stop` visible.
      setStreamFinished(true);
      fullText = response.text;
      setStreamingContent(fullText);

      await persistChatMessage(messagesCollection, {
        id: msgId,
        role: "assistant",
        content: fullText,
        ...(response.sources ? { sources: response.sources } : {}),
        ...(response.groundingMetadata
          ? { groundingMetadata: response.groundingMetadata }
          : {}),
        sourceOrigin: isWebSearch ? "web" : "local",
        createdAt: new Date().toISOString(),
      });

      if (!mountedRef.current || !isCurrent(generation)) {return;}
      // The answer is now persisted in history — hide the transient
      // streaming bubble so the response is not rendered twice.
      setStreamingContent(null);
    } catch (e: unknown) {
      if (mountedRef.current) {
        setStreamingContent(null);
      }
      if (cancelled) {
        // User cancelled mid-stream. Keep the partial text as a message
        // when there is some; never show an error banner for a voluntary
        // stop, and never insert an empty assistant message.
        if (mountedRef.current && fullText.trim() && messagesCollection) {
          // Cancellation must release the composer immediately; persistence
          // remains best-effort and is independently time-bounded.
          void persistChatMessage(messagesCollection, {
            id: msgId,
            role: "assistant",
            content: fullText,
            sourceOrigin: isWebSearch ? "web" : "local",
            createdAt: new Date().toISOString(),
          });
        }
      } else {
        if (!isCurrent(generation)) {return;}
        const errorText = t(
          "app_aiError",
          "Sorry, I encountered an error processing your request. Please try again.",
        );
        setErrorContent(errorText);
        setLastFailedQuery(userMsg);
        setErrorAction(classifyChatError(e));
        if (messagesCollection) {
          const persisted = await persistChatMessage(messagesCollection, {
            id: crypto.randomUUID(),
            role: "assistant",
            content: errorText,
            isError: true,
            retryQuery: userMsg,
            createdAt: new Date().toISOString(),
          });
          if (persisted) {
            // The reactive message list will render the persisted error; keep
            // the local fallback only for an unavailable/failed collection.
            setErrorContent(null);
          }
        }
        logger.error("[Chat] AI request failed", { error: e });
      }
    } finally {
      cancelResolveRef.current = null;
      sendInFlightRef.current = false;
      // There is only one active send per component. Even if another
      // lifecycle event invalidated this generation after the provider
      // response was persisted, the composer must not remain permanently
      // locked behind a stale generation guard.
      if (mountedRef.current) {
        setIsTyping(false);
        setStreamingContent(null);
        setStreamingProvider(null);
        setStreamFinished(false);
      }
    }
  };
  const handleSendRef = useRef(handleSend);
  handleSendRef.current = handleSend;

  /**
   * Localized display name for the provider currently generating.
   */
  const providerLabel = useMemo(() => {
    switch (streamingProvider) {
      case "webllm":
        return t("onboarding_providerWebLLM", "WebLLM (Local)");
      case "gemini":
        return t("onboarding_providerGemini", "Google Gemini");
      case "ollama":
        return t("onboarding_providerOllama", "Ollama");
      case "openai":
        return t("onboarding_providerOpenAI", "OpenAI");
      case "anthropic":
        return t("onboarding_providerClaude", "Anthropic Claude");
      case "groq":
        return t("onboarding_providerGroq", "Groq");
      case "custom":
        return t("app_customProvider", "Custom (OpenAI Format)");
      default:
        return t("app_aiProvider", "AI Provider");
    }
  }, [streamingProvider, t]);

  useEffect(() => {
    if (pendingQueryRef.current) {
      handleSendRef.current(pendingQueryRef.current);
    }
  }, []);

  const renderMessageContent = (msg: Message) => {
    if (msg.role === "user") {
      return <p className="whitespace-pre-wrap">{msg.content}</p>;
    }

    const content = msg.isTranslationKey ? t(msg.content) : msg.content;

    return (
      <div className="markdown-body prose prose-sm dark:prose-invert max-w-none">
        <Markdown
          remarkPlugins={[remarkGfm]}
          components={{
            text: ({ node: _node, ...props }) => {
              const text = props.children as string;
              if (typeof text !== "string") {
                return <span>{props.children}</span>;
              }

              // Regex to find [Source X] or [Fuente X]
              const parts = text.split(/(\[(?:Source|Fuente)\s+\d+\])/gi);
              return (
                <span>
                  {parts.map((part, i) => {
                    const match = part.match(/\[(?:Source|Fuente)\s+(\d+)\]/i);
                    if (match && msg.sources) {
                      const index = parseInt(match[1] ?? "1", 10) - 1;
                      const source = msg.sources?.[index];
                      if (source) {
                        return (
                          <button
                            type="button"
                            key={`${msg.id ?? msg.content}-${i}`}
                            onClick={() =>
                              onSelectSource?.(source.type, source.id)
                            }
                            className="truncate inline-flex items-center px-1.5 py-0.5 mx-0.5 rounded font-bold text-[10px] transition-colors ds-radius-button ds-bg-accent-soft ds-text-accent ds-border-accent"
                          >
                            {part}
                          </button>
                        );
                      }
                    }
                    return part;
                  })}
                </span>
              );
            },
          }}
        >
          {content}
        </Markdown>
      </div>
    );
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex flex-col h-[calc(100vh-120px)] max-w-4xl mx-auto w-full overflow-hidden shadow-sm ds-card"
    >
      <h1 className="visually-hidden truncate">{t("app_chatLocal", "Local RAG Chat")}</h1>
      {/* Header: provider currently generating (only while streaming) */}
      {streamingProvider && !streamFinished && (
        <div className="flex justify-center pt-4">
          <span
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-[11px] font-semibold ds-bg-secondary ds-border ds-text-secondary"
            aria-live="polite"
          >
            <Sparkles className="size-3.5 animate-pulse ds-text-accent" />
            {t("app_generatingWith", "Generating with {{provider}}...", {
              provider: providerLabel,
            })}
          </span>
        </div>
      )}
      {/* Messages */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-6 space-y-8 no-scrollbar"
        role="log"
        aria-label={t("aria_chat_history", "Chat history")}
      >
        <AnimatePresence initial={false}>
          {messages.map((msg, idx) => (
            <motion.div
              key={msg.id ?? `${msg.role}-${msg.content.slice(0, 32)}-${idx}`}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className={`flex gap-4 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`flex min-w-0 max-w-[85%] flex-col ${msg.role === "user" ? "items-end" : "items-start"}`}
              >
                <div
                  className={`group relative min-w-0 max-w-full px-5 py-3 text-sm leading-relaxed break-words [overflow-wrap:anywhere] shadow-sm ds-radius-card ${msg.role === "user" ? "ds-bg-accent ds-text-on-accent" : "ds-bg-secondary ds-text-primary ds-border-divider"}`}
                >
                  {renderMessageContent(msg)}

                  {msg.isError && msg.retryQuery && (
                    <button
                      type="button"
                      onClick={() => void handleSend(msg.retryQuery)}
                      disabled={isTyping}
                      aria-label={t("app_retry", "Retry")}
                      className="mt-3 inline-flex max-w-full truncate items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-semibold ds-card ds-text-accent disabled:opacity-50"
                    >
                      <Sparkles className="size-3.5" aria-hidden="true" />
                      {t("app_retry", "Retry")}
                    </button>
                  )}

                  {!msg.isTranslationKey && msg.role === "assistant" && (
                    <button
                      onClick={() => copyToClipboard(msg.content, idx)}
                      aria-label={t("app_copy", "Copy")}
                      className="truncate absolute -end-10 top-0 p-2 opacity-0 group-hover:opacity-100 transition-opacity text-[var(--text-muted)] hover:text-[var(--text-secondary)] dark:hover:text-[var(--text-muted)]"
                    >
                      {copiedId === idx ? (
                        <Check className="size-4 ds-text-success" />
                      ) : (
                        <Copy className="size-4" />
                      )}
                    </button>
                  )}
                </div>

                {msg.sources && msg.sources.length > 0 && (
                  <div className="mt-3 w-full space-y-2">
                    <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest px-1 ds-text-muted">
                      <Info className="size-3" />
                      <span>{t("app_sources")}</span>
                      {msg.sourceOrigin === "local" && (
                        <span className="ms-1 text-[9px] px-1.5 py-0.5 rounded bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400">
                          {t("app_fromLibrary", "From your library")}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {msg.sources.map((s, i) => (
                        <button
                          type="button"
                          key={`${s.type}:${s.id}:${i}`}
                          onClick={() => onSelectSource?.(s.type, s.id)}
                          className="truncate flex items-center gap-2 px-3 py-1.5 rounded-xl transition-all group ds-bg-secondary ds-text-secondary border border-[var(--divider)] ds-text-tiny"
                        >
                          <span className="size-4 flex items-center justify-center rounded-full text-[9px] font-bold transition-colors ds-bg-card-plain ds-text-muted">
                            {i + 1}
                          </span>
                          {s.type === "bookmark" ? (
                            <Bookmark className="size-3 text-blue-500" />
                          ) : (
                            <FileText className="size-3 ds-text-success" />
                          )}
                          <span className="truncate max-w-[200px] font-medium">
                            {s.title}
                          </span>
                          <ChevronRight className="rtl-flip size-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {msg.groundingMetadata?.groundingChunks && (
                  <div className="mt-3 w-full space-y-2">
                    <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest px-1 ds-text-muted">
                      <Globe className="size-3" />
                      <span>{t("app_webSources")}</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {msg.groundingMetadata.groundingChunks.map(
                        (chunk: GroundingChunk, i: number) =>
                          chunk.web && (
                            <a
                              key={`${chunk.id || chunk.web.uri}:${i}`}
                              href={sanitizeUrl(chunk.web.uri)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-2 px-3 py-1.5 rounded-xl transition-all group ds-bg-secondary ds-text-secondary border border-[var(--divider)] ds-text-tiny"
                            >
                              <span className="size-4 flex items-center justify-center rounded-full text-[9px] font-bold transition-colors ds-bg-card-plain ds-text-muted">
                                {i + 1}
                              </span>
                              <ExternalLink className="size-3 text-blue-500" />
                              <span className="truncate max-w-[200px] font-medium">
                                {chunk.web.title || chunk.web.uri}
                              </span>
                            </a>
                          ),
                      )}
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
        {downloadProgress && (
          <div className="flex gap-4 w-full max-w-md">
            {" "}
            <div className="px-5 py-4 text-sm flex flex-col gap-2 w-full shadow-sm ds-radius-card ds-bg-secondary ds-border ds-text-secondary">
              <div className="flex items-center justify-between text-xs font-semibold">
                <span className="flex items-center gap-1.5 ds-text-accent">
                  <Sparkles className="size-4 animate-spin ds-text-accent" />
                  {t("app_downloadingModel", "Downloading Local AI Model...")}
                </span>
                <span>{Math.round(downloadProgress.progress * 100)}%</span>
              </div>
              <div className="w-full bg-[var(--bg-secondary)] dark:bg-[var(--bg-card)] h-2 rounded-full overflow-hidden">
                <div
                  className="h-full transition-all duration-300 ds-bg-accent"
                  style={{
                    width: `${downloadProgress.progress * 100}%`,
                  }}
                />
              </div>
              <p className="text-[10px] truncate ds-text-muted">
                {downloadProgress.text}
              </p>
            </div>
          </div>
        )}
        {isTyping && streamingContent !== null && (
          <div className="flex gap-4">
            <div className="flex min-w-0 max-w-[85%] flex-col items-start">
              <div className="group relative min-w-0 max-w-full px-5 py-3 text-sm leading-relaxed break-words [overflow-wrap:anywhere] shadow-sm ds-radius-card ds-bg-secondary ds-border ds-text-primary">
                <div className="markdown-body prose prose-sm dark:prose-invert max-w-none">
                  {deferredStreamingContent || (
                    <div className="flex gap-1">
                      <span
                        className="size-1.5 rounded-full animate-bounce ds-bg-muted"
                        style={{
                          animationDelay: "0ms",
                        }}
                      ></span>
                      <span
                        className="size-1.5 rounded-full animate-bounce ds-bg-muted"
                        style={{ animationDelay: "150ms" }}
                      ></span>
                      <span
                        className="size-1.5 rounded-full animate-bounce ds-bg-muted"
                        style={{ animationDelay: "300ms" }}
                      ></span>
                    </div>
                  )}
                </div>
              </div>
              {!streamFinished && (
                <button
                  onClick={handleStopGeneration}
                  className="truncate mt-2 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ds-bg-secondary ds-border ds-text-muted hover:ds-text-primary"
                  aria-label={t("app_stop", "Stop")}
                >
                <Square className="size-3.5" />
                  {t("app_stop", "Stop")}
                </button>
              )}
            </div>
          </div>
        )}
        {errorContent !== null && (
          <div className="flex gap-4" role="alert">
            <div className="flex min-w-0 max-w-[85%] flex-col items-start">
              <div className="min-w-0 max-w-full px-5 py-3 text-sm leading-relaxed break-words [overflow-wrap:anywhere] shadow-sm ds-radius-card ds-bg-secondary ds-border ds-text-primary">
                <div className="markdown-body prose prose-sm dark:prose-invert max-w-none">
                  {errorContent}
                </div>                    {errorAction === "settings" && (
                  <button
                    type="button"
                    onClick={() =>
                      window.dispatchEvent(
                        new CustomEvent("forge:open-settings", {
                          detail: { section: "ai" },
                        }),
                      )
                    }
                    aria-label={t("app_openAISettings", "Open AI settings")}
                    className="mt-3 inline-flex max-w-full truncate items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-semibold ds-card ds-text-accent"
                  >
                    {t("app_openAISettings", "Open AI settings")}
                  </button>
                )}
                {lastFailedQuery && (
                  <button
                    type="button"
                    onClick={() => void handleSend(lastFailedQuery)}
                    disabled={isTyping}
                    aria-label={t("app_retry", "Retry")}
                    className="mt-3 inline-flex max-w-full truncate items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-semibold ds-card ds-text-accent disabled:opacity-50"
                  >
                    <Sparkles className="size-3.5" aria-hidden="true" />
                    {t("app_retry", "Retry")}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
        {isTyping && streamingContent === null && (
          <div className="flex gap-4">
            <div className="px-5 py-3 text-sm flex items-center gap-2 ds-radius-card ds-bg-secondary ds-border ds-text-muted">
              <Sparkles className="size-4 animate-pulse ds-text-accent" />
              <div className="flex gap-1">
                <span
                  className="size-1 rounded-full animate-bounce ds-bg-muted"
                  style={{ animationDelay: "0ms" }}
                ></span>
                <span
                  className="size-1 rounded-full animate-bounce ds-bg-muted"
                  style={{ animationDelay: "150ms" }}
                ></span>
                <span
                  className="size-1 rounded-full animate-bounce ds-bg-muted"
                  style={{ animationDelay: "300ms" }}
                ></span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="p-6 ds-topbar">
        <div className="relative max-w-3xl mx-auto flex items-center gap-2">            <button
            type="button"
            aria-pressed={isWebSearch}
            onClick={() => setIsWebSearch(!isWebSearch)}
            className={`truncate p-3 transition-all rounded-2xl ${isWebSearch ? "ds-text-accent" : "ds-text-muted"}`}
            style={{
              background: isWebSearch
                ? "var(--accent-soft)"
                : "var(--bg-secondary)",
              border: isWebSearch
                ? "1px solid var(--accent-primary)"
                : "1px solid var(--divider)",
            }}
            title={
              isWebSearch ? t("app_webSearchEnabled") : t("app_enableWebSearch")
            }
            aria-label={
              isWebSearch
                ? t("app_webSearchEnabled", "Web Search enabled")
                : t("app_enableWebSearch", "Enable Web Search")
            }
          >
            <Globe className={`size-5 ${isWebSearch ? "animate-pulse" : ""}`} />
          </button>
          <button
            type="button"
            aria-pressed={isPrivateMode}
            onClick={() => setIsPrivateMode(!isPrivateMode)}
            className={`truncate p-3 transition-all rounded-2xl ${isPrivateMode ? "ds-text-accent" : "ds-text-muted"}`}
            style={{
              background: isPrivateMode
                ? "var(--accent-soft)"
                : "var(--bg-secondary)",
              border: isPrivateMode
                ? "1px solid var(--accent-primary)"
                : "1px solid var(--divider)",
            }}
            title={
              isPrivateMode
                ? t("app_privateModeEnabled", "Private mode: AI stays local")
                : t("app_enablePrivateMode", "Enable private mode")
            }
            aria-label={
              isPrivateMode
                ? t("app_privateModeEnabled", "Private mode: AI stays local")
                : t("app_enablePrivateMode", "Enable private mode")
            }
          >
            {isPrivateMode ? (
              <Shield className="size-5" />
            ) : (
              <ShieldOff className="size-5" />
            )}
          </button>
          <div className="relative flex-1">
            <input
              type="text"
              data-testid="chat-input"
              aria-label={
                isWebSearch
                  ? t("app_webSearchPlaceholder")
                  : t("app_chatPlaceholder")
              }
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSend()}
              placeholder={
                isWebSearch
                  ? t("app_webSearchPlaceholder")
                  : t(
                      "app_chatPlaceholder",
                      "Ask about your bookmarks and documents...",
                    )
              }
              className="w-full py-4 px-6 pe-14 text-sm transition-all shadow-sm outline-none ds-input ds-radius-input"
            />
            <button
              type="button"
              onClick={() => handleSend()}
              disabled={!input.trim() || isTyping}
              aria-label={t("app_send", "Send")}
              className="absolute end-2 top-1/2 -translate-y-1/2 p-2.5 hover:scale-105 active:scale-95 disabled:opacity-30 disabled:scale-100 transition-all shadow-lg ds-accent-filled"
            >
              <Send className="size-4" />
            </button>
          </div>
        </div>
        <div className="flex items-center justify-center gap-4 mt-4">
          <div className="h-px flex-1 bg-[var(--divider)]"></div>
          <p className="text-[10px] uppercase tracking-[0.2em] font-semibold flex items-center gap-1.5">
            {isWebSearch ? (
              <>
                <Globe className="size-3 text-blue-500" />
                <span className="ds-text-muted">
                  {t("app_webSearchEnabled", "Web Search")}
                </span>
              </>
            ) : isPrivateMode ? (
              <>
                <Shield className="size-3 ds-text-accent" />
                <span className="ds-text-accent">
                  {t("app_privateModeActive", "Private Mode — Local AI Only")}
                </span>
              </>
            ) : (
              <>
                <FileText className="size-3 ds-text-success" />
                <span className="ds-text-accent">
                  {t("app_localKnowledge", "Your Local Knowledge")}
                </span>
              </>
            )}
          </p>
          <div className="h-px flex-1 bg-[var(--divider)]"></div>
        </div>
      </div>
    </motion.div>
  );
}
