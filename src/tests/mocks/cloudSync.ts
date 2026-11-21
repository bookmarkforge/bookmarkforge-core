import { vi } from "vitest";

export type CloudProvider =
  "drive" | "dropbox" | "onedrive" | "box" | "pcloud" | "webdav";

export interface CloudProviderAdapter {
  provider: CloudProvider;
  connected: boolean;
  connect: () => Promise<boolean>;
  disconnect: () => Promise<boolean>;
  listFiles: () => Promise<unknown[]>;
  uploadFile: (file: unknown) => Promise<{ id: string; name: string }>;
  downloadFile: (fileId: string) => Promise<ArrayBuffer>;
  deleteFile: (fileId: string) => Promise<boolean>;
  createFolder: (name: string) => Promise<{ id: string; name: string }>;
  getMetadata: (fileId: string) => Promise<{ size: number; modified: number }>;
  search: (query: string) => Promise<unknown[]>;
  getShareLink: (fileId: string) => Promise<string>;
  getUsedStorage: () => Promise<{ used: number; total: number }>;
  getUserInfo: () => Promise<{ email: string; name: string }>;
}

export interface CloudSyncConfig {
  provider: CloudProvider;
  authToken?: string;
  refreshToken?: string;
  endpoint?: string;
}

interface CloudProviderInfo {
  name: string;
  authType: "oauth2" | "apiKey" | "basic";
  maxFileSize: number;
}

export const mockCloudProviders: Record<CloudProvider, CloudProviderInfo> = {
  drive: {
    name: "Google Drive",
    authType: "oauth2",
    maxFileSize: 15 * 1024 * 1024 * 1024,
  },
  dropbox: {
    name: "Dropbox",
    authType: "oauth2",
    maxFileSize: 2 * 1024 * 1024 * 1024,
  },
  onedrive: {
    name: "OneDrive",
    authType: "oauth2",
    maxFileSize: 100 * 1024 * 1024 * 1024,
  },
  box: {
    name: "Box",
    authType: "oauth2",
    maxFileSize: 5 * 1024 * 1024 * 1024,
  },
  pcloud: {
    name: "pCloud",
    authType: "oauth2",
    maxFileSize: 10 * 1024 * 1024 * 1024,
  },
  webdav: {
    name: "WebDAV",
    authType: "basic",
    maxFileSize: 1024 * 1024 * 1024,
  },
};

export const createMockCloudAdapter = (
  provider: CloudProvider,
): CloudProviderAdapter => ({
  provider,
  connected: true,
  connect: vi.fn().mockResolvedValue(true),
  disconnect: vi.fn().mockResolvedValue(true),
  listFiles: vi.fn().mockResolvedValue([]),
  uploadFile: vi
    .fn()
    .mockResolvedValue({ id: "mock-file-id", name: "file.txt" }),
  downloadFile: vi.fn().mockResolvedValue(new ArrayBuffer(1024)),
  deleteFile: vi.fn().mockResolvedValue(true),
  createFolder: vi
    .fn()
    .mockResolvedValue({ id: "mock-folder-id", name: "folder" }),
  getMetadata: vi.fn().mockResolvedValue({ size: 1024, modified: Date.now() }),
  search: vi.fn().mockResolvedValue([]),
  getShareLink: vi.fn().mockResolvedValue("https://share.test/file"),
  getUsedStorage: vi
    .fn()
    .mockResolvedValue({ used: 1024 * 1024, total: 10 * 1024 * 1024 * 1024 }),
  getUserInfo: vi
    .fn()
    .mockResolvedValue({ email: "test@test.com", name: "Test User" }),
});

export const createCloudSyncMocks = () => {
  vi.mock("../services/integrations/cloudSync", async () => {
    const { vi } = await import("vitest");

    return {
      CloudProvider: {
        GOOGLE_DRIVE: "drive",
        DROPBOX: "dropbox",
        ONEDRIVE: "onedrive",
        BOX: "box",
        PCLOUD: "pcloud",
        S3: "s3",
        WEBDAV: "webdav",
      },

      createAdapter: vi
        .fn()
        .mockImplementation((provider: CloudProvider) =>
          createMockCloudAdapter(provider),
        ),

      CloudSyncService: vi.fn().mockImplementation(() => ({
        providers: new Map(Object.entries(mockCloudProviders)),
        currentProvider: null,
        syncInProgress: false,

        setProvider: vi.fn(),
        listFiles: vi.fn().mockResolvedValue([]),
        uploadFile: vi
          .fn()
          .mockResolvedValue({ success: true, syncedItems: ["file-id"] }),
        downloadFile: vi.fn().mockResolvedValue({ success: true }),
        deleteFile: vi.fn().mockResolvedValue({ success: true }),
        createFolder: vi.fn().mockResolvedValue({ success: true }),
        sync: vi.fn().mockResolvedValue({ success: true, syncedItems: [] }),
        getSyncStatus: vi.fn().mockResolvedValue({
          inProgress: false,
          lastSync: Date.now(),
          pendingItems: 0,
        }),
        resolveConflict: vi.fn().mockResolvedValue({ resolved: {} }),
      })),

      __esModule: true,
    };
  });
};

export const setupCloudSyncMocks = () => {
  createCloudSyncMocks();
};

export const mockCloudConfig: CloudSyncConfig = {
  provider: "drive",
  authToken: "mock-token",
  refreshToken: "mock-refresh-token",
  endpoint: "https://mock.test",
};
