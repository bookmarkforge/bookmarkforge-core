import { SUPPORT_KNOWLEDGE_ES } from "./SupportKnowledge_es";

const SUPPORT_KNOWLEDGE_EN = {
  GENERAL: {
    APP_NAME: "BookmarkForge",
    VERSION: "1.0.0 Stable",
    BUILD_DATE: "May 2026",
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
      "Peer-to-Peer synchronization. Data is sent directly between your devices (e.g., Laptop to Phone) without ever touching a central server.",
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
      'Virtualized list that handles 100,000+ items with zero lag. Features "Deep Search" which searches the full text of saved pages. Support for "Smart Collections" that auto-organize by tag.',
    FLASHCARDS:
      'Uses a modified Anki-style Spaced Repetition algorithm (SRK). It tracks your "forgetting curve" to show you cards at the perfect time. Supports image-occlusion and cloze-deletion.',
    GRAPH_VIEW:
      'Interactive 3D/2D visualization. You can filter by tags, date, or "Connection Strength". Visualizes semantic similarity between unrelated notes.',
    VOICE_COMMANDS:
      'Voice-to-Action engine. You can say "Hey BMF, find my notes on Biology" or "Bookmark this page". Works 100% offline via Web Speech API.',
    OMNIBAR:
      'Ctrl+K. The brain of the app. It can perform math, convert units, search bookmarks, and open notes simultaneously. Type ">" for system commands.',
  },

  AI_CONFIGURATION_PRO: {
    CLOUD_VS_LOCAL:
      "Cloud (Gemini/OpenAI) is faster and smarter but requires internet. Local (Ollama/WebLLM) is 100% private and works offline.",
    PRIVACY_SHIELD_DETAILS:
      'Our "Privacy Shield" uses Regex and NLP to redact PII (Personally Identifiable Information) before it leaves your machine. Even if you use Cloud AI, your secrets are safe.',
    MODEL_SELECTION:
      "For local use, we recommend Llama 3.2 (3B) for general tasks or Qwen 2.5 for multilingual support. For cloud, Gemini 1.5 Pro is the state-of-the-art choice.",
    QUANTIZATION:
      "We use 4-bit quantization (q4f16) to run large models on modest hardware without losing much accuracy.",
    TOKEN_OPTIMIZATION:
      "BookmarkForge uses a Hybrid Architecture with a local Semantic Cache (Voy + Transformers.js). If you ask similar questions, the app uses 0 tokens and 0 API calls by retrieving the exact intent from the local cache. It also dynamically routes requests to the optimal model to save costs.",
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
      "1. Ensure both devices are on the same Wi-Fi. 2. Check if a Firewall is blocking WebRTC. 3. Verify Sync IDs match. 4. Reset the Sync Room if needed.",
    AI_HALLUCINATIONS:
      'AI can sometimes be wrong. Use the "Sources" links in the Chat to verify. Adjust the "Temperature" in AI Settings for more creative or factual answers.',
    EXTENSION_NOT_SAVING:
      "1. Refresh the page you are trying to clip. 2. Ensure you are logged into BookmarkForge in another tab. 3. Re-install the bookmarklet.",
    PERFORMANCE_JANK:
      'If the app feels slow, go to Settings > Advanced and run "Database Optimization". Also, check System Diagnostics for CPU usage. Virtualization handles lists, but heavy notes can impact RAM.',
    DB_CORRUPTION:
      'Extremely rare. Use "System Diagnostics" to check DB integrity. If corrupt, restore from your last .bmf backup.',
  },

  FAQ_EXTENDED: {
    "Is it free?":
      "The core app is local-first and free to use. Advanced AI features or P2P Sync require a v1.0.0 Pro License.",
    "Can I use it on mobile?":
      "Yes! Install it as a PWA (Progressive Web App) via Chrome (Android) or Safari (iOS). It supports offline access and push notifications.",
    "Where are my files?":
      "Inside your browser's internal storage (IndexedDB). They are not files on your desktop, but you can export them as .bmf, Markdown, or PDF at any time.",
    "Does it work offline?":
      "100%. All features (Editor, Bookmarks, Graph, Local AI, Search) work without an internet connection.",
    "Does it consume a lot of API tokens?":
      "No. The app uses a Local Semantic Cache algorithm. If you ask variations of the same question, it uses 0 API tokens and saves you money automatically.",
    "How do I share a note?":
      "Open the note, click 'Share', and generate a secure, encrypted P2P link or export as PDF.",
    "How much data can it hold?":
      "Limited only by your browser's storage (usually 50% of your free disk space). It can easily handle 100,000+ items.",
    "Can I import from Notion/Evernote?":
      "Yes! Use Settings > Import and select your HTML/JSON export. We also support standard Chrome bookmarks import.",
  },

  TUTORIALS_QUICK_START: {
    "Setup in 2 mins":
      "1. Set Master Password. 2. Drag 'Save to Forge' to bookmarks bar. 3. Create your first Note using '/'. 4. Backup to .bmf.",
    "Mastering Search":
      "Press Ctrl+K. Type any concept. Use '?' to ask the AI directly about your documents.",
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
      "We offer a 30-day money-back guarantee if the app doesn't meet your needs.",
    PRO_FEATURES:
      "P2P Sync and Unlimited Local AI are Pro features.",
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
