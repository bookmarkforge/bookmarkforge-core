import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor, screen, fireEvent } from "@testing-library/react";
import React from "react";

// t() mock that interpolates {{params}} into the default/fallback string so
// assertions can check real rendered text ("2 GB/10 GB", "75%") instead of
// raw keys. Keys without a default stay as the key itself.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (
      key: string,
      defaultOrOptions?: unknown,
      options?: Record<string, string | number>,
    ) => {
      let def: string | null = null;
      let opts: Record<string, string | number> | undefined = options;
      if (typeof defaultOrOptions === "string") {
        def = defaultOrOptions;
      } else if (
        defaultOrOptions &&
        typeof defaultOrOptions === "object"
      ) {
        opts = defaultOrOptions as Record<string, string | number>;
      }
      let out = def ?? key;
      if (opts) {
        for (const [k, v] of Object.entries(opts)) {
          out = out.replace(new RegExp(`{{\\s*${k}\\s*}}`), String(v));
        }
      }
      return out;
    },
  }),
}));

const mockUseRxQuery = vi.fn().mockReturnValue({ result: 0 });
vi.mock("../../hooks/useRxDB", () => ({
  useRxCollection: () => null,
  useRxQuery: mockUseRxQuery,
}));
// Free-tier meter state — mutated per test (mock-prefixed so the vi.mock
// factory may close over it).
const mockFreeTierUsage = {
  count: undefined as number | undefined,
  limit: 1000,
  atWall: false,
  nearWall: false,
  isFree: false,
};
vi.mock("../../hooks/useFreeTierUsage", () => ({
  useFreeTierUsage: () => mockFreeTierUsage,
}));
vi.mock("../../services/pro-access", () => ({
  // The component resolves BackupService through the pro-access loader, so
  // the double is installed at the loader instead of at the Pro module.
  loadBackupService: () => Promise.resolve(BackupServiceDouble),
}));
const BackupServiceDouble = {
  getAutoBackupInfo: vi.fn(),
  getDiskBackupInfo: () => ({ method: null, timestamp: null, error: null }),
};
vi.mock("../../store/safeStorage", () => ({
  safeGet: vi.fn(() => null),
  safeSet: vi.fn(),
}));
vi.mock("../../components/dashboard/components/StorageCleanupDialog", () => ({
  StorageCleanupDialog: ({ open, onClose, usageLabel }: any) =>
    open ? (
      <div data-testid="storage-cleanup-dialog">
        <span>{usageLabel}</span>
        <button data-testid="cleanup-close" onClick={onClose}>
          close
        </button>
      </div>
    ) : null,
}));

const { loadBackupService } = await import("../../services/pro-access");
const BackupService = await loadBackupService();
const { safeGet } = await import("../../store/safeStorage");
const { StorageStatus, getStorageHealthLevel, compactAge, BACKUP_REFRESH_INTERVAL_MS, BACKUP_STALE_MS } = await import(
  "../../components/StorageStatus"
);

/** Stub navigator.storage.estimate for one test (absent by default). */
function stubEstimate(estimate: { usage: number; quota: number }) {
  Object.defineProperty(navigator, "storage", {
    configurable: true,
    value: {
      estimate: vi.fn().mockResolvedValue(estimate),
    },
  });
}

describe("StorageStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseRxQuery.mockReturnValue({ result: 0 });
    Object.assign(mockFreeTierUsage, {
      count: undefined,
      limit: 1000,
      atWall: false,
      nearWall: false,
      isFree: false,
    });
    (BackupService.getAutoBackupInfo as any).mockResolvedValue({
      available: false,
    });
    (safeGet as any).mockReturnValue(null);
    // No StorageManager by default — the quota path must degrade silently.
    Object.defineProperty(navigator, "storage", {
      configurable: true,
      value: undefined,
    });
  });

  it("renders without collections", () => {
    const { container } = render(<StorageStatus />);
    expect(container.textContent).toContain("app_rxdbReady");
  });

  it("uses 0 fallback when docsCount is not a number", () => {
    mockUseRxQuery.mockReturnValueOnce({ result: "string-val" as any });
    mockUseRxQuery.mockReturnValueOnce({ result: 5 });
    const { container } = render(<StorageStatus />);
    expect(container.textContent).toContain("5");
  });

  it("uses 0 fallback when bookmarksCount is not a number", () => {
    mockUseRxQuery.mockReturnValueOnce({ result: 3 });
    mockUseRxQuery.mockReturnValueOnce({ result: null });
    const { container } = render(<StorageStatus />);
    expect(container.textContent).toContain("3");
  });

  it("suma documentos y bookmarks", () => {
    mockUseRxQuery.mockReturnValueOnce({ result: 3 });
    mockUseRxQuery.mockReturnValueOnce({ result: 5 });
    const { container } = render(<StorageStatus />);
    expect(container.textContent).toContain("8");
  });

  it("shows quota usage when storage.estimate is available", async () => {
    stubEstimate({
      usage: 2 * 1024 * 1024 * 1024,
      quota: 10 * 1024 * 1024 * 1024,
    });
    const { container } = render(<StorageStatus />);
    await waitFor(() => expect(container.textContent).toContain("2 GB/10 GB"));
  });

  it("escalates to caution at 70%+ quota usage with an alert icon", async () => {
    // 75/100 GB = 75% — safely inside the caution band.
    stubEstimate({
      usage: 75 * 1024 * 1024 * 1024,
      quota: 100 * 1024 * 1024 * 1024,
    });
    const { container } = render(<StorageStatus />);
    await waitFor(() => expect(container.textContent).toContain("75%"));
    expect(container.querySelector(".lucide-triangle-alert")).toBeTruthy();
    expect(
      container.querySelector('[title*="consider exporting"]'),
    ).toBeTruthy();
  });

  it("flags a critical level at 95%+ quota usage", async () => {
    stubEstimate({
      usage: 96 * 1024 * 1024 * 1024,
      quota: 100 * 1024 * 1024 * 1024,
    });
    const { container } = render(<StorageStatus />);
    await waitFor(() => expect(container.textContent).toContain("96%"));
    expect(
      container.querySelector('[title*="free space or export now"]'),
    ).toBeTruthy();
  });

  it("flags a stale backup older than 48 hours", async () => {
    (BackupService.getAutoBackupInfo as any).mockResolvedValue({
      available: true,
      age: 60 * 60 * 60 * 1000, // 60 h > 48 h
    });
    mockUseRxQuery.mockReturnValue({ result: 5 });
    const { container } = render(<StorageStatus />);
    await waitFor(() =>
      expect(container.textContent).toContain("Backup 2d"),
    );
    expect(
      container.querySelector('[title*="No backup in over 48 hours"]'),
    ).toBeTruthy();
  });

  it("warns when the vault has items but no backup yet", async () => {
    (BackupService.getAutoBackupInfo as any).mockResolvedValue({
      available: false,
    });
    mockUseRxQuery.mockReturnValue({ result: 3 });
    const { container } = render(<StorageStatus />);
    await waitFor(() =>
      expect(
        container.querySelector('[title*="export one to protect"]'),
      ).toBeTruthy(),
    );
    expect(container.querySelector(".lucide-triangle-alert")).toBeTruthy();
  });

  it("stays normal with a recent backup and low usage", async () => {
    stubEstimate({
      usage: 1 * 1024 * 1024 * 1024,
      quota: 100 * 1024 * 1024 * 1024,
    });
    (BackupService.getAutoBackupInfo as any).mockResolvedValue({
      available: true,
      age: 5 * 60 * 60 * 1000, // 5 h — fresh
    });
    mockUseRxQuery.mockReturnValue({ result: 2 });
    const { container } = render(<StorageStatus />);
    // Wait until the async backup-age check has settled, then assert no
    // warning surface appeared.
    await waitFor(() =>
      expect(
        container.querySelector('[title*="Internal copy: 5h"]'),
      ).toBeTruthy(),
    );
    expect(container.querySelector(".lucide-triangle-alert")).toBeNull();
    expect(
      container.querySelector('[title*="consider exporting"]'),
    ).toBeNull();
    expect(
      container.querySelector('[title*="free space or export now"]'),
    ).toBeNull();
    expect(
      container.querySelector('[title*="No backup in over 48 hours"]'),
    ).toBeNull();
  });

  it("shows the free up space action at 95%+ and opens the cleanup dialog", async () => {
    stubEstimate({
      usage: 96 * 1024 * 1024 * 1024,
      quota: 100 * 1024 * 1024 * 1024,
    });
    render(<StorageStatus />);
    await waitFor(() =>
      expect(screen.getByText("Free up space")).toBeTruthy(),
    );
    fireEvent.click(screen.getByText("Free up space"));
    expect(screen.getByTestId("storage-cleanup-dialog")).toBeTruthy();
  });

  it("passes the usage label to the cleanup dialog", async () => {
    stubEstimate({
      usage: 96 * 1024 * 1024 * 1024,
      quota: 100 * 1024 * 1024 * 1024,
    });
    render(<StorageStatus />);
    await waitFor(() =>
      expect(screen.getByText("Free up space")).toBeTruthy(),
    );
    fireEvent.click(screen.getByText("Free up space"));
    expect(screen.getByText("96 GB")).toBeTruthy();
  });

  it("does not show the free up space action below the critical threshold", async () => {
    stubEstimate({
      usage: 75 * 1024 * 1024 * 1024,
      quota: 100 * 1024 * 1024 * 1024,
    });
    const { container } = render(<StorageStatus />);
    await waitFor(() => expect(container.textContent).toContain("75%"));
    expect(screen.queryByText("Free up space")).toBeNull();
  });

  it("getStorageHealthLevel maps thresholds to levels", () => {
    expect(getStorageHealthLevel(null)).toBe("normal");
    expect(getStorageHealthLevel(0)).toBe("normal");
    expect(getStorageHealthLevel(69.9)).toBe("normal");
    expect(getStorageHealthLevel(70)).toBe("caution");
    expect(getStorageHealthLevel(84.9)).toBe("caution");
    expect(getStorageHealthLevel(85)).toBe("warning");
    expect(getStorageHealthLevel(94.9)).toBe("warning");
    expect(getStorageHealthLevel(95)).toBe("critical");
    expect(getStorageHealthLevel(100)).toBe("critical");
  });

  it("compactAge formats minutes, hours and days", () => {
    expect(compactAge(45 * 60_000)).toBe("45m");
    expect(compactAge(5 * 3_600_000)).toBe("5h");
    expect(compactAge(60 * 3_600_000)).toBe("2d");
    expect(compactAge(10 * 60_000)).toBe("10m");
  });

  it("BACKUP_REFRESH_INTERVAL_MS is 60 seconds", () => {
    expect(BACKUP_REFRESH_INTERVAL_MS).toBe(60_000);
  });

  it("BACKUP_STALE_MS is 48 hours", () => {
    expect(BACKUP_STALE_MS).toBe(48 * 60 * 60 * 1000);
  });

  it("shows the free-tier meter only when Free and within 10% of the wall", () => {
    // Below threshold: no meter segment.
    Object.assign(mockFreeTierUsage, {
      count: 500, limit: 1000, atWall: false, nearWall: false, isFree: true,
    });
    const below = render(<StorageStatus />);
    expect(below.container.textContent).not.toContain("app_freeMeterLine");
    below.unmount();

    // ≥900: meter segment appears (interpolated count/limit text is
    // covered in FreeTierNudge.test; this suite's t() has no dictionary).
    Object.assign(mockFreeTierUsage, {
      count: 950, limit: 1000, atWall: false, nearWall: true, isFree: true,
    });
    const near = render(<StorageStatus />);
    expect(near.container.textContent).toContain("app_freeMeterLine");
    near.unmount();
  });

  it("never shows the free-tier meter for Pro users", () => {
    Object.assign(mockFreeTierUsage, {
      count: 5000, limit: 1000, atWall: true, nearWall: true, isFree: false,
    });
    const { container } = render(<StorageStatus />);
    expect(container.textContent).not.toContain("app_freeMeterLine");
  });
});
