// @vitest-environment node
import { describe, it, expect } from "vitest";
import type { IncomingMessage } from "node:http";
import { applySecurityHeaders, cspCorsHeaders, cspAdminAuth, signalingAdminAuth } from "../middleware/security";
function makeReq(headers: Record<string, string> = {}): IncomingMessage { return { headers, socket: { remoteAddress: "127.0.0.1" } } as unknown as IncomingMessage; }
describe("server middleware/security", () => {
  it("applySecurityHeaders sets all required security headers", () => { const res = { setHeader: (name: string) => {} } as unknown as Parameters<typeof applySecurityHeaders>[0]; applySecurityHeaders(res); expect(res.setHeader).toHaveBeenCalledWith("X-Content-Type-Options", "nosniff"); });
  it("cspCorsHeaders returns empty object for non-allowed origin", () => expect(cspCorsHeaders(makeReq({ origin: "https://evil.com" }))).toEqual({}));
  it("cspAdminAuth returns false without token", () => expect(cspAdminAuth(makeReq({}))).toBe(false));
  it("signalingAdminAuth returns false without token", () => expect(signalingAdminAuth(makeReq({}))).toBe(false));
});
