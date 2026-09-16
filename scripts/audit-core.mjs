/**
 * scripts/audit-core.mjs — núcleo reutilizable de la auditoría de locales.
 *
 * Extraído de scripts/gen-audit-report.mjs (batch-29) para que la MISMA
 * clasificación alimente dos consumidores:
 *   - gen-audit-report.mjs    → genera auditoria_placeholders.md (informe)
 *   - check-audit-drift.mjs   → gate de CI con baseline (delta > 0 = FAIL)
 *
 * La clasificación (skip regex, préstamos, blind spot de batch-24, tipo A/B)
 * vive SOLO aquí; cualquier cambio de umbral se refleja en ambos.
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

// Marcas / términos técnicos / rutas / urls / ejemplos / atajos / colores / versiones
const skip =
  /^(Pro$|Team$|Free$|Enterprise$|Chat$|Kanban$|Nostalgia$|Gallery$|Timeline$|tokens|Tokens|min$|Ollama|Gemini|WebLLM|WebGPU|OneDrive|WebDAV|Polar[0-9]|QJL|Float32|RAM|GB RAM|ON$|OFF$|Local-First|BookmarkForge|Dropbox|Google Drive|Google Gemini|Box$|pCloud|Notion|Obsidian|OpenAI|OpenRouter|Anthropic|Groq|Llama|Phi-|Qwen|Gemma|deepseek|CodeQL|UX|QA|Ctrl\+Shift|https?:|\/|#|XXXX|sk-|v[0-9]\.|-q4f16_1-MLC|WebRTC|RxDB|IndexedDB|P2P|AES|GCM|JWT|IP$|URL$|CSV|JSON|QR|Web Clipper$|WebClipper$|AES-GCM|⚠️ Plugin$|Bookmark Forge$|BMF Concierge$|\(Gemini\)$|\(Ollama\)$|Microsoft OneDrive$)/i;

// Préstamos legítimos por idioma: valores que en ese locale son nativos o
// préstamos establecidos (no inglés sin traducir). La exclusión es PER-LOCALE
// para no ocultar inglés genuinamente pendiente en otros idiomas (ru, ja, ko...).
const loanwordsByLocale = {
  pt: new Set([
    "Backlinks", "Tags", "Links", "Clusters", "Canvas", "Volume",
    "Downloads", "Backups", "Cache:", "Link", "General", "Empresa", "Design UX",
    "{{count}} tokens", // batch-27: préstamo establecido en portugués
  ]),
  es: new Set(["Error", "General", "Empresa", "{{count}} tokens"]),
  ar: new Set(["friend@example.com"]), // placeholder de email universal (batch-12)
  // Préstamos universales establecidos (offline/partner/profiler) en locales
  // que usan el mismo término nativamente — batch-9. Solo locales cuyo valor
  // ES el préstamo exacto; los que ya tradujeron (hr "Izvan mreže", id
  // "Luring", fi "Kumppani", ro "Partener", sv "Profilerare") no se excluyen.
  cs: new Set(["Offline", "Partner", "📊 Profiler (Ctrl+Shift+P)", "Limit", "AI Engine"]),
  da: new Set(["Offline", "Partner", "📊 Profiler (Ctrl+Shift+P)", "Send", "Acceleration", "Marketingspecialist", "{{count}} tokens"]),
  de: new Set(["Offline", "Partner", "📊 Profiler (Ctrl+Shift+P)", "Limit", "Stacktrace", "Exportformat", "GOLD", "Bookmarks", "Growth Hacker"]),
  fi: new Set(["Offline", "Copywriter"]), // fi app_offline stays "Offline" (loanword)
  fr: new Set([
    "Source", "Contradictions", // cognados franceses: "la source", "les contradictions"
    // batch-12: palabras francesas nativas idénticas al inglés (selfRef FPs)
    "Actions", "Documents", "Date", "Suggestions", "Questions",
    "Diagnostics", "Image", "Question", "Public", "Dates", // cognados franceses nativos
  ]),
  hr: new Set(["Partner", "📊 Profiler (Ctrl+Shift+P)", "Copywriter"]),
  hu: new Set(["Offline", "Partner", "📊 Profiler (Ctrl+Shift+P)"]),
  id: new Set(["📊 Profiler (Ctrl+Shift+P)", "Edit"]), // "Edit" es préstamo común en UI indonesia
  it: new Set(["Offline", "Partner", "📊 Profiler (Ctrl+Shift+P)", "Copywriter", "Privacy"]),
  nl: new Set([
    "Offline", "Partner", "📊 Profiler (Ctrl+Shift+P)", "items", "Privacy",
    "Onlinestatus", "Marketingspecialist", "Stacktrace", "Realtime", // neerlandés nativo
    // batch-12: compuestos neerlandeses legítimos + préstamos tech
    "Uptime", "Recent", "Cloudprovider", "Chatprompt", "Cloudarchitect",
    "Codereviewer", "Databasearchitect", "Productmanager", "Renders:", "Update",
    // batch-27: "tokens"/"records" son préstamos establecidos en neerlandés
    // (consistente con filter_results "{{count}} van {{total}} records").
    "{{count}} tokens", "{{count}} records",
  ]),
  no: new Set(["Offline", "Partner", "📊 Profiler (Ctrl+Shift+P)", "Send", "Onlinestatus", "{{count}} tokens"]),
  pl: new Set(["Offline", "Partner", "📊 Profiler (Ctrl+Shift+P)", "Limit", "Copywriter"]),
  ro: new Set(["Offline", "📊 Profiler (Ctrl+Shift+P)", "Copywriter", "Calendar", "Card", "Public"]), // "public" es rumano nativo
  sv: new Set(["Offline", "Partner", "Acceleration", "Copywriter", "Exportformat", "Onlinestatus", "{{count}} tokens"]),
};

// Préstamos/cognados universales de UI técnica que se usan idénticos en los
// idiomas de alfabeto latino europeo (de, fr, nl, it, da, no, sv, fi, pl,
// cs, hu, hr, ro, el, tr, id, pt): "Filter" en alemán/holandés, "Items" en
// neerlandés, "Volume" en francés… son traducciones legítimas, no inglés
// pendiente. Solo se aplican a locales de alfabeto LATINO; en ar/bg/he/hi/
// ja/ko/ru/th/uk/vi/zh un valor idéntico al inglés sí es inglés sin traducir
// (el flag se mantiene). Los concatenados rotos ("AutoTag", "PromptsSaved",
// "PrivateDoc"…) NO están en esta lista — esos son placeholders camelJunk.
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
  ar: "Árabe", bg: "Búlgaro", cs: "Checo", da: "Danés", de: "Alemán",
  el: "Griego", es: "Español", fi: "Finlandés", fr: "Francés", he: "Hebreo",
  hi: "Hindi", hr: "Croata", hu: "Húngaro", id: "Indonesio", it: "Italiano",
  ja: "Japonés", ko: "Coreano", nl: "Neerlandés", no: "Noruego", pl: "Polaco",
  pt: "Portugués", ro: "Rumano", ru: "Ruso", sv: "Sueco", th: "Tailandés",
  tr: "Turco", uk: "Ucraniano", vi: "Vietnamita", zh: "Chino",
};

/**
 * Clasifica un valor de locale.
 * @returns {"A"|"B"|null} — A: placeholder crudo; B: inglés sin traducir.
 */
function classify(en, key, value) {
  if (typeof value !== "string" || !value) return null;
  if (SUPPORT_CONTENT_KEYS.has(key)) return null;
  const ev = typeof en[key] === "string" ? en[key] : "";
  if (skip.test(value)) return null;
  // Blind spot histórico (batch-24): el skip `/^[{{]/` descartaba TODO valor
  // que empezara por `{` — incluido `{{count}} days ago`, inglés real invisible
  // al tipo B. Ahora solo se salta un PLACEHOLDER PURO (sin letras/dígitos
  // fuera de `{{...}}`, ej. `{{count}}`, `{{price}}`, `{{url}}`). Un valor que
  // empieza por `{` pero contiene texto (p.ej. `{{count}} days ago`) sigue a
  // la clasificación A/B y el tipo B lo caza si es byte-idéntico a en.
  if (/^[{]/.test(value)) {
    const stripped = value
      .replace(/\{\{[^}]+\}\}/g, "")
      .replace(/[^\p{L}\p{N}]/gu, "");
    if (stripped === "") return null; // placeholder puro — sin texto real
    // si hay letras/dígitos fuera de los braces: texto real, sigue clasificando
  }
  const lastSeg = key.split("_").pop().toLowerCase();
  const selfRef = lastSeg.length >= 4 && value.toLowerCase() === lastSeg;
  // camelJunk ampliado a diacríticos completos (é/è/ä/ö/ü/ő/ı/ş…): el rango
  // [a-záéíóúñ] anterior NO detectaba concatenados con acentos fuera de ese
  // set (ej. fr "ConfirmerRéinitialiserParamètres" con "è"). Ahora cubre
  // todo el alfabeto latino con diacríticos (U+00E0–U+00FF).
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

// batch-31: umbral del detector de longitud desproporcionada (compartido
// entre check-i18n-quality.mjs — gate con baseline — y gen-length-report.mjs
// — informe priorizado). Un valor traducido > LENGTH_RATIO_CAP × el texto en
// (tras quitar {{placeholders}}) es la firma estática de un overflow de UI
// (etiquetas cortas que se vuelven compuestos 2.5×+ en de/fi/hu).
export const LENGTH_RATIO_CAP = 2.5;
export const LENGTH_MIN_EN = 10;

/**
 * Compara la longitud visible de un valor de locale contra su par en inglés.
 * Los {{placeholders}} se quitan de AMBOS lados (renderizan en runtime y
 * contribuyen por igual). Devuelve null cuando el texto en es demasiado
 * corto (< LENGTH_MIN_EN: etiquetas diminutas donde 2-3 palabras de
 * traducción son normales y no false-positivarían) o cuando alguno de los
 * dos no es texto; si no, { ratio, enLen, locLen }.
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
 * Ejecuta la auditoría completa sobre public/locales.
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
