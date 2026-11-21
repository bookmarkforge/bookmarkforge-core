import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CSP_REPORT_BODY_MAX_BYTES,
  createCspCollector,
  createRateLimiter,
  hashIp,
  parseCspReport,
  redactOrigin,
  toStoredReport,
} from "../../api/_csp-report-core.js";
import handler from "../../api/csp-report.js";
import { handler as netlifyHandler, onRequest as cloudflareHandler } from "../../functions/csp-report.mjs";
import { assessCspReportCollectors } from "../check-csp-sync.mjs";

const ROOT = process.cwd();
const REPORT = JSON.stringify({
  "csp-report": {
    "document-uri": "https://app.example.com/app?token=secret#frag",
    "blocked-uri": "https://evil.example.com/tracker.js?leak=1",
    "effective-directive": "script-src",
    "script-sample": "alert(document.cookie)",
    disposition: "enforce",
  },
});

let errorSpy;

beforeEach(() => {
  // The collector logs one structured line per accepted report by design.
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  errorSpy.mockRestore();
});

/** Minimal Node req/res pair for the Vercel adapter. */
function nodeExchange({ method = "POST", body = REPORT, headers = {} } = {}) {
  const req = {
    method,
    body,
    headers,
    socket: { remoteAddress: "203.0.113.9" },
  };
  const res = {
    statusCode: 0,
    headers: {},
    setHeader(name, value) {
      this.headers[name] = value;
    },
    body: "",
    end(value) {
      this.body = value ?? "";
    },
  };
  return { req, res };
}

describe("report parsing and redaction", () => {
  it("accepts the legacy report-uri shape", () => {
    const parsed = parseCspReport(REPORT);
    expect(parsed.ok).toBe(true);
    expect(parsed.violation["effective-directive"]).toBe("script-src");
  });

  it("accepts the Reporting API (report-to) shape", () => {
    const parsed = parseCspReport(
      JSON.stringify({ type: "csp-violation", body: { effectiveDirective: "img-src" } }),
    );
    expect(parsed.ok).toBe(true);
    expect(parsed.violation.effectiveDirective).toBe("img-src");
  });

  it("rejects invalid JSON and a report with no violation", () => {
    expect(parseCspReport("{not json").reason).toBe("invalid_json");
    expect(parseCspReport(JSON.stringify({ hello: "world" })).reason).toBe("missing_csp_report");
  });

  it("keeps origins only: paths, queries and fragments never reach the record", () => {
    expect(redactOrigin("https://app.example.com/app?token=secret#frag")).toBe(
      "https://app.example.com",
    );
    expect(redactOrigin("not a url")).toBe("opaque");
    const stored = toStoredReport(JSON.parse(REPORT)["csp-report"], {
      ipHash: "h",
      timestamp: "t",
    });
    expect(stored.documentOrigin).toBe("https://app.example.com");
    expect(stored.blockedOrigin).toBe("https://evil.example.com");
    expect(JSON.stringify(stored)).not.toContain("secret");
    expect(JSON.stringify(stored)).not.toContain("alert(document.cookie)");
  });

  it("hashes the IP one-way (24 hex chars, never the address)", async () => {
    const hash = await hashIp("203.0.113.9", "salt");
    expect(hash).toMatch(/^[0-9a-f]{24}$/);
    expect(hash).not.toContain("203.0.113.9");
    expect(await hashIp("203.0.113.9", "other-salt")).not.toBe(hash);
  });
});

describe("collector contract", () => {
  it("accepts a valid report and records the redacted fields", async () => {
    const collector = createCspCollector({ salt: "s" });
    const result = await collector.accept("198.51.100.4", REPORT);
    expect(result.status).toBe(204);
    expect(result.stored.ipHash).toMatch(/^[0-9a-f]{24}$/);
    expect(collector.stats()).toEqual({ accepted: 1, rejected: 0, rateLimited: 0, retained: 1 });
    // Exactly one structured log line, with the event name the ops search uses.
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(String(errorSpy.mock.calls[0][0])).toContain('"event":"csp_violation"');
  });

  it("rejects malformed JSON with 400 and oversized bodies with 413", async () => {
    const collector = createCspCollector({ salt: "s" });
    expect((await collector.accept("198.51.100.5", "{oops")).status).toBe(400);
    const oversized = JSON.stringify({ "csp-report": { pad: "x".repeat(CSP_REPORT_BODY_MAX_BYTES) } });
    expect((await collector.accept("198.51.100.6", oversized)).status).toBe(413);
  });

  it("rate limits a single client after the window budget", async () => {
    const limiter = createRateLimiter({ limit: 2, windowMs: 60_000, now: () => 1_000 });
    expect(limiter.limited("ip")).toBe(false);
    expect(limiter.limited("ip")).toBe(false);
    expect(limiter.limited("ip")).toBe(true);
    expect(limiter.limited("other-ip")).toBe(false);
  });

  it("caps the rate-limit map instead of growing without bound", () => {
    const limiter = createRateLimiter({ limit: 10, maxEntries: 2, now: () => 1_000 });
    expect(limiter.limited("a")).toBe(false);
    expect(limiter.limited("b")).toBe(false);
    expect(limiter.limited("c")).toBe(true);
    expect(limiter.size()).toBe(2);
  });
});

describe("Vercel adapter", () => {
  it("answers 204 for a valid report and 405 for anything but POST", async () => {
    const accepted = nodeExchange({ headers: { "x-forwarded-for": "198.51.100.10, 10.0.0.1" } });
    await handler(accepted.req, accepted.res);
    expect(accepted.res.statusCode).toBe(204);
    expect(accepted.res.headers["Cache-Control"]).toBe("no-store");

    const rejected = nodeExchange({ method: "GET" });
    await handler(rejected.req, rejected.res);
    expect(rejected.res.statusCode).toBe(405);
  });

  it("answers 413 before parsing when the declared size is too large", async () => {
    const exchange = nodeExchange({
      body: "x".repeat(CSP_REPORT_BODY_MAX_BYTES + 1),
      headers: { "x-forwarded-for": "198.51.100.11" },
    });
    await handler(exchange.req, exchange.res);
    expect(exchange.res.statusCode).toBe(413);
  });
});

describe("Netlify and Cloudflare Pages adapters", () => {
  it("Netlify: 204 on POST, 405 otherwise", async () => {
    const ok = await netlifyHandler({
      httpMethod: "POST",
      headers: { "x-forwarded-for": "198.51.100.20" },
      body: REPORT,
      isBase64Encoded: false,
    });
    expect(ok.statusCode).toBe(204);
    const nope = await netlifyHandler({ httpMethod: "GET", headers: {}, body: "" });
    expect(nope.statusCode).toBe(405);
  });

  it("Cloudflare Pages: 204 on POST, 405 otherwise", async () => {
    const ok = await cloudflareHandler({
      request: new Request("https://app.example.com/csp-report", {
        method: "POST",
        headers: { "x-forwarded-for": "198.51.100.21" },
        body: REPORT,
      }),
      env: { CSP_REPORT_IP_HASH_SALT: "cf-salt" },
    });
    expect(ok.status).toBe(204);
    const nope = await cloudflareHandler({
      request: new Request("https://app.example.com/csp-report", { method: "GET" }),
      env: {},
    });
    expect(nope.status).toBe(405);
  });
});

describe("collector gate", () => {
  const read = (path) => readFileSync(join(ROOT, path), "utf8");

  it("passes on the shipped collectors", () => {
    const result = assessCspReportCollectors({
      "api/csp-report.js": read("api/csp-report.js"),
      "functions/csp-report.mjs": read("functions/csp-report.mjs"),
    });
    expect(result.failures).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("fails when a host has no collector", () => {
    const result = assessCspReportCollectors({ "api/csp-report.js": read("api/csp-report.js") });
    expect(result.ok).toBe(false);
    expect(result.failures.join("\n")).toMatch(/functions\/csp-report\.mjs: missing/);
  });

  it("fails on a stub that discards the report again", () => {
    const result = assessCspReportCollectors({
      "api/csp-report.js": "// We do not store the report\nimport '../api/_csp-report-core.js';",
      "functions/csp-report.mjs": read("functions/csp-report.mjs"),
    });
    expect(result.ok).toBe(false);
    expect(result.failures.join("\n")).toMatch(/discards the report/);
  });
});
