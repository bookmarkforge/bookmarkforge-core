// @vitest-environment node
import { describe, it, expect } from "vitest";
const config = await import("../lib/config");
describe("server lib/config", () => {
  it("PORT defaults to 8787", () => expect(config.PORT).toBe(8787));
  it("HOST defaults to 0.0.0.0", () => expect(config.HOST).toBe("0.0.0.0"));
  it("SERVER_INSTANCE_ID is a valid UUID", () => expect(config.SERVER_INSTANCE_ID).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/));
  it("TRUST_PROXY defaults to false", () => expect(config.TRUST_PROXY).toBe(false));
  it("MAX_CONNECTIONS defaults to 512", () => expect(config.MAX_CONNECTIONS).toBe(512));
  it("MAX_ROOMS defaults to 2048", () => expect(config.MAX_ROOMS).toBe(2048));
  it("MAX_PEERS_PER_ROOM does not exceed MAX_CONNECTIONS", () => expect(config.MAX_PEERS_PER_ROOM).toBeLessThanOrEqual(config.MAX_CONNECTIONS));
  it("ENFORCE_SIGNAL_HMAC is true by default", () => expect(config.ENFORCE_SIGNAL_HMAC).toBe(true));
  it("HTTP_SECURITY_HEADERS includes required security headers", () => { expect(config.HTTP_SECURITY_HEADERS).toHaveProperty("X-Content-Type-Options"); expect(config.HTTP_SECURITY_HEADERS).toHaveProperty("X-Frame-Options"); expect(config.HTTP_SECURITY_HEADERS).toHaveProperty("Content-Security-Policy"); });
  it("CSP_REPORT_BODY_MAX_BYTES is bounded", () => { expect(config.CSP_REPORT_BODY_MAX_BYTES).toBeGreaterThanOrEqual(1024); expect(config.CSP_REPORT_BODY_MAX_BYTES).toBeLessThanOrEqual(4 * 1024 * 1024); });
});
