/**
 * CSP profile override (S3/R13 fix residue).
 *
 * Reads `localStorage[STORAGE_KEYS.CSP_PROFILE]` and overwrites the existing
 * `<meta http-equiv="Content-Security-Policy">` tag with the profile string.
 * Idempotent and safe to call multiple times.
 *
 * SECURITY: the OPEN profile (unsafe-inline + unsafe-eval) is only permitted
 * in development; in production it degrades to MODERATE so a persisted OPEN
 * value set by an XSS/extension cannot weaken the deployed CSP.
 *
 * Called from main.tsx as defense-in-depth on top of the response header CSP.
 */

import { STORAGE_KEYS } from "../constants/storage-keys";
import { safeGet } from "../store/safeStorage";

// ── Dependency Injection ───────────────────────────────────────────
interface StorageLike {
  safeGet(key: string): string | null;
}

function getStorage(): StorageLike {
  return { safeGet };
}

type CspProfileName = "STRICT" | "MODERATE" | "OPEN";

// CSP profiles are INJECTED AT BUILD TIME via Vite `define` from the
// canonical source (scripts/csp-config.js), eliminating any drift between
// csp-config.js and the runtime CSP override. See
// scripts/vite-config-shared.ts for the define entries.
//
// Per the CSP spec, multiple policies are intersected (most-restrictive
// wins). Tightening via META after the response is delivered DOES
// immediately block resources that previously were allowed.
// ──────────────────────────────────────────────────────────────

/** @define — injected at build time from scripts/csp-config.js */
declare const __CSP_STRICT__: string;
/** @define — injected at build time from scripts/csp-config.js */
declare const __CSP_MODERATE__: string;
/** @define — injected at build time from scripts/csp-config.js */
declare const __CSP_OPEN__: string;

/**
 * CSP profiles derived from scripts/csp-config.js (canonical source).
 * Vite replaces the __CSP_*__ tokens at build time with the actual
 * profile strings from csp-config.js, so this is always in sync.
 */
const CSP_PROFILES: Record<CspProfileName, string> = {
  STRICT: __CSP_STRICT__,
  MODERATE: __CSP_MODERATE__,
  OPEN: __CSP_OPEN__,
};

/**
 * Reads `localStorage[STORAGE_KEYS.CSP_PROFILE]` and overwrites the existing
 * `<meta http-equiv="Content-Security-Policy">` tag with the profile string.
 * Idempotent and safe to call multiple times.
 *
 * Only affects resources loaded AFTER it runs. To cover the FIRST page render
 * (which happens before main.tsx evaluates because Vite emits
 * `<script type="module">` with `defer`), the STRICT profile is also shipped
 * as a response header by nginx.
 *
 * Called from main.tsx as defense-in-depth.
 */
export function applyUserCspProfile(): void {
  if (typeof document === "undefined") {return;}
  if (typeof localStorage === "undefined") {return;}
  let profileName: CspProfileName;
  try {
    const raw = getStorage().safeGet(STORAGE_KEYS.CSP_PROFILE);
    if (raw && (raw === "STRICT" || raw === "MODERATE" || raw === "OPEN")) {
      // SECURITY: the OPEN profile (unsafe-inline + unsafe-eval) is only
      // permitted in development. In production it would fully defeat the
      // CSP hardening, so we degrade it to MODERATE. A persisted OPEN value
      // set by an XSS/extension cannot weaken the deployed CSP.
      if (raw === "OPEN" && import.meta.env.PROD) {
        profileName = "MODERATE";
      } else {
        profileName = raw;
      }
    } else {
      return; // default = whatever the response header shipped
    }
  } catch (_err) {
    return;
  }

  const profile = CSP_PROFILES[profileName];
  if (!profile) {return;}

  // Find or create the meta tag.
  let meta = document.querySelector<HTMLMetaElement>(
    'meta[http-equiv="Content-Security-Policy"]',
  );
  if (!meta) {
    meta = document.createElement("meta");
    meta.httpEquiv = "Content-Security-Policy";
    meta.setAttribute("http-equiv", "Content-Security-Policy");
    document.head?.appendChild(meta);
  }
  meta.content = profile;
}
