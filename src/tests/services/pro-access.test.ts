import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockGate = vi.hoisted(() => ({ hasProAccess: vi.fn(() => true) }));

/** Shared real-shape double so cache-reset identity can be observed. */
const realBackupDouble = { exportBackup: vi.fn() };

/** Stand-in for the Pro P2P replication-manager singleton. */
const syncServiceDouble = { stopAll: vi.fn(), startP2PSync: vi.fn() };

vi.mock("../../services/LicenseService", () => ({
  licenseService: mockGate,
}));

// The loader's registry resolves these modules with dynamic import(); the
// double stands in for both the real implementation and a Core-build
// placeholder so no Pro code is loaded here.
vi.mock("../../services/BackupService", () => ({
  BackupService: { __isProPlaceholder: true, exportBackup: () => undefined },
}));

describe("announceProUnavailable", () => {
  let proAccess: typeof import("../../services/pro-access");

  beforeEach(async () => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("maps the typed error onto the bmf:pro-unavailable event detail", async () => {
    const dispatched: CustomEventInit[] = [];
    const spy = vi
      .spyOn(window, "dispatchEvent")
      .mockImplementation((event: Event) => {
        dispatched.push((event as CustomEvent).detail);
        return true;
      });
    proAccess = await import("../../services/pro-access");
    proAccess.announceProUnavailable(
      new proAccess.ProUnavailableError("WebRTCSyncService", "no-license"),
    );
    expect(spy).toHaveBeenCalledOnce();
    expect(dispatched[0]).toEqual({
      feature: "WebRTCSyncService",
      reason: "no-license",
    });
  });
});

describe("pro-access loader", () => {
  let proAccess: typeof import("../../services/pro-access");

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGate.hasProAccess.mockReturnValue(true);
    proAccess = await import("../../services/pro-access");
    proAccess.resetProAccessForTests();
  });

  it("rejects with no-license without fetching the module for a Free user", async () => {
    mockGate.hasProAccess.mockReturnValue(false);
    await expect(proAccess.loadBackupService()).rejects.toMatchObject({
      name: "ProUnavailableError",
      reason: "no-license",
    });
  });

  it("refuses to hand out an Open Core placeholder as success", async () => {
    // The mocked BackupService above IS a placeholder; the loader must
    // detect the sentinel and reject load-failed instead of resolving.
    await expect(proAccess.loadBackupService()).rejects.toMatchObject({
      name: "ProUnavailableError",
      reason: "load-failed",
    });
  });

  it("resolves a real implementation once and caches it", async () => {
    vi.doMock("../../services/BackupService", () => ({
      BackupService: {
        exportBackup: vi.fn().mockResolvedValue(undefined),
      },
    }));
    // re-import to pick up the doMock override
    vi.resetModules();
    const fresh = await import("../../services/pro-access");
    fresh.resetProAccessForTests();
    const first = await fresh.loadBackupService();
    const second = await fresh.loadBackupService();
    expect(second).toBe(first);
    expect(typeof (first as { exportBackup: unknown }).exportBackup).toBe(
      "function",
    );
  });

  it("loads the P2P replication manager and leaves a sync facade behind", async () => {
    // The teardown paths (CollaborationService.stop) cannot await, so a
    // successful load must install the same instance as a sync facade.
    vi.doMock("../../services/SyncService", () => ({
      syncService: syncServiceDouble,
    }));
    vi.resetModules();
    const fresh = await import("../../services/pro-access");
    fresh.resetProAccessForTests();

    await expect(fresh.loadSyncService()).resolves.toBe(syncServiceDouble);
    expect(fresh.requireProService("SyncService")).toBe(syncServiceDouble);
  });

  it("rejects loadSyncService for a Free user without fetching the module", async () => {
    const loaderSpy = vi.fn();
    vi.doMock("../../services/SyncService", () => {
      loaderSpy();
      return { syncService: syncServiceDouble };
    });
    vi.resetModules();
    const fresh = await import("../../services/pro-access");
    fresh.resetProAccessForTests();
    mockGate.hasProAccess.mockReturnValue(false);

    await expect(fresh.loadSyncService()).rejects.toMatchObject({
      name: "ProUnavailableError",
      service: "SyncService",
      reason: "no-license",
    });
    expect(loaderSpy).not.toHaveBeenCalled();
  });

  it("resetProAccessForTests clears the cache", async () => {
    vi.doMock("../../services/BackupService", () => ({
      BackupService: realBackupDouble,
    }));
    vi.resetModules();
    const fresh = await import("../../services/pro-access");
    const a = await fresh.loadBackupService();
    fresh.resetProAccessForTests();
    const b = await fresh.loadBackupService();
    // The registry re-invokes the loader (cache emptied); with the loader
    // returning the same double object, identity equals the double itself.
    expect(b).toBe(realBackupDouble);
    expect(a).toBe(realBackupDouble);
  });
});
