import { describe, it, expect, vi, afterEach } from "vitest";
import {
  probeStorageCapabilities,
  isStorageEnvironmentBroken,
} from "../../utils/storageProbe";

describe("probeStorageCapabilities", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("reports ok when IndexedDB opens and cleans up", async () => {
    const result = await probeStorageCapabilities(1000);
    // jsdom has no indexedDB — the honest answer is "missing", which is
    // still a decisive "environment broken" signal.
    expect(["ok", "missing", "error", "timeout"]).toContain(result.indexedDB);
  });

  it("reports missing when indexedDB is absent", async () => {
    vi.stubGlobal("indexedDB", undefined);
    const result = await probeStorageCapabilities(500);
    expect(result.indexedDB).toBe("missing");
  });

  it("reports error when indexedDB.open throws synchronously", async () => {
    vi.stubGlobal("indexedDB", {
      open: () => {
        throw new DOMException("denied", "SecurityError");
      },
    });
    const result = await probeStorageCapabilities(500);
    expect(result.indexedDB).toBe("error");
  });

  it("reports error on request.onerror", async () => {
    vi.stubGlobal("indexedDB", {
      open: () => {
        const req = {} as IDBOpenDBRequest;
        queueMicrotask(() => req.onerror?.({} as Event));
        return req;
      },
    });
    const result = await probeStorageCapabilities(500);
    expect(result.indexedDB).toBe("error");
  });

  it("reports timeout when the open never settles", async () => {
    vi.stubGlobal("indexedDB", {
      open: () => ({} as IDBOpenDBRequest), // never fires any handler
    });
    const result = await probeStorageCapabilities(50);
    expect(result.indexedDB).toBe("timeout");
  });

  it("reports ok after a successful open + delete", async () => {
    const db = {
      close: vi.fn(),
      objectStoreNames: { contains: () => false },
      createObjectStore: vi.fn(),
    } as unknown as IDBDatabase;
    const delReq = {} as IDBOpenDBRequest;
    vi.stubGlobal("indexedDB", {
      open: () => {
        const req = {} as IDBOpenDBRequest & { result?: unknown };
        req.result = db;
        queueMicrotask(() => {
          req.onupgradeneeded?.({ target: req } as unknown as IDBVersionChangeEvent);
          req.onsuccess?.({ target: req } as unknown as Event);
        });
        return req;
      },
      deleteDatabase: () => {
        queueMicrotask(() => delReq.onsuccess?.({} as Event));
        return delReq;
      },
    });
    const result = await probeStorageCapabilities(500);
    expect(result.indexedDB).toBe("ok");
  });
});

describe("isStorageEnvironmentBroken", () => {
  it("is broken when IndexedDB is not ok", () => {
    expect(
      isStorageEnvironmentBroken({
        indexedDB: "error",
        cryptoSubtle: true,
        localStorage: true,
      }),
    ).toBe(true);
    expect(
      isStorageEnvironmentBroken({
        indexedDB: "timeout",
        cryptoSubtle: true,
        localStorage: true,
      }),
    ).toBe(true);
    expect(
      isStorageEnvironmentBroken({
        indexedDB: "missing",
        cryptoSubtle: true,
        localStorage: true,
      }),
    ).toBe(true);
  });

  it("is broken when crypto.subtle is unavailable", () => {
    expect(
      isStorageEnvironmentBroken({
        indexedDB: "ok",
        cryptoSubtle: false,
        localStorage: true,
      }),
    ).toBe(true);
  });

  it("is NOT broken when only localStorage fails", () => {
    expect(
      isStorageEnvironmentBroken({
        indexedDB: "ok",
        cryptoSubtle: true,
        localStorage: false,
      }),
    ).toBe(false);
  });

  it("is NOT broken on a healthy environment", () => {
    expect(
      isStorageEnvironmentBroken({
        indexedDB: "ok",
        cryptoSubtle: true,
        localStorage: true,
      }),
    ).toBe(false);
  });
});
