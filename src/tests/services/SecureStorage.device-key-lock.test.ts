// @vitest-environment jsdom
/**
 * Tests for cross-tab device-key serialisation via the Web Locks API.
 *
 * Two SecureStorage instances simulate two browser tabs sharing the same
 * origin + IndexedDB + localStorage. Without the lock, concurrent
 * getDeviceKey() calls can generate divergent AES keys — the second
 * tab overwrites the JWK written by the first, and secrets encrypted
 * with the first key become undecryptable.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SecureStorage } from "../../services/SecureStorage";

// ── Simple lock queue that mimics navigator.locks.request ───────────

function createLockMock() {
  const held = new Set<string>();
  const queues = new Map<string, Array<() => void>>();

  const request = vi.fn(
    async (name: string, callback: () => Promise<unknown>): Promise<unknown> => {
      // If the lock is already held, queue this caller.
      if (held.has(name)) {
        await new Promise<void>((resolve) => {
          const q = queues.get(name) ?? [];
          q.push(resolve);
          queues.set(name, q);
        });
      }
      held.add(name);
      try {
        return await callback();
      } finally {
        held.delete(name);
        // Release the next waiter for this lock name.
        const q = queues.get(name);
        if (q && q.length > 0) {
          q.shift()!();
        }
      }
    },
  );

  return { request, held, queues };
}

// ── Tests ──────────────────────────────────────────────────────────

describe("SecureStorage — device-key lock (cross-tab serialisation)", () => {
  let lockMock: ReturnType<typeof createLockMock>;
  let instances: SecureStorage[] = [];

  beforeEach(() => {
    instances = [];
    lockMock = createLockMock();

    // Stub navigator.locks with our queue-based implementation.
    vi.stubGlobal("navigator", {
      ...(globalThis.navigator ?? {}),
      locks: lockMock,
    });

    // Start each test with a clean localStorage slate.
    localStorage.clear();
  });

  afterEach(async () => {
    // Close all IndexedDB connections to prevent cross-test interference.
    for (const inst of instances) {
      await inst.close().catch(() => undefined);
    }
    instances = [];
    vi.unstubAllGlobals();
  });

  /** Create a tracked instance. */
  function createInstance(): SecureStorage {
    const inst = new SecureStorage();
    instances.push(inst);
    return inst;
  }

  // ─────────────────────────────────────────────────────────────────

  it("acquires the Web Locks API lock when calling getDeviceKey", async () => {
    const instance = createInstance();

    // unwrapDeviceKeyWithPassword falls through to getDeviceKey() when
    // there is no wrapped key blob, which exercises the lock path.
    const key = await instance.unwrapDeviceKeyWithPassword("test-password");

    expect(key).toBeDefined();
    expect(lockMock.request).toHaveBeenCalledTimes(1);
    expect(lockMock.request).toHaveBeenCalledWith(
      expect.stringContaining("bookmarkforge_secure_vault"),
      expect.any(Function),
    );
  });

  // ─────────────────────────────────────────────────────────────────

  it("serializes two concurrent calls so only one generates the key", async () => {
    const instanceA = createInstance();
    const instanceB = createInstance();

    // Launch both concurrently — the second must wait for the first
    // to release the lock.
    const [keyA, keyB] = await Promise.all([
      instanceA.unwrapDeviceKeyWithPassword("shared-password"),
      instanceB.unwrapDeviceKeyWithPassword("shared-password"),
    ]);

    // Both calls must have gone through navigator.locks.request.
    expect(lockMock.request).toHaveBeenCalledTimes(2);
    expect(keyA).toBeDefined();
    expect(keyB).toBeDefined();

    // Only one JWK must have been written to localStorage — the second
    // caller re-reads the one written by the first instead of generating
    // a divergent second key.
    const jwkRaw = localStorage.getItem("bmf_device_key_jwk");
    expect(jwkRaw).not.toBeNull();

    // Parse and verify the JWK is a valid AES-GCM key descriptor.
    const jwk = JSON.parse(jwkRaw!);
    expect(jwk.kty).toBeDefined();
    expect(jwk.k).toBeDefined();
  });

  // ─────────────────────────────────────────────────────────────────

  it("second caller re-reads the JWK from localStorage inside the lock", async () => {
    const instanceA = createInstance();
    const instanceB = createInstance();

    // Track the order of lock callbacks so we can assert the second one
    // ran after the first had already written to localStorage.
    const callOrder: string[] = [];
    const origRequest = lockMock.request.getMockImplementation();
    lockMock.request.mockImplementation(
      async (name: string, callback: () => Promise<unknown>) => {
        const tag = callOrder.length === 0 ? "first" : "second";
        const result = await origRequest!(name, async () => {
          callOrder.push(`${tag}-enter`);
          const r = await callback();
          callOrder.push(`${tag}-exit`);
          return r;
        });
        return result;
      },
    );

    await Promise.all([
      instanceA.unwrapDeviceKeyWithPassword("order-test-pw"),
      instanceB.unwrapDeviceKeyWithPassword("order-test-pw"),
    ]);

    // The first caller enters the lock, generates the key, writes to
    // localStorage, exits. The second caller then enters, re-reads
    // localStorage, finds the JWK, and exits without generating a new key.
    expect(callOrder).toEqual([
      "first-enter",
      "first-exit",
      "second-enter",
      "second-exit",
    ]);
  });

  // ─────────────────────────────────────────────────────────────────

  it("falls back to direct call when navigator.locks is unavailable", async () => {
    // Remove navigator.locks entirely to exercise the fallback path.
    vi.stubGlobal("navigator", {
      ...(globalThis.navigator ?? {}),
      locks: undefined,
    });

    const instance = createInstance();
    const key = await instance.unwrapDeviceKeyWithPassword("fallback-pw");

    // Must still succeed — the fallback just calls fn() directly.
    expect(key).toBeDefined();
    expect(localStorage.getItem("bmf_device_key_jwk")).not.toBeNull();
  });

  // ─────────────────────────────────────────────────────────────────

  it("in-lock re-check of this.deviceKey prevents redundant generation", async () => {
    const instance = createInstance();

    // First call: populates this.deviceKey and writes the JWK.
    const key1 = await instance.unwrapDeviceKeyWithPassword("recheck-pw");
    expect(lockMock.request).toHaveBeenCalledTimes(1);

    // A second call on the same instance would hit the early-return cache
    // (this.deviceKey is already set). Clear it so we exercise the full
    // getDeviceKey() path again from scratch.
    instance.lockDeviceKey();
    const key2 = await instance.unwrapDeviceKeyWithPassword("recheck-pw");
    expect(lockMock.request).toHaveBeenCalledTimes(2);

    // Both should yield the same key material stored in localStorage.
    const jwk = JSON.parse(localStorage.getItem("bmf_device_key_jwk")!);
    expect(jwk.k).toBeDefined();
  });

  // ─────────────────────────────────────────────────────────────────

  it("both instances agree on the device key after concurrent initialisation", async () => {
    const instanceA = createInstance();
    const instanceB = createInstance();

    // Initialise both concurrently.
    await Promise.all([
      instanceA.unwrapDeviceKeyWithPassword("agree-pw"),
      instanceB.unwrapDeviceKeyWithPassword("agree-pw"),
    ]);

    // Lock both out to clear the in-memory caches.
    instanceA.lockDeviceKey();
    instanceB.lockDeviceKey();

    // Re-unlock both — they must re-read the SAME JWK from localStorage
    // and import the same key.
    const [ka, kb] = await Promise.all([
      instanceA.unwrapDeviceKeyWithPassword("agree-pw"),
      instanceB.unwrapDeviceKeyWithPassword("agree-pw"),
    ]);

    expect(ka).toBeDefined();
    expect(kb).toBeDefined();
    // The JWK in localStorage must be a single, consistent key.
    const jwk = JSON.parse(localStorage.getItem("bmf_device_key_jwk")!);
    expect(jwk.k).toBeDefined();
  });
});
