import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { act } from "react";
import userEvent from "@testing-library/user-event";
import React from "react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (s: string) => s, i18n: { language: "en" } }),
}));

vi.mock("lucide-react", () => {
  const mock = (name: string) => {
    const Icon = (props: any) => (
      <svg data-testid={`icon-${name}`} {...props} />
    );
    Icon.displayName = name;
    return Icon;
  };
  return {
    HardDrive: mock("HardDrive"),
    Trash2: mock("Trash2"),
    Loader2: mock("Loader2"),
    Database: mock("Database"),
    Download: mock("Download"),
    Upload: mock("Upload"),
    FolderOpen: mock("FolderOpen"),
  };
});

const mockFindExec = vi.fn();
const mockInitDB = vi.fn().mockResolvedValue({
  documents: { find: () => ({ exec: () => mockFindExec() }) },
  bookmarks: { find: () => ({ exec: () => mockFindExec() }) },
  chunks: { find: () => ({ exec: () => mockFindExec() }) },
});
vi.mock("../../../db/database", () => ({ initDB: mockInitDB }));

const mockTriggerManualCleanup = vi.fn();
vi.mock("../../../services/GarbageCollectionService", () => ({
  garbageCollectionService: { triggerManualCleanup: mockTriggerManualCleanup },
}));

const mockExportBackup = vi.fn();
const mockImportBackup = vi.fn();
vi.mock("../../../services/pro-access", () => ({
  // Both Pro services are resolved through the pro-access loader, so the
  // doubles are installed at the loader instead of at the Pro modules.
  loadBackupService: () =>
    Promise.resolve({
      exportBackup: mockExportBackup,
      importBackup: mockImportBackup,
    }),
  loadDiskBackupService: () =>
    Promise.resolve({
      getBackupFolderInfo: vi.fn().mockResolvedValue(null),
      pickBackupFolder: mockPickBackupFolder,
      clearBackupFolder: vi.fn().mockResolvedValue(undefined),
    }),
}));
const mockPickBackupFolder = vi.fn();

const mockToast = { success: vi.fn(), error: vi.fn() };
vi.mock("sonner", () => ({ toast: mockToast }));

const originalConfirm = globalThis.confirm;
const originalPrompt = globalThis.prompt;

describe("StorageSection", () => {
  let StorageSection: React.FC;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockFindExec.mockResolvedValue([]);
    mockTriggerManualCleanup.mockResolvedValue({ totalDeleted: 0 });
    mockExportBackup.mockResolvedValue(undefined);
    Object.assign(navigator, {
      storage: {
        estimate: () => Promise.resolve({ quota: 10737418240, usage: 0 }),
      },
    });
    (navigator as any).storage.estimate = () =>
      Promise.resolve({ quota: 10737418240, usage: 0 });
    globalThis.confirm = vi.fn(() => true);
    globalThis.prompt = vi.fn(() => "password123");
    vi.stubGlobal("caches", {
      keys: vi.fn().mockResolvedValue([]),
      open: vi.fn(),
      delete: vi.fn().mockResolvedValue(true),
    });
    vi.stubGlobal("indexedDB", {
      ...indexedDB,
      databases: vi.fn().mockResolvedValue([]),
      deleteDatabase: vi.fn(),
    } as any);
    const mod = await import("../../../components/settings/StorageSection");
    StorageSection = mod.StorageSection;
  });

  afterEach(() => {
    globalThis.confirm = originalConfirm;
    globalThis.prompt = originalPrompt;
  });

  it("renders title", async () => {
    render(<StorageSection />);
    expect(await screen.findByText("app_storageManager")).toBeTruthy();
  });

  it("renders loading state initially", () => {
    mockInitDB.mockImplementationOnce(() => new Promise(() => {}));
    const { unmount } = render(<StorageSection />);
    expect(screen.getByText("app_calculatingStorage")).toBeTruthy();
    unmount();
  });

  it("uses navigator.storage.estimate for the quota", async () => {
    const estimate = vi.fn().mockResolvedValue({ quota: 5000 });
    Object.defineProperty(navigator, "storage", {
      value: { estimate },
      configurable: true,
    });
    render(<StorageSection />);
    await waitForLoaded();
    expect(estimate).toHaveBeenCalled();
    // quota 5000 bytes renders as KB-scale via formatBytes.
    expect(screen.getAllByText(/KB/).length).toBeGreaterThan(0);
  });

  it("shows stats when loaded", async () => {
    render(<StorageSection />);
    await waitForLoaded();
    expect(screen.getByText("app_storageDocs")).toBeTruthy();
  });

  async function waitForLoaded() {
    await screen.findByText("app_backupRestore");
  }


  it("shows Compact Database button", async () => {
    render(<StorageSection />);
    expect(await screen.findByText("app_compactDatabase")).toBeTruthy();
  });

  it("shows Clear AI Models button", async () => {
    render(<StorageSection />);
    expect(await screen.findByText("app_clearAiModels")).toBeTruthy();
  });

  it("shows Export Backup button", async () => {
    render(<StorageSection />);
    expect(await screen.findByText("app_exportBackup")).toBeTruthy();
  });

  it("shows Import Backup button", async () => {
    render(<StorageSection />);
    expect(await screen.findByText("app_importBackup")).toBeTruthy();
  });

  it("shows backup notice text", async () => {
    render(<StorageSection />);
    expect(await screen.findByText("app_backupNotice")).toBeTruthy();
  });

  it("calculates storage from DB documents", async () => {
    mockFindExec.mockResolvedValue([{ some: "data" }]);
    render(<StorageSection />);
    expect(await screen.findByText("app_storageDocs")).toBeTruthy();
  });

  it("formats byte sizes correctly (bytes branch)", async () => {
    // Small quota (1000 bytes) exercises the "B" branch of formatBytes —
    // the default fixture (10 GB) only exercises the GB branch.
    (navigator as any).storage.estimate = () =>
      Promise.resolve({ quota: 1000, usage: 0 });
    render(<StorageSection />);
    await waitForLoaded();
    expect(screen.getByText(/1000 B/)).toBeTruthy();
  });

  it("formats byte sizes correctly (KB branch)", async () => {
    mockFindExec.mockResolvedValue([{ a: "x".repeat(1024) }]);
    render(<StorageSection />);
    await waitForLoaded();
    expect(screen.getAllByText(/KB/).length).toBeGreaterThan(0);
  });

  it("accumulates AI cache bytes from the caches API", async () => {
    vi.stubGlobal("caches", {
      keys: vi.fn().mockResolvedValue(["webllm-main"]),
      open: vi.fn().mockResolvedValue({
        keys: vi.fn().mockResolvedValue([{ url: "model.bin" }]),
        match: vi.fn().mockResolvedValue({
          blob: () => Promise.resolve({ size: 512 }),
        }),
      }),
      delete: vi.fn(),
    });
    render(<StorageSection />);
    await waitForLoaded();
    expect(screen.getAllByText(/512 B/).length).toBeGreaterThan(0);
  });

  it("counts streamed AI cache responses without materializing a blob", async () => {
    const blob = vi.fn();
    let reads = 0;
    vi.stubGlobal("caches", {
      keys: vi.fn().mockResolvedValue(["transformers-cache"]),
      open: vi.fn().mockResolvedValue({
        keys: vi.fn().mockResolvedValue([{ url: "model.bin" }]),
        match: vi.fn().mockResolvedValue({
          headers: new Headers(),
          body: {
            getReader: () => ({
              read: async () => {
                reads += 1;
                return reads === 1
                  ? { done: false, value: new Uint8Array(3) }
                  : { done: true, value: undefined };
              },
              releaseLock: vi.fn(),
            }),
          },
          blob,
        }),
      }),
      delete: vi.fn(),
    });
    render(<StorageSection />);
    await waitForLoaded();
    expect(blob).not.toHaveBeenCalled();
    expect(screen.getAllByText(/3 B/).length).toBeGreaterThan(0);
  });

  it("cancels the cache read on unmount", async () => {
    let resolveRead!: (result: { done: boolean; value?: Uint8Array }) => void;
    const readerCancel = vi.fn(() => {
      resolveRead({ done: true });
      return Promise.resolve();
    });
    const getReader = vi.fn().mockReturnValue({
      read: () => new Promise((resolve) => { resolveRead = resolve; }),
      cancel: readerCancel,
      releaseLock: vi.fn(),
    });
    vi.stubGlobal("caches", {
      keys: vi.fn().mockResolvedValue(["transformers-cache"]),
      open: vi.fn().mockResolvedValue({
        keys: vi.fn().mockResolvedValue([{ url: "model.bin" }]),
        match: vi.fn().mockResolvedValue({
          headers: new Headers(),
          body: { getReader },
        }),
      }),
      delete: vi.fn(),
    });

    const { unmount } = render(<StorageSection />);
    await vi.waitFor(() => expect(getReader).toHaveBeenCalled());
    unmount();
    await vi.waitFor(() => expect(readerCancel).toHaveBeenCalledTimes(1));
  });

  describe("error handling", () => {
    it("handles initDB failure gracefully", async () => {
      mockInitDB.mockRejectedValueOnce(new Error("DB error"));
      render(<StorageSection />);
      expect(await screen.findByText("app_storageManager")).toBeTruthy();
    });

    it("handles storage estimate not available", async () => {
      (navigator as any).storage = undefined;
      render(<StorageSection />);
      await waitForLoaded();
      expect(screen.getByText("app_storageDocs")).toBeTruthy();
    });

    it("handles caches API not available", async () => {
      vi.stubGlobal("caches", undefined);
      render(<StorageSection />);
      expect(await screen.findByText("app_storageManager")).toBeTruthy();
    });
  });

  describe("Compact Database button", () => {
    it("shows loader while compacting", async () => {
      mockTriggerManualCleanup.mockImplementation(() => new Promise(() => {}));
      render(<StorageSection />);
      await waitForLoaded();
      const buttons = screen.getAllByText("app_compactDatabase");
      await userEvent.click(buttons[0]!);
      expect(screen.getByText("app_compactDatabase")).toBeTruthy();
    });

    it("calls triggerManualCleanup on click", async () => {
      render(<StorageSection />);
      await waitForLoaded();
      const buttons = screen.getAllByText("app_compactDatabase");
      await userEvent.click(buttons[0]!);
      expect(mockTriggerManualCleanup).toHaveBeenCalledWith(0);
    });

    it("ignores a second click while compacting", async () => {
      let release!: (value: { totalDeleted: number }) => void;
      mockTriggerManualCleanup.mockImplementation(
        () => new Promise((resolve) => { release = resolve; }),
      );
      render(<StorageSection />);
      await waitForLoaded();
      const button = screen.getAllByText("app_compactDatabase")[0]!;

      await act(async () => {
        fireEvent.click(button);
        fireEvent.click(button);
      });

      expect(mockTriggerManualCleanup).toHaveBeenCalledTimes(1);
      await act(async () => {
        release({ totalDeleted: 0 });
        await vi.waitFor(() => expect(mockToast.success).toHaveBeenCalled());
      });
    });

    it("keeps the stats from the most recent measurement", async () => {
      const cacheKeys = vi
        .fn()
        .mockResolvedValueOnce(["webllm-cache"])
        .mockResolvedValue([]);
      vi.stubGlobal("caches", {
        keys: cacheKeys,
        open: vi.fn().mockResolvedValue({
          keys: vi.fn().mockResolvedValue([{ url: "model.bin" }]),
          match: vi.fn().mockResolvedValue({
            blob: () => Promise.resolve({ size: 1 }),
          }),
        }),
        delete: vi.fn().mockResolvedValue(true),
      });
      render(<StorageSection />);
      await waitForLoaded();

      mockFindExec.mockClear();
      let releaseStale!: (value: unknown[]) => void;
      let measurementCall = 0;
      mockFindExec.mockImplementation(() => {
        measurementCall += 1;
        if (measurementCall === 1) {
          return new Promise<unknown[]>((resolve) => { releaseStale = resolve; });
        }
        if (measurementCall === 4) {
          return Promise.resolve([{ value: "new" }]);
        }
        return Promise.resolve([]);
      });

      mockTriggerManualCleanup.mockResolvedValue({ totalDeleted: 0 });
      const compactButton = screen.getAllByText("app_compactDatabase")[0]!;
      const clearButton = screen.getAllByText("app_clearAiModels")[0]!;
      // Dispatch both events before React commits the loading render. This
      // models two different controls starting refreshes in the same turn.
      await act(async () => {
        fireEvent.click(compactButton);
        fireEvent.click(clearButton);
        await vi.waitFor(() => expect(measurementCall).toBe(4));
      });

      const latestBytes = JSON.stringify([{ value: "new" }]).length + 4;
      await vi.waitFor(() =>
        expect(screen.getByText(`${latestBytes} B`)).toBeTruthy(),
      );

      await act(async () => {
        releaseStale([]);
        await vi.waitFor(() =>
          expect(mockToast.success).toHaveBeenCalledTimes(2),
        );
      });
      expect(screen.getByText(`${latestBytes} B`)).toBeTruthy();
    });

    it("shows success toast on compact", async () => {
      mockTriggerManualCleanup.mockResolvedValue({ totalDeleted: 3 });
      render(<StorageSection />);
      await waitForLoaded();
      const buttons = screen.getAllByText("app_compactDatabase");
      await userEvent.click(buttons[0]!);
      await vi.waitFor(() => {
        expect(mockToast.success).toHaveBeenCalled();
      });
    });

    it("shows error toast on compact failure", async () => {
      mockTriggerManualCleanup.mockRejectedValueOnce(
        new Error("Cleanup error"),
      );
      render(<StorageSection />);
      await waitForLoaded();
      const buttons = screen.getAllByText("app_compactDatabase");
      await userEvent.click(buttons[0]!);
      await vi.waitFor(() => {
        expect(mockToast.error).toHaveBeenCalled();
      });
    });
  });

  describe("Export Backup button", () => {
    it("exports backup without encryption when user declines", async () => {
      globalThis.confirm = vi.fn(() => false);
      render(<StorageSection />);
      await waitForLoaded();
      const buttons = screen.getAllByText("app_exportBackup");
      await userEvent.click(buttons[0]!);
      expect(mockExportBackup).toHaveBeenCalledWith(undefined);
    });

    it("exports backup with encryption when user accepts", async () => {
      globalThis.confirm = vi.fn(() => true);
      globalThis.prompt = vi.fn(() => "mypass");
      render(<StorageSection />);
      await waitForLoaded();
      const buttons = screen.getAllByText("app_exportBackup");
      await userEvent.click(buttons[0]!);
      expect(mockExportBackup).toHaveBeenCalledWith("mypass");
    });

    it("shows error when user cancels password prompt", async () => {
      globalThis.confirm = vi.fn(() => true);
      globalThis.prompt = vi.fn(() => null);
      render(<StorageSection />);
      await waitForLoaded();
      const buttons = screen.getAllByText("app_exportBackup");
      await userEvent.click(buttons[0]!);
      expect(mockToast.error).toHaveBeenCalledWith("app_passwordRequired");
    });

    it("shows error toast on export failure", async () => {
      mockExportBackup.mockRejectedValueOnce(new Error("Export error"));
      render(<StorageSection />);
      await waitForLoaded();
      const buttons = screen.getAllByText("app_exportBackup");
      await userEvent.click(buttons[0]!);
      await vi.waitFor(() => {
        expect(mockToast.error).toHaveBeenCalled();
      });
    });

    // F0-3 regression: a manual export must write LAST_MANUAL_BACKUP_DATE so
    // the StorageStatus indicator and the dashboard banner can read the fresh
    // age without a page reload.
    it("writes LAST_MANUAL_BACKUP_DATE after export (F0-3 regression)", async () => {
      localStorage.removeItem("forge_last_manual_backup_date");
      globalThis.confirm = vi.fn(() => false);
      // Make the mock simulate what the real exportBackup does: write the
      // timestamp to localStorage via safeSet.
      mockExportBackup.mockImplementation(() => {
        localStorage.setItem(
          "forge_last_manual_backup_date",
          Date.now().toString(),
        );
      });
      render(<StorageSection />);
      await waitForLoaded();
      const buttons = screen.getAllByText("app_exportBackup");
      await userEvent.click(buttons[0]!);
      await vi.waitFor(() => {
        const raw = localStorage.getItem("forge_last_manual_backup_date");
        expect(raw).not.toBeNull();
        const ts = parseInt(raw!, 10);
        // Timestamp must be recent (within the last 5 seconds)
        expect(Date.now() - ts).toBeLessThan(5_000);
      });
    });
  });

  describe("Clear AI Models button", () => {
    function makeMockCache() {
      return {
        keys: vi.fn().mockResolvedValue(["/model.bin"]),
        match: vi
          .fn()
          .mockImplementation(() =>
            Promise.resolve(new Response("model data")),
          ),
      };
    }

    it("clears AI cache when confirmed", async () => {
      vi.stubGlobal("caches", {
        keys: vi.fn().mockResolvedValue(["webllm-cache"]),
        open: vi.fn().mockResolvedValue(makeMockCache()),
        delete: vi.fn().mockResolvedValue(true),
      });
      render(<StorageSection />);
      await waitForLoaded();
      const buttons = screen.getAllByText("app_clearAiModels");
      await userEvent.click(buttons[0]!);
      await vi.waitFor(() => {
        expect(mockToast.success).toHaveBeenCalled();
      });
    });

    it("ignores a second click while clearing the cache", async () => {
      vi.stubGlobal("caches", {
        keys: vi.fn().mockResolvedValue(["webllm-cache"]),
        open: vi.fn().mockResolvedValue({
          keys: vi.fn().mockResolvedValue([{ url: "model.bin" }]),
          match: vi.fn().mockResolvedValue({
            blob: () => Promise.resolve({ size: 1 }),
          }),
        }),
        delete: vi.fn().mockResolvedValue(true),
      });
      render(<StorageSection />);
      await waitForLoaded();

      let releaseKeys!: (keys: string[]) => void;
      const keys = vi
        .fn()
        .mockImplementationOnce(
          () => new Promise<string[]>((resolve) => { releaseKeys = resolve; }),
        )
        .mockResolvedValue([]);
      vi.stubGlobal("caches", {
        keys,
        open: vi.fn(),
        delete: vi.fn().mockResolvedValue(true),
      });
      const button = screen.getAllByText("app_clearAiModels")[0]!;

      await act(async () => {
        fireEvent.click(button);
        fireEvent.click(button);
      });

      expect(keys).toHaveBeenCalledTimes(1);
      await act(async () => {
        releaseKeys([]);
        await vi.waitFor(() => expect(mockToast.success).toHaveBeenCalled());
      });
    });

    it("shows error toast on AI cache clear failure", async () => {
      const keysMock = vi
        .fn()
        .mockResolvedValueOnce(["webllm-cache"])
        .mockRejectedValueOnce(new Error("Cache error"));
      vi.stubGlobal("caches", {
        keys: keysMock,
        open: vi.fn().mockResolvedValue(makeMockCache()),
        delete: vi.fn().mockResolvedValue(true),
      });
      render(<StorageSection />);
      await waitForLoaded();
      const buttons = screen.getAllByText("app_clearAiModels");
      await userEvent.click(buttons[0]!);
      await vi.waitFor(() => {
        expect(mockToast.error).toHaveBeenCalled();
      });
    });
  });

  describe("Import Backup", () => {
    it("shows error when .bmf file has no password", async () => {
      globalThis.prompt = vi.fn(() => null);
      render(<StorageSection />);
      await waitForLoaded();
      const buttons = screen.getAllByText("app_importBackup");
      await userEvent.click(buttons[0]!);

      const fileInput = document.querySelector(
        'input[type="file"]',
      ) as HTMLInputElement;
      const file = new File(["data"], "backup.bmf", {
        type: "application/octet-stream",
      });
      fireEvent.change(fileInput, { target: { files: [file] } });

      await vi.waitFor(() => {
        expect(mockToast.error).toHaveBeenCalledWith(
          "app_decryptPasswordRequired",
        );
      });
    });

    it("imports .json backup successfully", async () => {
      render(<StorageSection />);
      await waitForLoaded();
      const buttons = screen.getAllByText("app_importBackup");
      await userEvent.click(buttons[0]!);

      const fileInput = document.querySelector(
        'input[type="file"]',
      ) as HTMLInputElement;
      const file = new File(["{}"], "backup.json", {
        type: "application/json",
      });
      await act(async () => {
        fireEvent.change(fileInput, { target: { files: [file] } });
        await vi.waitFor(() => {
          expect(mockToast.success).toHaveBeenCalled();
        });
      });
    });

    it("shows error toast on import failure", async () => {
      mockImportBackup.mockRejectedValueOnce(new Error("Import error"));
      render(<StorageSection />);
      await waitForLoaded();
      const buttons = screen.getAllByText("app_importBackup");
      await userEvent.click(buttons[0]!);

      const fileInput = document.querySelector(
        'input[type="file"]',
      ) as HTMLInputElement;
      const file = new File(["{}"], "backup.json", {
        type: "application/json",
      });
      await act(async () => {
        fireEvent.change(fileInput, { target: { files: [file] } });
        await vi.waitFor(() => {
          expect(mockToast.error).toHaveBeenCalled();
        });
      });
    });
  });
});
