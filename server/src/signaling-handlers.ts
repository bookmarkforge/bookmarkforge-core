/**
 * server/src/signaling-handlers.ts — the operator-facing HTTP handlers.
 *
 * Extracted from `index.ts` (P-22): the liveness probe and the token-gated
 * diagnostics endpoint. Composition stays in the entry, which owns the
 * process-level constants and the live room state these handlers read.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { cspCorsHeaders } from "./middleware/security";
import { constantTimeUtf8Equal } from "./proxy-utils";

// ── HTTP healthcheck endpoint ─────────────────────────────────────
// Nginx reverse-proxies GET /health to verify the signaling server is
// alive (not just the reverse proxy itself). The WebSocket upgrade
// path is handled by ws on the same HTTP server.
export function healthHandler(_req: IncomingMessage, res: ServerResponse): void {
  // no-store: a proxy/CDN that caches the 200 would keep reporting "ok"
  // after the signaling server has died, masking the outage from the
  // healthcheck that nginx fronts with this endpoint.
  res.writeHead(200, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  // Keep the unauthenticated liveness probe deliberately minimal. Connection
  // counts, room cardinality and the restart identifier are reconnaissance
  // material; the identifier is already delivered to authenticated signaling
  // clients in the WebSocket init frame where it is operationally needed.
  res.end(JSON.stringify({ status: "ok" }));
}

export type SignalingAdminHandler = (
  req: IncomingMessage,
  res: ServerResponse,
) => void;

export interface SignalingAdminOptions {
  serverInstanceId: string;
  /** Shared secret; empty disables the endpoint (503). */
  adminToken: string;
  maxConnections: number;
  maxRooms: number;
  trustProxy: boolean;
  /** Live WebSocket client count. */
  clientCount: () => number;
  /** Current rooms, with peer counts and whether a secret is set. */
  roomMetrics: () => Array<{ roomId: string; peers: number; secretPresent: boolean }>;
}

export function createSignalingAdminHandler(
  options: SignalingAdminOptions,
): SignalingAdminHandler {
  // ── Admin diagnostics endpoint (disabled by default) ───────────
  // Exposes operational metrics only when options.adminToken is set.
  // Without it, requests fail closed with 503 so the endpoint is not
  // accidentally left public in deployments that forget to configure it.
  function signalingAdminHandler(req: IncomingMessage, res: ServerResponse): void {
    const adminToken = req.headers["x-signaling-admin-token"];
    const tokenMatches =
      typeof adminToken === "string" &&
      constantTimeUtf8Equal(options.adminToken, adminToken);
    if (!options.adminToken || !tokenMatches) {
      res.writeHead(options.adminToken ? 401 : 503, {
        "Content-Type": "text/plain",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
      res.end(options.adminToken ? "Unauthorized" : "Admin diagnostics unavailable");
      return;
    }
    const roomMetrics = options.roomMetrics();
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...cspCorsHeaders(req),
    });
    res.end(
      JSON.stringify({
        serverInstanceId: options.serverInstanceId,
        connections: options.clientCount(),
        maxConnections: options.maxConnections,
        rooms: roomMetrics.length,
        maxRooms: options.maxRooms,
        roomMetrics,
        trustProxy: options.trustProxy,
      }),
    );
  }

  return signalingAdminHandler;
}
