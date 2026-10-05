/**
 * scripts/check-extension-csp.mjs — extension CSP gate (ADR-029 follow-up).
 *
 * Asserts that the browser-extension manifests (Chrome MV3 + Firefox MV2)
 * declare a content_security_policy that exactly matches a single canonical
 * string. Each platform uses a different JSON shape (MV3: structured object
 * with `extension_pages`, MV2: flat string) — the canonical string is
 * applied verbatim to the right field in each manifest.
 *
 * The extension's CSP is intentionally tighter than the app's: there is no
 * web-app context here, only the extension pages (popup, background). So we
 * disable things the extension never needs (websocket to arbitrary hosts,
 * cross-origin frames, base-URI override, form submission) and reference
 * the same domain the app connects to (`https://bookmarkforgeapp.com`) so a
 * deployment that flips the app base URL to a private instance via
 * `chrome.storage.sync` remains compatible.
 *
 * Usage:
 *   node scripts/check-extension-csp.mjs           # gate (exit 1 on drift)
 *   node scripts/check-extension-csp.mjs --print   # print the canonical CSP
 *   node scripts/check-extension-csp.mjs --fix     # rewrite the manifests
 *
 * `--fix` writes the canonical CSP into both manifests (verbatim) without
 * touching any other field. It is intentionally narrow: removing or renaming
 * a manifest field is a code/ADR change, not a config-fix.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";


/**
 * Canonical content-security-policy for the browser extension. Single source
 * of truth; both manifests must declare this string (or its `extension_pages`
 * equivalent) verbatim.
 *
 * `connect-src 'self'`: the extension does no fetch() / XHR / WebSocket of
 * its own. `chrome.tabs.create` (used to open the capture page) is NOT
 * subject to connect-src — so no external domain needs whitelisting.
 * Reducing to `'self'` eliminates the unnecessary bookmarkforgeapp.com origin
 * and hardens the CSP against first-party exfiltration.
 *
 * `style-src 'self'` (no `'unsafe-inline'`): the popup stylesheet lives in
 * `extension/popup.css` and is loaded via `<link rel="stylesheet">` in
 * `popup.html`. Visibility toggling in `popup.js` uses the HTML `hidden`
 * attribute and a `.is-open` class, never inline `style=` — so removing
 * `'unsafe-inline'` is safe and locks down the only remaining inline-style
 * attack surface on the extension.
 */
const CANONICAL_CSP =
  `script-src 'self'; object-src 'none'; connect-src 'self'; frame-src 'none'; base-uri 'none'; form-action 'none'; style-src 'self'`;

const MANIFESTS = [
  {
    label: "Chrome MV3",
    path: "extension/manifest.json",
    /** Read the CSP value out of a parsed MV3 manifest. */
    extract: (manifest) => {
      const csp = manifest?.content_security_policy;
      if (csp === undefined || csp === null) return null;
      if (typeof csp === "string") return csp;
      if (typeof csp === "object" && typeof csp.extension_pages === "string") {
        return csp.extension_pages;
      }
      return null;
    },
    /**
     * Inject the canonical CSP into the file content as JSON text, preserving
     * the surrounding indentation by reading the file as text and locating
     * the `"content_security_policy":` key.
     */
    inject: (fileText, csp) => injectMvsContentSecurityPolicy(fileText, csp),
  },
  {
    label: "Firefox MV2",
    path: "extension/manifest-firefox.json",
    extract: (manifest) => {
      const csp = manifest?.content_security_policy;
      return typeof csp === "string" ? csp : null;
    },
    inject: (fileText, csp) =>
      injectFlatStringField(fileText, "content_security_policy", csp),
  },
];

// ---------------------------------------------------------------------------
// Text-level injection helpers (write the canonical CSP verbatim).
// ---------------------------------------------------------------------------

/**
 * MV3 manifest uses the structured form:
 *   "content_security_policy": { "extension_pages": "…" }
 * If the block is missing, inject a new top-level field in the correct
 * position (alphabetical ordering inside the trailing close brace) with the
 * project's 2-space indent. If it exists, replace only the `extension_pages`
 * value, preserving surrounding formatting.
 */
function injectMvsContentSecurityPolicy(fileText, csp) {
  if (!/"content_security_policy"\s*:/.test(fileText)) {
    return injectFlatStringField(fileText, "content_security_policy", csp) +
      `,\n  "content_security_policy": {\n    "extension_pages": ${jsonString(csp)}\n  }\n`;
  }
  // Replace just the extension_pages value, leaving the surrounding object intact.
  return fileText.replace(
    /("content_security_policy"\s*:\s*\{[\s\S]*?"extension_pages"\s*:\s*)"[^"]*"/,
    (_, prefix) => `${prefix}${jsonString(csp)}`,
  );
}

/**
 * Insert (or replace) `"<key>": "<value>"` in a manifest file with the
 * project's 2-space indent. Used both for the top-level MV2 CSP and as a
 * building block for MV3.
 */
function injectFlatStringField(fileText, key, value) {
  const re = new RegExp(`"${key}"\\s*:\\s*"[^"]*"`);
  if (re.test(fileText)) {
    return fileText.replace(re, `"${key}": ${jsonString(value)}`);
  }
  // Missing field — inject before the trailing closing brace.
  const closing = fileText.lastIndexOf("}");
  if (closing === -1) {
    throw new Error(
      `[check-extension-csp] cannot locate closing '}' in ${key} injection`,
    );
  }
  const head = fileText.slice(0, closing).replace(/,\s*$/, "");
  const tail = fileText.slice(closing);
  return `${head},\n  "${key}": ${jsonString(value)}\n${tail}`;
}

/** JSON-encode a string with no trailing whitespace quirks. */
function jsonString(value) {
  return JSON.stringify(value);
}

// ---------------------------------------------------------------------------
// Gate logic.
// ---------------------------------------------------------------------------

/**
 * Apply a `manifest` (JSON-parsed) to extract its CSP and report whether it
 * matches the canonical. Returns a structured report consumed by `main()`.
 */
function checkManifest({ label, path, extract }) {
  if (!existsSync(path)) {
    return { label, path, ok: false, reason: "missing" };
  }
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    return { label, path, ok: false, reason: "json-parse", error };
  }
  const csp = extract(manifest);
  if (csp === null) {
    return {
      label,
      path,
      ok: false,
      reason: "no-csp",
      canonical: CANONICAL_CSP,
    };
  }
  return {
    label,
    path,
    ok: csp === CANONICAL_CSP,
    actual: csp,
    canonical: CANONICAL_CSP,
  };
}

function main() {
  const args = process.argv.slice(2);
  const fix = args.includes("--fix");
  const printMode = args.includes("--print");

  if (printMode) {
    console.log(CANONICAL_CSP);
    return;
  }

  let failures = 0;
  const reports = MANIFESTS.map(checkManifest);

  for (const report of reports) {
    if (report.ok) {
      console.log(
        `[check-extension-csp] ok ${report.label} (${report.path}) — CSP verbatim`,
      );
      continue;
    }
    failures += 1;
    if (report.reason === "missing") {
      console.error(
        `[check-extension-csp] FAIL ${report.label} — manifest missing at ${report.path}`,
      );
    } else if (report.reason === "json-parse") {
      console.error(
        `[check-extension-csp] FAIL ${report.label} — JSON parse error: ${report.error?.message ?? report.error}`,
      );
    } else if (report.reason === "no-csp") {
      console.error(
        `[check-extension-csp] FAIL ${report.label} (${report.path}) — no content_security_policy declared. ` +
          `Expected: ${report.canonical}`,
      );
    } else {
      console.error(
        `[check-extension-csp] FAIL ${report.label} (${report.path}) — CSP drift`,
      );
      console.error(`  canonical: ${report.canonical}`);
      console.error(`  actual:    ${report.actual}`);
    }
  }

  if (fix && failures > 0) {
    let rewritten = 0;
    for (const [index, conf] of MANIFESTS.entries()) {
      const report = reports[index];
      if (report.reason === "missing") {
        console.warn(
          `[check-extension-csp] --fix skipped ${conf.label} — manifest is missing`,
        );
        continue;
      }
      if (report.reason === "json-parse") {
        console.warn(
          `[check-extension-csp] --fix skipped ${conf.label} — malformed JSON left untouched`,
        );
        continue;
      }
      if (report.ok) continue;
      const text = readFileSync(conf.path, "utf8");
      const result = conf.inject(text, CANONICAL_CSP);
      writeFileSync(conf.path, result.endsWith("\n") ? result : result + "\n");
      rewritten += 1;
    }
    console.log(
      `[check-extension-csp] --fix rewrote ${rewritten} manifest(s) with the canonical CSP`,
    );
  }

  if (failures > 0 && !fix) {
    process.exit(1);
  }
}

// Direct-invocation guard (matches the pattern in scripts/audit-anchors.mjs).
function isDirectInvocation() {
  const entry = process.argv[1];
  if (!entry) return false;
  const entryBase = entry.split(/[\\/]/).pop();
  const moduleBase = import.meta.url.split("/").pop();
  return entryBase === moduleBase;
}

if (isDirectInvocation()) {
  try {
    main();
  } catch (error) {
    console.error(
      `[check-extension-csp] FATAL: ${error?.message ?? String(error)}`,
    );
    process.exit(2);
  }
}

export { CANONICAL_CSP, checkManifest };
