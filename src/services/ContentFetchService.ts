import { Readability } from "@mozilla/readability";
import { Bookmark } from "../types";
import { initDB } from "../db/database";
import { logger } from "../utils/logger";
import { firewalledFetch } from "../utils/networkFirewall";
import { SanitizationService } from "./SanitizationService";

async function cancelResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Body cancellation is best-effort; the original fetch failure remains
    // the meaningful result for the caller.
  }
}

class ContentFetchService {
  async fetchAndExtract(
    bookmark: Bookmark,
    externalSignal?: AbortSignal,
  ): Promise<{ content: string; summary: string } | null> {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let removeExternalAbortListener: (() => void) | undefined;
    try {
      const url = bookmark.url;
      if (!url) {return null;}

      // SSRF gate (P78): re-validate the URL at fetch time, matching
      // MetadataService. Bookmarks can arrive via backup restore, stale data,
      // or older versions where the URL was never sanitized — and the network
      // firewall deliberately allows loopback (Ollama at localhost:11434), so
      // an unchecked private/loopback URL would fetch internal content.
      const sanitizedUrl = SanitizationService.sanitizeUrl(url);
      if (!sanitizedUrl) {
        logger.warn("Content fetch blocked: URL failed sanitization", { url });
        return null;
      }

      // Timeout + response size cap: prevent runaway fetches from blocking
      // the UI thread or exhausting memory on giant pages.
      const FETCH_TIMEOUT_MS = 15_000;
      const MAX_RESPONSE_BYTES = 5 * 1024 * 1024; // 5 MB
      const controller = new AbortController();
      if (externalSignal) {
        if (externalSignal.aborted) {return null;}
        const abortFromCaller = () => controller.abort();
        externalSignal.addEventListener("abort", abortFromCaller, { once: true });
        removeExternalAbortListener = () =>
          externalSignal.removeEventListener("abort", abortFromCaller);
      }
      timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

      const res = await firewalledFetch(
        sanitizedUrl,
        { signal: controller.signal },
        "content-fetch",
      );

      if (!res.ok) {
        await cancelResponseBody(res);
        logger.warn("Content fetch returned non-OK status", {
          status: res.status,
          url: sanitizedUrl,
        });
        return null;
      }

      // Reject non-HTML/plain responses before streaming the body.
      const contentType = res.headers.get("content-type") || "";
      if (
        !contentType.includes("text/html") &&
        !contentType.includes("text/plain")
      ) {
        await cancelResponseBody(res);
        logger.warn("Content fetch: unsupported content type", {
          contentType,
          url: sanitizedUrl,
        });
        return null;
      }

      // Stream with a byte budget instead of unbounded res.text().
      const reader =
        res.body && typeof res.body.getReader === "function"
          ? res.body.getReader()
          : null;
      if (!reader) {
        await cancelResponseBody(res);
        return null;
      }
      const chunks: Uint8Array[] = [];
      let totalBytes = 0;
      let abortReader: (() => void) | undefined;
      try {
        abortReader = () => {
          void reader.cancel().catch(() => undefined);
        };
        controller.signal.addEventListener("abort", abortReader, { once: true });
        if (controller.signal.aborted) {abortReader();}
        while (true) {
          const { done, value } = await reader.read();
          if (done) {break;}
          totalBytes += value.length;
          if (totalBytes > MAX_RESPONSE_BYTES) {
            try {
              await reader.cancel();
            } catch {
              // The response is already over budget; do not mask that result
              // with a secondary cancellation failure.
            }
            logger.warn("Content fetch: response exceeds size limit", {
              url: sanitizedUrl,
              totalBytes,
            });
            return null;
          }
          chunks.push(value);
        }
      } finally {
        if (abortReader) {
          controller.signal.removeEventListener("abort", abortReader);
        }
        reader.releaseLock();
      }

      if (controller.signal.aborted) {
        await cancelResponseBody(res);
        return null;
      }
      const blob = new Blob(chunks as BlobPart[]);
      const html = await blob.text();
      if (controller.signal.aborted) {return null;}

      const doc = new DOMParser().parseFromString(html, "text/html");
      const reader2 = new Readability(doc.cloneNode(true) as Document);
      const article = reader2.parse();

      if (!article || !article.content) {
        logger.warn("No readable content found", { url: sanitizedUrl });
        return null;
      }

      const { default: TurndownService } = await import("turndown");
      const turndown = new TurndownService({
        headingStyle: "atx",
        codeBlockStyle: "fenced",
        emDelimiter: "*",
      });
      const rawMarkdown = turndown.turndown(article.content);
      const content = SanitizationService.sanitizeHtml(rawMarkdown);
      const summary = SanitizationService.sanitizeText(article.excerpt || "");
      const title = article.title || bookmark.title;

      // DB persistence is best-effort: a failure to init or patch the
      // document must not discard the successfully extracted content.
      if (controller.signal.aborted) {return null;}
      try {
        const db = await initDB();
        const docRef = await db.bookmarks.findOne(bookmark.id).exec();
        if (controller.signal.aborted) {return null;}
        if (docRef) {
          await docRef.incrementalPatch({
            content,
            summary,
            title,
            updatedAt: new Date().toISOString(),
          });
        }
      } catch (dbErr) {
        logger.warn("Content extracted, but DB update failed", {
          url: bookmark.url,
          error: dbErr,
        });
      }

      return { content, summary };
    } catch (err) {
      logger.error("Content fetch failed", {
        url: bookmark.url,
        error: err,
      });
      return null;
    } finally {
      if (timeoutId !== undefined) {clearTimeout(timeoutId);}
      removeExternalAbortListener?.();
    }
  }
}

export const contentFetchService = new ContentFetchService();
