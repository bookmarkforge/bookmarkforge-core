/**
 * BF-E* error codes — the catalog documented at /help#error-codes.
 *
 * Every code below MUST stay in sync with `help.errorCodes.e*` in
 * `scripts/translations/en.json` (the help pages are generated from it).
 * The classifier maps thrown errors to the documented codes so users can
 * quote "BF-E102" in a ticket and support can jump straight to the fix.
 *
 * Codes are recorded (never thrown) at the UI boundary: `toUserErrorMessage`
 * calls `noteUserError`, which stores the last classified code for the
 * redacted diagnostics report (`utils/supportDiagnostics.ts`).
 */

// A type union, not a runtime map: nothing reads the labels at runtime, so an
// exported object was dead weight (`Unused exports` in knip) and an internal
// one was a value used only as a type (`no-unused-vars` in ESLint). The labels
// stay as comments, next to the code they document.
export type BfErrorCode =
  | "E101" // Vault password forgotten / recovery phrase required
  | "E102" // Vault locked / wrong password
  | "E103" // Storage quota exceeded
  | "E104" // IndexedDB blocked / private browsing
  | "E105" // P2P / WebRTC unavailable
  | "E106" // Local AI (WebLLM) cannot run on this device
  | "E107" // Backup import failed (wrong password / corrupt file)
  | "E201" // Pro license invalid / expired check
  | "E202" // Free limit reached (500 per collection: bookmarks / notes+documents)
  | "E301" // AI provider: API key invalid / revoked / wrong format
  | "E302" // AI provider: model retired / not found upstream
  | "E303" // AI provider: request format incompatible (payload drift)
  | "E304" // AI provider: rate limit / quota exhausted
  | "E305" // AI provider: upstream server error (5xx)
  | "E306" // AI provider: network unreachable / timeout

function errorText(error: unknown): string {
  if (error instanceof Error) {return `${error.name} ${error.message}`;}
  if (typeof error === "string") {return error;}
  if (error && typeof error === "object") {
    const e = error as { name?: unknown; message?: unknown; code?: unknown };
    return [e.name, e.message, e.code]
      .filter((v): v is string => typeof v === "string")
      .join(" ");
  }
  return "";
}

/**
 * Classify an arbitrary thrown value into a documented BF-E* code, or null
 * when the error does not match a known support category. Order matters:
 * the first matching rule wins, so specific checks precede generic ones.
 * Internal: callers go through `noteUserError`, which also records the code.
 */
function classifyUserError(error: unknown): BfErrorCode | null {
  const t = errorText(error).toLowerCase();
  if (!t) {return null;}

  // E101 — recovery phrase / forgotten password surfaces
  if (
    t.includes("recovery phrase") ||
    t.includes("frase de recuperaci") ||
    t.includes("forgot password") ||
    t.includes("seed phrase")
  ) {
    return "E101";
  }
  // E102 — vault locked / wrong credentials
  if (
    t.includes("wrong password") ||
    t.includes("invalid password") ||
    t.includes("incorrect password") ||
    t.includes("vault is locked") ||
    t.includes("vault locked") ||
    t.includes("bad password") ||
    t.includes("contraseña") && t.includes("incorrect")
  ) {
    return "E102";
  }
  // E3xx — AI provider errors. Placed BEFORE E103: provider quota errors
  // ("insufficient_quota", "rate limit") must not be misread as storage
  // quota. The raw provider message carries "API error <status>" or the
  // classified phrases built by providerErrors/GeminiProvider.
  if (
    t.includes("invalid or revoked api key") ||
    t.includes("api error 401") ||
    t.includes("api error 403") ||
    t.includes("api key not valid") ||
    t.includes("incorrect api key")
  ) {
    return "E301";
  }
  if (
    t.includes("incompatible request format") ||
    t.includes("api error 400") ||
    t.includes("unknown name") ||
    t.includes("invalid json payload") ||
    t.includes("unrecognized request argument")
  ) {
    return "E303";
  }
  if (
    t.includes("api error 429") ||
    t.includes("rate limit") ||
    t.includes("rate_limit") ||
    t.includes("too many requests") ||
    t.includes("insufficient_quota") ||
    t.includes("insufficient quota")
  ) {
    return "E304";
  }
  if (/api error 5\d\d/.test(t)) {
    return "E305";
  }
  if (
    t.includes("model_not_found") ||
    t.includes("not_found_error") ||
    t.includes("no longer available") ||
    t.includes("not found for api version") ||
    t.includes("api error 404") ||
    (t.includes("model") && t.includes("not found"))
  ) {
    return "E302";
  }
  if (
    t.includes("network error") ||
    t.includes("fetch failed") ||
    t.includes("econnrefused") ||
    t.includes("etimedout") ||
    t.includes("enotfound") ||
    t.includes("eai_again") ||
    t.includes("socket hang up") ||
    t.includes("err_internet")
  ) {
    return "E306";
  }
  // E103 — storage quota
  if (
    t.includes("quota") ||
    t.includes("ns_error_dom_quota") ||
    t.includes("storage full") ||
    t.includes("disk full") ||
    t.includes("storagepressure")
  ) {
    return "E103";
  }
  // E104 — IndexedDB unavailable / private mode
  if (
    t.includes("indexeddb") ||
    t.includes("indexed_db") ||
    t.includes("private browsing") ||
    t.includes("private mode") ||
    t.includes("idb_")
  ) {
    return "E104";
  }
  // E105 — WebRTC / P2P transport
  if (
    t.includes("webrtc") ||
    t.includes("rtcpeer") ||
    t.includes("ice candidate") ||
    t.includes("signaling")
  ) {
    return "E105";
  }
  // E106 — local AI runtime (WebLLM/WebGPU)
  if (
    t.includes("webllm") ||
    t.includes("webgpu") ||
    t.includes("shader-f16") ||
    t.includes("onnxruntime")
  ) {
    return "E106";
  }
  // E107 — backup/restore file problems
  if (
    t.includes(".bmf") ||
    t.includes("backup import") ||
    t.includes("restore failed") ||
    t.includes("corrupt") ||
    t.includes("truncated")
  ) {
    return "E107";
  }
  // E201 — license / entitlement
  if (
    t.includes("license") ||
    t.includes("licencia") ||
    t.includes("entitlement") ||
    t.includes("activation") ||
    t.includes("pro plan")
  ) {
    return "E201";
  }
  // E202 — free-tier cap
  if (
    t.includes("bookmark limit") ||
    t.includes("free limit") ||
    t.includes("max bookmarks") ||
    t.includes("500 bookmark") ||
    t.includes("limit reached") ||
    t.includes("upgrade to pro")
  ) {
    return "E202";
  }
  return null;
}

let lastErrorCode: BfErrorCode | null = null;

/** Record the code of the latest user-facing error for diagnostics. */
export function noteUserError(error: unknown): BfErrorCode | null {
  const code = classifyUserError(error);
  if (code) {lastErrorCode = code;}
  return code;
}

/** Last classified BF-E* code since app start, or null. */
export function getLastErrorCode(): BfErrorCode | null {
  return lastErrorCode;
}

/** Human label for logs/tests. */
export function describeErrorCode(code: BfErrorCode): string {
  return `BF-${code}`;
}
