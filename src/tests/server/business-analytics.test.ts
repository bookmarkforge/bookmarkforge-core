/**
 * src/tests/server/business-analytics.test.ts
 *
 * Unit tests for the opt-in business analytics collector
 * (server/src/business-analytics.ts): ingest validation, idempotent daily
 * buckets, cohort retention math, admin-gated KPIs, per-IP rate limiting and
 * state-file round-trip persistence.
 *
 * Follows the client-events test convention: drives createAnalyticsHandler
 * directly over a real HTTP server with a mocked Date.now clock so day math
 * is deterministic and fast.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAnalyticsHandler } from "../../../server/src/business-analytics";

const DAY_MS = 86_400_000;
const servers: Array<ReturnType<typeof createServer>> = [];
const realFetch = globalThis.fetch;

async function start(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<string> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

interface BucketBody {
  iid: string;
  counts: Record<string, number>;
  batchId?: string;
}

function postBucket(base: string, body: BucketBody, clientIp = "10.0.0.1"): Promise<Response> {
  return realFetch(`${base}/api/analytics/events`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": clientIp,
    },
    body: JSON.stringify(body),
  });
}

function getKpis(base: string, token = "admin-token"): Promise<Response> {
  return realFetch(`${base}/api/analytics/kpis`, {
    headers: { "x-analytics-admin-token": token },
  });
}

let fakeNow = 0;
const IID_A = "a".repeat(64);
const IID_B = "b".repeat(64);

beforeEach(() => {
  fakeNow = 0;
  vi.spyOn(Date, "now").mockImplementation(() => fakeNow);
  vi.stubEnv("ANALYTICS_ADMIN_TOKEN", "admin-token");
  vi.stubEnv("TRUST_PROXY", "1");
  vi.stubEnv("ANALYTICS_RATE_LIMIT", "100");
  vi.stubEnv("ANALYTICS_WINDOW_MS", "600000");
  vi.stubEnv("ANALYTICS_STATE_FILE", "");
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
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

describe("business analytics collector", () => {
  it("accepts a valid bucket and reports DAU + funnel counts", async () => {
    const base = await start(createAnalyticsHandler({ serverInstanceId: "test" }));
    const response = await postBucket(base, {
      iid: IID_A,
      counts: { vault_created: 1, bookmark_created: 3, session_start: 1 },
    });
    expect(response.status).toBe(204);

    const kpis = await getKpis(base).then((r) => r.json());
    expect(kpis.dau).toBe(1);
    expect(kpis.wau).toBe(1);
    expect(kpis.mau).toBe(1);
    expect(kpis.funnel).toMatchObject({ vault_created: 1, bookmark_created: 3, session_start: 1 });
    expect(kpis.activeInstalls).toBe(1);
  });

  it("rejects malformed buckets (bad iid, unknown type, non-integer count)", async () => {
    const base = await start(createAnalyticsHandler({ serverInstanceId: "test" }));
    const cases: Array<[string, unknown]> = [
      ["short iid", { iid: "abc", counts: { vault_created: 1 } }],
      ["non-hex iid", { iid: "z".repeat(64), counts: { vault_created: 1 } }],
      ["unknown type", { iid: IID_A, counts: { totally_not_real: 1 } }],
      ["float count", { iid: IID_A, counts: { vault_created: 1.5 } }],
      ["zero count", { iid: IID_A, counts: { vault_created: 0 } }],
      ["empty counts", { iid: IID_A, counts: {} }],
      ["content field", { iid: IID_A, counts: { vault_created: 1, note: "hello" } }],
    ];
    for (const [name, body] of cases) {
      const response = await postBucket(base, body as BucketBody);
      expect(response.status, name).toBe(400);
    }
    const kpis = await getKpis(base).then((r) => r.json());
    expect(kpis.counters.rejected).toBe(cases.length);
    expect(kpis.counters.accepted).toBe(0);
  });

  it("is idempotent: a retried day replaces the previous bucket, no double counting", async () => {
    const base = await start(createAnalyticsHandler({ serverInstanceId: "test" }));
    await postBucket(base, { iid: IID_A, counts: { bookmark_created: 3 } });
    // Retry the SAME day (same fakeNow) with a corrected bucket.
    await postBucket(base, { iid: IID_A, counts: { bookmark_created: 5 } });

    const kpis = await getKpis(base).then((r) => r.json());
    expect(kpis.funnel.bookmark_created).toBe(5);
    expect(kpis.dau).toBe(1);
  });

  // ADR-030: new clients send batchId — partial flushes must ADD UP (the
  // legacy per-day replace semantics silently lost activity from earlier
  // partial flushes of the same day) and a retried batch must be a no-op
  // even when the original 204 was lost in transit.
  it("accumulates batchId partial flushes additively within the same day", async () => {
    const base = await start(createAnalyticsHandler({ serverInstanceId: "test" }));
    const r1 = await postBucket(base, { iid: IID_A, batchId: "batch-1", counts: { bookmark_created: 3 } });
    const r2 = await postBucket(base, { iid: IID_A, batchId: "batch-2", counts: { bookmark_created: 4, vault_created: 1 } });
    expect(r1.status).toBe(204);
    expect(r2.status).toBe(204);

    const kpis = await getKpis(base).then((r) => r.json());
    // Both partial contributions survive — nothing is replaced.
    expect(kpis.funnel.bookmark_created).toBe(7);
    expect(kpis.funnel.vault_created).toBe(1);
    expect(kpis.dau).toBe(1);
  });

  it("is idempotent per batchId: a retried batch returns 204 without double counting", async () => {
    const base = await start(createAnalyticsHandler({ serverInstanceId: "test" }));
    await postBucket(base, { iid: IID_A, batchId: "batch-1", counts: { bookmark_created: 3 } });
    // Network lost the first 204 → client retries the SAME batchId.
    const retry = await postBucket(base, { iid: IID_A, batchId: "batch-1", counts: { bookmark_created: 3 } });
    expect(retry.status).toBe(204);

    const kpis = await getKpis(base).then((r) => r.json());
    expect(kpis.funnel.bookmark_created).toBe(3);
    expect(kpis.counters.accepted).toBe(2);
  });

  it("fails closed with 503 when the per-install batch capacity is exhausted", async () => {
    vi.stubEnv("ANALYTICS_MAX_BATCHES_PER_INSTALL", "32");
    const base = await start(createAnalyticsHandler({ serverInstanceId: "test" }));
    // Fill the bounded idempotency window (32 batches).
    for (let i = 0; i < 32; i++) {
      const response = await postBucket(base, { iid: IID_A, batchId: `batch-${i}`, counts: { session_start: 1 } });
      expect(response.status).toBe(204);
    }
    // A NEW batch beyond the window must be rejected, not silently dropped
    // or double counted.
    const overflow = await postBucket(base, { iid: IID_A, batchId: "batch-overflow", counts: { session_start: 1 } });
    expect(overflow.status).toBe(503);
    expect(overflow.headers.get("retry-after")).toBe("60");
    // Retrying an EXISTING batch stays a harmless duplicate (204).
    const duplicate = await postBucket(base, { iid: IID_A, batchId: "batch-0", counts: { session_start: 1 } });
    expect(duplicate.status).toBe(204);

    const kpis = await getKpis(base).then((r) => r.json());
    expect(kpis.funnel.session_start).toBe(32);
  });

  it("validates the batchId format and rejects malformed values", async () => {
    const base = await start(createAnalyticsHandler({ serverInstanceId: "test" }));
    const cases: Array<[string, string]> = [
      ["empty", ""],
      ["too long", "b".repeat(129)],
      ["bad chars", "bad id/with\nnewline"],
    ];
    for (const [name, batchId] of cases) {
      const response = await postBucket(base, { iid: IID_A, batchId, counts: { session_start: 1 } });
      expect(response.status, name).toBe(400);
    }
  });

  it("computes cohort retention D1/D7/D30 from first/last active days", async () => {
    const base = await start(createAnalyticsHandler({ serverInstanceId: "test" }));
    // Day 0: two installs first seen.
    await postBucket(base, { iid: IID_A, counts: { vault_created: 1 } }, "10.0.0.1");
    await postBucket(base, { iid: IID_B, counts: { vault_created: 1 } }, "10.0.0.2");

    // Day 1: A returns; B does not.
    fakeNow = DAY_MS;
    await postBucket(base, { iid: IID_A, counts: { session_start: 1 } }, "10.0.0.1");

    // Day 7: A returns again (retained D7); B stays away.
    fakeNow = 7 * DAY_MS;
    await postBucket(base, { iid: IID_A, counts: { session_start: 1 } }, "10.0.0.1");

    const kpis = await getKpis(base).then((r) => r.json());
    const cohort = kpis.cohorts["0"];
    expect(cohort).toBeDefined();
    expect(cohort.cohortSize).toBe(2);
    expect(cohort.d1).toBe(1); // only A active on day 1
    expect(cohort.d7).toBe(1); // only A active on day 7
    // D30 counts installs with lastDay >= firstDay + 30 — neither qualifies.
    expect(cohort.d30).toBe(0);
    expect(kpis.dau).toBe(1);
    expect(kpis.wau).toBe(1);
    // B was active on day 0, which is within 30 days of day 7.
    expect(kpis.mau).toBe(2);
  });

  it("gates the KPI GET behind the admin token", async () => {
    const base = await start(createAnalyticsHandler({ serverInstanceId: "test" }));
    expect((await getKpis(base, "")).status).toBe(401);
    expect((await getKpis(base, "wrong")).status).toBe(401);
    expect((await getKpis(base, "admin-token")).status).toBe(200);
  });

  it("rate limits per client IP", async () => {
    vi.stubEnv("ANALYTICS_RATE_LIMIT", "2");
    const base = await start(createAnalyticsHandler({ serverInstanceId: "test" }));
    await postBucket(base, { iid: IID_A, counts: { vault_created: 1 } }, "10.0.0.9");
    await postBucket(base, { iid: IID_A, counts: { session_start: 1 } }, "10.0.0.9");
    const third = await postBucket(base, { iid: IID_A, counts: { session_start: 1 } }, "10.0.0.9");
    expect(third.status).toBe(429);
    // A different client is not limited.
    const other = await postBucket(base, { iid: IID_B, counts: { vault_created: 1 } }, "10.0.0.10");
    expect(other.status).toBe(204);
  });

  it("persists state to a file and restores it on a new handler", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bmf-analytics-test-"));
    const stateFile = join(dir, "analytics.json");
    vi.stubEnv("ANALYTICS_STATE_FILE", stateFile);

    const first = await start(createAnalyticsHandler({ serverInstanceId: "test" }));
    await postBucket(first, { iid: IID_A, counts: { vault_created: 1, bookmark_created: 2 } });
    await getKpis(first); // ensure ingestion settled

    // The debounced writer fires after 2s; wait for the file to appear.
    const deadline = Date.now() + 5_000;
    while (!existsSync(stateFile) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(existsSync(stateFile)).toBe(true);
    const persisted = JSON.parse(readFileSync(stateFile, "utf8"));
    expect(persisted.installs).toHaveLength(1);

    // A fresh handler instance (same env) restores the state.
    vi.stubEnv("ANALYTICS_STATE_FILE", stateFile);
    const second = await start(createAnalyticsHandler({ serverInstanceId: "test" }));
    const kpis = await getKpis(second).then((r) => r.json());
    expect(kpis.activeInstalls).toBe(1);
    expect(kpis.funnel).toMatchObject({ vault_created: 1, bookmark_created: 2 });

    rmSync(dir, { recursive: true, force: true });
  });
});
