import type { IncomingMessage, ServerResponse } from "node:http";
import { CSP_REPORT_ALLOWED_ORIGINS, CSP_REPORT_ADMIN_TOKEN, SIGNALING_ADMIN_TOKEN, HTTP_SECURITY_HEADERS } from "../lib/config";
import { constantTimeUtf8Equal, clientIp } from "../proxy-utils";

export function applySecurityHeaders(res: ServerResponse): void {
  for (const [name, value] of Object.entries(HTTP_SECURITY_HEADERS)) { res.setHeader(name, value); }
}

export function cspCorsHeaders(req: IncomingMessage): Record<string, string> {
  const origin = req.headers.origin;
  if (typeof origin !== "string" || !CSP_REPORT_ALLOWED_ORIGINS.has(origin)) { return {}; }
  return { "Access-Control-Allow-Origin": origin, Vary: "Origin" };
}

export function cspAdminAuth(req: IncomingMessage): boolean {
  const adminToken = req.headers["x-csp-admin-token"];
  if (!CSP_REPORT_ADMIN_TOKEN || typeof adminToken !== "string") return false;
  return constantTimeUtf8Equal(CSP_REPORT_ADMIN_TOKEN, adminToken);
}

export function signalingAdminAuth(req: IncomingMessage): boolean {
  const adminToken = req.headers["x-signaling-admin-token"];
  if (!SIGNALING_ADMIN_TOKEN || typeof adminToken !== "string") return false;
  return constantTimeUtf8Equal(SIGNALING_ADMIN_TOKEN, adminToken);
}

export function getClientIp(req: IncomingMessage): string { return clientIp(req, true); }
