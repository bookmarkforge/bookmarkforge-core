/**
 * server/src/csp-report.ts — the CSP violation collector.
 *
 * Extracted from `index.ts` (P-22): a per-IP rate-limited POST endpoint with a
 * bounded in-memory ring, optional JSONL persistence and optional webhook
 * alerting. The factory is also the collector's start-up: it loads the
 * persisted history and installs the pruning interval, the same two statements
 * the entry used to run at import time.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname } from "node:path";
import { performance } from "node:perf_hooks";
import { cspCorsHeaders } from "./middleware/security";
import { constantTimeUtf8Equal, readBoundedInteger } from "./proxy-utils";

export type CspReportHandler = (
  req: IncomingMessage,
  res: ServerResponse,
) => void;

export interface CspReportCollectorOptions {
  /** Sent in webhook payloads and used as the default IP-hash salt. */
  serverInstanceId: string;
  /** Resolve the client IP with the server's TRUST_PROXY policy. */
  clientIp: (req: IncomingMessage) => string;
}

export function createCspReportCollector(
  options: CspReportCollectorOptions,
): CspReportHandler {
  /** Monotonic milliseconds for all in-memory rate windows. */
  const nowMs = (): number => performance.now();

  // ── CSP report collector ──────────────────────────────────────────
  // Browsers POST JSON violation reports to /csp-report when the
  // Content-Security-Policy blocks a resource. This collector logs
  // them and keeps a bounded in-memory ring of recent reports for
  // diagnostics. Rate-limited per IP to prevent abuse.

  const CSP_REPORT_MAX = readBoundedInteger(
    process.env.CSP_REPORT_MAX,
    200,
    1,
    10_000,
  );
  const CSP_REPORT_LIMIT = readBoundedInteger(
    process.env.CSP_REPORT_LIMIT,
    30,
    1,
    10_000,
  ); // per IP per window
  const CSP_REPORT_WINDOW_MS = readBoundedInteger(
    process.env.CSP_REPORT_WINDOW_MS,
    60_000,
    1_000,
    86_400_000,
  );
  // Optional JSONL persistence. It is disabled by default so the companion
  // server remains stateless; operators can set CSP_REPORT_FILE to retain a
  // bounded report history across restarts.
  const CSP_REPORT_FILE = process.env.CSP_REPORT_FILE ?? "";
  // POST remains unauthenticated because browsers cannot attach an admin token
  // to CSP violation reports. The diagnostics GET is fail-closed: without a
  // configured token it is unavailable rather than publicly exposing report
  // metadata.
  const CSP_REPORT_ADMIN_TOKEN = process.env.CSP_REPORT_ADMIN_TOKEN ?? "";
  const CSP_REPORT_IP_HASH_SALT =
    process.env.CSP_REPORT_IP_HASH_SALT || options.serverInstanceId;
  const CSP_REPORT_BODY_MAX_BYTES = readBoundedInteger(
    process.env.CSP_REPORT_BODY_MAX_BYTES,
    16_384,
    1_024,
    4 * 1024 * 1024,
  );
  const CSP_REPORT_RATE_MAX_ENTRIES = readBoundedInteger(
    process.env.CSP_REPORT_RATE_MAX_ENTRIES,
    10_000,
    100,
    100_000,
  );
  // Optional webhook alerting (audit plan 5.2.2): accepted violations are
  // batched and POSTed to this URL at most once per interval, so a burst of
  // reports collapses into one notification. The payload carries ONLY the
  // redacted StoredCspReport fields — never the client IP, never raw
  // script-sample content. Unset by default: the server stays stateless.
  // HTTPS only, mirroring the license adapter's policy: HTTP is accepted
  // only with an explicit non-production opt-out, so a production deployment
  // can never leak the redacted payloads in plaintext or point the webhook
  // at a non-HTTP scheme. A rejected URL is logged at startup and disabled
  // (fail-closed — no webhook rather than a promiscuous one).
  const CSP_REPORT_WEBHOOK_ALLOW_HTTP =
    process.env.CSP_REPORT_WEBHOOK_ALLOW_HTTP === "1" &&
    process.env.NODE_ENV !== "production";
  const CSP_REPORT_WEBHOOK_URL = (() => {
    const raw = process.env.CSP_REPORT_WEBHOOK_URL?.trim() ?? "";
    if (!raw) return "";
    const protocolOk =
      /^https:\/\//i.test(raw) ||
      (CSP_REPORT_WEBHOOK_ALLOW_HTTP && /^http:\/\//i.test(raw));
    if (!protocolOk) {
      console.error(JSON.stringify({
        event: "csp_webhook_url_rejected",
        reason: "only https is accepted" +
          (CSP_REPORT_WEBHOOK_ALLOW_HTTP
            ? ""
            : " (set CSP_REPORT_WEBHOOK_ALLOW_HTTP=1 outside production to permit http)"),
      }));
      return "";
    }
    return raw;
  })();
  const CSP_REPORT_WEBHOOK_INTERVAL_MS = readBoundedInteger(
    process.env.CSP_REPORT_WEBHOOK_INTERVAL_MS,
    15_000,
    250,
    86_400_000,
  );
  const CSP_REPORT_WEBHOOK_BATCH_MAX = readBoundedInteger(
    process.env.CSP_REPORT_WEBHOOK_BATCH_MAX,
    20,
    1,
    1_000,
  );
  // A webhook entry that keeps failing is dropped after this many attempts,
  // keeping the queue bounded even against a permanently dead endpoint.
  const CSP_REPORT_WEBHOOK_MAX_ATTEMPTS = readBoundedInteger(
    process.env.CSP_REPORT_WEBHOOK_MAX_ATTEMPTS,
    3,
    1,
    10,
  );
  // Absolute cap on the number of undelivered reports retained in memory.
  // MAX_ATTEMPTS bounds the LIFETIME of each entry, but while the endpoint is
  // down, accepted reports keep arriving (rate-limited per IP) — without this
  // cap the pending queue would grow without limit. On overflow the oldest
  // entries are dropped (counted in webhookDropped), never new ones, so the
  // most recent violations are the ones that survive.
  const CSP_REPORT_WEBHOOK_QUEUE_MAX = readBoundedInteger(
    process.env.CSP_REPORT_WEBHOOK_QUEUE_MAX,
    1_000,
    1,
    100_000,
  );
  const CSP_REPORT_WEBHOOK_TIMEOUT_MS = readBoundedInteger(
    process.env.CSP_REPORT_WEBHOOK_TIMEOUT_MS,
    5_000,
    1_000,
    60_000,
  );

  interface CspViolation {
    "blocked-uri"?: string;
    "document-uri"?: string;
    "violated-directive"?: string;
    "effective-directive"?: string;
    "original-policy"?: string;
    disposition?: string;
    "script-sample"?: string;
    "source-file"?: string;
    "line-number"?: number;
    "column-number"?: number;
  }

  interface CspReport {
    "csp-report": CspViolation;
  }

  interface StoredCspReport {
    timestamp: string;
    /** One-way IP fingerprint for aggregation; never the client IP itself. */
    ipHash: string;
    /** Origin-only metadata; paths, queries and fragments are discarded. */
    blockedOrigin?: string;
    documentOrigin?: string;
    violatedDirective?: string;
    disposition?: string;
  }

  const cspReports: StoredCspReport[] = [];
  let cspReportsAccepted = 0;
  let cspReportsRejected = 0;
  let cspReportsRateLimited = 0;
  const cspRateWindows = new Map<string, { count: number; windowStart: number }>();
  let cspPersistenceQueue = Promise.resolve();

  function hashCspIp(ip: string): string {
    return createHash("sha256")
      .update(`${CSP_REPORT_IP_HASH_SALT}:${ip}`)
      .digest("hex")
      .slice(0, 24);
  }

  function redactCspOrigin(value: unknown): string | undefined {
    if (typeof value !== "string" || value.length === 0) return undefined;
    try {
      return new URL(value).origin;
    } catch {
      return "opaque";
    }
  }

  function pruneCspRateWindows(now = nowMs()): void {
    const cutoff = now - CSP_REPORT_WINDOW_MS;
    // Windows are inserted in monotonic first-seen order and never move while
    // their counters are incremented. Expired windows therefore form a FIFO
    // prefix; remove only that prefix instead of scanning every tracked IP on
    // every report. The hot path is O(K), where K is the number expired.
    while (cspRateWindows.size > 0) {
      const oldest = cspRateWindows.entries().next().value as
        | [string, { count: number; windowStart: number }]
        | undefined;
      if (!oldest || oldest[1].windowStart >= cutoff) break;
      cspRateWindows.delete(oldest[0]);
    }
  }

  async function loadPersistedCspReports(): Promise<void> {
    if (!CSP_REPORT_FILE) return;
    try {
      const raw = await readFile(CSP_REPORT_FILE, "utf8");
      // The separator is a REAL newline ("\n", one byte 0x0A), never the
      // two-char sequence backslash+n. JSON.stringify escapes an actual newline
      // inside a string value to "\n" (backslash+n), so splitting on a raw
      // 0x0A byte is unambiguous: it can never cut through a record, no matter
      // what the violation payload contains. Using "\\n" here would corrupt
      // (and silently lose) the whole persisted history whenever a report
      // carried a newline in script-sample / original-policy.
      // Backward compatibility: files written by older versions used the
      // 2-char "\\n" separator (no raw newlines anywhere — JSON.stringify
      // escapes real ones). Such a file arrives as ONE physical line whose
      // JSON.parse fails; split it on the legacy separator and parse each
      // fragment.
      const parseLine = (line: string): StoredCspReport[] => {
        try {
          const report = JSON.parse(line) as StoredCspReport;
          return [report];
        } catch {
          if (line.includes("\\n")) {
            return line
              .split("\\n")
              .filter(Boolean)
              .map((fragment) => JSON.parse(fragment) as StoredCspReport);
          }
          throw new Error("Not valid JSONL line");
        }
      };
      const loaded = raw
        .split("\n")
        .filter(Boolean)
        .flatMap((line) => parseLine(line))
        .filter((report) =>
          report &&
          typeof report.timestamp === "string" &&
          typeof report.ipHash === "string",
        )
        .slice(-CSP_REPORT_MAX);
      cspReports.push(...loaded);
      cspReportsAccepted = loaded.length;
    } catch (error: unknown) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        console.error(JSON.stringify({ event: "csp_persistence_load_failed", error: String(error) }));
      }
    }
  }

  function persistCspReports(): void {
    if (!CSP_REPORT_FILE) return;
    const snapshot = cspReports
      .slice(-CSP_REPORT_MAX)
      .map((report) => JSON.stringify(report))
      .join("\n");
    cspPersistenceQueue = cspPersistenceQueue
      .then(async () => {
        await mkdir(dirname(CSP_REPORT_FILE), { recursive: true });
        await writeFile(CSP_REPORT_FILE, snapshot ? `${snapshot}\n` : "", "utf8");
      })
      .catch((error: unknown) => {
        console.error(JSON.stringify({ event: "csp_persistence_write_failed", error: String(error) }));
      });
  }

  // ── CSP webhook alerting ────────────────────────────────────────────
  // Fire-and-forget batching: accepted violations are queued, then flushed at
  // most once per interval with at most BATCH_MAX reports per delivery. A
  // failed delivery is retried up to MAX_ATTEMPTS with one interval of
  // backoff, and the pending queue is hard-capped at QUEUE_MAX entries
  // (oldest dropped on overflow) — bounded even against a permanently dead
  // endpoint. Delivery never blocks the request handler.
  interface CspWebhookEntry {
    report: StoredCspReport;
    attempts: number;
  }
  const cspWebhookQueue: CspWebhookEntry[] = [];
  let cspWebhookTimer: NodeJS.Timeout | null = null;
  let cspWebhookDeliveryInFlight = false;
  let cspWebhookDelivered = 0;
  let cspWebhookFailed = 0;
  let cspWebhookDropped = 0;

  function scheduleCspWebhookFlush(delayMs: number): void {
    if (cspWebhookTimer !== null) return;
    cspWebhookTimer = setTimeout(() => {
      cspWebhookTimer = null;
      void flushCspWebhook();
    }, delayMs);
    // Never keep the process alive for a notification alone.
    cspWebhookTimer.unref();
  }

  function enqueueCspWebhook(report: StoredCspReport): void {
    if (!CSP_REPORT_WEBHOOK_URL) return;
    cspWebhookQueue.push({ report, attempts: 0 });
    // Bounded queue: if the endpoint is down, drop the OLDEST pending report
    // (never the new one) so the most recent violations are retained and the
    // queue can never exceed the cap.
    if (cspWebhookQueue.length > CSP_REPORT_WEBHOOK_QUEUE_MAX) {
      const overflow = cspWebhookQueue.length - CSP_REPORT_WEBHOOK_QUEUE_MAX;
      cspWebhookQueue.splice(0, overflow);
      cspWebhookDropped += overflow;
    }
    scheduleCspWebhookFlush(CSP_REPORT_WEBHOOK_INTERVAL_MS);
  }

  async function flushCspWebhook(): Promise<void> {
    if (!CSP_REPORT_WEBHOOK_URL || cspWebhookDeliveryInFlight) return;
    if (cspWebhookQueue.length === 0) return;
    const batch = cspWebhookQueue.splice(0, CSP_REPORT_WEBHOOK_BATCH_MAX);
    cspWebhookDeliveryInFlight = true;
    try {
      const response = await fetch(CSP_REPORT_WEBHOOK_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "bookmarkforge-signaling-server",
        },
        body: JSON.stringify({
          serverInstanceId: options.serverInstanceId,
          generatedAt: new Date().toISOString(),
          count: batch.length,
          reports: batch.map((entry) => entry.report),
        }),
        signal: AbortSignal.timeout(CSP_REPORT_WEBHOOK_TIMEOUT_MS),
      });
      if (!response.ok) {
        throw new Error(`webhook responded ${response.status}`);
      }
      cspWebhookDelivered += batch.length;
    } catch (error: unknown) {
      const retryable = batch.filter((entry) => entry.attempts + 1 < CSP_REPORT_WEBHOOK_MAX_ATTEMPTS);
      // Entries that exhausted their attempts are dropped. A delivery failure
      // also counts as a failed delivery (not a dropped one) — failure and
      // drop are separate signals: failed = delivery attempts that failed,
      // dropped = entries discarded by the attempts cap or queue overflow.
      const dropped = batch.length - retryable.length;
      cspWebhookFailed += batch.length;
      if (dropped > 0) {
        cspWebhookDropped += dropped;
      }
      if (retryable.length > 0) {
        cspWebhookQueue.unshift(
          ...retryable.map((entry) => ({ report: entry.report, attempts: entry.attempts + 1 })),
        );
        // Requeued entries still count against the cap: if the queue is full,
        // drop the oldest pending entry to make room.
        if (cspWebhookQueue.length > CSP_REPORT_WEBHOOK_QUEUE_MAX) {
          const overflow = cspWebhookQueue.length - CSP_REPORT_WEBHOOK_QUEUE_MAX;
          cspWebhookQueue.splice(0, overflow);
          cspWebhookDropped += overflow;
        }
        scheduleCspWebhookFlush(CSP_REPORT_WEBHOOK_INTERVAL_MS);
      }
      console.error(JSON.stringify({
        event: "csp_webhook_failed",
        reason: String(error),
        retrying: retryable.length,
        dropped,
      }));
    } finally {
      cspWebhookDeliveryInFlight = false;
      // A partial flush (batch cap reached) must not strand the rest of the
      // queue: schedule the next flush if entries remain.
      if (cspWebhookQueue.length > 0) {
        scheduleCspWebhookFlush(CSP_REPORT_WEBHOOK_INTERVAL_MS);
      }
    }
  }

  function cspReportHandler(req: IncomingMessage, res: ServerResponse): void {
    // Only POST — GET returns the recent-reports dashboard.
    if (req.method === "GET") {
      const adminToken = req.headers["x-csp-admin-token"];
      // Constant-time comparison (same pattern as the room-secret check): the
      // admin token is a shared secret, so a naive `!==` would leak match
      // position through timing to a remote attacker probing the dashboard.
      const tokenMatches =
        typeof adminToken === "string" &&
        constantTimeUtf8Equal(CSP_REPORT_ADMIN_TOKEN, adminToken);
      if (!CSP_REPORT_ADMIN_TOKEN || !tokenMatches) {
        res.writeHead(CSP_REPORT_ADMIN_TOKEN ? 401 : 503, {
          "Content-Type": "text/plain",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        });
        res.end(CSP_REPORT_ADMIN_TOKEN ? "Unauthorized" : "Diagnostics unavailable");
        return;
      }
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        ...cspCorsHeaders(req),
      });
      res.end(JSON.stringify({
        recent: cspReports.slice(-50),
        total: cspReportsAccepted,
        rejected: cspReportsRejected,
        rateLimited: cspReportsRateLimited,
        persisted: Boolean(CSP_REPORT_FILE),
        webhook: Boolean(CSP_REPORT_WEBHOOK_URL),
        webhookDelivered: cspWebhookDelivered,
        webhookFailed: cspWebhookFailed,
        webhookDropped: cspWebhookDropped,
        serverInstanceId: options.serverInstanceId,
      }));
      return;
    }

    if (req.method !== "POST") {
      res.writeHead(405, { "Content-Type": "text/plain" });
      res.end("Method Not Allowed");
      return;
    }

    // Per-IP rate limiting for CSP reports.
    const ip = options.clientIp(req);
    const now = nowMs();
    pruneCspRateWindows(now);
    const win = cspRateWindows.get(ip);
    if (win && now - win.windowStart < CSP_REPORT_WINDOW_MS) {
      if (win.count >= CSP_REPORT_LIMIT) {
        cspReportsRateLimited += 1;
        res.writeHead(429, { "Content-Type": "text/plain" });
        res.end("Too Many Requests");
        return;
      }
      win.count++;
    } else {
      if (cspRateWindows.size >= CSP_REPORT_RATE_MAX_ENTRIES) {
        pruneCspRateWindows(now);
      }
      if (cspRateWindows.size >= CSP_REPORT_RATE_MAX_ENTRIES) {
        cspReportsRateLimited += 1;
        res.writeHead(429, { "Content-Type": "text/plain" });
        res.end("Too Many Requests");
        return;
      }
      cspRateWindows.set(ip, { count: 1, windowStart: now });
    }

    // Reject oversized bodies before buffering them. Content-Length is only an
    // early check; chunked requests are bounded while streaming below.
    const declaredLength = Number(req.headers["content-length"] ?? 0);
    if (Number.isFinite(declaredLength) && declaredLength > CSP_REPORT_BODY_MAX_BYTES) {
      req.resume();
      res.writeHead(413, { "Content-Type": "text/plain" });
      res.end("Payload Too Large");
      return;
    }

    const chunks: Buffer[] = [];
    let bodyBytes = 0;
    let bodyTooLarge = false;
    let oversizedResponseSent = false;
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      req.removeListener("data", onData);
      req.removeListener("end", onEnd);
      req.removeListener("error", onRequestError);
      req.removeListener("aborted", onAborted);
    };
    const rejectOversizedBody = () => {
      if (oversizedResponseSent) return;
      oversizedResponseSent = true;
      bodyTooLarge = true;
      // Stop retaining data immediately. Resume just long enough for Node to
      // drain the parser, then close the request after the 413 is flushed so a
      // chunked attacker cannot keep this connection open indefinitely.
      settle();
      req.resume();
      res.writeHead(413, { "Content-Type": "text/plain" });
      res.end("Payload Too Large");
      res.once("finish", () => req.destroy());
    };
    const onData = (chunk: Buffer) => {
      bodyBytes += chunk.length;
      if (bodyBytes > CSP_REPORT_BODY_MAX_BYTES) {
        rejectOversizedBody();
        return;
      }
      chunks.push(chunk);
    };
    // A client that disconnects mid-body (RST after headers, tab close) emits
    // 'error'/'aborted' on the request stream. Without these listeners the
    // 'error' event is an uncaught exception in Node — a remote DoS against
    // the whole signaling server — and the partial body is retained forever.
    const onRequestError = (_err: Error) => {
      settle();
      if (!res.writableEnded) {
        res.destroy();
      }
    };
    const onAborted = () => {
      settle();
      if (!res.writableEnded) {
        res.destroy();
      }
    };
    const onEnd = () => {
      if (bodyTooLarge || settled) return;
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        const report = JSON.parse(raw) as CspReport;
        const v = report?.["csp-report"];
        if (!v || typeof v !== "object") {
          cspReportsRejected += 1;
          res.writeHead(400, { "Content-Type": "text/plain" });
          res.end("Bad Request: missing csp-report");
          return;
        }

        const stored: StoredCspReport = {
          timestamp: new Date().toISOString(),
          ipHash: hashCspIp(ip),
          blockedOrigin: redactCspOrigin(v["blocked-uri"]),
          documentOrigin: redactCspOrigin(v["document-uri"]),
          violatedDirective: (v["effective-directive"] ??
            v["violated-directive"] ?? "").slice(0, 200),
          disposition: typeof v.disposition === "string"
            ? v.disposition.slice(0, 32)
            : "enforce",
        };

        // Evict oldest if over capacity.
        if (cspReports.length >= CSP_REPORT_MAX) {
          cspReports.splice(0, cspReports.length - CSP_REPORT_MAX + 1);
        }
        cspReports.push(stored);
        cspReportsAccepted += 1;
        persistCspReports();
        enqueueCspWebhook(stored);

        console.error(JSON.stringify({
          event: "csp_violation",
          timestamp: stored.timestamp,
          ipHash: stored.ipHash,
          blockedOrigin: stored.blockedOrigin,
          documentOrigin: stored.documentOrigin,
          violatedDirective: stored.violatedDirective,
          disposition: stored.disposition,
        }));

        res.writeHead(204);
        res.end();
      } catch (error: unknown) {
        cspReportsRejected += 1;
        console.error(JSON.stringify({ event: "csp_report_rejected", reason: "invalid_json", error: String(error) }));
        res.writeHead(400, { "Content-Type": "text/plain" });
        res.end("Bad Request: invalid JSON");
      }
    };
    req.on("data", onData);
    req.on("end", onEnd);
    req.on("error", onRequestError);
    req.on("aborted", onAborted);
  }

  // Load the optional bounded JSONL history before requests arrive. The server
  // remains usable if the file is absent or unreadable.
  void loadPersistedCspReports();

  // Prune stale CSP rate-limit windows periodically.
  setInterval(() => pruneCspRateWindows(), Math.max(CSP_REPORT_WINDOW_MS, 60_000)).unref();

  return cspReportHandler;
}
