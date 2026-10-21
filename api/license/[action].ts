import type { IncomingMessage, ServerResponse } from "node:http";
import { createLicenseHandler } from "./_license-server.js";
import { loadSigningPrivateKey } from "./_license-signing.js";

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const path = new URL(req.url ?? "/", "http://localhost").pathname;

  if (req.method === "GET" && (path === "/api/license/health" || path === "/licenses/health")) {
    const hasWhopKey = Boolean(process.env.WHOP_API_KEY);
    const hasSigningKey = loadSigningPrivateKey() !== null;
    res.writeHead(hasWhopKey && hasSigningKey ? 200 : 503, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify({
      status: hasWhopKey && hasSigningKey ? "ok" : "not_configured",
      providerConfigured: hasWhopKey,
      signingConfigured: hasSigningKey,
    }));
    return;
  }

  try {
    const licenseHandler = createLicenseHandler();
    await licenseHandler(req, res);
  } catch (error) {
    // Keep unexpected bootstrap/runtime failures from becoming an opaque
    // Vercel FUNCTION_INVOCATION_FAILED response. Log the diagnostic server-side
    // while returning only a generic error to the client.
    console.error("[license] unhandled handler error", error);
    if (!res.writableEnded) {
      res.writeHead(500, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify({
        error: {
          code: "SERVER",
          message: "license service encountered an internal error",
        },
      }));
    }
  }
}
