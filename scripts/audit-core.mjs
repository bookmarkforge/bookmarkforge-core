/**
 * scripts/audit-core.mjs — reusable core of the locale audit.
 *
 * Extracted from scripts/gen-audit-report.mjs (batch-29) so the SAME
 * classification feeds two consumers:
 *   - gen-audit-report.mjs    → generates auditoria_placeholders.md (report)
 *   - check-audit-drift.mjs   → CI gate with baseline (delta > 0 = FAIL)
 *
 * The classification (skip regex, loanwords, batch-24 blind spot, type A/B)
 * lives ONLY here; any threshold change is reflected in both.
 */

import { readFileSync, readdirSync } from "node:fs";

export const LOCALES_DIR = "public/locales";

// Support-content keys that are intentionally English in every locale.
// These are long-form Concierge/FAQ/graph-empty strings served by the
// keyword-matched SupportChat flow and the BMF knowledge base. They are
// deliberately authored once in English (matching the `en` fallbackLng
// contract) and are NOT classified as untranslated English: the audit gate
// exists to catch regressions in UI labels, not to demand 34×29 copies of
// long-form support prose. If a locale pack adds real translations for a
// key here, it stops being identical to `en` and is naturally dropped from
// the `all29` count — no script change needed.
const SUPPORT_CONTENT_KEYS = new Set([
  "app_supportChatWelcome",
  "app_supportChatHi",
  "app_supportChatDefault",
  "app_supportChatPrivacy",
  "app_supportChatEditor",
  "app_supportChatBookmarks",
  "app_supportChatRAG",
  "app_supportChatTheme",
  "app_supportChatTutorials",
  "app_supportChatShortcuts",
  "app_supportChatBackup",
  "app_supportChatAiSetup",
  "app_supportChatTroubleshoot",
  "app_supportChatSync",
  "app_supportChatMigration",
  "app_supportChatVault",
  "app_supportChatCanvas",
  "app_supportChatDatabase",
  "app_supportChatKanban",
  "app_supportChatMobile",
  "app_supportChatLicense",
  "app_supportChatFlashcards",
  "app_supportChatGraph",
  "app_supportChatVoice",
  "app_supportChatSearch",
  "app_supportChatCollaboration",
  "app_supportChatOffline",
  "app_supportChatStorage",
  "app_switchTabs",
  "app_noFlashcardsYet",
  "app_noFlashcardsHint",
  "app_goToEditor",
  "app_graphEmptyTitle",
  "app_graphEmptyDesc",
]);

// Brands / technical terms / paths / urls / examples / shortcuts / colors / versions
const skip =
  /^(Pro$|Team$|Free$|Enterprise$|Chat$|Kanban$|Nostalgia$|Gallery$|Timeline$|tokens|Tokens|min$|Ollama|Gemini|WebLLM|WebGPU|OneDrive|WebDAV|Polar[0-9]|QJL|Float32|RAM|GB RAM|ON$|OFF$|Local-First|BookmarkForge|Dropbox|Google Drive|Google Gemini|Box$|pCloud|Notion|Obsidian|OpenAI|OpenRouter|Anthropic|Groq|Llama|Phi-|Qwen|Gemma|deepseek|CodeQL|UX|QA|Ctrl\+Shift|https?:|\/|#|XXXX|sk-|v[0-9]\.|-q4f16_1-MLC|WebRTC|RxDB|IndexedDB|P2P|AES|GCM|JWT|IP$|URL$|CSV|JSON|QR|Web Clipper$|WebClipper$|AES-GCM|⚠️ Plugin$|Bookmark Forge$|BMF Concierge$|\(Gemini\)$|\(Ollama\)$|Microsoft OneDrive$)/i;

// Legitimate loanwords per language: values that are native or established
// loans in that locale (not untranslated English). The exclusion is
// PER-LOCALE so genuine pending English in other languages (ru, ja, ko…)
// is not hidden.
const loanwordsByLocale = {
  pt: new Set([
    "Backlinks", "Tags", "Links", "Clusters", "Canvas", "Volume",
    "Downloads", "Backups", "Cache:", "Link", "General", "Empresa", "Design UX",
    "{{count}} tokens", // batch-27: established loanword in Portuguese
  ]),
  es: new Set(["Error", "General", "Empresa", "{{count}} tokens"]),
  ar: new Set(["friend@example.com"]), // universal email placeholder (batch-12)
  // Established universal loans (offline/partner/profiler) in locales that
  // use the same term natively — batch-9. Only locales whose value IS the
  // exact loan; those already translated (hr "Izvan mreže", id "Luring",
  // fi "Kumppani", ro "Partener", sv "Profilerare") are not excluded.
  cs: new Set(["Offline", "Partner", "📊 Profiler (Ctrl+Shift+P)", "Limit", "AI Engine"]),
  da: new Set(["Offline", "Partner", "📊 Profiler (Ctrl+Shift+P)", "Send", "Acceleration", "Marketingspecialist", "{{count}} tokens"]),
  de: new Set(["Offline", "Partner", "📊 Profiler (Ctrl+Shift+P)", "Limit", "Stacktrace", "Exportformat", "GOLD", "Bookmarks", "Growth Hacker"]),
  fi: new Set(["Offline", "Copywriter"]), // fi app_offline stays "Offline" (loanword)
  fr: new Set([
    "Source", "Contradictions", // French cognates: "la source", "les contradictions"
    // batch-12: native French words identical to English (selfRef FPs)
    "Actions", "Documents", "Date", "Suggestions", "Questions",
    "Diagnostics", "Image", "Question", "Public", "Dates", // native French cognates
  ]),
  hr: new Set(["Partner", "📊 Profiler (Ctrl+Shift+P)", "Copywriter"]),
  hu: new Set(["Offline", "Partner", "📊 Profiler (Ctrl+Shift+P)"]),
  id: new Set(["📊 Profiler (Ctrl+Shift+P)", "Edit"]), // "Edit" is a common loan in Indonesian UI
  it: new Set(["Offline", "Partner", "📊 Profiler (Ctrl+Shift+P)", "Copywriter", "Privacy"]),
  nl: new Set([
    "Offline", "Partner", "📊 Profiler (Ctrl+Shift+P)", "items", "Privacy",
    "Onlinestatus", "Marketingspecialist", "Stacktrace", "Realtime", // native Dutch
    // batch-12: legitimate Dutch compounds + tech loans
    "Uptime", "Recent", "Cloudprovider", "Chatprompt", "Cloudarchitect",
    "Codereviewer", "Databasearchitect", "Productmanager", "Renders:", "Update",
    // batch-27: "tokens"/"records" are established loans in Dutch
    // (consistent with filter_results "{{count}} van {{total}} records").
    "{{count}} tokens", "{{count}} records",
  ]),
  no: new Set(["Offline", "Partner", "📊 Profiler (Ctrl+Shift+P)", "Send", "Onlinestatus", "{{count}} tokens"]),
  pl: new Set(["Offline", "Partner", "📊 Profiler (Ctrl+Shift+P)", "Limit", "Copywriter"]),
  ro: new Set(["Offline", "📊 Profiler (Ctrl+Shift+P)", "Copywriter", "Calendar", "Card", "Public"]), // "public" is native Romanian
  sv: new Set(["Offline", "Partner", "Acceleration", "Copywriter", "Exportformat", "Onlinestatus", "{{count}} tokens"]),
};

// Universal UI loanwords/cognates used identically across European Latin
// alphabet languages (de, fr, nl, it, da, no, sv, fi, pl, cs, hu, hr, ro,
// el, tr, id, pt): "Filter" in German/Dutch, "Items" in Dutch, "Volume" in
// French… these are legitimate translations, not pending English. They only
// apply to LATIN-alphabet locales; in ar/bg/he/hi/ja/ko/ru/th/uk/vi/zh a
// value identical to English IS untranslated English (the flag stands).
// Broken concatenations ("AutoTag", "PromptsSaved", "PrivateDoc"…) are NOT
// in this list — those are camelJunk placeholders.
const EURO_LATIN_LOCALES = new Set([
  "cs", "da", "de", "el", "fi", "fr", "hr", "hu", "id", "it",
  "nl", "no", "pl", "pt", "ro", "sv", "tr",
]);
const EURO_LOANWORDS = new Set([
  "Live", "Start", "Stop", "Pause", "Type", "Filter", "Items",
  "Volume", "Tags", "Links", "Nodes", "Sources", "Clusters",
  "Downloads", "Backups", "Canvas", "Database", "Model", "Support",
  "Link", "Cache:", "Backlinks", "Status", "General", "Dashboard",
  "Analytics", "Graph", "Name", "Tutorials", "Auto-Tune",
  "Diagram (Mermaid)", "Database (RxDB)", "Formula (LaTeX)",
  "Cloud AI (Gemini)", "Zero-Knowledge P2P", "Design UX",
  "Import", "Importa", "Importieren", "Importer", "Importera",
  "Importovat", "Importeren", "Mobil", "Mobile", "Mobilní", "Mobilne",
  "Mobiel",
]);

export const langNames = {
  ar: "Arabic", bg: "Bulgarian", cs: "Czech", da: "Danish", de: "German",
  el: "Greek", es: "Spanish", fi: "Finnish", fr: "French", he: "Hebrew",
  hi: "Hindi", hr: "Croatian", hu: "Hungarian", id: "Indonesian", it: "Italian",
  ja: "Japanese", ko: "Korean", nl: "Dutch", no: "Norwegian", pl: "Polish",
  pt: "Portuguese", ro: "Romanian", ru: "Russian", sv: "Swedish", th: "Thai",
  tr: "Turkish", uk: "Ukrainian", vi: "Vietnamese", zh: "Chinese",
};

/**
 * Classify a locale value.
 * @returns {"A"|"B"|null} — A: raw placeholder; B: untranslated English.
 */
function classify(en, key, value) {
  if (typeof value !== "string" || !value) return null;
  if (SUPPORT_CONTENT_KEYS.has(key)) return null;
  const ev = typeof en[key] === "string" ? en[key] : "";
  if (skip.test(value)) return null;
  // Historical blind spot (batch-24): the `/^[{{]/` skip discarded EVERY
  // value starting with `{` — including `{{count}} days ago`, real English
  // invisible to type B. Now only a PURE PLACEHOLDER is skipped (no
  // letters/digits outside `{{...}}`, e.g. `{{count}}`, `{{price}}`,
  // `{{url}}`). A value starting with `{` but containing text (e.g.
  // `{{count}} days ago`) still goes through A/B classification and type B
  // catches it when byte-identical to en.
  if (/^[{]/.test(value)) {
    const stripped = value
      .replace(/\{\{[^}]+\}\}/g, "")
      .replace(/[^\p{L}\p{N}]/gu, "");
    if (stripped === "") return null; // pure placeholder — no real text
    // letters/digits outside the braces: real text, keep classifying
  }
  const lastSeg = key.split("_").pop().toLowerCase();
  const selfRef = lastSeg.length >= 4 && value.toLowerCase() === lastSeg;
  // camelJunk extended to full diacritics (é/è/ä/ö/ü/ő/ı/ş…): the previous
  // [a-záéíóúñ] range did not detect concatenations with accents outside
  // that set (e.g. fr "ConfirmerRéinitialiserParamètres" with "è"). Now it
  // covers the whole Latin alphabet with diacritics (U+00E0–U+00FF).
  const camelJunk =
    /^[A-ZÀ-ÖØ-Þ][a-zà-öø-ÿ]{2,}([A-ZÀ-ÖØ-Þ][a-zà-öø-ÿ]{1,}){1,}[A-Za-zÀ-ÖØ-Þà-öø-ÿ]*$/.test(
      value,
    ) && /[A-ZÀ-ÖØ-Þ].*[A-ZÀ-ÖØ-Þ]/.test(value);
  const keyLike =
    /app_|Example$|Ejemplo$|Desc$|Descripcion|Placeholder|Paso\d|Step\d|Nota$|CreadoEn|CloudError|LicenciaActiva|RestablecerConfiguración|ActualizaciónDisponible|RecortadoDeWeb|FiltroGráfico|ResetSettings|ConfirmReset/.test(
      value,
    );
  if (selfRef || camelJunk || keyLike) return "A";
  if (ev && value === ev && /[A-Za-z]{4}/.test(value)) return "B";
  return null;
}

// batch-31: threshold of the disproportionate-length detector (shared
// between check-i18n-quality.mjs — gate with baseline — and
// gen-length-report.mjs — prioritized report). A translated value >
// LENGTH_RATIO_CAP × the English text (after stripping {{placeholders}}) is
// the static signature of a UI overflow (short labels that become 2.5×+
// compounds in de/fi/hu).
export const LENGTH_RATIO_CAP = 2.5;
export const LENGTH_MIN_EN = 10;

/**
 * Compare the visible length of a locale value against its English peer.
 * {{placeholders}} are stripped from BOTH sides (they render at runtime and
 * contribute equally). Returns null when the English text is too short
 * (< LENGTH_MIN_EN: tiny labels where 2-3 translation words are normal and
 * would not be false positives) or when either side is not text;
 * otherwise { ratio, enLen, locLen }.
 * @returns {{ratio: number, enLen: number, locLen: number}|null}
 */
export function lengthStats(enValue, value) {
  if (typeof enValue !== "string" || typeof value !== "string") return null;
  const enStripped = enValue.replace(/\{\{[^}]*\}\}/g, "").trim();
  const locStripped = value.replace(/\{\{[^}]*\}\}/g, "").trim();
  if (enStripped.length < LENGTH_MIN_EN) return null;
  return {
    ratio: locStripped.length / enStripped.length,
    enLen: enStripped.length,
    locLen: locStripped.length,
  };
}

/**
 * Run the full audit over public/locales.
 * @returns {{files: string[], keyCount: Record<string,number>,
 *            perLang: Record<string,{a:number,b:number}>, total: number,
 *            unique: number, all29: number}}
 */
export function runAudit() {
  const files = readdirSync(LOCALES_DIR)
    .filter((f) => f.endsWith(".json") && f !== "en.json")
    .sort();
  const en = JSON.parse(readFileSync(`${LOCALES_DIR}/en.json`, "utf8"));

  const keyCount = {};
  const perLang = {};

  for (const f of files) {
    const lang = f.replace(".json", "");
    const data = JSON.parse(readFileSync(`${LOCALES_DIR}/${f}`, "utf8"));
    let a = 0;
    let b = 0;
    const loan = loanwordsByLocale[lang];
    for (const [k, v] of Object.entries(data)) {
      if ((loan && loan.has(v)) || (EURO_LATIN_LOCALES.has(lang) && EURO_LOANWORDS.has(v))) continue;
      const type = classify(en, k, v);
      if (!type) continue;
      if (type === "A") a++;
      else b++;
      keyCount[k] = (keyCount[k] || 0) + 1;
    }
    perLang[lang] = { a, b };
  }

  const total = Object.values(perLang).reduce((s, v) => s + v.a + v.b, 0);
  const unique = Object.keys(keyCount).length;
  const all29 = Object.values(keyCount).filter((n) => n === files.length).length;

  return { files, keyCount, perLang, total, unique, all29 };
}
