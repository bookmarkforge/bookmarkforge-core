import { sanitizeUrl, sanitizeUserInput } from "./SanitizationService";
import { logger } from "../utils/logger";
import { safeErrorForLog } from "../utils/safeErrorForLog";
import { firewalledFetch } from "../utils/networkFirewall";
import { isPrivateHost } from "../utils/ipSecurity";
import { cancelResponseBody, readBoundedResponseText } from "./ai/utils";

const MAX_METADATA_HTML_CHARS = 5 * 1024 * 1024;

const BLOCKED_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "169.254.169.254",
  "metadata.google.internal",
  "metadata.googleusercontent.com",
]);


function isUrlAllowed(url: string): boolean {
  try {
    const parsed = new URL(url);
    // Trailing dot ("localhost.") is DNS-equivalent to "localhost" — strip it
    // so BLOCKED_HOSTS/isPrivateHost cannot be bypassed. The IP-classification
    // logic lives in src/utils/ipSecurity.ts (single source of truth).
    const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");

    if (BLOCKED_HOSTS.has(hostname)) {
      return false;
    }
    if (isPrivateHost(hostname)) {
      return false;
    }
    if (parsed.port === "22" || parsed.port === "23") {
      return false;
    }

    return true;
  } catch (_err) {
    return false;
  }
}

export class MetadataService {
  /**
   * Extracts the value of the first <meta> tag matching a given attribute pair.
   */
  private getMetaContent(
    doc: Document,
    attr: string,
    value: string,
  ): string | null {
    const selector = `meta[${attr}="${value.replace(/"/g, "'")}"]`;
    return doc.querySelector(selector)?.getAttribute("content") ?? null;
  }

  /**
   * Extracts name and description from the first JSON-LD script block
   * that parses successfully. Returns null if none found.
   */
  private extractJsonLd(
    doc: Document,
  ): { name?: string; description?: string } | null {
    const scripts = doc.querySelectorAll(
      'script[type="application/ld+json"]',
    );
    for (const script of scripts) {
      try {
        const raw = script.textContent || "";
        if (!raw.trim()) continue;
        const parsed = JSON.parse(raw);
        // Handle @graph arrays (JSON-LD container)
        const items = Array.isArray(parsed)
          ? parsed
          : parsed["@graph"] || [parsed];
        for (const item of items) {
          if (item.name || item.description) {
            return {
              name: item.name || undefined,
              description: item.description || undefined,
            };
          }
        }
      } catch {
        // Malformed JSON-LD — skip silently
      }
    }
    return null;
  }

  /**
   * Fetches the title, description, and preview image of a URL.
   *
   * Extraction priority for title:
   *   1. <title> tag
   *   2. <meta property="og:title">
   *   3. <meta name="twitter:title">
   *   4. JSON-LD `name`
   *
   * Extraction priority for description:
   *   1. <meta name="description">
   *   2. <meta property="og:description">
   *   3. <meta name="twitter:description">
   *   4. JSON-LD `description`
   */
  async fetchMetadata(
    url: string,
    signal?: AbortSignal,
  ): Promise<{ title: string; description: string; image?: string }> {
    if (signal?.aborted) {
      throw new DOMException("The metadata request was aborted", "AbortError");
    }

    const sanitizedUrl = sanitizeUrl(url);
    if (!sanitizedUrl || !isUrlAllowed(sanitizedUrl)) {
      return { title: "", description: "" };
    }

    try {
      // Removed api.microlink.io to ensure 100% zero-knowledge privacy.
      // Sending URLs to a third-party proxy violates the Local-First architecture.
      // We rely purely on direct fetch (if CORS allows).

      const res = await firewalledFetch(
        sanitizedUrl,
        signal ? { signal } : undefined,
        "metadata",
      );
      if (signal?.aborted) {
        throw new DOMException("The metadata request was aborted", "AbortError");
      }
      if (!res.ok) {
        await cancelResponseBody(res);
        throw new Error(`Metadata request failed with HTTP ${res.status}`);
      }
      const html = await readBoundedResponseText(res, MAX_METADATA_HTML_CHARS);
      if (signal?.aborted) {
        throw new DOMException("The metadata request was aborted", "AbortError");
      }
      const doc = new DOMParser().parseFromString(html, "text/html");

      // ── Title: priority chain ────────────────────────────────────
      // Use textContent, not innerText: jsdom (and some SSR DOMs) do not
      // implement innerText on <title>, which would silently drop titles.
      let rawTitle =
        doc.querySelector("title")?.textContent?.trim() ||
        this.getMetaContent(doc, "property", "og:title") ||
        this.getMetaContent(doc, "name", "twitter:title") ||
        "";

      // Fall back to JSON-LD if nothing found yet
      if (!rawTitle) {
        const ld = this.extractJsonLd(doc);
        if (ld?.name) rawTitle = ld.name;
      }
      const title = sanitizeUserInput(rawTitle);

      // ── Description: priority chain ──────────────────────────────
      let rawDescription =
        doc
          .querySelector('meta[name="description"]')
          ?.getAttribute("content") ||
        this.getMetaContent(doc, "property", "og:description") ||
        this.getMetaContent(doc, "name", "twitter:description") ||
        "";

      // Fall back to JSON-LD if nothing found yet
      if (!rawDescription) {
        const ld = this.extractJsonLd(doc);
        if (ld?.description) rawDescription = ld.description;
      }
      const description = sanitizeUserInput(rawDescription);

      // ── Preview image (optional) ─────────────────────────────────
      const image =
        this.getMetaContent(doc, "property", "og:image") ||
        this.getMetaContent(doc, "name", "twitter:image") ||
        undefined;

      return { title, description, ...(image ? { image } : {}) };
    } catch (err) {
      if (
        signal?.aborted ||
        (err instanceof Error || err instanceof DOMException) &&
          err.name === "AbortError"
      ) {
        throw err;
      }
      // Best-effort enrichment: the fetch failure is expected and handled
      // (the caller receives the URL as fallback title and the capture
      // proceeds). Log at WARN, not ERROR, so routine network/firewall
      // deflections do not pollute the error channel — same convention as
      // QuickCapture's "metadata fetch failed" degradation.
      logger.warn("Error fetching metadata", { error: safeErrorForLog(err) });
      // Return the normalized sanitized URL as the fallback title (matches
      // the URL actually attempted), not the raw caller-supplied string.
      return { title: sanitizedUrl, description: "" };
    }
  }
}

export const metadataService = new MetadataService();
