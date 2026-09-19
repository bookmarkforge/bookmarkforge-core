import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { render, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (s: string) => s }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("lucide-react", () => {
  const MockIcon = (props: any) => (
    <svg data-testid={props?.["data-testid"] || "mock-icon"} {...props} />
  );
  MockIcon.displayName = "MockIcon";
  return {
    Cloud: MockIcon,
    Loader2: MockIcon,
    Shield: MockIcon,
    Upload: MockIcon,
    FolderSync: MockIcon,
  };
});
vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
  },
}));
vi.mock("../../../services/integrations/cloudSync", () => ({
  cloudSyncService: {
    init: vi.fn(),
    authenticate: vi.fn().mockResolvedValue(undefined),
    listFiles: vi.fn().mockResolvedValue([]),
    sync: vi.fn().mockResolvedValue({ success: true }),
    downloadFile: vi.fn(),
    // Default to the legacy (no sidecar) path; integrity-specific tests
    // override this per-case.
    verifyRemoteBackup: vi
      .fn()
      .mockResolvedValue({ status: "missing" }),
    setLocalDataProvider: vi.fn(),
  },
  registerLocalBackupProvider: vi.fn(),
  CloudProvider: {},
}));
vi.mock("../../../services/SecurityVault", () => ({
  securityVault: {
    hasSecret: vi.fn().mockResolvedValue(false),
    decryptSecret: vi.fn(),
    encryptSecret: vi.fn().mockResolvedValue(undefined),
    withMasterPasswordBytes: vi.fn(
      (_caller: object, fn: (p: Uint8Array | null) => unknown) => {
        const pw = (globalThis as any).__VAULT_PASSWORD__ ?? "test-password";
        return fn(pw ? new TextEncoder().encode(pw as string) : null);
      },
    ),
    registerCaller: vi.fn(),
    onLock: vi.fn(() => () => {}),
    onUnlock: vi.fn(() => () => {}),
  },
}));
vi.mock("../../../services/BackupService", () => ({
  BackupService: {
    createBackupData: vi.fn().mockResolvedValue({ blob: new Blob() }),
    importBackup: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock(
  "../../../components/settings/ProviderForm/AuthTokenFields",
  () => ({
    AuthTokenFields: ({ authToken, onChange, t }: any) => (
      <input
        data-testid="auth-token-fields"
        aria-label={t?.("authTokenLabel", "Token") || "Token"}
        value={authToken}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
          onChange(e.target.value)
        }
      />
    ),
  }),
);
vi.mock(
  "../../../components/settings/ProviderForm/WebDAVFields",
  () => ({
    WebDAVFields: ({ url, onUrlChange, t }: any) => (
      <div data-testid="webdav-fields">
        {t?.("webdavOption", "WebDAV")}
        <input
          aria-label={t?.("webdavUrlLabel", "WebDAV Server URL")}
          value={url}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            onUrlChange(e.target.value)
          }
        />
      </div>
    ),
  }),
);
vi.mock(
  "../../../components/settings/ProviderForm/RestoreList",
  () => ({
    RestoreList: ({ files, onRestore, t }: any) => (
      <div data-testid="restore-list">
        {files?.length > 0 && (
          <button
            data-testid="restore-btn"
            onClick={() => onRestore?.("file1", "backup.json")}
          >
            Restore
          </button>
        )}
        {t?.("restore", "Restore")}
      </div>
    ),
  }),
);

const { CloudSyncSection } =
  await import("../../../components/settings/CloudSyncSection");

describe("CloudSyncSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("renders section heading", async () => {
    const { findByText } = render(<CloudSyncSection />);
    expect(await findByText("cloudSyncTitle")).toBeTruthy();
  });

  it("renders provider selector", async () => {
    const { findByLabelText } = render(<CloudSyncSection />);
    const select = (await findByLabelText(
      "cloudProviderLabel",
    )) as HTMLSelectElement;
    expect(select.value).toBe("webdav");
  });

  it("renders WebDAV fields by default", () => {
    const { getByTestId } = render(<CloudSyncSection />);
    expect(getByTestId("webdav-fields")).toBeTruthy();
  });

  it("renders test connection button", async () => {
    const { findByText } = render(<CloudSyncSection />);
    expect(await findByText("testConnection")).toBeTruthy();
  });

  it("renders save and sync button", async () => {
    const { findByText } = render(<CloudSyncSection />);
    expect(await findByText("saveAndSync")).toBeTruthy();
  });

  it("renders auto sync toggle", () => {
    const { getByRole } = render(<CloudSyncSection />);
    const toggle = getByRole("switch") as HTMLButtonElement;
    expect(toggle).toBeTruthy();
  });

  it("does not configure a cloud destination by default (opt-in)", async () => {
    const { cloudSyncService } =
      await import("../../../services/integrations/cloudSync");
    const { findByText } = render(<CloudSyncSection />);
    await findByText("cloudSyncTitle");
    expect(cloudSyncService.init).not.toHaveBeenCalled();
  });

  it("renders AuthTokenFields for drive provider", async () => {
    const { findByLabelText, findByTestId } = render(<CloudSyncSection />);
    const select = (await findByLabelText(
      "cloudProviderLabel",
    )) as HTMLSelectElement;
    await userEvent.selectOptions(select, "drive");
    expect(await findByTestId("auth-token-fields")).toBeTruthy();
  });

  it("renders AuthTokenFields for dropbox provider", async () => {
    const { findByLabelText, findByTestId } = render(<CloudSyncSection />);
    const select = (await findByLabelText(
      "cloudProviderLabel",
    )) as HTMLSelectElement;
    await userEvent.selectOptions(select, "dropbox");
    expect(await findByTestId("auth-token-fields")).toBeTruthy();
  });

  it("shows success toast on test connection", async () => {
    const { findByText, findByLabelText } = render(<CloudSyncSection />);
    await userEvent.type(
      await findByLabelText("webdavUrlLabel"),
      "https://cloud.example.test/dav/",
    );
    const btn = await findByText("testConnection");
    await userEvent.click(btn);
    await waitFor(async () => {
      const { cloudSyncService } =
        await import("../../../services/integrations/cloudSync");
      expect(cloudSyncService.authenticate).toHaveBeenCalled();
    });
    const { toast } = await import("sonner");
    expect(toast.success).toHaveBeenCalledWith(
      expect.stringContaining("app_cloudTestSuccess"),
    );
    const { securityVault } = await import("../../../services/SecurityVault");
    expect(securityVault.encryptSecret).toHaveBeenCalled();
  });

  it("rejects an empty WebDAV URL before making a network request", async () => {
    const { cloudSyncService } =
      await import("../../../services/integrations/cloudSync");
    const { toast } = await import("sonner");
    const { findByText, getByTestId } = render(<CloudSyncSection />);
    await userEvent.click(await findByText("testConnection"));
    expect(cloudSyncService.authenticate).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining("app_cloudConfigRequired"),
    );
    expect(getByTestId("cloud-sync-config-error")).toBeTruthy();
  });

  it("shows error toast on test connection failure", async () => {
    const { cloudSyncService } =
      await import("../../../services/integrations/cloudSync");
    cloudSyncService.authenticate = vi
      .fn()
      .mockRejectedValue(new Error("Network error"));
    const { toast } = await import("sonner");
    const { findByText } = render(<CloudSyncSection />);
    const btn = await findByText("testConnection");
    await userEvent.click(btn);
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalled();
    });
  });

  it("rejects an empty token before testing token providers", async () => {
    const { cloudSyncService } =
      await import("../../../services/integrations/cloudSync");
    const { toast } = await import("sonner");
    const { findByLabelText, findByText, getByTestId } = render(<CloudSyncSection />);
    await userEvent.selectOptions(
      await findByLabelText("cloudProviderLabel"),
      "drive",
    );
    await userEvent.click(await findByText("testConnection"));
    expect(cloudSyncService.authenticate).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining("app_cloudTokenRequired"),
    );
    expect(getByTestId("cloud-sync-config-error")).toBeTruthy();
  });

  it("shows generic error on non-Error test failure", async () => {
    const { cloudSyncService } =
      await import("../../../services/integrations/cloudSync");
    cloudSyncService.authenticate = vi.fn().mockRejectedValue("string error");
    const { toast } = await import("sonner");
    const { findByText } = render(<CloudSyncSection />);
    const btn = await findByText("testConnection");
    await userEvent.click(btn);
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalled();
    });
  });

  it("shows success toast on save and sync", async () => {
    const { toast } = await import("sonner");
    const { findByText, findByLabelText } = render(<CloudSyncSection />);
    await userEvent.type(
      await findByLabelText("webdavUrlLabel"),
      "https://cloud.example.test/dav/",
    );
    const btn = await findByText("saveAndSync");
    await userEvent.click(btn);
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalled();
    });
  });

  it("shows error when sync fails", async () => {
    const { cloudSyncService } =
      await import("../../../services/integrations/cloudSync");
    cloudSyncService.sync = vi
      .fn()
      .mockResolvedValue({ success: false, errors: ["sync error"] });
    const { toast } = await import("sonner");
    const { findByText, findByLabelText } = render(<CloudSyncSection />);
    await userEvent.type(
      await findByLabelText("webdavUrlLabel"),
      "https://cloud.example.test/dav/",
    );
    const btn = await findByText("saveAndSync");
    await userEvent.click(btn);
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalled();
    });
  });

  it("shows error when vault is locked during sync", async () => {
    (globalThis as any).__VAULT_PASSWORD__ = null;
    const { toast } = await import("sonner");
    const { findByText, findByLabelText } = render(<CloudSyncSection />);
    await userEvent.type(
      await findByLabelText("webdavUrlLabel"),
      "https://cloud.example.test/dav/",
    );
    const btn = await findByText("saveAndSync");
    await userEvent.click(btn);
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalled();
    });
  });

  it("toggles auto-sync on", async () => {
    const { getByRole } = render(<CloudSyncSection />);
    const toggle = getByRole("switch") as HTMLButtonElement;
    await userEvent.click(toggle);
    expect(localStorage.getItem("forge_auto_sync_cloud")).toBe("true");
    const { toast } = await import("sonner");
    expect(toast.success).toHaveBeenCalledWith(
      expect.stringContaining("app_autoSyncEnabled"),
    );
  });

  it("toggles auto-sync off by clicking twice", async () => {
    const { getByRole } = render(<CloudSyncSection />);
    const toggle = getByRole("switch") as HTMLButtonElement;
    await userEvent.click(toggle);
    expect(localStorage.getItem("forge_auto_sync_cloud")).toBe("true");
    await userEvent.click(toggle);
    expect(localStorage.getItem("forge_auto_sync_cloud")).toBe("false");
  });

  it("loads saved config from vault on mount", async () => {
    const { securityVault } = await import("../../../services/SecurityVault");
    const savedConfig = { provider: "webdav", authToken: "", webdavConfig: { url: "https://cloud.example.test/dav/" } };
    securityVault.hasSecret = vi.fn().mockResolvedValue(true);
    securityVault.decryptSecret = vi
      .fn()
      .mockResolvedValue(JSON.stringify(savedConfig));
    const { findByLabelText } = render(<CloudSyncSection />);
    await waitFor(async () => {
      const select = document.querySelector("select") as HTMLSelectElement;
      expect(select?.value).toBe("webdav");
    });
  });

  it("handles config load error gracefully", async () => {
    const { securityVault } = await import("../../../services/SecurityVault");
    securityVault.hasSecret = vi
      .fn()
      .mockRejectedValue(new Error("Vault error"));
    const { findByText } = render(<CloudSyncSection />);
    expect(await findByText("cloudSyncTitle")).toBeTruthy();
  });

  it("shows AuthTokenFields for onedrive provider", async () => {
    const { findByLabelText, findByTestId } = render(<CloudSyncSection />);
    const select = (await findByLabelText(
      "cloudProviderLabel",
    )) as HTMLSelectElement;
    await userEvent.selectOptions(select, "onedrive");
    expect(await findByTestId("auth-token-fields")).toBeTruthy();
  });

  it("loads config and fetches remote files on mount with saved config", async () => {
    const { securityVault } = await import("../../../services/SecurityVault");
    const savedConfig = { provider: "webdav", authToken: "", webdavConfig: { url: "https://cloud.example.test/dav/" } };
    securityVault.hasSecret = vi.fn().mockResolvedValue(true);
    securityVault.decryptSecret = vi
      .fn()
      .mockResolvedValue(JSON.stringify(savedConfig));
    const { cloudSyncService } =
      await import("../../../services/integrations/cloudSync");
    cloudSyncService.listFiles = vi.fn().mockResolvedValue([
      {
        id: "f1",
        name: "bookmarkforge_sync_2024.json",
        modifiedTime: "2024-01-01",
      },
      {
        id: "f2",
        name: "bookmarkforge_sync_2025.json",
        modifiedTime: "2025-01-01",
      },
      { id: "f3", name: "other_file.txt" },
    ]);
    render(<CloudSyncSection />);
    await waitFor(() => {
      expect(cloudSyncService.init).toHaveBeenCalled();
      expect(cloudSyncService.listFiles).toHaveBeenCalled();
    });
  });

  it("aborts restore when user cancels", async () => {
    window.confirm = vi.fn(() => false) as any;
    const { securityVault } = await import("../../../services/SecurityVault");
    const { cloudSyncService } =
      await import("../../../services/integrations/cloudSync");
    securityVault.hasSecret = vi.fn().mockResolvedValue(true);
    securityVault.decryptSecret = vi
      .fn()
      .mockResolvedValue(JSON.stringify({ provider: "webdav", webdavConfig: { url: "https://cloud.example.test/dav/" } }));
    cloudSyncService.listFiles = vi
      .fn()
      .mockResolvedValue([{ id: "f1", name: "bookmarkforge_sync_2024.json" }]);
    const { findByTestId } = render(<CloudSyncSection />);
    await waitFor(() => expect(cloudSyncService.listFiles).toHaveBeenCalled());
    const restoreBtn = await findByTestId("restore-btn");
    await userEvent.click(restoreBtn);
    expect(window.confirm).toHaveBeenCalled();
    expect(cloudSyncService.downloadFile).not.toHaveBeenCalled();
  });

  it("shows error when restore has invalid data", async () => {
    window.confirm = vi.fn(() => true) as any;
    const { cloudSyncService } =
      await import("../../../services/integrations/cloudSync");
    const { securityVault } = await import("../../../services/SecurityVault");
    securityVault.hasSecret = vi.fn().mockResolvedValue(true);
    securityVault.decryptSecret = vi
      .fn()
      .mockResolvedValue(JSON.stringify({ provider: "webdav", webdavConfig: { url: "https://cloud.example.test/dav/" } }));
    cloudSyncService.downloadFile = vi
      .fn()
      .mockResolvedValue(new TextEncoder().encode('{"invalid":true}'));
    cloudSyncService.listFiles = vi
      .fn()
      .mockResolvedValue([{ id: "f1", name: "bookmarkforge_sync_2024.json" }]);
    const { toast } = await import("sonner");
    const { findByTestId } = render(<CloudSyncSection />);
    await waitFor(() => expect(cloudSyncService.listFiles).toHaveBeenCalled());
    const restoreBtn = await findByTestId("restore-btn");
    await userEvent.click(restoreBtn);
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalled();
    });
  });

  it("shows friendly error when remote payload is not JSON", async () => {
    window.confirm = vi.fn(() => true) as any;
    const { cloudSyncService } =
      await import("../../../services/integrations/cloudSync");
    const { securityVault } = await import("../../../services/SecurityVault");
    securityVault.hasSecret = vi.fn().mockResolvedValue(true);
    securityVault.decryptSecret = vi
      .fn()
      .mockResolvedValue(JSON.stringify({ provider: "webdav", webdavConfig: { url: "https://cloud.example.test/dav/" } }));
    cloudSyncService.downloadFile = vi
      .fn()
      .mockResolvedValue(new TextEncoder().encode("not-json{{"));
    cloudSyncService.listFiles = vi
      .fn()
      .mockResolvedValue([{ id: "f1", name: "bookmarkforge_sync_2024.json" }]);
    const { toast } = await import("sonner");
    const { findByTestId } = render(<CloudSyncSection />);
    await waitFor(() => expect(cloudSyncService.listFiles).toHaveBeenCalled());
    const restoreBtn = await findByTestId("restore-btn");
    await userEvent.click(restoreBtn);
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
  });

  it("shows friendly error when remote data field is not a string", async () => {
    window.confirm = vi.fn(() => true) as any;
    const { cloudSyncService } =
      await import("../../../services/integrations/cloudSync");
    const { securityVault } = await import("../../../services/SecurityVault");
    securityVault.hasSecret = vi.fn().mockResolvedValue(true);
    securityVault.decryptSecret = vi
      .fn()
      .mockResolvedValue(JSON.stringify({ provider: "webdav", webdavConfig: { url: "https://cloud.example.test/dav/" } }));
    cloudSyncService.downloadFile = vi
      .fn()
      .mockResolvedValue(
        new TextEncoder().encode('{"encrypted":true,"data":{"nested":1}}'),
      );
    cloudSyncService.listFiles = vi
      .fn()
      .mockResolvedValue([{ id: "f1", name: "bookmarkforge_sync_2024.json" }]);
    const { toast } = await import("sonner");
    const { findByTestId } = render(<CloudSyncSection />);
    await waitFor(() => expect(cloudSyncService.listFiles).toHaveBeenCalled());
    const restoreBtn = await findByTestId("restore-btn");
    await userEvent.click(restoreBtn);
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
  });

  it("restore calls downloadFile with file id", async () => {
    window.confirm = vi.fn(() => true) as any;
    const { cloudSyncService } =
      await import("../../../services/integrations/cloudSync");
    const { securityVault } = await import("../../../services/SecurityVault");
    securityVault.hasSecret = vi.fn().mockResolvedValue(true);
    securityVault.decryptSecret = vi
      .fn()
      .mockResolvedValue(JSON.stringify({ provider: "webdav", webdavConfig: { url: "https://cloud.example.test/dav/" } }));
    const fakeData = JSON.stringify({ encrypted: true, data: "AAAA" });
    cloudSyncService.downloadFile = vi
      .fn()
      .mockResolvedValue(new TextEncoder().encode(fakeData));
    cloudSyncService.listFiles = vi
      .fn()
      .mockResolvedValue([{ id: "f1", name: "bookmarkforge_sync_2024.json" }]);
    const { findByTestId } = render(<CloudSyncSection />);
    await waitFor(() => expect(cloudSyncService.listFiles).toHaveBeenCalled());
    const restoreBtn = await findByTestId("restore-btn");
    await userEvent.click(restoreBtn);
    await waitFor(
      () => {
        expect(cloudSyncService.downloadFile).toHaveBeenCalledWith("file1");
      },
      { timeout: 3000 },
    );
  });

  it("restore shows error when vault is locked", async () => {
    window.confirm = vi.fn(() => true) as any;
    const { cloudSyncService } =
      await import("../../../services/integrations/cloudSync");
    const { securityVault } = await import("../../../services/SecurityVault");
    securityVault.hasSecret = vi.fn().mockResolvedValue(true);
    securityVault.decryptSecret = vi
      .fn()
      .mockResolvedValue(JSON.stringify({ provider: "webdav", webdavConfig: { url: "https://cloud.example.test/dav/" } }));
    securityVault.withMasterPasswordBytes = vi.fn(
      async (_caller: object, fn: (p: Uint8Array | null) => unknown) => fn(null),
    ) as unknown as typeof securityVault.withMasterPasswordBytes;
    const fakeData = JSON.stringify({ encrypted: true, data: "AAAA" });
    cloudSyncService.downloadFile = vi
      .fn()
      .mockResolvedValue(new TextEncoder().encode(fakeData));
    cloudSyncService.listFiles = vi
      .fn()
      .mockResolvedValue([{ id: "f1", name: "bookmarkforge_sync_2024.json" }]);
    const { toast } = await import("sonner");
    const { findByTestId } = render(<CloudSyncSection />);
    await waitFor(() => expect(cloudSyncService.listFiles).toHaveBeenCalled());
    const restoreBtn = await findByTestId("restore-btn");
    await userEvent.click(restoreBtn);
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalled();
    });
  });

  it("does not show toasts if the connection test finishes after unmount", async () => {
    const { cloudSyncService } =
      await import("../../../services/integrations/cloudSync");
    let resolveAuth: () => void;
    cloudSyncService.authenticate = vi.fn().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveAuth = resolve;
        }),
    );
    const { toast } = await import("sonner");

    const { findByText, findByLabelText, unmount } = render(<CloudSyncSection />);
    await userEvent.type(
      await findByLabelText("webdavUrlLabel"),
      "https://cloud.example.test/dav/",
    );
    const btn = await findByText("testConnection");
    await userEvent.click(btn);
    await waitFor(() => expect(resolveAuth).toBeTypeOf("function"));
    unmount();
    await act(async () => {
      resolveAuth!();
    });

    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("does not show toasts if the restore finishes after unmount", async () => {
    window.confirm = vi.fn(() => true) as any;
    const { cloudSyncService } =
      await import("../../../services/integrations/cloudSync");
    const { securityVault } = await import("../../../services/SecurityVault");
    securityVault.hasSecret = vi.fn().mockResolvedValue(true);
    securityVault.decryptSecret = vi
      .fn()
      .mockResolvedValue(JSON.stringify({ provider: "webdav", webdavConfig: { url: "https://cloud.example.test/dav/" } }));
    let resolveDownload: (value: Uint8Array) => void;
    cloudSyncService.downloadFile = vi.fn().mockImplementation(
      () =>
        new Promise<Uint8Array>((resolve) => {
          resolveDownload = resolve;
        }),
    );
    cloudSyncService.listFiles = vi
      .fn()
      .mockResolvedValue([{ id: "f1", name: "bookmarkforge_sync_2024.json" }]);
    const { toast } = await import("sonner");

    const { findByTestId, unmount } = render(<CloudSyncSection />);
    await waitFor(() => expect(cloudSyncService.listFiles).toHaveBeenCalled());
    const restoreBtn = await findByTestId("restore-btn");
    await userEvent.click(restoreBtn);
    unmount();
    await act(async () => {
      resolveDownload!(new TextEncoder().encode("{}"));
    });

    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });
});
