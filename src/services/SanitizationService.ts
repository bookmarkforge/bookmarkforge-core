import DOMPurify from "dompurify";
import { logger } from "../utils/logger";
import {
  normalizeIpv4,
  isPrivateIpv4,
  isPrivateIpv6Host,
  hexMappedIpv4ToDotted,
} from "../utils/ipSecurity";

/**
 * SanitizationService - Centralized input sanitization using DOMPurify
 * Prevents XSS attacks by sanitizing all user inputs before storage or display
 */
export class SanitizationService {
  // DOMPurify configuration for general HTML content
  private static readonly HTML_CONFIG = {
    ALLOWED_TAGS: [
      "p",
      "br",
      "b",
      "i",
      "u",
      "strong",
      "em",
      "code",
      "pre",
      "blockquote",
      "ul",
      "ol",
      "li",
      "a",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "table",
      "thead",
      "tbody",
      "tr",
      "th",
      "td",
      "img",
      "span",
      "div",
      "hr",
      "sub",
      "sup",
      "del",
      "ins",
      "mark",
      "small",
      "cite",
      "dfn",
    ],
    ALLOWED_ATTR: [
      "href",
      "title",
      "target",
      "rel",
      "src",
      "alt",
      "width",
      "height",
      "colspan",
      "rowspan",
      "class",
      "id",
    ],
    FORCE_BODY: true,
    SANITIZE_DOM: true,
    KEEP_CONTENT: true,
  };

  // Stricter configuration for user-generated content (chat, comments)
  private static readonly USER_CONTENT_CONFIG = {
    ALLOWED_TAGS: ["p", "br", "b", "i", "strong", "em", "code", "blockquote"],
    ALLOWED_ATTR: [],
    FORCE_BODY: true,
  };

  // Configuration for markdown rendering (allows more formatting)
  private static readonly MARKDOWN_CONFIG = {
    ALLOWED_TAGS: [
      "p",
      "br",
      "b",
      "i",
      "u",
      "strong",
      "em",
      "code",
      "pre",
      "blockquote",
      "ul",
      "ol",
      "li",
      "a",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "hr",
      "sub",
      "sup",
      "del",
      "ins",
      "mark",
    ],
    ALLOWED_ATTR: ["href", "title", "target", "rel"],
    FORCE_BODY: true,
  };

  /**
   * Sanitize HTML content using DOMPurify
   * @param html - Raw HTML string to sanitize
   * @param strict - Use stricter configuration (default: false)
   * @returns Sanitized HTML string
   */
  static sanitizeHtml(html: string, strict = false): string {
    if (!html || typeof html !== "string") {return "";}

    try {
      const config = strict ? this.USER_CONTENT_CONFIG : this.HTML_CONFIG;
      const sanitized = DOMPurify.sanitize(html, config);

      // Additional security: Ensure all links have safe attributes
      if (!strict) {
        return this.sanitizeLinks(sanitized);
      }

      return sanitized;
    } catch (error) {
      logger.error("[SanitizationService] Failed to sanitize HTML:", error);
      return ""; // Fail safely
    }
  }

  /**
   * Sanitize plain text by escaping HTML entities
   * @param text - Plain text string
   * @returns Escaped text safe for HTML display
   */
  static sanitizeText(text: string): string {
    if (!text || typeof text !== "string") {return "";}

    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Sanitize URLs to prevent XSS and SSRF attacks
   * @param url - URL string to validate
   * @returns Sanitized URL or empty string if invalid
   */
  static sanitizeUrl(url: string): string {
    if (!url || typeof url !== "string") {return "";}

    try {
      const parsed = new URL(url, window.location.origin);

      // Only allow http and https protocols
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return "";
      }

      // Block javascript:, vbscript:, and data: URLs in raw href (defense-in-depth —
      // WHATWG URL parser already rejects most of these, but the raw-string
      // check catches edge cases where the parser normalizes a dangerous URL
      // into a valid one).
      if (
        url.startsWith("javascript:") ||
        url.startsWith("vbscript:") ||
        url.startsWith("data:")
      ) {
        return "";
      }

      // Block private IPs and localhost. Strip a trailing dot (FQDN root):
      // "localhost." is DNS-equivalent to "localhost" and must not bypass
      // the checks below.
      const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");

      // `URL.hostname` keeps IPv6 brackets ("[::1]"), which would defeat the
      // range regexes below — strip them before any checks.
      const bareHost =
        hostname.startsWith("[") && hostname.endsWith("]")
          ? hostname.slice(1, -1)
          : hostname;

      // Normalize non-dotted-decimal IPv4 forms (hex 0x7f000001, octal
      // 0177.0.0.1, integer 2130706433, short forms 127.1, or embedded
      // credentials) that browsers may resolve to a private address but
      // slip past string checks. The WHATWG URL parser already normalizes
      // most of these (e.g. 0x7f000001 → 127.0.0.1); normalizeIpv4 is
      // defense-in-depth for parsers that do not.
      const normalizedHost = normalizeIpv4(bareHost);

      // Exact matches: loopback, unspecified, broadcast
      if (
        [
          "localhost",
          "127.0.0.1",
          "::1",
          "::",
          "0.0.0.0",
          "255.255.255.255",
        ].includes(normalizedHost)
      ) {
        return "";
      }

      // Private / special-use IPv4 ranges (RFC 1918, loopback /8, link-local,
      // CGNAT, TEST-NET, multicast, reserved)
      if (isPrivateIpv4(normalizedHost)) {
        return "";
      }

      // Private IPv6 ranges (reserved 0::/8, ULA, link-local, site-local) —
      // single source of truth in src/utils/ipSecurity.ts so the URL gate
      // and the fetch-time gate (isPrivateHost) cannot drift.
      if (isPrivateIpv6Host(normalizedHost)) {
        return "";
      }

      // IPv4-mapped IPv6 (::ffff:a.b.c.d). The URL parser may rewrite the
      // embedded IPv4 to hex ("::ffff:c0a8:101"), so re-derive the dotted
      // form (shared helper — keep this logic in ONE place) and apply the
      // IPv4 checks.
      if (normalizedHost.startsWith("::ffff:")) {
        const tail = normalizedHost.slice("::ffff:".length);
        const embedded = tail.includes(".")
          ? tail
          : hexMappedIpv4ToDotted(tail) ?? "";
        if (embedded.includes(".")) {
          if (isPrivateIpv4(embedded)) {
            return "";
          }
        } else {
          // Unparseable mapped address — block conservatively (SSRF guard)
          return "";
        }
      }

      return parsed.href;
    } catch (_err) {
      return "";
    }
  }

  /**
   * Validates MIME type for uploaded files.
   * Checks against allowed MIME types and validates file signatures (magic bytes).
   * Complies with secure-code-review-checklist: "Uploaded files are validated
   * for content type, size, file type and filename".
   *
   * @param file - The File object from an upload
   * @param allowedTypes - Map of MIME type -> allowed extensions
   * @param maxSizeBytes - Maximum file size in bytes
   * @returns Validation result with sanitized filename if valid
   */
  static async validateFileUpload(
    file: File,
    allowedTypes: Record<string, string[]>,
    maxSizeBytes: number = 50 * 1024 * 1024, // 50MB default
  ): Promise<{ valid: boolean; sanitizedName: string; error?: string }> {
    // 1. Validate file name — block path traversal and null bytes
    const rawName = file.name || "";
    if (
      !rawName ||
      rawName.includes("\0") ||
      rawName.includes("/") ||
      rawName.includes("\\")
    ) {
      return { valid: false, sanitizedName: "", error: "Invalid file name" };
    }

    // Sanitize filename: only allow alphanumeric, dots, dashes, underscores
    const sanitizedName = rawName
      .replace(/[^a-zA-Z0-9._-]/g, "_")
      .replace(/\.{2,}/g, ".") // No double dots
      .replace(/^[.]+/, "") // No leading dots
      .substring(0, 255); // Max filename length

    if (!sanitizedName) {
      return {
        valid: false,
        sanitizedName: "",
        error: "Filename is empty after sanitization",
      };
    }

    // 2. Validate file size
    if (file.size === 0) {
      return { valid: false, sanitizedName, error: "File is empty" };
    }
    if (file.size > maxSizeBytes) {
      return {
        valid: false,
        sanitizedName,
        error: `File too large (max ${Math.round(maxSizeBytes / 1024 / 1024)}MB)`,
      };
    }

    // 3. Validate MIME type against allowlist
    const reportedType = file.type || "application/octet-stream";
    if (!Object.keys(allowedTypes).includes(reportedType)) {
      return {
        valid: false,
        sanitizedName,
        error: `File type "${reportedType}" is not allowed`,
      };
    }

    // 4. Validate file extension
    const extension = sanitizedName.split(".").pop()?.toLowerCase() || "";
    const allowedExtensions = allowedTypes[reportedType] || [];
    if (!allowedExtensions.includes(extension)) {
      return {
        valid: false,
        sanitizedName,
        error: `File extension ".${extension}" not allowed for type "${reportedType}"`,
      };
    }

    // 5. Validate magic bytes (file signature) to prevent MIME spoofing
    try {
      const magicBytesValid = await this.validateMagicBytes(file, reportedType);
      if (!magicBytesValid) {
        return {
          valid: false,
          sanitizedName,
          error:
            "File content does not match declared type (magic bytes mismatch)",
        };
      }
    } catch (_err) {
      // If we can't read magic bytes, allow it (browser security model)
    }

    return { valid: true, sanitizedName };
  }

  /**
   * Validates magic bytes (file signatures) to detect MIME type spoofing.
   * Reads the first few bytes of the file and compares against known signatures.
   */
  private static async validateMagicBytes(
    file: File,
    mimeType: string,
  ): Promise<boolean> {
    // Read first 16 bytes (enough for most file signatures)
    const blob = file.slice(0, 16);
    const buffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);

    // Text-based formats (JSON/HTML/SVG/XML) may legitimately start with
    // whitespace or a UTF-8 BOM; a strict offset-0 compare would reject valid
    // files. Skip ASCII whitespace + UTF-8 BOM before comparing. Binary
    // formats are unaffected: their magic sits at offset 0, and a file whose
    // bytes do not start with the signature at offset 0 is rejected anyway.
    let scan = 0;
    while (
      scan < bytes.length &&
      (bytes[scan] === 0x20 ||
        bytes[scan] === 0x09 ||
        bytes[scan] === 0x0a ||
        bytes[scan] === 0x0d ||
        bytes[scan] === 0x0b ||
        bytes[scan] === 0x0c ||
        // UTF-8 BOM: EF BB BF
        (bytes[scan] === 0xef &&
          bytes[scan + 1] === 0xbb &&
          bytes[scan + 2] === 0xbf))
    ) {
      scan += bytes[scan] === 0xef ? 3 : 1;
    }

    // Known magic byte signatures
    const signatures: Record<string, number[][]> = {
      "image/png": [[0x89, 0x50, 0x4e, 0x47]],
      "image/jpeg": [[0xff, 0xd8, 0xff]],
      "image/gif": [[0x47, 0x49, 0x46, 0x38]],
      "image/webp": [[0x52, 0x49, 0x46, 0x46]],
      "image/bmp": [[0x42, 0x4d]],
      "image/svg+xml": [[0x3c, 0x73, 0x76, 0x67]], // "<svg"
      "application/pdf": [[0x25, 0x50, 0x44, 0x46]], // "%PDF"
      "application/zip": [[0x50, 0x4b, 0x03, 0x04]],
      "application/json": [[0x7b], [0x5b]], // "{" or "["
      "text/plain": [], // Plain text has no magic bytes — always passes
      "text/html": [[0x3c]], // "<"
      "text/csv": [], // No magic bytes
      "text/markdown": [], // No magic bytes
    };

    const expectedSignatures = signatures[mimeType];
    if (!expectedSignatures) {
      // Unknown MIME type — allow for forward compatibility
      return true;
    }

    if (expectedSignatures.length === 0) {
      // No magic bytes to check — always passes
      return true;
    }

    // Check if bytes start with any of the expected signatures (from the
    // first non-whitespace offset).
    for (const signature of expectedSignatures) {
      if (signature.every((b, i) => bytes[scan + i] === b)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Default allowed MIME types for general file uploads.
   * Extend as needed for specific upload contexts.
   */
  static readonly DEFAULT_ALLOWED_TYPES: Record<string, string[]> = {
    "image/png": ["png"],
    "image/jpeg": ["jpg", "jpeg"],
    "image/gif": ["gif"],
    "image/webp": ["webp"],
    "application/pdf": ["pdf"],
    "application/zip": ["zip"],
    "application/json": ["json"],
    "text/plain": ["txt"],
    "text/html": ["html", "htm"],
    "text/csv": ["csv"],
    "text/markdown": ["md"],
  };

  /**
   * Sanitize content for markdown rendering
   * @param content - Markdown or HTML content
   * @returns Sanitized HTML safe for display
   */
  static sanitizeForMarkdown(content: string): string {
    if (!content || typeof content !== "string") {return "";}

    try {
      return DOMPurify.sanitize(content, this.MARKDOWN_CONFIG);
    } catch (error) {
      logger.error("[SanitizationService] Failed to sanitize markdown:", error);
      return this.sanitizeText(content);
    }
  }

  /**
   * Sanitize user input from chat, forms, etc.
   * Uses strict configuration that allows minimal formatting
   * @param content - User-generated content
   * @returns Sanitized HTML
   */
  static sanitizeUserContent(content: string): string {
    if (!content || typeof content !== "string") {return "";}

    try {
      return DOMPurify.sanitize(content, this.USER_CONTENT_CONFIG);
    } catch (error) {
      logger.error(
        "[SanitizationService] Failed to sanitize user content:",
        error,
      );
      return this.sanitizeText(content);
    }
  }

  /**
   * Additional link sanitization to ensure safe attributes
   * @param html - HTML string with links
   * @returns HTML with sanitized links
   */
  private static sanitizeLinks(html: string): string {
    // Defense in depth: re-sanitize before innerHTML to prevent XSS
    // if a caller bypassed the primary DOMPurify pass.
    const safeHtml = DOMPurify.sanitize(html, this.HTML_CONFIG);
    const div = document.createElement("div");
    div.innerHTML = safeHtml;

    const links = div.querySelectorAll("a");
    links.forEach((link) => {
      const href = link.getAttribute("href");
      // Strip data: URIs from anchor href — they can carry malicious payloads
      // (e.g. data:text/html,<script>) and bypass CSP script-src. DOMPurify
      // does not strip data: URIs from href by default.
      if (href && href.startsWith("data:")) {
        link.removeAttribute("href");
        return;
      }
      // Add security attributes to all external links
      if (href && (href.startsWith("http://") || href.startsWith("https://"))) {
        link.setAttribute("target", "_blank");
        link.setAttribute("rel", "noopener noreferrer nofollow");
      }
    });

    // Strip data: URIs from img src — they can carry malicious payloads
    // (e.g. SVG with embedded script) and bypass CSP script-src.
    const images = div.querySelectorAll("img");
    images.forEach((img) => {
      const src = img.getAttribute("src");
      if (src && src.startsWith("data:")) {
        img.removeAttribute("src");
        img.setAttribute("alt", "[blocked: data URI]");
      }
    });

    return div.innerHTML;
  }

  /**
   * Sanitize an object recursively (for API payloads)
   * @param obj - Object to sanitize
   * @returns Sanitized object
   */
  static sanitizeObject<T extends Record<string, unknown>>(
    obj: T,
    visited?: WeakSet<object>,
  ): T {
    if (!obj || typeof obj !== "object") {return obj;}
    if (visited?.has(obj)) {return {} as T;}
    const visitedSet = visited || new WeakSet<object>();
    visitedSet.add(obj);

    if (Array.isArray(obj)) {
      return obj.map((item) => {
        if (typeof item === "string") {
          return this.sanitizeText(item);
        }
        if (typeof item === "object" && item !== null) {
          return this.sanitizeObject(
            item as Record<string, unknown>,
            visitedSet,
          );
        }
        return item;
      }) as unknown as T;
    }

    const sanitized: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === "string") {
        const htmlFields = [
          "content",
          "blocks",
          "summary",
          "description",
          "bio",
        ];
        const isHtmlField = htmlFields.some((field) =>
          key.toLowerCase().includes(field),
        );

        sanitized[key] = isHtmlField
          ? this.sanitizeHtml(value)
          : this.sanitizeText(value);
      } else if (typeof value === "object" && value !== null) {
        sanitized[key] = this.sanitizeObject(
          value as Record<string, unknown>,
          visitedSet,
        );
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized as T;
  }

}

/**
 * Sanitize user input to prevent XSS attacks (no HTML allowed).
 * @param input - Raw user input
 * @param maxLength - Maximum allowed length (default 10000)
 * @returns Sanitized string
 */
export function sanitizeUserInput(input: string, maxLength = 10000): string {
  if (typeof input !== "string") {return "";}
  let sanitized = input.trim().substring(0, maxLength);
  sanitized = DOMPurify.sanitize(sanitized, {
    ALLOWED_TAGS: [],
    ALLOWED_ATTR: [],
    KEEP_CONTENT: true,
  });
  return sanitized;
}

/**
 * Sanitize tags array to prevent injection
 * @param tags - Array of tags
 * @returns Sanitized tags array (max 50 chars each, unique)
 */
export function sanitizeTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) {return [];}
  return tags
    .map((tag): string => sanitizeUserInput(String(tag), 50))
    // L-07: normalize consistently with TagManager/TagColorService (which key
    // colors by lowercase tag): strip a leading '#', trim and lowercase, so
    // ["AI", "ai", "#ai"] collapse into one tag instead of three.
    .map((tag) => tag.replace(/^#+/, "").trim().toLowerCase())
    .filter((tag) => tag.length > 0 && tag.length <= 50)
    .filter((tag, index, self) => self.indexOf(tag) === index);
}

/**
 * Validate and sanitize bookmark URL
 * @param url - URL to validate
 * @returns Valid URL or throws
 */
export function validateAndSanitizeUrl(url: string): string {
  const sanitized = SanitizationService.sanitizeUrl(url);
  if (!sanitized) {
    throw new Error("Invalid URL: must be http: or https:");
  }
  try {
    new URL(sanitized);
    return sanitized;
  } catch (_err) {
    throw new Error("Invalid URL format");
  }
}

/**
 * Sanitize search query to prevent regex/SQL-like injection
 * @param query - Search query
 * @returns Sanitized query (max 500 chars)
 */
export function sanitizeSearchQuery(query: string): string {
  if (typeof query !== "string") {return "";}
  return query
    .trim()
    .replace(/[<>{}[\]\\]/g, "")
    .substring(0, 500);
}

/**
 * Sanitize HTML for display with a curated safe-tag set.
 * Alias kept for backward compatibility; equivalent to `sanitizeHtml(html, false)`.
 * @param html - HTML content
 * @returns Sanitized HTML
 */
export function sanitizeHtmlForDisplay(html: string): string {
  return SanitizationService.sanitizeHtml(html, false);
}

// Convenience re-exports of the static methods as plain functions for callers
// that prefer functional style. Both names work.
export const sanitizeUrl =
  SanitizationService.sanitizeUrl.bind(SanitizationService);
export const sanitizeHtml =
  SanitizationService.sanitizeHtml.bind(SanitizationService);
export const sanitizeText =
  SanitizationService.sanitizeText.bind(SanitizationService);
