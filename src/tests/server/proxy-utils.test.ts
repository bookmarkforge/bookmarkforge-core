import { describe, expect, it } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  applySecurityHeaders,
  clientIp,
  constantTimeUtf8Equal,
  readBoundedInteger,
} from "../../../server/src/proxy-utils";

function responseHeaders() {
  const headers = new Map<string, string>();
  return {
    setHeader(name: string, value: string) {
      headers.set(name, value);
    },
    headers,
  } as unknown as ServerResponse & { headers: Map<string, string> };
}

function request(headers: IncomingMessage["headers"], remoteAddress = "10.0.0.1") {
  return { headers, socket: { remoteAddress } } as IncomingMessage;
}

describe("shared server proxy helpers", () => {
  it("accepts bounded integer values and fails safe to the fallback", () => {
    expect(readBoundedInteger("12", 3, 1, 20)).toBe(12);
    expect(readBoundedInteger("12.5", 3, 1, 20)).toBe(3);
    expect(readBoundedInteger("999", 3, 1, 20)).toBe(3);
    expect(readBoundedInteger(undefined, 3, 1, 20)).toBe(3);
  });

  it("compares UTF-8 secrets and handles different byte lengths", () => {
    expect(constantTimeUtf8Equal("password", "password")).toBe(true);
    expect(constantTimeUtf8Equal("password", "passworD")).toBe(false);
    expect(constantTimeUtf8Equal("ñ", "n")).toBe(false);
  });

  it("trusts forwarding headers only when explicitly enabled", () => {
    const req = request({ "x-forwarded-for": "203.0.113.8, 10.0.0.2", "x-real-ip": "203.0.113.9" });
    expect(clientIp(req, true)).toBe("203.0.113.8");
    expect(clientIp(req, false)).toBe("10.0.0.1");
  });

  it("keeps the interest-cohort policy opt-out explicit for collectors", () => {
    const standard = responseHeaders();
    applySecurityHeaders(standard);
    expect(standard.headers.get("Permissions-Policy")).toContain("interest-cohort=()");

    const collector = responseHeaders();
    applySecurityHeaders(collector, { includeInterestCohort: false });
    expect(collector.headers.get("Permissions-Policy")).toBe("camera=(), geolocation=(), microphone=()");
  });
});
