/**
 * Behavioral tests for the ADR-039 service-worker integrity runtime
 * (scripts/sw-integrity-runtime.js).
 *
 * The runtime is a bare script body (the vite build appends it verbatim
 * into the Workbox-generated dist/sw.js), so these tests execute the real
 * shipping bytes with `new Function("self", "FetchEvent", src)` against a
 * synthetic SW environment. This also pins the "no imports/exports"
 * constraint that keeps the file embeddable.
 */
// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const RUNTIME_SRC = readFileSync(
  join(HERE, "..", "sw-integrity-runtime.js"),
  "utf8",
);

const ORIGIN = "https://app.example";

/** sha256 hex of a string, using the same primitive as the runtime. */
async function sha256Hex(text) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Cache double with the ignoreSearch delete semantics Workbox needs. */
class FakeCache {
  constructor(name, log) {
    this.name = name;
    this.entries = new Map();
    this.log = log;
  }
  async match(request) {
    return this.entries.get(String(request)) ?? null;
  }
  async put(request, response) {
    this.entries.set(String(request), response);
  }
  async delete(request, opts) {
    const target = String(request);
    let removed = false;
    for (const key of [...this.entries.keys()]) {
      const keyPath = opts?.ignoreSearch ? key.split("?")[0] : key;
      if (keyPath === target) {
        this.entries.delete(key);
        this.log.deleted.push(`${this.name}::${key}`);
        removed = true;
      }
    }
    return removed;
  }
}

/**
 * Builds a sandbox and evaluates the runtime inside it. The baseline
 * respondWith records its argument so pass-through identity is observable;
 * when the runtime patches the prototype, guarded events resolve to the
 * wrapped promise instead.
 */
function makeSandbox({ manifest, clients = [] } = {}) {
  const log = { postMessages: [], deleted: [] };
  const caches = new Map();
  const getCache = (name) => {
    if (!caches.has(name)) {caches.set(name, new FakeCache(name, log));}
    return caches.get(name);
  };

  const sandboxSelf = {
    location: { origin: ORIGIN },
    __BMF_SW_INTEGRITY_MANIFEST__: manifest,
    clients: {
      matchAll: async () =>
        clients.map((c) => ({
          postMessage: (m) => log.postMessages.push([c.id, m]),
        })),
    },
    caches: {
      keys: async () => [...caches.keys()],
      open: async (name) => getCache(name),
    },
  };

  class FakeFetchEvent {
    constructor(request) {
      this.request = request;
      this.respondedWith = null;
    }
    respondWith(p) {
      this.respondedWith = p;
    }
  }
  new Function("self", "FetchEvent", RUNTIME_SRC)(
    sandboxSelf,
    FakeFetchEvent,
  );

  /** Dispatch a GET fetch event for a same-origin path. */
  const dispatch = (path, response) =>
    dispatchRequest(new Request(`${ORIGIN}${path}`), response);
  /** Dispatch with a fully custom Request (cross-origin, POST, …). */
  const dispatchRequest = (request, response) => {
    const event = new FakeFetchEvent(request);
    event.respondWith(Promise.resolve(response));
    return event.respondedWith;
  };

  return { sandboxSelf, dispatch, dispatchRequest, log, getCache };
}

describe("sw-integrity-runtime (ADR-039)", () => {
  let consoleError;
  beforeEach(() => {
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    consoleError.mockRestore();
  });

  it("stays a bare script body: no import/export statements", () => {
    // It is appended verbatim into dist/sw.js — any module syntax would
    // make the whole service worker fail to parse.
    expect(RUNTIME_SRC).not.toMatch(/^\s*(?:import|export)\b/m);
  });

  it("never performs outbound network access (verification is local-only)", () => {
    // The runtime must hash the response it was handed, not fetch anything.
    expect(RUNTIME_SRC).not.toMatch(/\bfetch\s*\(/);
  });

  it("no-ops when no manifest is embedded (dev/test SW)", async () => {
    const { dispatch, log } = makeSandbox({ manifest: undefined });
    const res = await dispatch("/assets/chunk-abc.js", new Response("evil"));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("evil");
    expect(log.postMessages).toEqual([]);
  });

  it("passes through a response whose bytes match the manifest hash", async () => {
    const body = "console.log('legit chunk');";
    const { dispatch, log } = makeSandbox({
      manifest: {
        version: "1.0.0",
        files: { "/assets/chunk-abc.js": await sha256Hex(body) },
      },
    });
    const res = await dispatch("/assets/chunk-abc.js", new Response(body));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(body);
    expect(log.postMessages).toEqual([]);
    expect(log.deleted).toEqual([]);
  });

  it("fails closed on a hash mismatch: 504, cache eviction, client notify", async () => {
    const body = "console.log('legit chunk');";
    const { dispatch, log, getCache } = makeSandbox({
      manifest: {
        version: "1.0.0",
        files: { "/assets/chunk-abc.js": await sha256Hex(body) },
      },
      clients: [{ id: "client-1" }, { id: "client-2" }],
    });
    // Poison a Workbox-style precache entry (revision query) and the
    // lazy-assets runtime cache.
    await getCache("workbox-precache-v2").put(
      "/assets/chunk-abc.js?v=rev1",
      new Response("evil"),
    );
    await getCache("bookmarkforge-lazy-assets").put(
      "/assets/chunk-abc.js",
      new Response("evil"),
    );

    const res = await dispatch(
      "/assets/chunk-abc.js",
      new Response("evil /* tampered */"),
    );

    // The tampered chunk NEVER executes in the page.
    expect(res.status).toBe(504);
    expect(await res.text()).toBe("Integrity check failed");
    // Both poisoned entries evicted (ignoreSearch strips the revision).
    expect(log.deleted).toEqual([
      "workbox-precache-v2::/assets/chunk-abc.js?v=rev1",
      "bookmarkforge-lazy-assets::/assets/chunk-abc.js",
    ]);
    // Same contract the app already handles end to end.
    expect(log.postMessages).toHaveLength(2);
    expect(log.postMessages[0]?.[1]).toMatchObject({
      type: "bundle-integrity-failed",
      mismatchedFiles: ["/assets/chunk-abc.js"],
      reason: "sw-cache-handler",
    });
    expect(typeof log.postMessages[0]?.[1].checkedAt).toBe("string");
    expect(consoleError).toHaveBeenCalled();
  });

  it("passes through non-ok responses (cannot verify an error body)", async () => {
    const { dispatch, log } = makeSandbox({
      manifest: { version: "1.0.0", files: { "/assets/listed.js": "00" } },
    });
    const notFound = await dispatch(
      "/assets/listed.js",
      new Response("nope", { status: 404 }),
    );
    expect(notFound.status).toBe(404);
    expect(log.postMessages).toEqual([]);
    expect(log.deleted).toEqual([]);
  });

  it("passes through same-origin paths that are not in the manifest", async () => {
    const { dispatch, log } = makeSandbox({
      manifest: { version: "1.0.0", files: { "/assets/listed.js": "00" } },
    });
    const res = await dispatch("/api/whatever", new Response("{}"));
    expect(res.status).toBe(200);
    expect(log.postMessages).toEqual([]);
  });

  it("never guards cross-origin responses", async () => {
    const { dispatchRequest, log } = makeSandbox({
      manifest: {
        version: "1.0.0",
        files: { "/assets/listed.js": await sha256Hex("evil") },
      },
    });
    // Same pathname, foreign origin: the manifest is same-origin scoped, so
    // this must flow through untouched.
    const res = await dispatchRequest(
      new Request("https://evil.example/assets/listed.js"),
      new Response("evil"),
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("evil");
    expect(log.postMessages).toEqual([]);
  });

  it("does not guard non-GET requests (identity pass-through)", async () => {
    const { sandboxSelf, dispatchRequest } = makeSandbox({
      manifest: { version: "1.0.0", files: { "/api/submit": "00" } },
    });
    const res = await dispatchRequest(
      new Request(`${ORIGIN}/api/submit`, { method: "POST" }),
      new Response("ok"),
    );
    expect(res.status).toBe(200);
    expect(sandboxSelf.__BMF_SW_INTEGRITY__.enabled).toBe(true);
  });

  it("exposes a diagnostic surface on self", () => {
    const { sandboxSelf } = makeSandbox({
      manifest: { version: "1.0.0", files: { "/a.js": "00" } },
    });
    expect(sandboxSelf.__BMF_SW_INTEGRITY__.enabled).toBe(true);
    expect(typeof sandboxSelf.__BMF_SW_INTEGRITY__.verifyResponse).toBe(
      "function",
    );
    expect(typeof sandboxSelf.__BMF_SW_INTEGRITY__.guardResponse).toBe(
      "function",
    );
  });

  it("reports enabled=false without a manifest and leaves respondWith stock", async () => {
    const { sandboxSelf, dispatch } = makeSandbox({ manifest: undefined });
    expect(sandboxSelf.__BMF_SW_INTEGRITY__.enabled).toBe(false);
    const res = await dispatch("/x", new Response("ok"));
    expect(res.status).toBe(200);
  });
});
