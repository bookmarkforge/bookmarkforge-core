import React, {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
} from "react";
import { motion, AnimatePresence } from "motion/react";
import { agentService } from "../services/ai/AgentService";
import {
  Send,
  Bot,
  HelpCircle,
  Sparkles,
  BookOpen,
  Activity,
  CheckCircle2,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  MessageCircle,
  Copy,
  Check,
  Trash2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  type SupportChatTabId,
} from "../constants/navigation";
import { SUPPORT_KNOWLEDGE } from "../data/SupportKnowledge";
import { safeGet, safeSet } from "../store/safeStorage";
import { STORAGE_KEYS } from "../constants/storage-keys";
import {
  checkIndexedDB,
  checkNetwork,
  checkOllama,
  checkWebGPU,
  checkWebLLM,
  checkWebRTC,
  formatBytes,
  getStorageEstimate,
} from "../services/SupportDiagnostics";
import { logger } from "../utils/logger";
import { logRateLimited } from "../utils/boundedLog";
import type { LocaleCode } from "../constants/locales";
import { useRequestGuard } from "../hooks/useRequestGuard";

interface Message {
  role: "user" | "assistant";
  content: string;
  isTranslationKey?: boolean;
}

const defaultSupportMessage = (): Message => ({
  role: "assistant",
  content: "app_supportChatWelcome",
  isTranslationKey: true,
});

/** Recover gracefully from a manually edited or truncated support history. */
const getInitialSupportMessages = (): Message[] => {
  const saved = safeGet(STORAGE_KEYS.BMF_SUPPORT_HISTORY);
  if (!saved) return [defaultSupportMessage()];

  try {
    const parsed: unknown = JSON.parse(saved);
    if (!Array.isArray(parsed)) return [defaultSupportMessage()];
    const valid = parsed.filter(
      (message): message is Message =>
        typeof message === "object" &&
        message !== null &&
        (message as Message).role !== undefined &&
        ((message as Message).role === "user" ||
          (message as Message).role === "assistant") &&
        typeof (message as Message).content === "string",
    );
    return valid.length > 0 ? valid : [defaultSupportMessage()];
  } catch {
    // Corrupted history must not crash the chat; surface it bounded so a
    // repeated storage failure is diagnosable.
    logRateLimited(
      "warn",
      "support-history-parse",
      "Stored support chat history is corrupted; starting fresh",
    );
    return [defaultSupportMessage()];
  }
};

const normalizeSupportText = (value: string): string =>
  value
    .toLocaleLowerCase()
    .normalize("NFD")
    .replace(/[\\u0300-\\u036f]/g, "");

const getSupportResponse = (query: string): string => {
  const q = normalizeSupportText(query);
  const hasSupportTerm = (term: string): boolean => {
    if (term.includes(" ")) return q.includes(term);      return new RegExp(`(?:^|[^\\p{L}\\p{N}])${term}(?:$|[^\\p{L}\\p{N}])`, "u").test(q);
  };

  // Greetings use token boundaries so words such as "this" do not match
  // the short English token "hi".
  if (hasSupportTerm("hi") || hasSupportTerm("hello") || hasSupportTerm("hola") || hasSupportTerm("hey"))
    {return "app_supportChatHi";}
  // Privacy & Security
  if (
    q.includes("privacy") || q.includes("privacidad") ||
    q.includes("seguridad") || q.includes("security") ||
    q.includes("gdpr") || q.includes("tracking") ||
    q.includes("telemetry") || q.includes("anonymous")
  )
    {return "app_supportChatPrivacy";}
  // Editor & Notes
  if (q.includes("editor") || q.includes("nota") || q.includes("note") ||
      q.includes("block") || q.includes("markdown") || q.includes("latex") ||
      q.includes("mermaid") || q.includes("diagram"))
    {return "app_supportChatEditor";}
  // Bookmarks
  if (q.includes("bookmark") || q.includes("marcador") ||
      q.includes("clip") || q.includes("capturar") || q.includes("capture"))
    {return "app_supportChatBookmarks";}
  // RAG & Local AI Chat
  if (q.includes("rag") || q.includes("local ai") || q.includes("ask") ||
      q.includes("pregunt") || q.includes("question"))
    {return "app_supportChatRAG";}
  // Theme & Appearance
  if (q.includes("theme") || q.includes("tema") || q.includes("dark") ||
      q.includes("light") || q.includes("font") || q.includes("color"))
    {return "app_supportChatTheme";}
  // Tutorials & Getting Started
  if (q.includes("tutorial") || q.includes("guia") || q.includes("guide") ||
      q.includes("start") || q.includes("empezar") || q.includes("begin"))
    {return "app_supportChatTutorials";}
  // Shortcuts & Keyboard
  if (q.includes("shortcut") || q.includes("teclado") || q.includes("atajo") ||
      q.includes("ctrl") || q.includes("hotkey") || q.includes("keyboard"))
    {return "app_supportChatShortcuts";}
  // Backup & Export
  if (q.includes("backup") || q.includes("copia") || q.includes("export") ||
      q.includes("bmf") || q.includes("restore") || q.includes("restaurar"))
    {return "app_supportChatBackup";}
  // AI Setup & Providers
  if (hasSupportTerm("ai") || q.includes("gemini") || q.includes("ollama") ||
      q.includes("openai") || q.includes("provider") || q.includes("model") ||
      q.includes("api key") || q.includes("token") || q.includes("webllm"))
    {return "app_supportChatAiSetup";}
  // Troubleshooting & Performance
  if (q.includes("slow") || q.includes("lento") || q.includes("crash") ||
      q.includes("lag") || q.includes("freeze") || q.includes("bug") ||
      q.includes("broken") || q.includes("roto") || q.includes("fail") ||
      q.includes("falla") || q.includes("error") || q.includes("problema"))
    {return "app_supportChatTroubleshoot";}
  // Sync & P2P
  if (q.includes("sync") || q.includes("sincronizar") ||
      q.includes("p2p") || q.includes("peer") || q.includes("webrtc"))
    {return "app_supportChatSync";}
  // Import & Migration
  if (q.includes("import") || q.includes("migrate") || q.includes("migrar") ||
      q.includes("notion") || q.includes("evernote") || q.includes("obsidian"))
    {return "app_supportChatMigration";}
  // Vault & Password
  if (q.includes("vault") || q.includes("boveda") || q.includes("password") ||
      q.includes("contrasena") || q.includes("lock") || q.includes("unlock") ||
      q.includes("forgot") || q.includes("olvid") || q.includes("recovery") ||
      q.includes("phrase") || q.includes("master"))
    {return "app_supportChatVault";}
  // Canvas
  if (q.includes("canvas") || q.includes("lienzo") || q.includes("whiteboard") ||
      q.includes("draw") || q.includes("dibuj"))
    {return "app_supportChatCanvas";}
  // Database / Table View
  if (q.includes("database") || q.includes("base de datos") ||
      q.includes("table") || q.includes("tabla") || q.includes("spreadsheet"))
    {return "app_supportChatDatabase";}
  // Kanban
  if (q.includes("kanban") || q.includes("board") || q.includes("column"))
    {return "app_supportChatKanban";}
  // Mobile & PWA
  if (q.includes("mobile") || q.includes("movil") || q.includes("phone") ||
      q.includes("pwa") || q.includes("ios") || q.includes("android") ||
      q.includes("install") || q.includes("instalar"))
    {return "app_supportChatMobile";}
  // License & Pro
  if (q.includes("license") || q.includes("licencia") || hasSupportTerm("pro") ||
      q.includes("activate") || q.includes("activar") || q.includes("buy") ||
      q.includes("comprar") || q.includes("price") || q.includes("precio") ||
      q.includes("trial") || q.includes("pago") || q.includes("payment"))
    {return "app_supportChatLicense";}
  // Flashcards & SRS
  if (q.includes("flashcard") || q.includes("srs") || q.includes("review") ||
      q.includes("repasar") || q.includes("memorize") || q.includes("memorizar"))
    {return "app_supportChatFlashcards";}
  // Graph & Visualization
  if (q.includes("graph") || q.includes("grafo") || q.includes("visualiz") ||
      q.includes("connection") || q.includes("conexi") || q.includes("node"))
    {return "app_supportChatGraph";}
  // Voice Commands
  if (q.includes("voice") || q.includes("voz") || q.includes("speech") ||
      q.includes("mic") || q.includes("dictate") || q.includes("dictar"))
    {return "app_supportChatVoice";}
  // Search & Omnibar
  if (q.includes("search") || q.includes("buscar") || q.includes("find") ||
      q.includes("encontrar") || q.includes("omnibar") || q.includes("ctrl+k"))
    {return "app_supportChatSearch";}
  // Collaboration & Sharing
  if (q.includes("collaborat") || q.includes("colabor") || q.includes("share") ||
      q.includes("compartir") || q.includes("team") || q.includes("equipo"))
    {return "app_supportChatCollaboration";}
  // Offline
  if (q.includes("offline") || q.includes("sin conexi") ||
      q.includes("no internet") || q.includes("sin internet") ||
      q.includes("airplane") || q.includes("avion"))
    {return "app_supportChatOffline";}
  // Storage & Space
  if (q.includes("storage") || q.includes("almacenamiento") ||
      q.includes("space") || q.includes("espacio") || q.includes("quota") ||
      q.includes("full") || q.includes("lleno") || q.includes("size"))
    {return "app_supportChatStorage";}
  return "app_supportChatDefault";
};

const SupportChat = function SupportChat() {
  const { t, i18n } = useTranslation();
  // i18next can expose a regional BCP-47 tag (for example `pt-BR`).
  // Resolve it to the canonical 30-locale code before selecting the FAQ
  // knowledge base or passing the language to the support agent.
  const lang = i18n.language.split("-")[0] as LocaleCode;

  const [activeTab, setActiveTab] = useState<"chat" | "faq" | "diagnostics">(
    "chat",
  );
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  // --- CHAT STATE ---
  const [messages, setMessages] = useState<Message[]>(
    getInitialSupportMessages,
  );
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const sendInFlightRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const responseTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const diagTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const diagRunIdRef = useRef(0);
  // Deliberate manual guard — the send flow cannot map to useGuardedAction:
  // reentry is blocked synchronously via sendInFlightRef (a second Enter must
  // be dropped before any await), the knowledge-base path owns its isTyping
  // reset inside a delayed timer, and the guard's only other job is dropping
  // results after unmount (which the unmount cleanup below also does via the
  // diagRunId bump). The boolean isRunning + onSuccess/onError contract would
  // fight the timer path instead of consolidating it.
  const {
    begin: beginChat,
    isCurrent: isChatCurrent,
    cancel: cancelChat,
  } = useRequestGuard();
  // Reports are independent from chat requests. Copying a diagnostic report
  // must not invalidate a pending support answer or leave its composer stuck.
  const {
    begin: beginReport,
    isCurrent: isReportCurrent,
  } = useRequestGuard();
  const activeChatGenerationRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      clearTimeout(responseTimerRef.current);
      clearTimeout(diagTimerRef.current);
      clearTimeout(copyTimerRef.current);
      // Invalidate any diagnostics run still in flight after unmount so a
      // late probe result cannot set state on a component that is gone.
      diagRunIdRef.current += 1;
      activeChatGenerationRef.current = null;
    };
  }, []);

  useEffect(() => {
    safeSet(STORAGE_KEYS.BMF_SUPPORT_HISTORY, JSON.stringify(messages));
    if (activeTab === "chat" && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isTyping, activeTab]);

  const quickActions = [
    { label: t("app_supportActionTutorials", "Tutorials"), query: "getting started" },
    { label: t("app_supportActionBackup", "Backups"), query: "backup" },
    { label: t("app_supportActionPrivacy", "Privacy"), query: "privacy" },
    { label: t("app_supportActionLocalAi", "Local AI"), query: "ai setup" },
    { label: t("app_supportActionSync", "Sync"), query: "sync p2p" },
    { label: t("app_supportActionShortcuts", "Shortcuts"), query: "shortcuts" },
    { label: t("app_supportActionImport", "Import"), query: "import notion" },
    { label: t("app_supportActionMobile", "Mobile"), query: "mobile pwa" },
  ];

  const handleSend = useCallback(
    async (customQuery?: string) => {
      const userQuery = customQuery || input;
      if (!userQuery.trim() || sendInFlightRef.current || isTyping) {return;}
      const request = beginChat();
      activeChatGenerationRef.current = request.generation;
      sendInFlightRef.current = true;

      setMessages((prev) => [...prev, { role: "user", content: userQuery }]);
      setInput("");
      setIsTyping(true);

      try {
        const responseKey = getSupportResponse(userQuery);

        if (responseKey !== "app_supportChatDefault") {
          clearTimeout(responseTimerRef.current);
          responseTimerRef.current = setTimeout(() => {
            responseTimerRef.current = undefined;
            // A clear-history action or another guarded operation may have
            // superseded this delayed canned response. Do not append it to a
            // history the user has already cleared.
            if (
              activeChatGenerationRef.current !== request.generation ||
              !isChatCurrent(request.generation)
            ) {return;}
            setMessages((prev) => [
              ...prev,
              {
                role: "assistant",
                content: responseKey,
                isTranslationKey: true,
              },
            ]);
            setIsTyping(false);
            sendInFlightRef.current = false;
          }, 800);
        } else {
          try {
            const response = await agentService.supportChat(userQuery, lang);
            // Only the message append is stale-gated — the typing/reset below
            // must ALWAYS run, or a superseded send (e.g. Copy Report begun
            // while the AI answers) leaks isTyping=true and disables the
            // input forever.
            if (isChatCurrent(request.generation)) {
              setMessages((prev) => [
                ...prev,
                { role: "assistant", content: response },
              ]);
            }
          } catch (err) {
            if (isChatCurrent(request.generation)) {
              logger.error("[SupportChat] AI service call failed", err);
              setMessages((prev) => [
                ...prev,
                {
                  role: "assistant",
                  content: "app_supportChatDefault",
                  isTranslationKey: true,
                },
              ]);
            }
          }
          if (activeChatGenerationRef.current === request.generation) {
            activeChatGenerationRef.current = null;
            setIsTyping(false);
            sendInFlightRef.current = false;
          }
        }
      } catch (err) {
        if (activeChatGenerationRef.current === request.generation) {
          activeChatGenerationRef.current = null;
          setIsTyping(false);
          sendInFlightRef.current = false;
        }
        if (!isChatCurrent(request.generation)) {return;}
        logger.error("[SupportChat] send handler failed", err);
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: "app_supportChatDefault",
            isTranslationKey: true,
          },
        ]);
      }
    },
    [input, isTyping, lang, beginChat, isChatCurrent],
  );

  const clearHistory = () => {
    // Clearing history is also a cancellation boundary. Without invalidating
    // the request guard, a delayed FAQ response or a late AI response could
    // repopulate the history immediately after the user confirmed deletion.
    clearTimeout(responseTimerRef.current);
    responseTimerRef.current = undefined;
    cancelChat();
    activeChatGenerationRef.current = null;
    sendInFlightRef.current = false;
    setIsTyping(false);
    setMessages([
      {
        role: "assistant",
        content: "app_supportChatWelcome",
        isTranslationKey: true,
      },
    ]);
  };

  const handleTabClick = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      const tabId = e.currentTarget.getAttribute("data-tab-id") as
        SupportChatTabId | null;
      if (tabId) {
        setActiveTab(tabId);
        setShowClearConfirm(false);
      }
    },
    [setActiveTab],
  );

  const handleFaqToggle = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      const idx = parseInt(
        e.currentTarget.getAttribute("data-faq-index") ?? "",
        10,
      );
      if (!isNaN(idx)) {setOpenFaq((prev) => (prev === idx ? null : idx));}
    },
    [],
  );

  // --- FAQ STATE ---
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const faqData = SUPPORT_KNOWLEDGE[lang] || SUPPORT_KNOWLEDGE.en;
  const faqList = useMemo(
    () =>
      Object.entries(faqData!.FAQ_EXTENDED).map(([q, a]) => ({
        q,
        a,
      })),
    [faqData],
  );

  // --- DIAGNOSTICS STATE ---
  const [isDiagnosing, setIsDiagnosing] = useState(false);
  const [reportCopied, setReportCopied] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [diagResults, setDiagResults] = useState<
    {
      id: string;
      name: string;
      status: "pending" | "ok" | "error";
      details?: string;
    }[]
  >([
    {
      id: "storage",
      name: t("app_diagStorage", "Storage (IndexedDB)"),
      status: "pending",
    },
    {
      id: "webrtc",
      name: t("app_diagWebRTC", "P2P Connectivity (WebRTC)"),
      status: "pending",
    },
    {
      id: "webgpu",
      name: t("app_diagWebGPU", "Local AI Capability (WebGPU)"),
      status: "pending",
    },
    {
      id: "network",
      name: t("app_diagNetwork", "Network Status"),
      status: "pending",
    },
    {
      id: "ollama",
      name: t("app_diagOllama", "Local AI (Ollama)"),
      status: "pending",
    },
    {
      id: "webllm",
      name: t("app_diagWebLLM", "Local AI (WebLLM)"),
      status: "pending",
    },
  ]);

  const runDiagnostics = useCallback(() => {
    setIsDiagnosing(true);
    setDiagResults((prev) =>
      prev.map((d) => ({ ...d, status: "pending", details: undefined })),
    );

    clearTimeout(diagTimerRef.current);
    // Real browser probes run in parallel. The short delay keeps the
    // "Verifying status…" pending state visible instead of flashing results.
    // `runId` guards against stale runs: a new run increments it, so a
    // slower previous run can never overwrite newer results.
    const runId = ++diagRunIdRef.current;
    diagTimerRef.current = setTimeout(async () => {
      try {
        const [idbOk, estimate, webRtc, gpuOk, network, ollama, webLlm] =
          await Promise.all([
            checkIndexedDB(),
            getStorageEstimate(),
            checkWebRTC(),
            checkWebGPU(),
            checkNetwork(),
            checkOllama(),
            checkWebLLM(),
          ]);

        if (runId !== diagRunIdRef.current) {return;}

        setDiagResults((prev) =>
          prev.map((d) => {
            if (d.id === "storage") {
              if (!idbOk) {
                return {
                  ...d,
                  status: "error",
                  details: t(
                    "app_diagStorageError",
                    "Database write/read test failed. Storage may be full or blocked.",
                  ),
                };
              }
              if (estimate && estimate.quotaBytes > 0) {
                return {
                  ...d,
                  status: "ok",
                  details: `${t(
                    "app_diagStorageOk",
                    "The database is healthy and has enough space.",
                  )} ${t(
                    "app_diagStorageUsage",
                    "Using {{usage}} of {{quota}}.",
                    {
                      usage: formatBytes(estimate.usageBytes),
                      quota: formatBytes(estimate.quotaBytes),
                    },
                  )}`,
                };
              }
              return {
                ...d,
                status: "ok",
                details: t(
                  "app_diagStorageOk",
                  "The database is healthy and has enough space.",
                ),
              };
            }
            if (d.id === "webrtc") {
              if (webRtc.status === "ok") {
                const elapsed =
                  webRtc.elapsedMs !== null ? ` (${webRtc.elapsedMs} ms)` : "";
                return {
                  ...d,
                  status: "ok",
                  details: `${t(
                    "app_diagWebRTCOk",
                    "The WebRTC API is available for P2P synchronization.",
                  )}${elapsed}`,
                };
              }
              return {
                ...d,
                status: "error",
                details: t(
                  "app_diagWebRTCError",
                  "WebRTC API is unavailable. P2P synchronization will not work.",
                ),
              };
            }
            if (d.id === "webgpu") {
              return gpuOk
                ? {
                    ...d,
                    status: "ok",
                    details: t(
                      "app_diagWebGPUOk",
                      "WebGPU enabled. Local AI models can run.",
                    ),
                  }
                : {
                    ...d,
                    status: "error",
                    details: t(
                      "app_diagWebGPUError",
                      "WebGPU not detected. Only cloud AI will work.",
                    ),
                  };
            }
            if (d.id === "network") {
              if (!network.online) {
                return {
                  ...d,
                  status: "error",
                  details: t(
                    "app_diagNetworkOffline",
                    "You are offline. Cloud AI and web search are unavailable.",
                  ),
                };
              }
              const connectionLabel = network.effectiveType
                ? [network.effectiveType, network.saveData ? "saveData" : null]
                    .filter(Boolean)
                    .join(", ")
                : "online";
              return {
                ...d,
                status: "ok",
                details: t(
                  "app_diagNetworkOk",
                  "You are online ({{connection}}).",
                  { connection: connectionLabel },
                ),
              };
            }
            if (d.id === "ollama") {
              const url = ollama.url ?? "localhost:11434";
              return ollama.available
                ? {
                    ...d,
                    status: "ok",
                    details: t(
                      "app_diagOllamaOk",
                      "Ollama is reachable at {{url}}.",
                      { url },
                    ),
                  }
                : {
                    ...d,
                    status: "error",
                    details: t(
                      "app_diagOllamaError",
                      "Ollama is not running at {{url}}. Start the Ollama app.",
                      { url },
                    ),
                  };
            }
            if (d.id === "webllm") {
              if (!webLlm.canRun) {
                // Name the precise cause when the probe produced a verdict,
                // mirroring the capability errors the generation gates throw
                // (same ladder: WebGPU surface -> shader-f16 -> 4 GB RAM).
                // The generic fallback stays for the verdict-less case (the
                // probe itself failed), so a broken probe degrades to the
                // honest "something is required" message instead of a wrong
                // specific one.
                const blockerMessage =
                  webLlm.blocker === "webgpu-unavailable"
                    ? t(
                        "app_diagWebLLMBlockerWebGPU",
                        "WebLLM cannot run: this browser does not support WebGPU.",
                      )
                    : webLlm.blocker === "shader-f16-unsupported"
                      ? t(
                          "app_diagWebLLMBlockerF16",
                          "WebLLM cannot run: the GPU lacks shader-f16 (half-precision) support.",
                        )
                      : webLlm.blocker === "insufficient-memory"
                        ? t(
                            "app_diagWebLLMBlockerRAM",
                            "WebLLM cannot run: at least 4 GB of device memory is required.",
                          )
                        : t(
                            "app_diagWebLLMError",
                            "WebLLM cannot run: WebGPU or sufficient RAM is required.",
                          );
                return {
                  ...d,
                  status: "error",
                  details: blockerMessage,
                };
              }
              const modelDetail =
                webLlm.modelLoaded && webLlm.currentModel
                  ? ` ${t(
                      "app_diagWebLLMModel",
                      "Model loaded: {{model}}",
                      { model: webLlm.currentModel },
                    )}`
                  : ` ${t(
                      "app_diagWebLLMNotLoaded",
                      "Model not loaded yet.",
                    )}`;
              return {
                ...d,
                status: "ok",
                details: `${t(
                  "app_diagWebLLMOk",
                  "WebLLM is ready on this device.",
                )}${modelDetail}`,
              };
            }
            return d;
          }),
        );
      } finally {
        // Always end the "diagnosing" state, even if a probe rejected —
        // but only when this run is still the latest one.
        if (runId === diagRunIdRef.current) {setIsDiagnosing(false);}
      }
    }, 1200);
  }, [setIsDiagnosing, setDiagResults, t]);

  useEffect(() => {
    if (
      activeTab === "diagnostics" &&
      diagResults[0]!.status === "pending" &&
      !isDiagnosing
    ) {
      Promise.resolve().then(() => runDiagnostics());
    }
  }, [activeTab, diagResults, isDiagnosing, runDiagnostics]);

  /**
   * Exports the current diagnostics results as readable plain-text JSON and
   * copies it to the clipboard so the user can paste it into support chat.
   * Falls back to a hidden-textarea + execCommand copy on non-secure
   * contexts where `navigator.clipboard` is unavailable.
   */
  const copyReport = useCallback(async () => {
    const request = beginReport();
    const report = {
      app: "BookmarkForge",
      generatedAt: new Date().toISOString(),
      language: i18n.language,
      userAgent:
        typeof navigator !== "undefined" ? navigator.userAgent : undefined,
      results: diagResults.map((d) => ({
        id: d.id,
        name: d.name,
        status: d.status,
        details: d.details,
      })),
    };
    const text = JSON.stringify(report, null, 2);
    try {
      let copied = false;
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        copied = true;
      } else {
        // Fallback for non-secure contexts: the textarea is always removed
        // (finally) even when execCommand throws.
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        try {
          textarea.select();
          copied = document.execCommand("copy");
        } finally {
          document.body.removeChild(textarea);
        }
      }
      if (!copied) {return;}
      if (!isReportCurrent(request.generation)) {return;}
      setReportCopied(true);
      clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => {
        if (isReportCurrent(request.generation)) {setReportCopied(false);}
      }, 2000);
    } catch {
      // Clipboard unavailable — leave the button untouched, but leave a
      // bounded trace so the missing capability is diagnosable.
      logRateLimited(
        "warn",
        "support-copy-clipboard",
        "Clipboard write failed; copy report unavailable",
      );
    }
  }, [diagResults, i18n.language, beginReport, isReportCurrent]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex flex-col md:flex-row h-full max-w-7xl mx-auto w-full rounded-3xl shadow-2xl overflow-hidden ds-card"
    >
      {/* Sidebar Navigation */}
      <div
        role="tablist"
        aria-orientation="horizontal"
        aria-label={t("app_supportChatTitle", "Support navigation")}
        className="w-full md:w-60 border-b md:border-b-0 md:border-r flex flex-row md:flex-col p-4 gap-2 shrink-0 ds-bg-secondary ds-border-divider"
      >
        <div className="hidden md:block px-2 pb-4 mb-4 ds-divider-b">              <h2 className="ds-h3 flex items-center gap-2 min-w-0 line-clamp-2">

            <HelpCircle className="size-5 ds-text-accent" />
            {t("app_supportCenter", "Help Center")}
          </h2>
          <p className="text-xs mt-1 ds-text-muted">
            {t("app_supportAuto247", "Automatic 24/7 Support")}
          </p>
        </div>

        {((): React.ReactElement[] => {
          // Tab ids come from the canonical shared array in
          // src/constants/navigation.ts (also consumed by the E2E selector
          // gate); the union type keeps this list drift-proof.
          type TabId = SupportChatTabId;
          const tabs: Array<{
            id: TabId;
            Icon: React.ComponentType<{ className?: string }>;
            label: string;
          }> = [
            {
              id: "chat",
              Icon: MessageCircle,
              label: t("app_supportAIAssist", "AI Assistant"),
            },
            {
              id: "faq",
              Icon: BookOpen,
              label: t("app_supportKnowledge", "Knowledge Base"),
            },
            {
              id: "diagnostics",
              Icon: Activity,
              label: t("app_supportDiag", "Diagnostics"),
            },
          ];
          return tabs.map((tab) => (
            <button
              key={tab.id}
              role="tab"
              aria-selected={activeTab === tab.id}
              onClick={handleTabClick}
              data-tab-id={tab.id}
              className={`truncate ds-side-tab${activeTab === tab.id ? " is-active" : ""}`}
            >
              <tab.Icon className="size-5 shrink-0" />
              <span className="hidden md:inline truncate text-xs font-semibold uppercase tracking-widest">
                {tab.label}
              </span>
            </button>
          ));
        })()}
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col h-[600px] md:h-auto relative bg-app-bg">
        {/* TAB: CHAT */}
        {activeTab === "chat" && (
          <>
            <div className="relative p-4 flex items-center justify-between shrink-0 ds-bg-secondary ds-divider-b">
              <div className="flex items-center gap-3">
                <div className="relative">
                  <div className="size-10 rounded-xl flex items-center justify-center shadow-lg ds-accent-filled ds-shadow-accent">
                    <Sparkles className="size-5 text-white" />
                  </div>
                  <div className="absolute -bottom-1 -right-1 size-3.5 rounded-full ds-bg-success ds-border-card" />
                </div>
                <div>
                  <h3 className="ds-label-section truncate min-w-0">
                    {t("app_bmfConcierge", "BMF Concierge")}
                  </h3>
                  <div className="flex items-center gap-1.5">
                    <span className="size-1.5 rounded-full animate-pulse ds-bg-success" />
                    <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-700 dark:ds-text-success">
                      {t("app_onlineSecure", "Online & Secure")}
                    </span>
                  </div>
                </div>
              </div>
              <button
                onClick={() => setShowClearConfirm(true)}
                className="p-2 transition-colors ds-text-muted hover:ds-text-danger"
                aria-label={t("app_clearHistory", "Clear History")}
                title={t("app_clearHistory", "Clear History")}
              >
                <Trash2 className="size-4" />
              </button>
              <AnimatePresence>
                {showClearConfirm && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="absolute end-4 top-16 z-50 w-72 p-4 rounded-xl shadow-2xl ds-card ds-border"
                    role="alertdialog"
                    aria-label={t("app_confirm", "Confirm")}
                  >
                    <p className="text-sm font-medium ds-text-primary mb-3">
                      {t("app_confirmClearHistory", "Clear all chat history? This cannot be undone.")}
                    </p>
                    <div className="flex gap-2 justify-end">
                      <button
                        onClick={() => setShowClearConfirm(false)}
                        className="truncate px-3 py-1.5 rounded-lg text-xs font-bold ds-btn-text"
                      >
                        {t("app_cancel", "Cancel")}
                      </button>
                      <button
                        onClick={() => {
                          setShowClearConfirm(false);
                          clearHistory();
                        }}
                        className="truncate px-3 py-1.5 rounded-lg text-xs font-bold text-white ds-bg-danger"
                      >
                        {t("app_delete", "Delete")}
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <div
              ref={scrollRef}
              className="flex-1 min-w-0 overflow-y-auto p-4 space-y-4"
              role="log"
              aria-live="polite"
            >
              {messages.map((msg, idx) => (
                <motion.div
                  key={idx}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`flex gap-3 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  {msg.role === "assistant" && (
                    <div className="size-8 rounded-xl flex items-center justify-center shrink-0 ds-bg-muted">
                      <Bot className="size-4 ds-text-muted" />
                    </div>
                  )}
                  <div
                    className={`flex min-w-0 max-w-[85%] flex-col ${msg.role === "user" ? "items-end" : "items-start"}`}
                  >
                    <div
                      className={`min-w-0 max-w-full px-4 py-2.5 rounded-2xl text-sm leading-relaxed break-words [overflow-wrap:anywhere] shadow-sm ${msg.role === "user" ? "ds-bg-inverse ds-text-inverse font-medium" : "ds-bg-secondary ds-text-primary ds-border-divider"}`}
                    >
                      {msg.isTranslationKey ? t(msg.content) : msg.content}
                    </div>
                  </div>
                </motion.div>
              ))}
              {isTyping && (
                <div className="flex gap-3">
                  <div className="size-8 rounded-xl flex items-center justify-center ds-bg-muted">
                    <Bot className="size-4 animate-pulse ds-text-muted" />
                  </div>
                  <div className="px-4 py-3 rounded-2xl flex items-center gap-1.5 ds-bg-secondary ds-border">
                    <span
                      className="size-1.5 rounded-full animate-bounce ds-bg-text-muted"
                      style={{ animationDelay: "0ms" }}
                    />
                    <span
                      className="size-1.5 rounded-full animate-bounce ds-bg-text-muted"
                      style={{ animationDelay: "150ms" }}
                    />
                    <span
                      className="size-1.5 rounded-full animate-bounce ds-bg-text-muted"
                      style={{ animationDelay: "300ms" }}
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="p-4 shrink-0 ds-bg-secondary ds-divider-t">
              <div className="flex flex-wrap gap-2 mb-3">
                {quickActions.map((action) => (
                  <button
                    key={action.query}
                    onClick={() => handleSend(action.query)}
                    className="truncate px-3 py-1 rounded-full text-xs font-semibold transition-all shadow-sm ds-card"
                  >
                    {action.label}
                  </button>
                ))}
              </div>
              <div className="relative group">
                <input
                  type="text"
                  aria-label={t("app_typeMessage", "Type a message")}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSend()}
                  placeholder={t("app_chatPlaceholder", "Type a message...")}
                  className="w-full rounded-2xl py-4 px-6 pe-14 text-sm transition-all shadow-sm focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)] ds-card"
                />
                <button
                  onClick={() => handleSend()}
                  disabled={!input.trim() || isTyping}
                  aria-label={t("app_send", "Send")}
                  className="absolute end-2 top-1/2 -translate-y-1/2 p-2.5 rounded-xl hover:scale-105 active:scale-95 disabled:opacity-30 disabled:scale-100 transition-all shadow-lg ds-accent-filled"
                >
                  <Send className="size-4" />
                </button>
              </div>
            </div>
          </>
        )}

        {/* TAB: FAQ */}
        {activeTab === "faq" && (
          <div className="flex-1 min-w-0 overflow-y-auto p-6">
            <h3 className="ds-h3 mb-6 line-clamp-2">
              {t("app_supportFaqTitle", "Frequently Asked Questions")}
            </h3>
            <div className="space-y-3">
              {faqList.map((faq, index) => (
                <div key={faq.q} className="rounded-xl overflow-hidden ds-card">
                  <button
                    onClick={handleFaqToggle}
                    data-faq-index={index}
                    className="w-full min-w-0 truncate text-start px-5 py-4 flex items-center justify-between transition-colors"
                    title={faq.q}
                  >
                    <span className="min-w-0 truncate font-bold text-sm ds-text-primary">
                      {faq.q}
                    </span>
                    {openFaq === index ? (
                      <ChevronUp className="size-4 ds-text-muted" />
                    ) : (
                      <ChevronDown className="size-4 ds-text-muted" />
                    )}
                  </button>
                  <AnimatePresence>
                    {openFaq === index && (
                      <motion.div
                        initial={{ height: 0 }}
                        animate={{ height: "auto" }}
                        exit={{ height: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="px-5 pb-4 text-sm leading-relaxed pt-3 ds-divider-t ds-text-secondary">
                          {typeof faq.a === "string" ? faq.a : String(faq.a)}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              ))}
            </div>

            <div className="mt-8 p-4 rounded-xl ds-bg-accent-soft ds-border-accent">
              <h4 className="font-semibold text-sm mb-2 ds-text-accent line-clamp-2">
                {t("app_supportNotFoundTitle", "Can't find your answer?")}
              </h4>
              <p className="text-xs mb-3 ds-text-secondary">
                {t(
                  "app_supportNotFoundDesc",
                  "The AI Assistant (BMF Concierge) has been trained with all tutorials and usage guides. Use the Chat tab to ask specific questions and resolve your issue instantly.",
                )}
              </p>
              <button
                onClick={handleTabClick}
                data-tab-id="chat"
                className="truncate text-xs font-bold btn-primary ds-px-md"
              >
                {t("app_supportGoToAi", "Go to AI Assistant")}
              </button>
            </div>
          </div>
        )}

        {/* TAB: DIAGNOSTICS */}
        {activeTab === "diagnostics" && (
          <div className="flex-1 min-w-0 overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-6">
              <h3 className="ds-h3 line-clamp-2">
                {t("app_supportDiagTitle", "System Diagnostics")}
              </h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={copyReport}
                  className="truncate flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors shadow-sm ds-card"
                  title={t(
                    "app_diagCopyReportTitle",
                    "Copy the diagnostics report as JSON",
                  )}
                >
                  {reportCopied ? (
                    <Check className="size-3.5 ds-text-success" />
                  ) : (
                    <Copy className="size-3.5" />
                  )}
                  {reportCopied
                    ? t("app_diagCopyReportCopied", "Copied!")
                    : t("app_diagCopyReport", "Copy Report")}
                </button>
                <button
                  onClick={runDiagnostics}
                  disabled={isDiagnosing}
                  className="truncate flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold disabled:opacity-50 transition-colors shadow-sm ds-card"
                >
                  <RefreshCw
                    className={`size-3.5 ${isDiagnosing ? "animate-spin" : ""}`}
                  />
                  {t("app_supportDiagReeval", "Re-evaluate")}
                </button>
              </div>
            </div>

            <p className="text-sm mb-6 ds-text-muted">
              {t(
                "app_supportDiagDesc",
                "This tool automatically checks your browser's local components to ensure BookmarkForge works correctly.",
              )}
            </p>

            <div className="space-y-4">
              {diagResults.map((diag) => (
                <div
                  key={diag.id}
                  className="p-4 rounded-xl flex items-start gap-4 shadow-sm ds-card"
                >
                  <div className="mt-0.5">
                    {diag.status === "pending" && (
                      <RefreshCw className="size-5 animate-spin ds-text-muted" />
                    )}
                    {diag.status === "ok" && (
                      <CheckCircle2 className="size-5 ds-text-success" />
                    )}
                    {diag.status === "error" && (
                      <AlertCircle className="size-5 ds-text-warning" />
                    )}
                  </div>
                  <div className="flex-1">
                    <h4 className="font-semibold text-sm ds-text-primary truncate min-w-0">
                      {diag.name}
                    </h4>
                    {diag.details ? (
                      <p
                        className="text-xs mt-1"
                        style={{
                          color:
                            diag.status === "error"
                              ? "var(--color-warning)"
                              : "var(--text-muted)",
                        }}
                      >
                        {diag.details}
                      </p>
                    ) : (
                      <p className="text-xs mt-1 ds-text-muted">
                        {t("app_supportDiagVerifying", "Verifying status...")}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-8 p-5 rounded-xl shadow-lg ds-bg-inverse ds-border ds-text-inverse">
              <h4 className="font-semibold text-sm mb-2 flex items-center gap-2 line-clamp-2">
                <Bot className="size-4 ds-text-success" />
                {t(
                  "app_supportDiagGuaranteedTitle",
                  "Guaranteed Automatic Support",
                )}
              </h4>
              <p className="text-xs leading-relaxed mb-4 ds-text-muted">
                {t(
                  "app_supportDiagGuaranteedDesc",
                  "BookmarkForge is a Local-First application. This means 99% of issues are resolved by refreshing the page (F5) or restoring from a backup file (.bmf). There is no central database that can fail. You have absolute control over your data.",
                )}
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => window.location.reload()}
                  className="truncate px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ds-card"
                >
                  {t("app_supportDiagRefresh", "Refresh App (F5)")}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
};

export default SupportChat;
