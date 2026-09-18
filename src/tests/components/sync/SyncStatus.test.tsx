import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  waitFor,
  fireEvent,
  act,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

vi.mock("react-i18next", () => {
  const t = (key: string, options?: any) =>
    typeof options === "string" ? options : options?.defaultValue || key;
  return {
    useTranslation: () => ({ t, i18n: { language: "en" } }),
    initReactI18next: { type: "3rdParty", init: vi.fn() },
  };
});

vi.mock("lucide-react", () => {
  const mock = (name: string) => {
    const Icon = (props: any) => (
      <svg data-testid={`icon-${name}`} {...props} />
    );
    Icon.displayName = name;
    return Icon;
  };
  return {
    Wifi: mock("Wifi"),
    WifiOff: mock("WifiOff"),
    RefreshCw: mock("RefreshCw"),
    Loader2: mock("Loader2"),
    Cloud: mock("Cloud"),
  };
});

vi.mock("motion/react", async () => {
  const { createMotionMock } = await import("../../mocks/motion");
  return createMotionMock();
});

vi.mock("../../../utils/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn() },
}));

vi.mock("../../../db/database", () => ({
  initDB: vi.fn().mockResolvedValue({/* fake db */}),
}));

vi.mock("../../../services/SyncService", () => ({
  syncService: (globalThis as any).__syncMock,
}));

vi.mock("../../../services/LicenseService", () => ({
  licenseService: {
    hasProAccess: vi.fn().mockReturnValue(true),
  },
}));

(globalThis as any).__syncMock = {
  isSyncing: false,
  currentRoomId: null,
  connectedPeers: 0,
  syncHealth: "disconnected",
  lastSyncTime: null,
  onSyncStateChange: null,
  restartSync: vi.fn().mockResolvedValue(undefined),
  startP2PSync: vi.fn().mockResolvedValue(undefined),
};

function setMock(props: Record<string, any>) {
  Object.assign((globalThis as any).__syncMock, props);
}

async function renderSyncStatus() {
  return render(React.createElement(SyncStatusForTest));
}

let SyncStatusForTest: React.FC;

describe("SyncStatus", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    // Re-seed the default Pro license mock after clearAllMocks.
    const licenseMock = (await import("../../../services/LicenseService"))
      .licenseService as any;
    (licenseMock.hasProAccess as any).mockReturnValue(true);
    localStorage.setItem("bf_trial_started_at", String(Date.now()));
    setMock({
      isSyncing: false,
      currentRoomId: null,
      syncHealth: "disconnected",
      lastSyncTime: null,
      onSyncStateChange: null,
      restartSync: vi.fn().mockResolvedValue(undefined),
      startP2PSync: vi.fn().mockResolvedValue(undefined),
    });
    const mod = await import("../../../components/sync/SyncStatus");
    SyncStatusForTest = mod.SyncStatus;
  });

  it("renders the sync status badge", async () => {
    await renderSyncStatus();
    expect(screen.getByTitle("app_syncNow")).toBeTruthy();
  });

  it("shows inactive state initially", async () => {
    await renderSyncStatus();
    expect(screen.getByText("app_syncInactive")).toBeTruthy();
  });

  it("disables refresh button when clicked", async () => {
    await renderSyncStatus();
    await userEvent.click(screen.getByTitle("app_syncNow"));
    await waitFor(() => {
      expect(screen.getByTitle("app_syncNow")).toBeDisabled();
    });
  });

  it("shows loading spinner while restarting", async () => {
    await renderSyncStatus();
    await userEvent.click(screen.getByTitle("app_syncNow"));
    await waitFor(() => {
      expect(screen.getByTestId("icon-Loader2")).toBeTruthy();
    });
  });

  it("shows healthy syncing state with Wifi icon", async () => {
    setMock({
      isSyncing: true,
      syncHealth: "healthy",
      lastSyncTime: Date.now(),
    });
    await renderSyncStatus();
    await waitFor(() => {
      expect(screen.getByTestId("icon-Wifi")).toBeTruthy();
    });
    // Real default string (not the i18n key) — what users actually see.
    expect(screen.getByText("E2EE Sync Active")).toBeTruthy();
  });

  it("shows connecting state with Cloud icon", async () => {
    setMock({ syncHealth: "connecting", currentRoomId: "room-abc-123" });
    await renderSyncStatus();
    await waitFor(() => {
      expect(screen.getByTestId("icon-Cloud")).toBeTruthy();
    });
    expect(screen.getByText("app_syncConnecting")).toBeTruthy();
  });

  it("shows error state text", async () => {
    setMock({ syncHealth: "error" });
    await renderSyncStatus();
    await waitFor(() => {
      expect(screen.getByText("app_syncErrorStatus")).toBeTruthy();
    });
  });

  it("shows last sync just now", async () => {
    setMock({ lastSyncTime: Date.now() - 30000 });
    await renderSyncStatus();
    await waitFor(() => {
      expect(screen.getByText("app_syncJustNow")).toBeTruthy();
    });
  });

  it("shows minutes ago for older last sync", async () => {
    setMock({ lastSyncTime: Date.now() - 120000 });
    await renderSyncStatus();
    await waitFor(() => {
      expect(screen.getByText("app_syncMinutesAgo")).toBeTruthy();
    });
  });

  it("starts P2P sync on restart when no room is active", async () => {
    setMock({ currentRoomId: null });
    await renderSyncStatus();
    await userEvent.click(screen.getByTitle("app_syncNow"));
    await waitFor(() => {
      expect((globalThis as any).__syncMock.startP2PSync).toHaveBeenCalled();
      expect((globalThis as any).__syncMock.restartSync).not.toHaveBeenCalled();
    });
  });

  it("blocks P2P sync on Free (no license, no trial)", async () => {
    localStorage.removeItem("bf_trial_started_at");
    // Override the default Pro mock to simulate Free tier.
    const licenseMock = (await import("../../../services/LicenseService"))
      .licenseService as any;
    (licenseMock.hasProAccess as any).mockReturnValue(false);
    setMock({ currentRoomId: null });
    await renderSyncStatus();
    await userEvent.click(screen.getByTitle("app_syncNow"));
    await waitFor(() => {
      expect((globalThis as any).__syncMock.startP2PSync).not.toHaveBeenCalled();
      expect((globalThis as any).__syncMock.restartSync).not.toHaveBeenCalled();
    });
  });

  it("restarts existing sync when a room is active", async () => {
    setMock({ currentRoomId: "room-abc-123" });
    await renderSyncStatus();
    await userEvent.click(screen.getByTitle("app_syncNow"));
    await waitFor(() => {
      expect((globalThis as any).__syncMock.restartSync).toHaveBeenCalled();
      expect((globalThis as any).__syncMock.startP2PSync).not.toHaveBeenCalled();
    });
  });

  it("handles restart error gracefully (button re-enables)", async () => {
    setMock({ restartSync: vi.fn().mockRejectedValue(new Error("fail")) });
    await renderSyncStatus();
    await userEvent.click(screen.getByTitle("app_syncNow"));
    await waitFor(
      () => {
        expect(screen.getByTitle("app_syncNow")).not.toBeDisabled();
      },
      { timeout: 3000 },
    );
  });

  it("cleanly unmounts without errors", async () => {
    const { unmount } = await renderSyncStatus();
    expect(() => unmount()).not.toThrow();
  });

  it("unmount during a pending restart clears the timer", async () => {
    vi.useFakeTimers();
    try {
      setMock({
        currentRoomId: "room-abc-123",
        restartSync: vi.fn().mockResolvedValue(undefined),
      });
      const { unmount } = render(React.createElement(SyncStatusForTest));
      fireEvent.click(screen.getByTitle("app_syncNow"));
      // Flush initDB + restartSync so the 1s reset timer gets scheduled.
      await act(async () => {});
      unmount();
      // Advancing past the timer must not throw nor touch state.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      expect((globalThis as any).__syncMock.restartSync).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
