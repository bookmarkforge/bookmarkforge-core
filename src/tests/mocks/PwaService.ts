import { vi } from "vitest";

export interface PwaConfig {
  themeColor?: string;
  backgroundColor?: string;
  display?: string;
  orientation?: string;
}

export interface PwaStatus {
  registered: boolean;
  active: boolean;
  updateAvailable: boolean;
}

export interface StorageEstimate {
  usage: number;
  quota: number;
  percentUsed: number;
}

export interface CacheEntry {
  name: string;
  size: number;
  pages: number;
}

export const mockStorageEstimate: StorageEstimate = {
  usage: 1024 * 1024 * 10,
  quota: 1024 * 1024 * 100,
  percentUsed: 10,
};

export const mockCacheEntry: CacheEntry = {
  name: "test-cache",
  size: 1024,
  pages: 5,
};

export const createPwaServiceMocks = () => {
  vi.mock("../services/pwa/PwaService", async () => {
    const { vi } = await import("vitest");

    return {
      PwaService: vi.fn().mockImplementation(() => ({
        config: {
          enabled: true,
          autoUpdate: false,
          cacheAssets: true,
          cacheApi: true,
          offlineFallback: true,
          skipWaiting: true,
          periodicSync: false,
        },

        checkForUpdates: vi.fn().mockResolvedValue({ available: false }),
        applyUpdate: vi.fn().mockResolvedValue(undefined),

        register: vi.fn().mockResolvedValue({ active: true }),
        unregister: vi.fn().mockResolvedValue(undefined),

        cacheResource: vi.fn().mockResolvedValue(true),
        getCachedResources: vi.fn().mockResolvedValue([mockCacheEntry]),
        clearCache: vi.fn().mockResolvedValue(undefined),

        registerPeriodicSync: vi.fn().mockResolvedValue(true),
        unregisterPeriodicSync: vi.fn().mockResolvedValue(undefined),

        requestNotificationPermission: vi.fn().mockResolvedValue("granted"),
        showNotification: vi.fn().mockResolvedValue(undefined),

        setBadgeCount: vi.fn().mockResolvedValue(undefined),
        clearBadge: vi.fn().mockResolvedValue(undefined),

        registerShareTarget: vi.fn(),

        getStorageEstimate: vi.fn().mockResolvedValue(mockStorageEstimate),
        requestPersistentStorage: vi.fn().mockResolvedValue(true),

        getStatus: vi.fn().mockReturnValue({
          registered: true,
          updateAvailable: false,
          online: true,
          storageEstimate: mockStorageEstimate,
          backgroundSync: true,
          shareTarget: true,
          badgeCount: 0,
        }),

        getVersion: vi.fn().mockReturnValue("1.0.0"),
        getConfig: vi.fn().mockReturnValue({} as PwaConfig),
        updateConfig: vi.fn(),
      })),

      PwaConfig: vi.fn().mockImplementation((config) => config),
      PwaStatus: vi.fn().mockImplementation((status) => status),
      StorageEstimate: vi.fn().mockImplementation((estimate) => estimate),
      CacheEntry: vi.fn().mockImplementation((entry) => entry),

      defaultPwaConfig: {
        enabled: true,
        autoUpdate: false,
        cacheAssets: true,
        cacheApi: true,
        offlineFallback: true,
        skipWaiting: true,
        periodicSync: false,
      },

      __esModule: true,
    };
  });

  vi.mock("../utils/logger", () => ({
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
  }));
};

export const setupPwaServiceMocks = () => {
  createPwaServiceMocks();
};
