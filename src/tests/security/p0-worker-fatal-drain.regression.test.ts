import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

interface CapturedPost {
  id: string;
  type: string;
  payload: unknown;
}

interface FakeWorker {
  onmessage: ((ev: { data: unknown }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  posted: CapturedPost[];
  terminateCalls: number;
  postMessage(msg: CapturedPost): void;
  terminate(): void;
}

const workerInstances: FakeWorker[] = [];

/**
 * Minimal Worker mock. No auto-respond — tests manually drive onmessage so
 * the in-flight pendingRequests queue stays populated long enough for the
 * FATAL drain path to fire.
 */
class MockWorker {
  public onmessage: ((ev: { data: unknown }) => void) | null = null;
  public onerror: ((ev: unknown) => void) | null = null;
  public posted: CapturedPost[] = [];
  public terminateCalls = 0;
  constructor() {
    workerInstances.push(this as unknown as FakeWorker);
  }
  postMessage(msg: CapturedPost): void {
    this.posted.push(msg);
  }
  terminate(): void {
    this.terminateCalls += 1;
  }
}

vi.mock("../../services/SecureStorage", () => ({
  secureStorage: {
    getSecret: vi.fn(async () => null),
    setSecret: vi.fn(async () => undefined),
    hasSecret: vi.fn(async () => false),
    deleteSecret: vi.fn(async () => undefined),
  },
}));

/**
 * Captures a rejection (returns `null` if the promise resolved instead).
 * Used to assert that the FATAL drain path actually rejects in-flight
 * requests without depending on the i18n wrapping layer that
 * EncryptionService.encrypt/.decrypt apply over their inner runInWorker
 * rejections — which we carefully do NOT want to test here.
 */
async function captureRejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
    return null;
  } catch (err) {
    return err;
  }
}

describe("P0 regression — worker FATAL drains pending requests", () => {
  beforeEach(() => {
    vi.resetModules();
    workerInstances.length = 0;
    vi.stubGlobal("Worker", MockWorker as unknown as typeof Worker);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("drains ALL in-flight requests, terminates the worker, and rejects new operations", async () => {
    const { encryptionService } =
      await import("../../services/EncryptionService");

    // Production forces useWorker=false in test env; this regression test
    // exercises the worker FATAL-drain path, so re-enable the worker.
    (encryptionService as unknown as { useWorker: boolean }).useWorker = true;

    expect(workerInstances.length).toBe(1);
    const worker = workerInstances[0];

    // Queue three heterogeneous in-flight operations. With no auto-respond
    // the pendingRequests map holds all three entries until the FATAL fires.
    const promiseEncrypt = encryptionService.encrypt("payload-A", "pw-A");
    const promiseDecrypt = encryptionService.decrypt(
      "v4:placeholder-ciphertext",
      "pw-B",
    );
    const promiseDbKey = encryptionService.deriveDbKey("pw-C", "salt-X");

    await new Promise((r) => setTimeout(r, 0));
    expect(worker!.posted.length).toBe(3);

    // Allow pendingRequests to settle
    await new Promise((r) => setTimeout(r, 0));

    // Drive the FATAL message manually.
    worker!.onmessage!({
      data: {
        type: "FATAL_WORKER_ERROR",
        error: "Synthetic-boom-from-test",
      },
    });

    // CONTRACT 1: every in-flight request must be rejected (the FATAL path
    // iterates pendingRequests and rejects each pending Promise).
    expect(await captureRejection(promiseEncrypt)).toBeInstanceOf(Error);
    expect(await captureRejection(promiseDecrypt)).toBeInstanceOf(Error);
    expect(await captureRejection(promiseDbKey)).toBeInstanceOf(Error);

    // CONTRACT 2: pendingRequests is empty after the drain.
    // (Accessing the private field via `any` is intentional — the drain
    // contract is what we are verifying.)
    const pendingSize = (
      encryptionService as unknown as {
        pendingRequests: Map<string, unknown>;
      }
    ).pendingRequests.size;
    expect(pendingSize).toBe(0);

    // CONTRACT 3: terminate is called exactly once on the same worker
    // instance — no implicit respawn within the singleton.
    expect(worker!.terminateCalls).toBe(1);

    // CONTRACT 4: subsequent operations on the singleton fail loudly
    // because the worker reference is now null.
    expect(
      await captureRejection(encryptionService.encrypt("after-fatal", "pw")),
    ).toBeInstanceOf(Error);
  });

  it("does NOT drain pending requests on a NON-FATAL worker reply (negative control)", async () => {
    const { encryptionService } =
      await import("../../services/EncryptionService");
    (encryptionService as unknown as { useWorker: boolean }).useWorker = true;
    const worker = workerInstances[0];

    const promise = encryptionService.encrypt("payload", "pw");
    await new Promise((r) => setTimeout(r, 0));
    expect(worker!.posted.length).toBe(1);

    // Reply with a regular { id, error } — non-FATAL. The handler should
    // look the id up, reject its specific pending request, and otherwise
    // leave the worker alone (no drain, no termination).
    worker!.onmessage!({
      data: { id: worker!.posted[0]!.id, error: "operation failed" },
    });

    expect(await captureRejection(promise)).toBeInstanceOf(Error);

    // CONTRACT 3 (negative): no termination triggered.
    expect(worker!.terminateCalls).toBe(0);

    // CONTRACT 4 (negative): pendingRequests is empty, NOT because of a
    // drain, but because the single matching entry was rejected and removed.
    const pendingSize = (
      encryptionService as unknown as {
        pendingRequests: Map<string, unknown>;
      }
    ).pendingRequests.size;
    expect(pendingSize).toBe(0);

    // CONTRACT 5 (negative): a subsequent encrypt posted at a fresh id
    // should still be deliverable — proves the worker was not torn down.
    const followup = encryptionService.encrypt("after-error", "pw");
    await new Promise((r) => setTimeout(r, 0));
    worker!.onmessage!({
      data: { id: worker!.posted[1]!.id, result: "v4:delivered" },
    });
    await expect(followup).resolves.toBe("v4:delivered");
  });
});
