import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";

const mockToast = { warning: vi.fn() };
const mockAgentService = { clearCache: vi.fn() };
const mockInitDB = vi.fn();
const mockNotificationService = { scheduleSRSNotification: vi.fn() };
const mockAutoProcessor = { start: vi.fn(), stop: vi.fn() };

vi.mock("sonner", () => ({ toast: mockToast }));
vi.mock("../../db/database", () => ({ initDB: mockInitDB }));
vi.mock("../../services/NotificationService", () => ({
  notificationService: mockNotificationService,
}));
vi.mock("../../services/ai/AgentService", () => ({
  agentService: mockAgentService,
}));
vi.mock("../../services/ai/AutoProcessorService", () => ({
  autoProcessorService: mockAutoProcessor,
}));
vi.mock("../../utils/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

describe("useAppLifecycle", () => {
  let useAppLifecycle: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("../../hooks/useAppLifecycle");
    useAppLifecycle = mod.useAppLifecycle;
  });

  it("should show warning and clear cache when under pressure", () => {
    renderHook(() => useAppLifecycle(true, (s: string) => s));
    expect(mockToast.warning).toHaveBeenCalledWith(
      "app_memoryPressureCritical",
    );
    expect(mockAgentService.clearCache).toHaveBeenCalled();
  });

  it("should not show warning when not under pressure", () => {
    renderHook(() => useAppLifecycle(false, (s: string) => s));
    expect(mockToast.warning).not.toHaveBeenCalled();
  });

  it("should check due cards on mount", async () => {
    const execMock = vi.fn().mockResolvedValue([{ id: "1" }, { id: "2" }]);
    mockInitDB.mockResolvedValue({
      flashcards: {
        find: vi.fn().mockReturnValue({
          limit: vi.fn().mockReturnValue({ exec: execMock }),
        }),
      },
    });

    renderHook(() => useAppLifecycle(false, (s: string) => s));
    await vi.waitFor(() => {
      expect(
        mockNotificationService.scheduleSRSNotification,
      ).toHaveBeenCalledWith(2);
    });
  });

  it("should start autoProcessor on mount and stop on unmount", () => {
    const { unmount } = renderHook(() =>
      useAppLifecycle(false, (s: string) => s),
    );
    expect(mockAutoProcessor.start).toHaveBeenCalled();

    unmount();
    expect(mockAutoProcessor.stop).toHaveBeenCalled();
  });

  it("should set interval to check due cards", () => {
    const setIntervalSpy = vi.spyOn(global, "setInterval");
    renderHook(() => useAppLifecycle(false, (s: string) => s));
    expect(setIntervalSpy).toHaveBeenCalled();
    setIntervalSpy.mockRestore();
  });

  it("should not schedule notification when no due cards", async () => {
    const execMock = vi.fn().mockResolvedValue([]);
    mockInitDB.mockResolvedValue({
      flashcards: {
        find: vi.fn().mockReturnValue({
          limit: vi.fn().mockReturnValue({ exec: execMock }),
        }),
      },
    });

    renderHook(() => useAppLifecycle(false, (s: string) => s));
    await vi.waitFor(() => {
      expect(
        mockNotificationService.scheduleSRSNotification,
      ).not.toHaveBeenCalled();
    });
  });

  it("should contain notification failures in the background loop", async () => {
    const execMock = vi.fn().mockResolvedValue([{ id: "1" }]);
    mockInitDB.mockResolvedValue({
      flashcards: {
        find: vi.fn().mockReturnValue({
          limit: vi.fn().mockReturnValue({ exec: execMock }),
        }),
      },
    });
    mockNotificationService.scheduleSRSNotification.mockRejectedValueOnce(
      new Error("notification unavailable"),
    );
    const { logger } = await import("../../utils/logger");

    renderHook(() => useAppLifecycle(false, (s: string) => s));
    await vi.waitFor(() => {
      expect(logger.warn).toHaveBeenCalledWith(
        "[useAppLifecycle] SRS notification failed",
        expect.objectContaining({ error: expect.anything() }),
      );
    });
  });

  it("should log error when initDB fails", async () => {
    const { logger } = await import("../../utils/logger");
    const testError = new Error("Database connection failed");
    mockInitDB.mockRejectedValue(testError);

    renderHook(() => useAppLifecycle(false, (s: string) => s));

    await vi.waitFor(() => {
      expect(logger.error).toHaveBeenCalledWith(
        "[useAppLifecycle] Error in background SRS check",
        expect.objectContaining({
          error: expect.objectContaining({
            name: "Error",
            message: "Database connection failed",
          }),
        }),
      );
    });
  });
});
