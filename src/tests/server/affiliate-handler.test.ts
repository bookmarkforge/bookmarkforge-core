/**
 * The affiliate proxy is a public POST surface that spends the operator's Whop
 * account credential, so each guard is pinned here:
 *
 *   - fail closed without a Whop credential (503, never a fake success),
 *   - reject a foreign Origin and a missing Origin in production,
 *   - cap the request body (a shared-spirit 256 KiB) so an oversized POST cannot
 *     buffer unbounded memory into the process that also serves signaling,
 *   - per-IP rate limit,
 *   - answer upstream failures with 5xx `success: false` instead of the
 *     `{ totalReferrals: 0, totalEarnings: "$0" }` that used to be returned and
 *     made an outage look like "no referrals yet",
 *   - never build a checkout link the deployment cannot actually build.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAffiliateHandlers } from "../../../server/src/affiliate-handler";

const servers: Array<ReturnType<typeof createServer>> = [];

async function start(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
): Promise<string> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          if (!server.listening) {
            resolve();
            return;
          }
          server.close(() => resolve());
        }),
    ),
  );
});

const BASE_OPTIONS = {
  apiKey: "test_whop_key",
  companyId: "biz_test",
  proPlanId: "plan_test",
  allowedOrigins: ["https://app.example"],
  allowMissingOrigin: false,
  rateLimit: 100,
} as const;

async function request(
  base: string,
  path: string,
  body: string,
  init: { method?: string; origin?: string | null } = {},
): Promise<Response> {
  const method = init.method ?? "POST";
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const origin = init.origin === undefined ? "https://app.example" : init.origin;
  if (origin) headers.Origin = origin;
  return fetch(`${base}${path}`, {
    method,
    headers,
    ...(method === "POST" ? { body } : {}),
  });
}

describe("affiliate handler — guards", () => {
  it("fails closed when the deployment has no Whop credential", async () => {
    const { handleGetAffiliateStats } = createAffiliateHandlers({
      ...BASE_OPTIONS,
      apiKey: "",
    });
    const base = await start(handleGetAffiliateStats as never);
    const fetchImpl = vi.fn();

    const response = await request(base, "/api/affiliate/stats", JSON.stringify({ deviceId: "d1" }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ success: false });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects a foreign origin in production", async () => {
    const upstream = vi.fn();
    const { handleGetAffiliateStats } = createAffiliateHandlers({
      ...BASE_OPTIONS,
      fetchImpl: upstream as unknown as typeof fetch,
    });
    const base = await start(handleGetAffiliateStats as never);

    const response = await request(base, "/api/affiliate/stats", JSON.stringify({ deviceId: "d1" }), {
      origin: "https://evil.example",
    });

    expect(response.status).toBe(403);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("rejects a missing Origin in production", async () => {
    const { handleGetAffiliateStats } = createAffiliateHandlers(BASE_OPTIONS);
    const base = await start(handleGetAffiliateStats as never);

    const response = await request(base, "/api/affiliate/stats", JSON.stringify({ deviceId: "d1" }), {
      origin: null,
    });

    expect(response.status).toBe(403);
  });

  it("answers 405 for a non-POST method", async () => {
    const { handleGetAffiliateStats } = createAffiliateHandlers(BASE_OPTIONS);
    const base = await start(handleGetAffiliateStats as never);

    const response = await request(base, "/api/affiliate/stats", "", { method: "GET" });

    expect(response.status).toBe(405);
  });

  it("caps the request body instead of buffering it whole", async () => {
    const upstream = vi.fn();
    const { handleGetAffiliateStats } = createAffiliateHandlers({
      ...BASE_OPTIONS,
      fetchImpl: upstream as unknown as typeof fetch,
    });
    const base = await start(handleGetAffiliateStats as never);

    const response = await request(
      base,
      "/api/affiliate/stats",
      JSON.stringify({ deviceId: "d1", pad: "x".repeat(300 * 1024) }),
    );

    expect(response.status).toBe(413);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("rejects an unusable device id", async () => {
    const { handleGetAffiliateStats } = createAffiliateHandlers(BASE_OPTIONS);
    const base = await start(handleGetAffiliateStats as never);

    const missing = await request(base, "/api/affiliate/stats", JSON.stringify({}));
    expect(missing.status).toBe(400);

    const malformed = await request(base, "/api/affiliate/stats", "{not json");
    expect(malformed.status).toBe(400);

    const tooLong = await request(
      base,
      "/api/affiliate/stats",
      JSON.stringify({ deviceId: "d".repeat(129) }),
    );
    expect(tooLong.status).toBe(400);
  });

  it("rate limits repeated requests per IP", async () => {
    const upstream = vi.fn(async () =>
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const { handleGetAffiliateStats } = createAffiliateHandlers({
      ...BASE_OPTIONS,
      rateLimit: 2,
      fetchImpl: upstream as unknown as typeof fetch,
    });
    const base = await start(handleGetAffiliateStats as never);

    const first = await request(base, "/api/affiliate/stats", JSON.stringify({ deviceId: "d1" }));
    const second = await request(base, "/api/affiliate/stats", JSON.stringify({ deviceId: "d1" }));
    const third = await request(base, "/api/affiliate/stats", JSON.stringify({ deviceId: "d1" }));

    expect([first.status, second.status]).toEqual([200, 200]);
    expect(third.status).toBe(429);
    expect(upstream).toHaveBeenCalledTimes(2);
  });
});

describe("affiliate handler — results", () => {
  function handlersWith(upstream: typeof fetch, overrides: Record<string, unknown> = {}) {
    return createAffiliateHandlers({
      ...BASE_OPTIONS,
      ...overrides,
      fetchImpl: upstream,
    });
  }

  it("returns the affiliate id and the checkout link built from the plan id", async () => {
    const upstream = vi.fn(async () =>
      new Response(JSON.stringify({ id: "aff_1", total_referrals: 3, total_earnings: "$150" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const { handleGetAffiliateStats } = handlersWith(upstream as unknown as typeof fetch);
    const base = await start(handleGetAffiliateStats as never);

    const response = await request(base, "/api/affiliate/stats", JSON.stringify({ deviceId: "d1" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      affiliateId: "aff_1",
      affiliateLink: "https://whop.com/checkout/plan_test?a=aff_1",
      totalReferrals: 3,
      totalEarnings: "$150",
    });
  });

  it("never fabricates a checkout link when the plan id is missing", async () => {
    const upstream = vi.fn(async () =>
      new Response(JSON.stringify({ id: "aff_1" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const { handleGetAffiliateStats } = handlersWith(upstream as unknown as typeof fetch, {
      proPlanId: "",
    });
    const base = await start(handleGetAffiliateStats as never);

    const response = await request(base, "/api/affiliate/stats", JSON.stringify({ deviceId: "d1" }));

    await expect(response.json()).resolves.toMatchObject({
      success: true,
      affiliateId: "aff_1",
      affiliateLink: null,
    });
  });

  it("reports an upstream failure instead of inventing zero counters", async () => {
    const upstream = vi.fn(async () =>
      new Response("nope", { status: 500, headers: { "content-type": "text/plain" } }),
    );
    const { handleGetAffiliateStats } = handlersWith(upstream as unknown as typeof fetch);
    const base = await start(handleGetAffiliateStats as never);

    const response = await request(base, "/api/affiliate/stats", JSON.stringify({ deviceId: "d1" }));

    expect(response.status).toBe(502);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.success).toBe(false);
    // The regression this pins: a failed read must not answer "$0" / 0.
    expect(body).not.toHaveProperty("totalReferrals");
  });

  it("maps a network failure to 502", async () => {
    const upstream = vi.fn(async () => {
      throw new Error("socket hang up");
    });
    const { handleCreateAffiliate } = handlersWith(upstream as unknown as typeof fetch);
    const base = await start(handleCreateAffiliate as never);

    const response = await request(base, "/api/affiliate/create", JSON.stringify({ deviceId: "d1" }));

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({ success: false });
  });

  it("treats 404 as an honest empty state, not a masked failure", async () => {
    const upstream = vi.fn(async () => new Response("", { status: 404 }));
    const { handleGetAffiliateStats } = handlersWith(upstream as unknown as typeof fetch);
    const base = await start(handleGetAffiliateStats as never);

    const response = await request(base, "/api/affiliate/stats", JSON.stringify({ deviceId: "d1" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      affiliateId: "",
      affiliateLink: null,
      totalReferrals: 0,
      totalEarnings: "$0",
    });
  });

  it("carries the strict security headers", async () => {
    const upstream = vi.fn(async () => new Response("{}", { status: 404 }));
    const { handleGetAffiliateStats } = handlersWith(upstream as unknown as typeof fetch);
    const base = await start(handleGetAffiliateStats as never);

    const response = await request(base, "/api/affiliate/stats", JSON.stringify({ deviceId: "d1" }));

    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("content-security-policy")).toContain("default-src 'none'");
  });
});
