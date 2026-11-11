import { SUPPORT_KNOWLEDGE_ES } from "./SupportKnowledge_es";

const SUPPORT_KNOWLEDGE_EN = {
  GENERAL: {
    APP_NAME: "BookmarkForge",
    VERSION: "1.0.0",
    BUILD_DATE: "November 2026",
    PHILOSOPHY:
      "Total privacy, local-first performance, and AI-augmented human intelligence.",
    DATA_STORAGE:
      "100% Local-First. Your data lives in your browser's IndexedDB (via RxDB). We have NO access to your data, NO servers tracking your clicks, and NO cloud database storing your notes.",
  },

  GLOSSARY: {
    RAG: 'Retrieval-Augmented Generation. It means the AI "reads" your local notes before answering, so it knows your specific knowledge.',
    EMBEDDINGS:
      'Mathematical representations of text that allow the AI to find "meaning" instead of just matching words.',
    P2P_SYNC:
      "Peer-to-Peer synchronization. Your content travels encrypted directly between your devices (e.g., Laptop to Phone). A signaling server only helps devices find each other — it never sees your data.",
    VAULT:
      "The encrypted container for your most sensitive data and AI configuration.",
    WEBLLM:
      "A technology that runs full AI models (like Llama 3) directly inside your browser using your graphics card (WebGPU).",
    SPACED_REPETITION:
      "A learning technique that increases intervals between reviews of flashcards to improve long-term memory.",
    ZERO_KNOWLEDGE:
      "A security principle where we (the developers) have zero knowledge of your encryption keys or data.",
  },

  CORE_FEATURES_ADVANCED: {
    EDITOR:
      'Block-based editor. Supports /commands, drag-and-drop, LaTeX for math, Mermaid diagrams for charts, and code highlighting for 50+ languages. Features "AI Copilot" for real-time writing help.',
    BOOKMARKS:
      'Virtualized list designed for large libraries — smooth scrolling with thousands of items. Features "Deep Search" across your library. Supports tags, AI auto-tag suggestions and collections. (Free plan caps at 500 bookmarks; Pro is unlimited.)',
    FLASHCARDS:
      'Uses a modified Anki-style Spaced Repetition algorithm (SRK). It tracks your "forgetting curve" to show you cards at the perfect time.',
    GRAPH_VIEW:
      'Interactive 2D force-directed visualization (SVG). Nodes are your notes and bookmarks; edges connect items that share tags. You can filter by tags or date range and export the graph as PNG/SVG.',
    VOICE_COMMANDS:
      'Push-to-talk voice: Voice Dictation transcribes speech into notes and the Voice Command Center triggers actions. Uses the browser Web Speech API — Chrome/Edge support it and it requires an internet connection; Firefox support is limited.',
    OMNIBAR:
      'Ctrl+K. Fuzzy search across your documents and bookmarks (titles and summaries). Select a result to open it; documents also offer copy-link and delete actions. `Ctrl+Shift+P` opens the same Omnibar.',
  },

  AI_CONFIGURATION_PRO: {
    CLOUD_VS_LOCAL:
      "Cloud (Gemini/OpenAI) is faster and smarter but requires internet. Local (Ollama/WebLLM) is 100% private and works offline.",
    PRIVACY_SHIELD_DETAILS:
      'There is no automatic PII stripping — cloud providers receive the prompts and vault context the app sends. For maximum privacy use "Private Mode" (shield icon in Chat): it restricts AI to local providers (Ollama/WebLLM) so nothing leaves your device. Review what you share with cloud providers.',
    MODEL_SELECTION:
      "For local use, we recommend current small models via Ollama (e.g., Llama 3.2) or WebLLM for browser-native inference. For cloud, any OpenAI-compatible or first-party provider the user configures with their own key works — there is no single mandated model.",
    QUANTIZATION:
      "We use 4-bit quantization (q4f16) to run large models on modest hardware without losing much accuracy.",
    TOKEN_OPTIMIZATION:
      "BookmarkForge includes a local Semantic Cache (Voy vector search + local embeddings). Repeated or very similar questions can be answered from the cache without a new API call, which reduces token usage on cloud providers.",
  },

  SECURITY_DEEP_DIVE: {
    MASTER_PASSWORD_POLICY:
      "Minimum 12 characters. We recommend a passphrase. The AES-GCM key is derived with Argon2id (version 4), our single mandatory KDF since the security audit (ADR-019).",
    ENCRYPTION_DETAILS:
      "We use the browser's native SubtleCrypto API. Keys are never stored in plain text; they are derived on-the-fly and only exist in memory (RAM).",
    DATA_RECOVERY:
      'There is NO "Forgot Password" link. Your password is the ONLY key. Always keep a .bmf backup in a safe place. We cannot help you if you lose it.',
    OFFLINE_VALIDATION:
      "License validation happens locally after an initial handshake. No constant tracking.",
  },

  TROUBLESHOOTING_MASTER_LIST: {
    APP_NOT_LOADING:
      "1. Clear Browser Cache. 2. Update Chrome/Edge to latest version. 3. Check if your disk is full. 4. Disable conflicting extensions (adblockers sometimes block IndexedDB).",
    SYNC_FAILING:
      "1. Devices do NOT need the same network — a signaling server helps peers find each other; only the encrypted data channel is P2P. 2. Check if a Firewall is blocking WebRTC. 3. Verify both devices show the same Sync Room/ID. 4. Re-pair from the Collaboration panel if the session is stale.",
    AI_HALLUCINATIONS:
      'AI can sometimes be wrong. Use the "Sources" links in the Chat to verify answers against your own notes. If answers stay unreliable, try a different model in AI Settings or ask more specific questions.',
    EXTENSION_NOT_SAVING:
      "1. Refresh the page you are trying to clip, then click the extension or bookmarklet again — it opens BookmarkForge's capture page. 2. There is no account login: confirm the save with your master password on that page (or unlock the vault first). 3. Self-hosted users: verify the instance URL in the extension options.",
    PERFORMANCE_JANK:
      'If the app feels slow, go to Settings > Storage and run "Compact Database". Also, check System Diagnostics for storage and browser health. Virtualization handles lists, but heavy notes can impact RAM.',
    DB_CORRUPTION:
      'Extremely rare. Use "System Diagnostics" to check your storage and browser health (it runs a live IndexedDB probe). If data is lost or unreadable, restore from your last .bmf backup.',
  },

  FAQ_EXTENDED: {
    "Is it free?":
      "Yes — the Free plan is free forever with 500 bookmarks, notes, documents, smart search, knowledge graph, JSON/HTML export and encrypted .bmf backups. Pro is a one-time payment (no subscription) that unlocks unlimited bookmarks, P2P sync across 5 devices, local AI, RAG chat, flashcards and PDF/OCR export. At the 500-bookmark cap you can still read, search and export — only new saves pause.",
    "Can I use it on mobile?":
      "Yes! Install it as a PWA (Progressive Web App) via Chrome (Android) or Safari (iOS). It supports offline access and local browser notifications.",
    "Where are my files?":
      "Inside your browser's internal storage (IndexedDB). They are not files on your desktop, but you can export them as .bmf, Markdown, or PDF at any time.",
    "Does it work offline?":
      "Yes — the editor, bookmarks, graph, search, flashcards and local AI (Ollama/WebLLM) work without internet. Cloud AI providers and web search need connectivity.",
    "Does it consume a lot of API tokens?":
      "Cloud AI usage depends on your provider's pricing. The local Semantic Cache can answer repeated or very similar questions without a new API call, which reduces token spend. Local models (Ollama/WebLLM) use no API tokens at all.",
    "How do I share a note?":
      "Open the note, click 'Share', and generate a link. The link embeds the document content — anyone who has the URL can read it, so share it only with people you trust. You can also export as PDF.",
    "How much data can it hold?":
      "Limited by your browser's storage quota — typically a large share of your free disk space (browser-dependent). The Free plan caps at 500 bookmarks; Pro is unlimited within that quota.",
    "Can I import from Notion/Evernote?":
      "From Notion: yes — in Notion use Settings → Export → \"Markdown & CSV\", then import the ZIP in BookmarkForge (Settings → Import). Pages become documents and the folder structure is preserved. From Evernote: export your notes as `.enex` (Evernote → Settings → Export) and import the file directly — notes become documents with tags and dates preserved (attachments are not imported). BookmarkForge also imports JSON/CSV/HTML bookmark exports (Pocket, Raindrop, Omnivore), Pinboard posts exports and Firefox places.json backups, Markdown/Obsidian ZIP vaults and Chrome bookmarks.",
  },

  TUTORIALS_QUICK_START: {
    "Setup in 2 mins":
      "1. Set Master Password. 2. Drag 'Save to Forge' to bookmarks bar. 3. Create your first Note using '/'. 4. Backup to .bmf.",
    "Mastering Search":
      "Press Ctrl+K and type any concept to fuzzy-search your documents and bookmarks. For AI answers about your notes, open the Chat tab.",
    "Becoming a Power User":
      "Use Flashcards to memorize your notes. Use the Graph View to see how your ideas connect over months.",
  },

  COMPATIBILITY_MATRIX: {
    WINDOWS: "Chrome/Edge (Best), Firefox (Good).",
    MACOS: "Safari (Best for battery), Chrome (Best for AI).",
    LINUX: "Firefox (Full Support), Brave (Ensure WebGPU is enabled).",
    MOBILE: "iOS 16+ (Safari PWA), Android 12+ (Chrome PWA).",
    HARDWARE: "Recommended 8GB RAM and an entry-level GPU for Local AI.",
  },

  GDPR_PRIVACY_COMPLIANCE: {
    COMPLIANCE:
      "BookmarkForge is GDPR compliant by design. Since we do not collect or store your data on our servers, you are the sole owner and controller of your information.",
    DATA_PORTABILITY:
      "You can export all your data in JSON (.bmf) or human-readable Markdown/CSV at any time.",
    NO_TRACKING:
      "No Google Analytics, no telemetry, no tracking pixels. 100% clean.",
  },

  LICENSE_SUPPORT: {
    PAYMENT_PROCESSOR:
      "Payments are handled securely by our selected payment provider. We never see your credit card information.",
    REFUND_POLICY:
      "Refunds are handled by the payment provider where you bought. Whop direct purchases have a 30-day refund window; AppSumo lifetime deals have a 60-day no-matter-the-reason window — request it there, not by email. Outside those windows, cases are reviewed individually.",
    PRO_FEATURES:
      "Pro (one-time payment, lifetime of v1) includes: unlimited bookmarks, P2P sync across up to 5 devices, local AI (WebLLM/Ollama), RAG chat with expert agents, flashcards with spaced repetition, PDF + OCR export, advanced export (7 formats: Notion, Obsidian, JSON, JSONL, CSV, Markdown, HTML), and cloud backup sync to your own storage. Refunds are processed by the payment provider — Whop direct purchases have a 30-day window, AppSumo deals a 60-day window.",
  },
};

type SupportKnowledge = Omit<
  typeof SUPPORT_KNOWLEDGE_EN,
  "FAQ_EXTENDED" | "TUTORIALS_QUICK_START"
> & {
  FAQ_EXTENDED: Record<string, string>;
  TUTORIALS_QUICK_START: Record<string, string>;
};

// Keep the registry explicit. A Proxy silently turned every unsupported
// locale into English, which made missing translations impossible to detect
// and caused callers to believe they had selected a localized knowledge base.
// New locale packs should be added here and covered by the i18n quality gate.
export const SUPPORT_KNOWLEDGE: Record<string, SupportKnowledge> = {
  en: SUPPORT_KNOWLEDGE_EN,
  es: SUPPORT_KNOWLEDGE_ES,
};

/**
 * Resolve a knowledge pack deliberately at the runtime boundary. Regional
 * tags (for example `pt-BR`) are normalized once, and an unavailable pack
 * falls back to English explicitly rather than through property access magic.
 */
export function getSupportKnowledge(locale?: string): SupportKnowledge {
  const code = (locale ?? "en").split("-")[0]?.toLowerCase() || "en";
  // `en` is a compile-time constant of the record literal, so it always
  // exists; `!` narrows the index-signature access on the final fallback.
  return SUPPORT_KNOWLEDGE[code] ?? SUPPORT_KNOWLEDGE.en!;
}
