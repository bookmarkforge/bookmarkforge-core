#!/usr/bin/env node
/**
 * support-triage.mjs — AI-assisted support triage for BookmarkForge.
 *
 * Reads ticket text files (one per ticket, any extension) and produces, for
 * each: category, provider, urgency flags, and a DRAFT reply assembled from
 * verified facts (runbooks/FAQ). The operator reviews and sends — nothing is
 * ever auto-sent.
 *
 * Usage:
 *   node scripts/support-triage.mjs <dir-or-file> [--out <dir>] [--json]
 *
 * Input dir: every file is treated as one ticket (use .txt/.md exports).
 * Output: <out>/<name>.triage.json + <name>.draft.md per ticket, plus
 *         _summary.md with category counts and FAQ-gap candidates.
 *
 * Ground rules baked in (see docs/support-ai-workflow.md):
 *   - Never ask for password, recovery phrase, or vault access.
 *   - Never promise refunds — provider-managed only.
 *   - Never promise v2+ free to LTD buyers.
 *   - Drafts cite BF-E codes when the ticket mentions an error code.
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { join, basename, extname } from "node:path";

const EMAIL = "bookmarkforge@proton.me";
const WHOP_REFUND = "https://whop.com/orders";
const APPSUMO_REFUND = "https://appsumo.com/account/orders";

// ---------- classification ----------

const CATEGORIES = [
  // AppSumo buyers write in many languages — keywords cover the top
  // locales for the highest-volume categories (license, refund, vault).
  ["refund", ["refund", "money back", "remboursement", "rembourser", "rückerstattung", "erstattung", "reembolso", "devolucion", "chargeback", "dispute", "rimborso"]], // i18n-allow: non-English terms are ticket-detection data, not prose
  ["license", ["license", "licence", "key", "activate", "activation", "pro version", "upgrade", "licencia", "clave", "activar", "code", "licence key", "schlüssel", "licentie", "licença"]], // i18n-allow: non-English terms are ticket-detection data, not prose
  ["billing", ["payment", "charged", "invoice", "receipt", "billing", "pago", "cobro", "factura", "whop", "appsumo", "order id", "zahlung", "facture", "fatura"]], // i18n-allow: non-English terms are ticket-detection data, not prose
  ["account", ["delete my account", "delete account", "delete my data", "gdpr", "right to erasure", "cancel my", "borrar cuenta", "eliminar cuenta", "borrar mis datos", "export my data", "supprimer mon compte", "konto löschen"]], // i18n-allow: non-English terms are ticket-detection data, not prose
  ["vault-access", ["forgot password", "forgot my password", "can't open", "cant open", "locked out", "recover", "olvide la contrasena", "no puedo abrir", "recuperar contrasena", "recuperar accesso", "mot de passe oublié", "passwort vergessen", "hauptpasswort", "kennwort", "esqueci a senha"]], // i18n-allow: non-English terms are ticket-detection data, not prose
  ["data-loss", ["lost my", "lost data", "deleted", "backup", "restore", "missing bookmarks", "perdi", "borre", "respaldo"]], // i18n-allow: Spanish terms are ticket-detection data, not prose
  ["sync", ["sync", "synchronize", "p2p", "peer", "devices", "sincronizar", "dispositivos", "webrtc", "synchronisation", "synchronisierung", "sincronização", "sincronizzazione"]], // i18n-allow: non-English terms are ticket-detection data, not prose
  ["ai", [" ai ", "ollama", "webllm", "model", "gemini", "openai", "llm", "chatbot", "inteligencia artificial", "modelo ia"]], // i18n-allow: Spanish terms are ticket-detection data, not prose
  ["import-export", ["import", "export", "notion", "evernote", "pocket", "raindrop", "obsidian", "csv", "json", "pinboard", "firefox", "places.json", "importar", "exportar"]], // i18n-allow: Spanish terms are ticket-detection data, not prose
  ["extension", ["extension", "bookmarklet", "clip", "capture", "extensión", "guardar página", "guardar pagina"]], // i18n-allow: Spanish terms are ticket-detection data, not prose
  ["mobile", ["mobile", "phone", "iphone", "android", "pwa", "install app", "movil", "telefono"]], // i18n-allow: Spanish terms are ticket-detection data, not prose
  ["bug", ["bug", "error", "crash", "broken", "doesn't work", "not working", "fails", "freeze", "blank", "bf-e"]],
  ["feature-request", ["feature request", "would be nice", "suggestion", "wishlist", "suggest", "request", "seria bueno", "sugerencia"]], // i18n-allow: Spanish terms are ticket-detection data, not prose
];

const URGENCY = [
  ["legal-threat", ["lawyer", "attorney", "legal action", "sue", "lawsuit", "abogado", "demand letter"]],
  ["chargeback-threat", ["chargeback", "bank dispute", "credit card company", "dispute the charge"]],
  ["refund-demand", ["want my money", "full refund", "demand a refund", "quiero mi dinero", "reembolso completo"]], // i18n-allow: Spanish terms are ticket-detection data, not prose
  ["angry", ["unacceptable", "worst", "scam", "fraud", "terrible", "horrible", "inaceptable", "estafa", "pesimo"]], // i18n-allow: Spanish terms are ticket-detection data, not prose
  ["data-loss-critical", ["lost everything", "years of", "all my data", "perdi todo"]], // i18n-allow: Spanish terms are ticket-detection data, not prose
];

const BF_E_RE = /BF-E\d{3}/gi;

function normalize(s) {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

// Padded text so " ai " style keywords match at string boundaries too.
function pad(t) {
  return ` ${t} `;
}

// Whole-phrase matching with word boundaries — "sue" must not hit "issue",
// "ai" must not hit "said"/"email"/"j'ai" (apostrophes excluded so French
// contractions like j'ai/l'IA don't false-positive). Multi-word phrases keep
// their spaces.
function kwRe(keyword) {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![a-z0-9'])${escaped.replace(/ /g, "\\s+")}(?![a-z0-9'])`, "i");
}

// Keywords are normalized too — the ticket text is accent-stripped, so
// "extensión" must be matched as "extension".
const CATEGORY_MATCHERS = CATEGORIES.map(([cat, words]) => [
  cat,
  words.map((w) => {
    const nw = normalize(w).trim();
    return { w: nw, re: kwRe(nw) };
  }),
]);
const URGENCY_MATCHERS = URGENCY.map(([flag, words]) => [
  flag,
  words.map((w) => kwRe(normalize(w))),
]);

export function classify(text) {
  const t = pad(normalize(text));
  const scores = CATEGORY_MATCHERS.map(([cat, words]) => [
    cat,
    words.reduce((n, { w, re }) => n + (re.test(t) ? (w.includes(" ") ? 2 : 1) : 0), 0),
  ]);
  scores.sort((a, b) => b[1] - a[1]);
  const positive = scores.filter(([, s]) => s > 0);
  // Multi-topic: keep every category within 1 point of the top score (max 2)
  // so "import fails with BF-E107 and voice offline?" drafts both answers.
  const top = positive.length ? positive[0][1] : 0;
  const topics = positive.filter(([, s]) => s >= top - 1).slice(0, 2).map(([cat]) => cat);
  const category = topics[0] || "other";

  const provider = /appsumo/.test(t) ? "appsumo" : /whop/.test(t) ? "whop" : "unknown";

  const flags = URGENCY_MATCHERS.filter(([, res]) => res.some((re) => re.test(t))).map(([f]) => f);

  const codes = [...new Set((text.match(BF_E_RE) || []).map((c) => c.toUpperCase()))];

  return { category, topics, provider, flags, bfCodes: codes, scores: scores.slice(0, 3) };
}

// ---------- draft generation (verified facts only) ----------

const NEVER =
  "For your security we can never ask for your master password, recovery phrase, or vault contents — if anyone asks, it is not us.";

function topicLines(cat, c) {
  switch (cat) {
    case "license":
      return [
        "To activate Pro: **Settings → Pro → Activate Pro License** and paste your license key.",
        `If the key was issued by ${c.provider === "appsumo" ? "AppSumo" : "your payment provider"}, first make sure you redeemed the deal code on their site — the license key arrives by email after redemption.`,
        "If it still fails, please send us your **order ID** (not the full license key — the first 8 characters are enough to look it up) and we will check it server-side.",
      ];
    case "refund":
      return [
        "Refunds are processed by the payment provider, not by us — this protects your purchase record.",
        c.provider === "appsumo" || /appsumo/.test(c.raw || "")
          ? `AppSumo lifetime deals have a **60-day no-matter-the-reason refund window**: ${APPSUMO_REFUND}`
          : `Whop direct purchases have a **30-day refund window**: ${WHOP_REFUND}`,
        "Outside those windows, refund cases are reviewed individually — tell us what happened and we will take a look.",
        "If a refund is issued, the license key is revoked but your local data is never touched — you keep the Free tier.",
      ];
    case "account":
      return [
        "BookmarkForge stores your data locally in your browser — there is no central account to delete.",
        "To remove everything: open the app → **Settings → Storage → Delete all local data** (or clear the site's data in your browser). This erases the vault, backups and settings from that device.",
        "For purchase records held by your payment provider, contact them directly — we never see your payment details.",
      ];
    case "vault-access":
      return [
        "BookmarkForge is zero-knowledge: **there is no password recovery** — your master password is the only key, by design.",
        "If you have a `.bmf` backup file or your recovery phrase, you can restore access from it. If not, the vault contents cannot be recovered by anyone, including us.",
        NEVER,
      ];
    case "data-loss":
      return [
        "First, do not panic-delete anything: your data lives in the browser's IndexedDB and may still be recoverable.",
        "Check **Settings → Storage** for the latest backup, and restore from a `.bmf` file if you have one. If the vault was recently locked, try unlocking again — IndexedDB data persists across sessions.",
        "If you can still open the vault, export a backup immediately (Settings → Backup) before troubleshooting further.",
      ];
    case "sync":
      return [
        "Devices do **not** need the same network — a signaling server only helps peers find each other; your data travels encrypted P2P via WebRTC.",
        "Free tier syncs bookmarks between your own devices; Pro raises the limit to 5 devices. Check that both devices show the same Sync Room/ID, and that no firewall or VPN is blocking WebRTC.",
      ];
    case "ai":
      return [
        "BookmarkForge works with cloud providers (your own API key) or fully local models — **Ollama is free**, WebLLM requires Pro.",
        "There is no mandatory model: pick whichever your hardware supports. If local AI fails, check that your model finished downloading and that WebGPU is enabled in the browser.",
      ];
    case "import-export":
      return [
        "Supported imports: JSON/CSV/HTML bookmarks (Pocket, Raindrop, Omnivore exports), ZIP vaults (Markdown/Obsidian — and **Notion**: export \"Markdown & CSV\" from Notion, then import the ZIP; pages become documents and folders are preserved), Chrome bookmarks, and `.bmf` backups.",
        "From Evernote: export notes as `.enex` and import directly — notes become documents with tags and dates (attachments are not imported).",
        "From Pinboard: import the `posts/all` JSON export; from Firefox: import the `places.json` backup (about:debugging → Import/Export). Bookmark folders are flattened on Firefox import.",
        "Exports: Notion, Obsidian, JSON, JSONL, CSV, Markdown, HTML (PDF export is Pro).",
      ];
    case "extension":
      return [
        "The extension/bookmarklet opens BookmarkForge's capture page — there is no separate login. Confirm the save with your **master password** (or unlock the vault first).",
        "Self-hosted users: verify the instance URL in the extension options. If the page does not open, refresh the tab you are clipping and try again.",
      ];
    case "mobile":
      return [
        "BookmarkForge is a Progressive Web App: open the site in your mobile browser and use **Add to Home Screen** for an app-like experience.",
        "All features work on mobile; some (WebLLM local AI, certain voice features) depend on your device's hardware and browser.",
      ];
    case "bug":
      return [
        "Thanks for the report. To help us reproduce it, please send:",
        "1. The **BF-E error code** if you saw one (shown in the error message)",
        "2. Browser + version, and whether it happens in private/incognito mode",
        "3. The redacted **diagnostics report** from Support → Diagnostics (it contains no vault content, URLs or titles)",
      ];
    case "feature-request":
      return [
        "Thanks for the suggestion — we read every feature request.",
        "You can track it and vote on the public roadmap. If it is already planned for v2, Pro owners get the 60% upgrade discount when it ships.",
      ];
    case "billing":
      return [
        "Purchase records live with the payment provider. For order questions (receipts, invoices, charges) contact them directly — we only handle license activation.",
        c.provider === "appsumo" ? `AppSumo orders: ${APPSUMO_REFUND}` : `Whop orders: ${WHOP_REFUND}`,
      ];
    default:
      return [
        "Thanks for reaching out. To point you in the right direction, could you tell us:",
        "1. What you were trying to do when it happened",
        "2. Browser + version (and OS if relevant)",
        "3. Any **BF-E code** shown, or the diagnostics report from Support → Diagnostics",
        "If your question is about a purchase, include the order ID from your provider.",
      ];
  }
}

function draftFor(c) {
  const parts = [];
  const p = (x) => parts.push(x);
  const topics = c.topics.length ? c.topics : ["other"];

  p(`Hi — thanks for reaching out to BookmarkForge support. (Ticket auto-triaged as: ${topics.join(" + ")}${c.provider !== "unknown" ? `, provider: ${c.provider}` : ""}.)`);

  for (const topic of topics) {
    for (const line of topicLines(topic, c)) p(line);
  }

  if (c.bfCodes.length) {
    p(`We can see error code(s) ${c.bfCodes.join(", ")} in your message — that helps us a lot. The full list of codes and what they mean is at /help.`);
  }

  if (c.flags.length) {
    p("**Note to operator:** urgency flags detected: " + c.flags.join(", ") + " — review personally before sending.");
  }

  p(NEVER);
  p(`— BookmarkForge Support · ${EMAIL}`);
  return parts.join("\n\n");
}

// ---------- batch processing ----------

function collectFiles(input) {
  const st = statSync(input);
  if (st.isFile()) return [input];
  return readdirSync(input)
    .map((f) => join(input, f))
    .filter((f) => statSync(f).isFile()
      && !f.endsWith(".triage.json")
      && !f.endsWith(".draft.md")
      && basename(f) !== "_summary.md");
}

function main() {
  const args = process.argv.slice(2);
  const input = args.find((a) => !a.startsWith("--"));
  if (!input) {
    console.error("Usage: node scripts/support-triage.mjs <dir-or-file> [--out <dir>] [--json]");
    process.exit(1);
  }
  const outIdx = args.indexOf("--out");
  const outDir = outIdx > -1 ? args[outIdx + 1] : join(input, "triage-out");
  const jsonOnly = args.includes("--json");

  const files = collectFiles(input);
  if (!files.length) {
    console.error(`No ticket files found in ${input}`);
    process.exit(1);
  }
  mkdirSync(outDir, { recursive: true });

  const results = [];
  for (const file of files) {
    const raw = readFileSync(file, "utf8");
    const c = { ...classify(raw), raw };
    const name = basename(file, extname(file)).replace(/[^\w-]/g, "_");
    const draft = draftFor(c);
    const triage = { file, ...c, raw: undefined };
    writeFileSync(join(outDir, `${name}.triage.json`), JSON.stringify(triage, null, 2));
    writeFileSync(join(outDir, `${name}.draft.md`), `# Draft reply — ${name}\n\n_Category: ${c.category} · Provider: ${c.provider} · Flags: ${c.flags.join(",") || "none"} · BF-E: ${c.bfCodes.join(",") || "—"}_\n\n${draft}\n`);
    results.push({ name, category: c.category, provider: c.provider, flags: c.flags, codes: c.bfCodes });
  }

  // summary + FAQ gap detection
  const byCat = {};
  for (const r of results) byCat[r.category] = (byCat[r.category] || 0) + 1;
  const gapCats = ["other", "feature-request"].filter((c) => byCat[c]);

  const summary = [
    `# Triage summary — ${results.length} ticket(s)`,
    "",
    "| Category | Count |",
    "|---|---|",
    ...Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([k, v]) => `| ${k} | ${v} |`),
    "",
    `Providers: ${JSON.stringify(results.reduce((m, r) => ({ ...m, [r.provider]: (m[r.provider] || 0) + 1 }), {}))}`,
    `Urgency flags: ${results.filter((r) => r.flags.length).length} ticket(s) need personal review`,
    "",
    gapCats.length
      ? `**FAQ gaps:** ${gapCats.join(", ")} — review these tickets and add canned answers to SupportKnowledge/locales if recurring.`
      : "No FAQ gaps detected this batch.",
    "",
    "_All drafts require human review before sending. See docs/support-ai-workflow.md._",
  ].join("\n");
  writeFileSync(join(outDir, "_summary.md"), summary);

  if (jsonOnly) console.log(JSON.stringify(results, null, 2));
  else {
    console.log(`Triaged ${results.length} ticket(s) → ${outDir}`);
    console.log(summary);
  }
}

if (process.argv[1] && process.argv[1].endsWith("support-triage.mjs")) main();
