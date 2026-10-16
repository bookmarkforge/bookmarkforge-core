// P1: ADR-067 — the OG card handler (/og) treats query parameters as
// untrusted input: `type` is allowlisted, every interpolated value is
// XML-escaped, and the response carries the standard strict security
// headers. A malformed request URL fails closed to the default card
// instead of rejecting the async handler (unhandledRejection → process
// crash). This file is pinned by scripts/audit-anchors.mjs
// (p1-og-reflected-xss): removing or renaming it is an ADR-level change.
import { describe, expect, it } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createOgHandler } from "../../../server/src/og-handler";

interface MockResponse {
  statusCode: number;
  body: string;
  setHeader(name: string, value: string): void;
  writeHead(status: number, writeHeaders: Record<string, string>): MockResponse;
  end(html: string): MockResponse;
  header(name: string): string | undefined;
}

/** Minimal response mock: setHeader + writeHead merge like Node's ServerResponse. */
function mockResponse(): MockResponse {
  const headers = new Map<string, string>();
  const res: MockResponse = {
    statusCode: 0,
    body: "",
    setHeader(name: string, value: string) {
      headers.set(name.toLowerCase(), value);
    },
    writeHead(status: number, writeHeaders: Record<string, string>) {
      res.statusCode = status;
      for (const [name, value] of Object.entries(writeHeaders)) {
        headers.set(name.toLowerCase(), value);
      }
      return res;
    },
    end(html: string) {
      res.body = html;
      return res;
    },
    header(name: string) {
      return headers.get(name.toLowerCase());
    },
  };
  return res;
}

async function getOg(url: string) {
  const handler = createOgHandler();
  const res = mockResponse();
  await handler(
    { url } as IncomingMessage,
    res as unknown as ServerResponse,
  );
  return res;
}

describe("P1 regression — ADR-067 OG handler untrusted query params", () => {
  describe("reflected XSS via ?type=", () => {
    it("does not reflect injected markup from the type parameter", async () => {
      const payload = "</text><script>alert(1)</script>";
      const res = await getOg(`/og?type=${encodeURIComponent(payload)}`);

      expect(res.statusCode).toBe(200);
      // The raw payload markup must never reach the HTML/SVG output.
      expect(res.body).not.toContain("<script>alert(1)");
      expect(res.body).not.toContain("</text><script>");
    });

    it("does not reflect injected event handlers from the type parameter", async () => {
      const payload = '"><img src=x onerror=alert(1)>';
      const res = await getOg(`/og?type=${encodeURIComponent(payload)}`);

      expect(res.statusCode).toBe(200);
      expect(res.body).not.toContain("<img src=x");
    });

    it("renders the default card for non-allowlisted type values", async () => {
      const res = await getOg("/og?type=evil%3Cscript%3E");

      expect(res.statusCode).toBe(200);
      // Fallback renders the default DOCUMENT badge.
      expect(res.body).toContain("DOCUMENT");
    });

    it("reflects each allowlisted type value", async () => {
      const graph = await getOg("/og?type=graph");
      const bookmark = await getOg("/og?type=bookmark");
      const document_ = await getOg("/og?type=document");

      expect(graph.body).toContain("GRAPH");
      expect(bookmark.body).toContain("BOOKMARK");
      expect(document_.body).toContain("DOCUMENT");
    });
  });

  describe("escaping of title and stats", () => {
    it("escapes markup in title (SVG text and meta tags)", async () => {
      const res = await getOg(
        `/og?title=${encodeURIComponent("<script>alert(1)</script>")}`,
      );

      expect(res.statusCode).toBe(200);
      expect(res.body).not.toContain("<script>alert(1)");
      expect(res.body).toContain("&lt;script&gt;");
    });

    it("escapes markup in stats", async () => {
      const res = await getOg(
        `/og?stats=${encodeURIComponent('<img src=x onerror=alert(1)>')}`,
      );

      expect(res.statusCode).toBe(200);
      expect(res.body).not.toContain("<img src=x");
    });
  });

  describe("response hardening", () => {
    it("sets the strict security headers on the OG response", async () => {
      const res = await getOg("/og?title=ok");

      expect(res.header("content-security-policy")).toContain(
        "default-src 'none'",
      );
      expect(res.header("x-content-type-options")).toBe("nosniff");
      expect(res.header("x-frame-options")).toBe("DENY");
      expect(res.header("referrer-policy")).toBe("no-referrer");
    });

    it("uses no inline styles so the strict CSP renders the card", async () => {
      const res = await getOg("/og?title=ok");

      expect(res.body).not.toContain("style=");
    });

    it("fails closed to the default card on a malformed request URL", async () => {
      // Absolute-form request target with an invalid host — `new URL` throws.
      const res = await getOg("http://[invalid");

      expect(res.statusCode).toBe(200);
      expect(res.body).toContain("DOCUMENT");
    });
  });
});
