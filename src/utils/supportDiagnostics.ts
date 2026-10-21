/**
 * Redacted diagnostic builder for support — never includes vault content,
 * URLs, prompts or titles. Safe to paste in email/discussions.
 *
 * Data gathered:
 *  - app version / build hash (vite __APP_VERSION__ if available, else package)
 *  - browser (UA via navigator.userAgent — already sent in HTTP headers) + lang
 *  - counts: bookmarks / docs / vectors (numbers only)
 *  - storage: quota usage % + estimate (navigator.storage.estimate) — no paths
 *  - P2P: connected boolean + last sync age — no peer IDs or room secrets
 *  - AI: provider name + local AI availability (bool) — no prompt content
 *  - errors: count last 7d + last BF-E code — no stack/content
 *
 * All fields are plain numbers/booleans/versions — GDPR-safe.
 */

import { diagnosticService } from "../services/DiagnosticService";
import { getBuildHash } from "../utils/bundleIntegrity";

export interface RedactedDiagnostic {
  app: string;
  version: string;
  build: string;
  generatedAt: string;
  browser: string;
  lang: string;
  vault: { bookmarks: number; vectors: number };
  storage: { usagePct: number | null; usedBytes: number | null; quotaBytes: number | null; ok: boolean };
  p2p: { connected: boolean };
  ai: { provider: string; localAvailable: boolean; webLLMStatus: string };
  errors: { count7d: number; lastCode: string | null };
  bfE: string | null;
}

function getAppVersion(): string {
  // Vite injects __APP_VERSION__ in production builds; fallback to package version prefix
  try {
    // @ts-expect-error — injected by vite define
    if (typeof __APP_VERSION__ === "string" && __APP_VERSION__) return String(__APP_VERSION__);
  } catch { /* ignore */ }
  return "1.0.0";
}

export async function buildRedactedDiagnostic(lastBfE: string | null = null): Promise<RedactedDiagnostic> {
  const d = await diagnosticService.getDiagnostics();
  let usedBytes: number | null = null;
  let quotaBytes: number | null = null;
  let usagePct: number | null = null;
  try {
    if (navigator.storage?.estimate) {
      const est = await navigator.storage.estimate();
      usedBytes = typeof est.usage === "number" ? est.usage : null;
      quotaBytes = typeof est.quota === "number" ? est.quota : null;
      if (usedBytes !== null && quotaBytes !== null && quotaBytes > 0) {
        usagePct = Math.round((usedBytes / quotaBytes) * 100);
      }
    }
  } catch { /* storage unavailable */ }
  const storageOk = (() => {
    try { return !!window.indexedDB; } catch { return false; }
  })();
  return {
    app: "BookmarkForge",
    version: getAppVersion(),
    build: getBuildHash() || "dev",
    generatedAt: new Date().toISOString().slice(0, 10),
    browser: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 120) : "unknown",
    lang: typeof document !== "undefined" ? (document.documentElement.lang || navigator.language || "en") : "en",
    vault: { bookmarks: d.db.bookmarkCount, vectors: d.db.vectorCount },
    storage: { usagePct, usedBytes, quotaBytes, ok: storageOk },
    p2p: { connected: Object.keys(d.sync.providers || {}).length > 0 },
    ai: { provider: d.ai.provider, localAvailable: d.ai.ollamaAvailable || d.ai.webGpuSupported, webLLMStatus: d.ai.webLlmStatus },
    errors: { count7d: 0, lastCode: lastBfE },
    bfE: lastBfE,
  };
}

export function formatDiagnosticText(diag: RedactedDiagnostic): string {
  const storage = diag.storage.usagePct !== null
    ? `${diag.storage.usagePct}% (${diag.storage.ok ? "IndexedDB OK" : "IndexedDB ?"})`
    : (diag.storage.ok ? "IndexedDB OK" : "unknown");
  const lines = [
    `BookmarkForge v${diag.version} | ${diag.browser.split(" ").slice(-2).join(" ")} | Build ${diag.build}`,
    `Vault: ${diag.vault.bookmarks} bookmarks, ${diag.vault.vectors} vectors`,
    `Storage: ${storage}${diag.storage.usedBytes !== null ? ` — ${Math.round(diag.storage.usedBytes/1024/1024)}MB` : ""} | Last backup: see Settings → Storage`,
    `P2P: ${diag.p2p.connected ? "connected" : "not connected"} | AI: ${diag.ai.provider} (${diag.ai.webLLMStatus})${diag.ai.localAvailable ? " local OK" : ""}`,
    `Errors: ${diag.errors.count7d} last 7d | BF-E: ${diag.bfE ?? "none"} | ${diag.generatedAt}`,
  ];
  return lines.join("\n");
}

export async function copyRedactedDiagnostic(lastBfE: string | null = null): Promise<string> {
  const diag = await buildRedactedDiagnostic(lastBfE);
  const text = formatDiagnosticText(diag);
  // Prefer clipboard; fallback to execCommand path is handled by caller UI if needed
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
  } else {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    try { ta.select(); document.execCommand("copy"); } finally { document.body.removeChild(ta); }
  }
  return text;
}
