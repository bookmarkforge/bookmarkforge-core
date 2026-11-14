/**
 * Support-chat canned responses and history recovery.
 *
 * Extracted from SupportChat.tsx: the keyword→translation-
 * key responder and the persisted-history parser are pure logic with no
 * React dependency, so they live here where both the component and tests can
 * reach them without pulling the whole chat UI into the bundle graph.
 */
import { safeGet } from "../store/safeStorage";
import { STORAGE_KEYS } from "../constants/storage-keys";
import { logRateLimited } from "./boundedLog";

export interface SupportChatMessage {
  role: "user" | "assistant";
  content: string;
  isTranslationKey?: boolean;
}

const defaultSupportMessage = (): SupportChatMessage => ({
  role: "assistant",
  content: "app_supportChatWelcome",
  isTranslationKey: true,
});

/** Recover gracefully from a manually edited or truncated support history. */
export const getInitialSupportMessages = (): SupportChatMessage[] => {
  const saved = safeGet(STORAGE_KEYS.BMF_SUPPORT_HISTORY);
  if (!saved) return [defaultSupportMessage()];

  try {
    const parsed: unknown = JSON.parse(saved);
    if (!Array.isArray(parsed)) return [defaultSupportMessage()];
    const valid = parsed.filter(
      (message): message is SupportChatMessage =>
        typeof message === "object" &&
        message !== null &&
        (message as SupportChatMessage).role !== undefined &&
        ((message as SupportChatMessage).role === "user" ||
          (message as SupportChatMessage).role === "assistant") &&
        typeof (message as SupportChatMessage).content === "string",
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
    .replace(/[\u0300-\u036f]/g, "");

export const getSupportResponse = (query: string): string => {
  const q = normalizeSupportText(query);
  const hasSupportTerm = (term: string): boolean => {
    if (term.includes(" ")) return q.includes(term);      return new RegExp(`(?:^|[^\\p{L}\\p{N}])${term}(?:$|[^\\p{L}\\p{N}])`, "u").test(q);
  };

  // Greetings use token boundaries so words such as "this" do not match
  // the short English token "hi".
  if (hasSupportTerm("hi") || hasSupportTerm("hello") || hasSupportTerm("hola") || hasSupportTerm("hey"))
    {return "app_supportChatHi";}
  // Privacy & Security (incl. GDPR data-deletion requests — a top ticket)
  if (
    q.includes("privacy") || q.includes("privacidad") ||
    q.includes("seguridad") || q.includes("security") ||
    q.includes("gdpr") || q.includes("tracking") ||
    q.includes("telemetry") || q.includes("anonymous") ||
    q.includes("delete my data") || q.includes("delete account") ||
    q.includes("delete all my") || q.includes("borrar mis datos") ||
    q.includes("eliminar cuenta") || q.includes("right to be forgotten") ||
    q.includes("derecho al olvido")
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
  // Refunds — must precede License: "refund my pro license" contains
  // license keywords but the intent is the refund flow, not activation.
  if (q.includes("refund") || q.includes("reembolso") ||
      q.includes("money back") || q.includes("devolucion") ||
      q.includes("chargeback") || q.includes("reimburse"))
    {return "app_supportChatRefund";}
  // License & Pro (incl. LTD codes, discounts, coupons)
  if (q.includes("license") || q.includes("licencia") || hasSupportTerm("pro") ||
      q.includes("activate") || q.includes("activar") || q.includes("buy") ||
      q.includes("comprar") || q.includes("price") || q.includes("precio") ||
      q.includes("pago") || q.includes("payment") ||
      q.includes("discount") || q.includes("descuento") ||
      q.includes("coupon") || q.includes("cupon") ||
      q.includes("appsumo") || q.includes("lifetime deal") ||
      q.includes("oferta"))
    {return "app_supportChatLicense";}
  // Updates — after License so "upgrade to pro" resolves to the license flow.
  if (q.includes("update") || q.includes("actualizar") ||
      q.includes("actualizacion") || q.includes("upgrade") ||
      q.includes("new version") || q.includes("nueva version") ||
      q.includes("version") || q.includes("versión"))
    {return "app_supportChatUpdate";}
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
