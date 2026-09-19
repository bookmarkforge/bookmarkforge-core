/**
 * F1-F — Zero-knowledge offsite backup (WebDAV/Nextcloud).
 *
 * Validates the three measurable success criteria from docs/ROADMAP.md:
 *   1. The upload payload contains zero plaintext bookmark titles/URLs.
 *   2. `last_offsite_backup_date` updates to `Date.now()` after a successful
 *      upload.
 *   3. A wipe → restore drill from the offsite copy reproduces the source
 *      bookmark count and tag set.
 *
 * The encryption path is REAL: BackupService.createBackupData/importBackup run
 * the actual AES-GCM + Argon2id pipeline (main-thread fallback in the test
 * environment). Only the database boundary (initDB) and settings are mocked,
 * mirroring src/tests/services/BackupRestore.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Module mocks (hoisted by Vitest) ───────────────────────────────────────

vi.mock("../../../db/database", () => ({ initDB: vi.fn() }));

vi.mock("../../../services/SettingsService", () => ({
  settingsService: {
    exportSettings: vi.fn(() => ({})),
    importSettings: vi.fn(),
  },
}));

vi.mock("../../../services/pro-access", async () => ({
  // The service under test resolves BackupService through the pro-access
  // loader; hand it the real implementation so the backup path stays
  // end-to-end (the gate itself is covered by pro-access's own tests).
  loadBackupService: async () =>
    (await import("../../../services/BackupService")).BackupService,
}));
vi.mock("../../../services/SecurityVault", () => ({
  securityVault: {
    registerCaller: vi.fn(),
    withMasterPasswordBytes: vi.fn(
      (_caller: object, fn: (p: Uint8Array | null) => unknown) => {
        const pw =
          (globalThis as { __VAULT_PASSWORD__?: string | null })
            .__VAULT_PASSWORD__ ?? "master-password-123";
        return fn(pw ? new TextEncoder().encode(pw) : null);
      },
    ),
    onLock: vi.fn(() => () => {}),
    onUnlock: vi.fn(() => () => {}),
  },
}));

vi.mock("../../../utils/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import {
  CloudSyncService,
  registerLocalBackupProvider,
} from "../../../services/integrations/cloudSync";
import { BackupService } from "../../../services/BackupService";
import { initDB } from "../../../db/database";
import { STORAGE_KEYS } from "../../../constants/storage-keys";

// ── Helpers ─────────────────────────────────────────────────────────────────

type FakeBookmark = {
  id: string;
  title: string;
  url: string;
  tags: string[];
};

function makeBookmarkCollection() {
  let docs: FakeBookmark[] = [];
  return {
    find: vi.fn(() => ({
      exec: vi.fn(async () => docs.map((d) => ({ toJSON: () => ({ ...d }) }))),
    })),
    count: vi.fn(() => ({ exec: vi.fn(async () => docs.length) })),
    bulkInsert: vi.fn(async (incoming: FakeBookmark[]) => {
      for (const d of incoming) docs.push(d);
    }),
    upsert: vi.fn(async (d: FakeBookmark) => {
      const index = docs.findIndex((x) => x.id === d.id);
      if (index >= 0) docs[index] = d;
      else docs.push(d);
    }),
    bulkRemove: vi.fn(async () => {}),
    setDocs: (next: FakeBookmark[]) => {
      docs = next;
    },
    getDocs: () => docs,
  };
}

function makeFakeDb(bookmarks: FakeBookmark[]) {
  const collection = makeBookmarkCollection();
  collection.setDocs(bookmarks);
  return {
    collections: { bookmarks: collection },
    bookmarks: collection,
    _bookmarks: collection,
  };
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result =
        typeof reader.result === "string" ? reader.result : "";
      const comma = result.indexOf(",");
      resolve(comma === -1 ? "" : result.slice(comma + 1));
    };
    reader.onerror = () =>
      reject(reader.error ?? new Error("Failed to read blob"));
    reader.readAsDataURL(blob);
  });
}

function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

const SOURCE_BOOKMARKS: FakeBookmark[] = [
  { id: "b1", title: "Alpha Confidential", url: "https://alpha.secret.example", tags: ["news"] },
  { id: "b2", title: "Beta Confidential", url: "https://beta.secret.example", tags: ["dev"] },
  { id: "b3", title: "Gamma Confidential", url: "https://gamma.secret.example", tags: ["news", "dev"] },
  { id: "b4", title: "Delta Confidential", url: "https://delta.secret.example", tags: ["read"] },
  { id: "b5", title: "Epsilon Confidential", url: "https://epsilon.secret.example", tags: ["news", "read"] },
];

const WEBDAV_CONFIG = {
  provider: "webdav" as const,
  webdavConfig: {
    url: "https://webdav.example.com/remote.php/dav",
    username: "user",
    password: "pass",
  },
};

function okResponse(): Response {
  return {
    ok: true,
    status: 200,
    text: async () => "",
    headers: new Headers(),
  } as unknown as Response;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("F1-F zero-knowledge offsite backup (WebDAV/Nextcloud)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    localStorage.clear();
    (globalThis as { __VAULT_PASSWORD__?: string | null }).__VAULT_PASSWORD__ =
      "master-password-123";
  });

  it("uploads only base64 ciphertext — zero plaintext titles or URLs (criterion 1)", async () => {
    const db = makeFakeDb(
      SOURCE_BOOKMARKS.map((b) => ({ ...b, tags: [...b.tags] })),
    );
    (initDB as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(db);

    const service = new CloudSyncService(WEBDAV_CONFIG);
    registerLocalBackupProvider(service);

    // Capture the payload PUT explicitly: the integrity sidecar is now also
    // uploaded (HMAC tag JSON), and it must never contain plaintext either.
    let uploadedBody = "";
    let sidecarBody = "";
    mockFetch.mockImplementation(async (_input: unknown, init?: RequestInit) => {
      if (init?.method === "PUT") {
        const body = String(init.body ?? "");
        try {
          const parsed = JSON.parse(body) as { encrypted?: unknown };
          if (parsed && typeof parsed === "object" && "encrypted" in parsed) {
            uploadedBody = body;
          } else if (typeof (parsed as { hmac?: unknown })?.hmac === "string") {
            sidecarBody = body;
          }
        } catch {
          /* not JSON — ignore */
        }
      }
      return okResponse();
    });

    const result = await service.sync();
    expect(result.success).toBe(true);

    expect(uploadedBody).not.toBe("");
    expect(sidecarBody).not.toBe("");

    const payload = JSON.parse(uploadedBody) as {
      encrypted: boolean;
      data: string;
      timestamp: number;
    };
    expect(payload.encrypted).toBe(true);
    expect(typeof payload.data).toBe("string");
    expect(payload.data.length).toBeGreaterThan(0);

    // The whole payload (JSON envelope included) must carry zero occurrences
    // of any plaintext bookmark title or URL string.
    for (const b of SOURCE_BOOKMARKS) {
      expect(uploadedBody).not.toContain(b.title);
      expect(uploadedBody).not.toContain(b.url);
      expect(uploadedBody).not.toContain("Confidential");
    }

    // The data field decodes to ciphertext, not the JSON backup document.
    const decoded = atob(payload.data);
    expect(decoded).not.toContain("Alpha Confidential");
    expect(decoded).not.toContain("https://alpha.secret.example");
  });

  it("updates last_offsite_backup_date on a successful upload (criterion 2)", async () => {
    const db = makeFakeDb(
      SOURCE_BOOKMARKS.map((b) => ({ ...b, tags: [...b.tags] })),
    );
    (initDB as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(db);

    const service = new CloudSyncService(WEBDAV_CONFIG);
    registerLocalBackupProvider(service);
    mockFetch.mockResolvedValue(okResponse());

    const before = Date.now();
    const result = await service.sync();
    const after = Date.now();

    expect(result.success).toBe(true);
    const raw = localStorage.getItem(
      STORAGE_KEYS.BOOKMARKFORGE_CLOUD_LASTBACKUP,
    );
    expect(raw).not.toBeNull();
    const stored = Number(raw);
    expect(Number.isFinite(stored)).toBe(true);
    expect(stored).toBeGreaterThanOrEqual(before - 1000);
    expect(stored).toBeLessThanOrEqual(after + 1000);
  });

  it("does not update the counter when the upload fails", async () => {
    const db = makeFakeDb(
      SOURCE_BOOKMARKS.map((b) => ({ ...b, tags: [...b.tags] })),
    );
    (initDB as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(db);

    const service = new CloudSyncService(WEBDAV_CONFIG);
    registerLocalBackupProvider(service);
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "",
    } as unknown as Response);

    const result = await service.sync();
    expect(result.success).toBe(false);
    expect(
      localStorage.getItem(STORAGE_KEYS.BOOKMARKFORGE_CLOUD_LASTBACKUP),
    ).toBeNull();
  });

  it("retains only the newest configured remote backup versions", async () => {
    const db = makeFakeDb(SOURCE_BOOKMARKS);
    (initDB as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(db);

    const service = new CloudSyncService({
      ...WEBDAV_CONFIG,
      remoteRetentionCount: 2,
    });
    registerLocalBackupProvider(service);
    const deleted: string[] = [];
    mockFetch.mockImplementation(async (_input: unknown, init?: RequestInit) => {
      if (init?.method === "PROPFIND") {
        return {
          ok: true,
          status: 207,
          text: async () =>
            [
              "<href>/bookmarkforge_sync_webdav_1700000000000.json</href><displayname>bookmarkforge_sync_webdav_1700000000000.json</displayname>",
              "<href>/bookmarkforge_sync_webdav_1800000000000.json</href><displayname>bookmarkforge_sync_webdav_1800000000000.json</displayname>",
              "<href>/bookmarkforge_sync_webdav_1900000000000.json</href><displayname>bookmarkforge_sync_webdav_1900000000000.json</displayname>",
            ].join(""),
          headers: new Headers(),
        } as unknown as Response;
      }
      if (init?.method === "DELETE") {
        deleted.push(String(_input));
      }
      return okResponse();
    });

    const result = await service.sync();

    expect(result.success).toBe(true);
    expect(deleted).toHaveLength(1);
    expect(deleted[0]).toContain("1700000000000");
  });

  it("wipe → restore drill reproduces bookmark count and tags (criterion 3)", async () => {
    const source = SOURCE_BOOKMARKS.map((b) => ({ ...b, tags: [...b.tags] }));
    const db = makeFakeDb(source);
    (initDB as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(db);

    // 1. Offsite backup: encrypt the vault with the master password.
    const { blob } = await BackupService.createBackupData("master-password-123");
    const base64 = await blobToBase64(blob);
    expect(base64.length).toBeGreaterThan(0);
    const remotePayload = JSON.stringify({ encrypted: true, data: base64 });

    // 2. Wipe the local vault ("laptop burned in a fire").
    db._bookmarks.setDocs([]);
    expect(db._bookmarks.getDocs()).toHaveLength(0);

    // 3. Restore from the offsite copy.
    const { data } = JSON.parse(remotePayload) as { data: string };
    const bytes = base64ToBytes(data);
    const file = new File([bytes], "backup.bmf", {
      type: "application/octet-stream",
    });
    Object.defineProperty(file, "arrayBuffer", {
      value: vi.fn(async () => bytes.buffer),
    });
    await BackupService.importBackup(file, "master-password-123");

    const restored = db._bookmarks.getDocs();
    expect(restored).toHaveLength(source.length);

    const tagSet = (bookmarks: FakeBookmark[]): string[] =>
      bookmarks.map((b) => [...b.tags].sort().join(",")).sort();
    expect(tagSet(restored)).toEqual(tagSet(source));
    expect(
      restored.map((b) => b.title).sort(),
    ).toEqual(source.map((b) => b.title).sort());
  });
});
