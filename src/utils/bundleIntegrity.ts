/**
 * Bundle Integrity Validator
 *
 * Detects tampering with the application bundle at runtime.
 * Verifies that loaded JavaScript/CSS resources match expected hashes
 * from the build manifest (generated at build time, injected via Vite).
 *
 * Complies with secure-code-review-checklist:
 * "Validate that the running code matches the reviewed code"
 *
 * Privacy: Runs entirely locally. No data leaves the device.
 * Reports integrity failures to AuditLog for security auditing.
 */

import { logger } from "./logger";
import { getWindowBuildHash } from "./browser-types";
import { firewalledFetch } from "./networkFirewall";

interface IntegrityManifest {
  version: string;
  buildHash: string;
  buildTime: string;
  files: Record<string, string>; // path -> sha256 hash
}

interface IntegrityCheckResult {
  passed: boolean;
  totalFiles: number;
  matchedFiles: number;
  mismatchedFiles: string[];
  missingFiles: string[];
  extraFiles: string[];
  checkedAt: string;
}

let cachedManifest: IntegrityManifest | null = null;
let forceIntegrityCheck = false;

/**
 * Extracts the integrity manifest injected at build time.
 * The manifest is expected as a JSON blob in a script tag
 * with id="__BMF_INTEGRITY_MANIFEST__" or via VITE_BUILD_MANIFEST.
 */
function getBuildManifest(): IntegrityManifest | null {
  if (cachedManifest) {return cachedManifest;}

  try {
    // Attempt to read from injected script tag
    const manifestEl = document.getElementById("__BMF_INTEGRITY_MANIFEST__");
    if (manifestEl?.textContent) {
      cachedManifest = JSON.parse(manifestEl.textContent) as IntegrityManifest;
      return cachedManifest;
    }
  } catch (_err) {
    logger.debug("[BundleIntegrity] No injected manifest element found");
  }

  // Fallback: use Vite env vars for build identity
  const buildHash =
    (typeof window !== "undefined" &&
    getWindowBuildHash().__BMF_BUILD_HASH__
      ? String(getWindowBuildHash().__BMF_BUILD_HASH__)
      : "") ||
    import.meta.env.VITE_BUILD_HASH ||
    "";

  if (buildHash) {
    cachedManifest = {
      version: import.meta.env.VITE_APP_VERSION || "0.0.0",
      buildHash,
      buildTime: "",
      files: {},
    };
    return cachedManifest;
  }

  // Try env-based fallback
  const envBuildHash = import.meta.env.VITE_BUILD_HASH;
  if (envBuildHash) {
    cachedManifest = {
      version: import.meta.env.VITE_APP_VERSION || "0.0.0",
      buildHash: envBuildHash,
      buildTime: "",
      files: {},
    };
    return cachedManifest;
  }

  return null;
}

/**
 * Computes SHA-256 hash of a string.
 */
async function sha256Bytes(bytes: ArrayBuffer | ArrayBufferView): Promise<string> {
  const view = bytes instanceof ArrayBuffer
    ? new Uint8Array(bytes)
    : new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // Copy the view so Web Crypto receives an ArrayBuffer owned by this realm;
  // this also avoids hashing unrelated bytes from a larger backing buffer.
  const data = new Uint8Array(view.byteLength);
  data.set(view);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256(input: string): Promise<string> {
  return sha256Bytes(new TextEncoder().encode(input));
}

/**
 * Verify bytes for a dynamically fetched same-origin asset (notably WASM)
 * against the build manifest. In production, an absent manifest or an
 * unlisted asset is a hard failure; tests/development remain permissive so
 * mocked and HMR resources keep working.
 */
export async function verifyResourceIntegrity(
  url: string,
  bytes: ArrayBuffer | ArrayBufferView,
): Promise<boolean> {
  const manifest = getBuildManifest();
  const production = import.meta.env.PROD && !forceIntegrityCheck;
  if (!manifest || Object.keys(manifest.files).length === 0) {
    return !production;
  }

  let path: string;
  try {
    path = new URL(url, window.location.href).pathname;
  } catch {
    path = url;
  }
  const expectedHash = manifest.files[path];
  if (!expectedHash) {
    return !production;
  }
  const actualHash = await sha256Bytes(bytes);
  return actualHash === expectedHash;
}

/**
 * Fetches a resource and computes its hash.
 * Uses fetch to get the raw content, then hashes it.
 */
async function fetchAndHashResource(url: string): Promise<string | null> {
  try {
    // SECURITY (C2): route through the network firewall. Same-origin and
    // self-allowed URLs pass; third-party origins are blocked.
    const response = await firewalledFetch(
      url,
      {
        cache: "force-cache", // Use cached version to avoid extra network
        credentials: "omit",
      },
      "bundle-integrity",
    );
    if (!response.ok) {return null;}
    const text = await response.text();
    return await sha256(text);
  } catch (_err) {
    // Silently fail — resource may not be fetchable (cross-origin, etc.)
    return null;
  }
}

/**
 * Extracts all script and stylesheet URLs from the current document.
 * Only checks same-origin resources.
 */
function getSameOriginResourceUrls(): string[] {
  const urls: string[] = [];
  const origin = window.location.origin;

  // Check <script> tags
  const scripts = document.querySelectorAll("script[src]");
  scripts.forEach((s) => {
    const src = (s as HTMLScriptElement).src;
    if (src.startsWith(origin) || src.startsWith("/")) {
      urls.push(src);
    }
  });

  // Check <link> stylesheets
  const links = document.querySelectorAll('link[rel="stylesheet"]');
  links.forEach((l) => {
    const href = (l as HTMLLinkElement).href;
    if (href.startsWith(origin) || href.startsWith("/")) {
      urls.push(href);
    }
  });

  // Check module preloads
  const preloads = document.querySelectorAll('link[rel="modulepreload"]');
  preloads.forEach((l) => {
    const href = (l as HTMLLinkElement).href;
    if (href.startsWith(origin) || href.startsWith("/")) {
      urls.push(href);
    }
  });

  return [...new Set(urls)];
}

/**
 * Performs a full bundle integrity check.
 *
 * Compares the hashes of all loaded same-origin resources
 * against the build manifest. Reports mismatches.
 *
 * NOTE: In development mode (Vite dev server), integrity checks
 * are skipped because files change on every hot reload.
 */
export function clearManifestCache(): void {
  cachedManifest = null;
}

export function setForceIntegrityCheck(force: boolean): void {
  forceIntegrityCheck = force;
}

export async function checkBundleIntegrity(): Promise<IntegrityCheckResult> {
  const result: IntegrityCheckResult = {
    passed: true,
    totalFiles: 0,
    matchedFiles: 0,
    mismatchedFiles: [],
    missingFiles: [],
    extraFiles: [],
    checkedAt: new Date().toISOString(),
  };

  // Skip in dev mode (files change constantly with HMR)
  if (import.meta.env.DEV && !forceIntegrityCheck) {
    logger.debug("[BundleIntegrity] Skipped in development mode");
    result.passed = true;
    return result;
  }

  const manifest = getBuildManifest();
  if (!manifest || Object.keys(manifest.files).length === 0) {
    // In production the integrity manifest MUST be present. Its absence
    // means the protection was stripped, so the check must fail rather
    // than silently pass.
    if (import.meta.env.PROD && !forceIntegrityCheck) {
      logger.error(
        "[BundleIntegrity] No file manifest available in production; integrity check failed",
      );
      result.passed = false;
      result.missingFiles.push("__BMF_INTEGRITY_MANIFEST__");
      return result;
    }
    logger.info(
      "[BundleIntegrity] No file manifest available; skipping per-file check",
    );
    result.passed = true;
    return result;
  }

  const resourceUrls = getSameOriginResourceUrls();
  result.totalFiles = resourceUrls.length;

  const manifestPaths = new Set(Object.keys(manifest.files));

  for (const url of resourceUrls) {
    // Extract the path from the URL
    let path: string;
    try {
      path = new URL(url).pathname;
    } catch (_err) {
      path = url;
    }

    const expectedHash = manifest.files[path];

    if (!expectedHash) {
      // File not in manifest — could be dynamically loaded
      continue;
    }

    const actualHash = await fetchAndHashResource(url);
    if (!actualHash) {
      // Couldn't fetch — skip (may be cross-origin)
      continue;
    }

    if (actualHash !== expectedHash) {
      result.passed = false;
      result.mismatchedFiles.push(path);
      logger.error("[BundleIntegrity] Hash mismatch", {
        file: path,
        expected: expectedHash.substring(0, 16) + "...",
        actual: actualHash.substring(0, 16) + "...",
      });
    } else {
      result.matchedFiles++;
    }
  }

  // Check for files in manifest that aren't loaded
  const loadedPaths = new Set(
    resourceUrls.map((u) => {
      try {
        return new URL(u).pathname;
      } catch (_err) {
        return u;
      }
    }),
  );
  for (const path of manifestPaths) {
    if (!loadedPaths.has(path)) {
      result.missingFiles.push(path);
    }
  }

  if (!result.passed) {
    logger.error("[BundleIntegrity] INTEGRITY CHECK FAILED", {
      mismatchedCount: result.mismatchedFiles.length,
      mismatched: result.mismatchedFiles,
    });

    // Emit a custom event so AuditLog and UI can react
    window.dispatchEvent(
      new CustomEvent("bundle-integrity-failed", {
        detail: {
          mismatchedFiles: result.mismatchedFiles,
          checkedAt: result.checkedAt,
        },
      }),
    );

    // Show visible error to user — tampered bundle must not execute silently.
    // The string is static (no user data), so innerHTML is safe here.
    const integrityErrorHtml =
      '<div style="display:flex;align-items:center;justify-content:center;height:100vh;background:#0f172a;color:#ef4444;font-family:system-ui;text-align:center;padding:2rem"><div><h1 style="font-size:1.5rem;margin-bottom:1rem">Integrity Check Failed</h1><p style="color:#94a3b8;margin-bottom:0.5rem">The application bundle has been tampered with.</p><p style="color:#64748b;font-size:0.875rem">Please reinstall the application from a trusted source.</p></div></div>';
    // L-06: body may not exist yet (this can run before parse completes) —
    // falling back to <html> instead of throwing a TypeError that would leave
    // the app with no error screen at all.
    if (document.body) {
      document.body.innerHTML = integrityErrorHtml;
    } else {
      document.documentElement.insertAdjacentHTML(
        "beforeend",
        integrityErrorHtml,
      );
    }
    // L-06: surface the failure in the tab title as well.
    document.title = "Integrity Check Failed";
  } else {
    logger.info("[BundleIntegrity] Integrity check passed", {
      matchedFiles: result.matchedFiles,
      totalFiles: result.totalFiles,
    });
  }

  return result;
}

/**
 * Quick check that verifies the build identity matches what's expected.
 * This is a lightweight alternative to full file hashing — it checks
 * that the build hash in the HTML matches the one in the JS env vars.
 */
export function verifyBuildIdentity(): boolean {
  const manifest = getBuildManifest();
  if (!manifest?.buildHash) {return true;} // Can't verify

  const envHash =
    getBuildHashFromEnv() || import.meta.env.VITE_BUILD_HASH || "";

  if (!envHash) {return true;} // No env hash to compare

  if (manifest.buildHash !== envHash) {
    logger.error("[BundleIntegrity] Build identity mismatch", {
      manifestHash: manifest.buildHash,
      envHash,
    });
    return false;
  }

  return true;
}

// Auto-run integrity check after page load (production only)
if (typeof window !== "undefined" && import.meta.env.PROD) {
  // Delay to not block initial render
  setTimeout(() => {
    checkBundleIntegrity().catch((err) => {
      logger.error("[BundleIntegrity] Auto-check failed", { error: err });
    });
  }, 3000);
}

// ─── Runtime script-injection detection ──────────────────────────────
//
// The static integrity check runs once at boot and validates that loaded
// resources match the build manifest. An attacker who injects a <script>
// tag AFTER boot (e.g. via a compromised browser extension or a DOM
// clobbering gadget in a dependency) would not be caught by the static
// check alone. This MutationObserver monitors <head> for new <script>
// elements and validates them against the manifest. Unknown scripts are
// removed and the event is logged.

let injectionObserver: MutationObserver | null = null;

function isProduction(): boolean {
  try {
    return import.meta.env.PROD === true;
  } catch {
    return false;
  }
}

export function startScriptInjectionGuard(): void {
  if (!isProduction() || typeof MutationObserver === "undefined") return;
  if (injectionObserver) return; // already running

  injectionObserver = new MutationObserver((mutations) => {
    const manifest = getBuildManifest();
    // Without a manifest we can't validate — but in production the
    // manifest must be present (checkBundleIntegrity already enforces
    // this). If it's missing, we're already in a degraded state.
    if (!manifest || Object.keys(manifest.files).length === 0) return;

    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (!(node instanceof HTMLScriptElement)) continue;
        const src = node.src;
        // Inline scripts without src are blocked by CSP (script-src
        // does not include 'unsafe-inline'), so they never execute.
        // We only need to validate external scripts with a src.
        if (!src) continue;

        let path: string;
        try {
          const parsed = new URL(src, window.location.href);
          // Only validate same-origin scripts. Cross-origin scripts
          // are blocked by CSP connect-src / script-src.
          if (parsed.origin !== window.location.origin) continue;
          path = parsed.pathname;
        } catch {
          continue;
        }

        const expectedHash = manifest.files[path];
        if (!expectedHash) {
          // Script src not in the manifest — remove it.
          logger.error(
            "[BundleIntegrity] Runtime script injection blocked",
            { src: src.slice(0, 200), path },
          );
          node.remove();
          window.dispatchEvent(
            new CustomEvent("bundle-integrity-failed", {
              detail: {
                mismatchedFiles: [path],
                reason: "runtime-injection",
                checkedAt: new Date().toISOString(),
              },
            }),
          );
        }
        // Scripts already in the manifest are legitimate dynamic
        // imports or code-split chunks — allow them.
      }
    }
  });

  // Observe the whole document (childList, subtree). Only HTMLScriptElement
  // nodes with a src are evaluated, so framework DOM churn in <body> cannot
  // cause false positives: same-origin scripts already listed in the build
  // manifest are allowed, and anything else is removed. In production every
  // same-origin chunk the app itself injects (code-split imports,
  // modulepreloads) IS in the manifest, so a removal here means an
  // unexpected script — exactly the signal this guard exists for.
  injectionObserver.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
  logger.info("[BundleIntegrity] Runtime script-injection guard active");
}

export function stopScriptInjectionGuard(): void {
  if (injectionObserver) {
    injectionObserver.disconnect();
    injectionObserver = null;
  }
}

// NOTE: __BMF_BUILD_HASH__ is already declared in src/types/globals.d.ts as
// window.__BMF_BUILD_HASH__.

/**
 * Best-effort build hash for diagnostics. Prefers the CSP-safe JSON
 * integrity manifest element — the only production source, since the old
 * inline `window.__BMF_BUILD_HASH__ = ...` script is blocked by the strict
 * CSP (audit R71) — with the window property as fallback for tests/dev.
 */
export function getBuildHash(): string {
  // Read the element DIRECTLY (not via getBuildManifest, which caches): the
  // diagnostics test suite relies on fresh reads after clearing the window
  // property, and the element is the authoritative CSP-safe production source.
  try {
    const el = document.getElementById("__BMF_INTEGRITY_MANIFEST__");
    if (el?.textContent) {
      const parsed = JSON.parse(el.textContent) as { buildHash?: string };
      if (parsed?.buildHash) {return parsed.buildHash;}
    }
  } catch {
    // element absent / malformed — fall through to the window property
  }
  try {
    return getWindowBuildHash().__BMF_BUILD_HASH__ || "";
  } catch {
    return "";
  }
}

/**
 * The window-injected build hash ONLY. verifyBuildIdentity compares this
 * second, independent source against the manifest element hash (they were
 * injected separately at build time); keep reading the window property
 * directly so a mismatch is still detected in tests/dev.
 */
function getBuildHashFromEnv(): string {
  try {
    return getWindowBuildHash().__BMF_BUILD_HASH__ || "";
  } catch (_err) {
    return "";
  }
}

