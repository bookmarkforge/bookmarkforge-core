/**
 * src/tests/server/client-events.test.ts
 *
 * Unit test for the client-events collector's critical-threshold WINDOW
 * RE-ARM: after a first alert fires (>= CLIENT_EVENTS_CRITICAL_CLIENTS
 * distinct clients report critical within the window), the alert must NOT
 * refire while the window still holds the threshold, and MUST re-arm once
 * the window expires — so a fresh third critical client fires the webhook
 * AGAIN.
 *
 * Unlike the integration suite (src/tests/sync/client-events.test.ts, which
 * spawns the real companion server and waits on real 1.5s/60s windows), this
 * test drives createClientEventsHandler directly over a real HTTP server with
 * a mocked Date.now clock, making the window expiry deterministic and fast.
 *
 * Privacy contract re-checked here too: the webhook payload carries only
 * aggregate counters (never raw IPs or ipHashes).
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClientEventsHandler } from "../../../server/src/client-events";

const servers: Array<ReturnType<typeof createServer>> = [];

// The handler's webhook delivery is fire-and-forget global fetch; the test
// stubs global fetch to capture webhook POSTs. The test's OWN requests must
// use the REAL fetch (captured before any stub) or they would hit the mock.
const realFetch = globalThis.fetch;

async function start(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<string> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

function postCritical(base: string, clientIp: string, pct: number): Promise<Response> {
  return realFetch(`${base}/api/client-events`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": clientIp,
    },
    body: JSON.stringify({ type: "storage-pressure", level: "critical", pct }),
  });
}

let fakeNow = 1_000_000;

beforeEach(() => {
  fakeNow = 1_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => fakeNow);
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
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

describe("client-events webhook safety and diagnostics", () => {
  it("rejects HTTP webhook URLs in production and exposes delivery counters", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CLIENT_EVENTS_WEBHOOK_URL", "http://hooks.example.com/hook");
    vi.stubEnv("CLIENT_EVENTS_ADMIN_TOKEN", "diagnostics-token");
    vi.stubEnv("CLIENT_EVENTS_CRITICAL_CLIENTS", "2");
    vi.stubEnv("CLIENT_EVENTS_LIMIT", "10");
    vi.stubEnv("TRUST_PROXY", "1");

    const handler = createClientEventsHandler({ serverInstanceId: "unit-test" });
    const base = await start((req, res) => { void handler(req, res); });
    await postCritical(base, "203.0.113.10", 90);
    await postCritical(base, "203.0.113.11", 91);
    await new Promise((resolve) => setTimeout(resolve, 20));

    const diagnostics = await realFetch(`${base}/api/client-events`, {
      headers: { "x-client-events-admin-token": "diagnostics-token" },
    });
    expect(diagnostics.status).toBe(200);
    const body = await diagnostics.json() as {
      webhook?: boolean;
      webhookDelivered?: number;
      webhookFailed?: number;
    };
    expect(body.webhook).toBe(false);
    expect(body.webhookDelivered).toBe(0);
    expect(body.webhookFailed).toBe(0);
  });

  it("reflects delivered and failed webhook counters in diagnostics", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("CLIENT_EVENTS_WEBHOOK_URL", "https://hooks.example.com/hook");
    vi.stubEnv("CLIENT_EVENTS_ADMIN_TOKEN", "diagnostics-token");
    vi.stubEnv("CLIENT_EVENTS_CRITICAL_CLIENTS", "2");
    vi.stubEnv("CLIENT_EVENTS_LIMIT", "10");
    vi.stubEnv("TRUST_PROXY", "1");

    let webhookCall = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("hooks.example.com")) {
        webhookCall += 1;
        // Alert #1 fails (503); the re-armed alert #2 delivers (204).
        return new Response(null, { status: webhookCall === 1 ? 503 : 204 });
      }
      return realFetch(input);
    }));
    const handler = createClientEventsHandler({ serverInstanceId: "unit-test" });
    const base = await start((req, res) => { void handler(req, res); });

    // Wave 1: two distinct critical clients within the window → alert #1 →
    // webhook 503 → webhookFailed increments. The re-arm semantics forbid a
    // second firing within the same window (see the window re-arm test):
    // the counters are validated across two windows.
    await postCritical(base, "203.0.113.20", 90);
    await postCritical(base, "203.0.113.21", 91);
    await vi.waitFor(async () => {
      const diagnostics = await realFetch(`${base}/api/client-events`, {
        headers: { "x-client-events-admin-token": "diagnostics-token" },
      });
      const body = await diagnostics.json() as { webhookFailed?: number };
      expect(body.webhookFailed).toBeGreaterThanOrEqual(1);
    });

    // ── Window expires (fakeNow advances > default WINDOW_MS 600s) → lazy
    // re-arm: the first post-sweep critical leaves the count below the
    // threshold and the second one re-crosses it → alert #2 → webhook 204
    // → webhookDelivered.
    fakeNow += 601_000;

    await postCritical(base, "203.0.113.22", 92);
    await postCritical(base, "203.0.113.23", 93);
    await vi.waitFor(() => expect(webhookCall).toBeGreaterThanOrEqual(2));

    const after = await realFetch(`${base}/api/client-events`, {
      headers: { "x-client-events-admin-token": "diagnostics-token" },
    });
    const afterBody = await after.json() as { webhookDelivered?: number; webhookFailed?: number };
    expect(afterBody.webhookDelivered).toBe(1);
    expect(afterBody.webhookFailed).toBe(1);
  });
});

describe("client-event-retry-stats diagnostics", () => {
  it("accepts retry-stats, accumulates counters and logs each NEW drop once", async () => {
    vi.stubEnv("CLIENT_EVENTS_ADMIN_TOKEN", "diagnostics-token");
    vi.stubEnv("CLIENT_EVENTS_LIMIT", "100");
    vi.stubEnv("TRUST_PROXY", "1");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const handler = createClientEventsHandler({ serverInstanceId: "unit-test" });
    const base = await start((req, res) => {
      void handler(req, res);
    });

    const postStats = (
      dropped: number,
      clientIp = "203.0.113.50",
      attempts = 3,
      coalesced = 1,
    ) =>
      realFetch(`${base}/api/client-events/retry-stats`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": clientIp,
        },
        body: JSON.stringify({ type: "client-event-retry-stats", attempts, coalesced, dropped }),
      });
    const degradedLines = () =>
      errorSpy.mock.calls.filter((args) => String(args[0]).includes("client_events_retry_degraded"));

    // First report: dropped=3 is new → accepted (204) + one degraded log line.
    const first = await postStats(3);
    expect(first.status).toBe(204);
    expect(degradedLines()).toHaveLength(1);
    expect(String(degradedLines()[0]![0])).toContain('"newDropped":3');

    // Unchanged cumulative dropped → 204 but NO new degraded line (dedup).
    const second = await postStats(3);
    expect(second.status).toBe(204);
    expect(degradedLines()).toHaveLength(1);

    // dropped grows to 5 → exactly +2 new → second degraded line.
    const third = await postStats(5);
    expect(third.status).toBe(204);
    expect(degradedLines()).toHaveLength(2);
    expect(String(degradedLines()[1]![0])).toContain('"newDropped":2');

    // A second client has its own cumulative counter stream; it must not be
    // treated as a reset of the first client's counters.
    const otherClient = await postStats(4, "203.0.113.51", 2, 0);
    expect(otherClient.status).toBe(204);

    // Diagnostics expose per-client deltas: first client contributes
    // attempts=3/coalesced=1/dropped=5, second contributes 2/0/4.
    const diagnostics = await realFetch(`${base}/api/client-events`, {
      headers: { "x-client-events-admin-token": "diagnostics-token" },
    });
    expect(diagnostics.status).toBe(200);
    const body = (await diagnostics.json()) as {
      clientRetryAttempts?: number;
      clientRetryCoalesced?: number;
      clientRetryDropped?: number;
    };
    expect(body.clientRetryAttempts).toBe(5);
    expect(body.clientRetryCoalesced).toBe(1);
    expect(body.clientRetryDropped).toBe(9);

    errorSpy.mockRestore();
  });
});

describe("client-events critical threshold — window re-arm", () => {
  it("fires the webhook again when a third critical client arrives after the window expired", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(null, { status: 204 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("CLIENT_EVENTS_WINDOW_MS", "60000");
    vi.stubEnv("CLIENT_EVENTS_CRITICAL_CLIENTS", "3");
    vi.stubEnv("CLIENT_EVENTS_WEBHOOK_URL", "https://hooks.example.com/hook");
    vi.stubEnv("TRUST_PROXY", "1");

    const handler = createClientEventsHandler({ serverInstanceId: "unit-test" });
    const base = await start((req, res) => {
      void handler(req, res);
    });

    // ── Wave 1: three distinct critical clients inside the window → 1 alert ──
    await postCritical(base, "203.0.113.1", 90);
    await postCritical(base, "203.0.113.2", 91);
    await postCritical(base, "203.0.113.3", 92);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    // A 4th distinct critical client in the SAME window must NOT refire.
    await postCritical(base, "203.0.113.4", 93);
    await new Promise((r) => setTimeout(r, 50));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // ── Window expires (all wave-1 entries go stale) ──
    fakeNow += 61_000;

    // Re-arm is lazy: the next critical event sweeps the stale entries and
    // drops below the threshold (alertFired → false). Two clients are still
    // below the threshold → still no second webhook.
    await postCritical(base, "203.0.113.5", 94);
    await postCritical(base, "203.0.113.6", 95);
    await new Promise((r) => setTimeout(r, 50));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // The THIRD critical client after expiry crosses the threshold again →
    // the webhook fires a second time (re-armed window).
    await postCritical(base, "203.0.113.7", 96);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    const secondCall = fetchMock.mock.calls[1];
    expect(secondCall).toBeDefined();
    const body = JSON.parse(String(secondCall![1]?.body)) as Record<string, unknown>;
    expect(body.alert).toBe("client-events-critical-threshold");
    expect(body.criticalClients).toBe(3);
    expect(body.threshold).toBe(3);
    expect(body.windowMs).toBe(60000);

    // Privacy: the re-fired alert carries no raw IPs / hashes.
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("203.0.113");
    expect(serialized).not.toContain("ipHash");
  });
});
