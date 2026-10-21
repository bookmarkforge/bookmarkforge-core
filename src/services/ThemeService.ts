import { STORAGE_KEYS } from "../constants/storage-keys";

/**
 * CSS-only user themes (ADR-042 D4). A theme is a stylesheet applied to a
 * dedicated <style> element via textContent — never innerHTML — so markup
 * cannot escape the element. The sanitizer additionally fails closed on any
 * construct that could load an external resource or execute code.
 */

const THEME_STYLE_ID = "bookmarkforge-user-theme";
const MAX_THEME_CSS_BYTES = 64 * 1024;

interface SanitizeResult {
  ok: boolean;
  css?: string;
  reason?: string;
}

/** Forbidden constructs: external fetch or legacy CSS execution vectors. */
const FORBIDDEN: Array<{ name: string; re: RegExp }> = [
  { name: "external @import", re: /@import\b/i },
  { name: "external url()", re: /url\s*\(/i },
  { name: "legacy expression()", re: /expression\s*\(/i },
  { name: "legacy behavior:", re: /behavior\s*:/i },
  { name: "script: scheme", re: /javascript\s*:/i },
  { name: "-moz-binding", re: /-moz-binding\b/i },
];

/**
 * Normalizes CSS syntax that browsers treat as equivalent before safety checks.
 * CSS identifier escapes and comments can otherwise hide forbidden functions.
 */
function normalizeCssForSafety(css: string): string {
  const withoutComments = css.replace(/\/\*[\s\S]*?(?:\*\/|$)/g, "");
  const withHexEscapesDecoded = withoutComments.replace(
    /\\([0-9a-fA-F]{1,6})(?:[ \t\r\n\f])?/g,
    (_match, hex: string) => {
      const codePoint = Number.parseInt(hex, 16);
      if (
        codePoint === 0 ||
        codePoint > 0x10ffff ||
        (codePoint >= 0xd800 && codePoint <= 0xdfff)
      ) {
        return "�";
      }
      return String.fromCodePoint(codePoint);
    },
  );
  return withHexEscapesDecoded
    .replace(/\\([\s\S])/g, "$1")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

/** Validates and normalizes a user theme stylesheet. Pure and side-effect free. */
export function sanitizeThemeCss(css: string): SanitizeResult {
  if (typeof css !== "string" || css.trim().length === 0) {
    return { ok: false, reason: "theme CSS is empty" };
  }
  const trimmed = css.trim();
  if (new TextEncoder().encode(trimmed).byteLength > MAX_THEME_CSS_BYTES) {
    return { ok: false, reason: "theme CSS exceeds the 64 KB limit" };
  }
  const normalized = normalizeCssForSafety(trimmed);
  for (const { name, re } of FORBIDDEN) {
    if (re.test(normalized)) {
      return { ok: false, reason: `theme CSS contains forbidden ${name}` };
    }
  }
  return { ok: true, css: trimmed };
}

function readStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** Applies, clears and persists the active user theme stylesheet. */
export class ThemeService {
  private ensureStyleElement(): HTMLStyleElement {
    let el = document.getElementById(THEME_STYLE_ID) as HTMLStyleElement | null;
    if (!el) {
      el = document.createElement("style");
      el.id = THEME_STYLE_ID;
      el.setAttribute("data-bookmarkforge-theme", "user");
      document.head.appendChild(el);
    }
    return el;
  }

  /** Sanitizes `css` and, on success, applies it to the dedicated <style>. */
  apply(css: string): SanitizeResult {
    const result = sanitizeThemeCss(css);
    if (!result.ok || result.css === undefined) {
      return result;
    }
    const el = this.ensureStyleElement();
    el.textContent = result.css;
    return result;
  }

  /** Removes the applied user theme stylesheet. */
  clear(): void {
    const el = document.getElementById(THEME_STYLE_ID);
    el?.remove();
  }

  /** Returns the currently applied CSS, or null when no theme is applied. */
  getAppliedCss(): string | null {
    const el = document.getElementById(THEME_STYLE_ID);
    return el?.textContent ?? null;
  }

  /** Persists a sanitized theme CSS to local storage (opt-in, local-only). */
  save(css: string): SanitizeResult {
    const result = sanitizeThemeCss(css);
    if (!result.ok || result.css === undefined) {
      return result;
    }
    const storage = readStorage();
    if (!storage) {
      return { ok: false, reason: "local storage is unavailable" };
    }
    storage.setItem(STORAGE_KEYS.USER_THEME_CSS, result.css);
    return result;
  }

  /** Loads the persisted theme CSS, or null when none is stored. */
  load(): string | null {
    const storage = readStorage();
    const raw = storage?.getItem(STORAGE_KEYS.USER_THEME_CSS);
    if (!raw) {
      return null;
    }
    const result = sanitizeThemeCss(raw);
    return result.ok ? (result.css ?? null) : null;
  }

  /** Removes the persisted theme CSS (does not touch the applied <style>). */
  removePersisted(): void {
    readStorage()?.removeItem(STORAGE_KEYS.USER_THEME_CSS);
  }
}

export const themeService = new ThemeService();
