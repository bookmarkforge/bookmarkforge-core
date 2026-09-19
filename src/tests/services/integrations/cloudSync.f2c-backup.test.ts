/**
 * F2-C — Zero-knowledge offsite backup to S3 / Google Drive / Dropbox.
 *
 * Validates the measurable success criteria from docs/ROADMAP.md per
 * destination:
 *   1. The upload payload contains zero plaintext bookmark titles/URLs.
 *   2. `last_offsite_backup_date` updates to `Date.now()` after success.
 *   3. A wipe → restore drill from the S3 object reproduces count + tags.
 *   4. (opt-in) is asserted by the CloudSyncSection settings test.
 *
 * The SigV4 signing helper is exercised directly so the canonical request
 * and payload hash are deterministic and well-formed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../db/database", () => ({ initDB: vi.fn() }));

vi.mock("../../../services/SettingsService", () => ({
  settingsService: {
    exportSettings: vi.fn(() => ({})),
    importSettings: vi.fn(),
  },
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

// The offsite upload path builds its payload through the Pro loader, which
// refuses to resolve BackupService without a license. The encryption under
// test is the real BackupService, so only the gate is relaxed — every other
// LicenseService method keeps its real behaviour.
vi.mock("../../../services/LicenseService", async () => {
  const actual = await vi.importActual<
    typeof import("../../../services/LicenseService")
  >("../../../services/LicenseService");
  return {
    ...actual,
    licenseService: {
      ...actual.licenseService,
      hasProAccess: () => true,
    },
  };
});

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import {
  CloudSyncService,
  registerLocalBackupProvider,
} from "../../../services/integrations/cloudSync";
import { signS3Request } from "../../../services/integrations/cloudSync.adapters.s3";
import { BackupService } from "../../../services/BackupService";
import { initDB } from "../../../db/database";
import { STORAGE_KEYS } from "../../../constants/storage-keys";

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

const S3_CONFIG = {
  provider: "s3" as const,
  s3Config: {
    endpoint: "https://s3.example.com",
    bucket: "vault-backups",
    region: "us-east-1",
    accessKeyId: "AKIA_TEST",
    secretAccessKey: "secret-test-key",
  },
};

function okResponse(): Response {
  return {
    ok: true,
    status: 200,
    text: async () => "",
    arrayBuffer: async () => new ArrayBuffer(0),
    headers: new Headers(),
  } as unknown as Response;
}

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(body),
    json: async () => body,
    arrayBuffer: async () => new ArrayBuffer(0),
    headers: new Headers(),
  } as unknown as Response;
}

describe("F2-C zero-knowledge offsite backup (S3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    localStorage.clear();
    (globalThis as { __VAULT_PASSWORD__?: string | null }).__VAULT_PASSWORD__ =
      "master-password-123";
  });

  it("signS3Request builds a well-formed SigV4 request with a correct payload hash", async () => {
    const body = JSON.stringify({ hello: "world" });
    const req = await signS3Request(
      S3_CONFIG.s3Config,
      "PUT",
      "backup.json",
      body,
      "application/json",
    );

    expect(req.url).toBe(
      "https://s3.example.com/vault-backups/backup.json",
    );
    expect(req.headers.authorization).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKIA_TEST\/\d{8}\/us-east-1\/s3\/aws4_request, SignedHeaders=(content-type;)?host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/,
    );
    expect(req.headers["x-amz-date"]).toMatch(/^\d{8}T\d{6}Z$/);

    // The payload hash must equal the SHA-256 of the exact body bytes.
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(body),
    );
    const expected = Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    expect(req.headers["x-amz-content-sha256"]).toBe(expected);
    expect(req.body).toBe(body);
  });

  it("uploads only base64 ciphertext — zero plaintext titles or URLs (criterion 1)", async () => {
    const db = makeFakeDb(SOURCE_BOOKMARKS.map((b) => ({ ...b, tags: [...b.tags] })));
    (initDB as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(db);

    const service = new CloudSyncService(S3_CONFIG);
    registerLocalBackupProvider(service);

    // Capture the payload PUT explicitly: the HMAC sidecar is uploaded too.
    let uploadedBody = "";
    mockFetch.mockImplementation(async (_input: unknown, init?: RequestInit) => {
      if (init?.method === "PUT") {
        const body = String(init.body ?? "");
        if (!body.includes('"hmac"')) {
          uploadedBody = body;
        }
      }
      return okResponse();
    });

    const result = await service.sync();
    expect(result.success).toBe(true);
    expect(uploadedBody).not.toBe("");

    const payload = JSON.parse(uploadedBody) as {
      encrypted: boolean;
      data: string;
      timestamp: number;
    };
    expect(payload.encrypted).toBe(true);
    expect(typeof payload.data).toBe("string");
    expect(payload.data.length).toBeGreaterThan(0);

    for (const b of SOURCE_BOOKMARKS) {
      expect(uploadedBody).not.toContain(b.title);
      expect(uploadedBody).not.toContain(b.url);
      expect(uploadedBody).not.toContain("Confidential");
    }
    expect(atob(payload.data)).not.toContain("Alpha Confidential");
  });

  it("updates last_offsite_backup_date on a successful upload (criterion 2)", async () => {
    const db = makeFakeDb(SOURCE_BOOKMARKS.map((b) => ({ ...b, tags: [...b.tags] })));
    (initDB as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(db);

    const service = new CloudSyncService(S3_CONFIG);
    registerLocalBackupProvider(service);
    mockFetch.mockResolvedValue(okResponse());

    const before = Date.now();
    const result = await service.sync();
    const after = Date.now();

    expect(result.success).toBe(true);
    const raw = localStorage.getItem(STORAGE_KEYS.BOOKMARKFORGE_CLOUD_LASTBACKUP);
    expect(raw).not.toBeNull();
    const stored = Number(raw);
    expect(Number.isFinite(stored)).toBe(true);
    expect(stored).toBeGreaterThanOrEqual(before - 1000);
    expect(stored).toBeLessThanOrEqual(after + 1000);
  });

  it("wipe → restore drill from the S3 object reproduces count and tags (criterion 3)", async () => {
    const source = SOURCE_BOOKMARKS.map((b) => ({ ...b, tags: [...b.tags] }));
    const db = makeFakeDb(source);
    (initDB as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(db);

    // 1. Encrypt + upload to S3 (intercept the PUT body as the "remote copy").
    const service = new CloudSyncService(S3_CONFIG);
    registerLocalBackupProvider(service);
    let remotePayload = "";
    mockFetch.mockImplementation(async (_input: unknown, init?: RequestInit) => {
      if (init?.method === "PUT") {
        // The HMAC sidecar is uploaded after the payload; only the backup
        // envelope is the restorable remote copy.
        const body = String(init.body ?? "");
        if (!body.includes('"hmac"')) {
          remotePayload = body;
        }
      }
      return okResponse();
    });
    const upload = await service.sync();
    expect(upload.success).toBe(true);
    expect(remotePayload).not.toBe("");

    // 2. Wipe the local vault.
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
    expect(restored.map((b) => b.title).sort()).toEqual(
      source.map((b) => b.title).sort(),
    );
    const tagSet = (bookmarks: FakeBookmark[]): string[] =>
      bookmarks.map((b) => [...b.tags].sort().join(",")).sort();
    expect(tagSet(restored)).toEqual(tagSet(source));
  });
});

describe("F2-C zero-knowledge offsite backup (Google Drive)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    localStorage.clear();
    (globalThis as { __VAULT_PASSWORD__?: string | null }).__VAULT_PASSWORD__ =
      "master-password-123";
  });

  const DRIVE_CONFIG = {
    provider: "drive" as const,
    authToken: "drive-test-token",
  };

  it("uploads only ciphertext — zero plaintext titles or URLs (criterion 1)", async () => {
    const db = makeFakeDb(SOURCE_BOOKMARKS.map((b) => ({ ...b, tags: [...b.tags] })));
    (initDB as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(db);

    const service = new CloudSyncService(DRIVE_CONFIG);
    registerLocalBackupProvider(service);

    const bodies: string[] = [];
    mockFetch.mockImplementation(async (_input: unknown, init?: RequestInit) => {
      if (init?.method === "POST") {return jsonResponse({ id: "file-1" });}
      if (init?.method === "PUT") {bodies.push(String(init.body ?? ""));}
      return okResponse();
    });

    const result = await service.sync();
    expect(result.success).toBe(true);
    expect(bodies.length).toBeGreaterThan(0);
    const all = bodies.join("\n");
    for (const b of SOURCE_BOOKMARKS) {
      expect(all).not.toContain(b.title);
      expect(all).not.toContain(b.url);
      expect(all).not.toContain("Confidential");
    }
  });

  it("updates last_offsite_backup_date on success (criterion 2)", async () => {
    const db = makeFakeDb(SOURCE_BOOKMARKS.map((b) => ({ ...b, tags: [...b.tags] })));
    (initDB as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(db);

    const service = new CloudSyncService(DRIVE_CONFIG);
    registerLocalBackupProvider(service);
    mockFetch.mockImplementation(async (_input: unknown, init?: RequestInit) => {
      if (init?.method === "POST") {return jsonResponse({ id: "file-1" });}
      return okResponse();
    });

    const before = Date.now();
    const result = await service.sync();
    const after = Date.now();
    expect(result.success).toBe(true);
    const raw = localStorage.getItem(STORAGE_KEYS.BOOKMARKFORGE_CLOUD_LASTBACKUP);
    expect(raw).not.toBeNull();
    const stored = Number(raw);
    expect(stored).toBeGreaterThanOrEqual(before - 1000);
    expect(stored).toBeLessThanOrEqual(after + 1000);
  });
});

describe("F2-C zero-knowledge offsite backup (Dropbox)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    localStorage.clear();
    (globalThis as { __VAULT_PASSWORD__?: string | null }).__VAULT_PASSWORD__ =
      "master-password-123";
  });

  const DROPBOX_CONFIG = {
    provider: "dropbox" as const,
    authToken: "dropbox-test-token",
  };

  it("uploads only ciphertext — zero plaintext titles or URLs (criterion 1)", async () => {
    const db = makeFakeDb(SOURCE_BOOKMARKS.map((b) => ({ ...b, tags: [...b.tags] })));
    (initDB as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(db);

    const service = new CloudSyncService(DROPBOX_CONFIG);
    registerLocalBackupProvider(service);

    let uploadedBody = "";
    mockFetch.mockImplementation(async (_input: unknown, init?: RequestInit) => {
      if (init?.method === "POST") {
        const body = String(init.body ?? "");
        // Dropbox uploads the payload via POST; skip the HMAC sidecar body.
        if (!body.includes('"hmac"')) {
          uploadedBody = body;
          return jsonResponse({ id: "dbx-1" });
        }
      }
      return okResponse();
    });

    const result = await service.sync();
    expect(result.success).toBe(true);
    expect(uploadedBody).not.toBe("");
    const payload = JSON.parse(uploadedBody) as { encrypted: boolean; data: string };
    expect(payload.encrypted).toBe(true);
    for (const b of SOURCE_BOOKMARKS) {
      expect(uploadedBody).not.toContain(b.title);
      expect(uploadedBody).not.toContain(b.url);
      expect(uploadedBody).not.toContain("Confidential");
    }
  });

  it("updates last_offsite_backup_date on success (criterion 2)", async () => {
    const db = makeFakeDb(SOURCE_BOOKMARKS.map((b) => ({ ...b, tags: [...b.tags] })));
    (initDB as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(db);

    const service = new CloudSyncService(DROPBOX_CONFIG);
    registerLocalBackupProvider(service);
    mockFetch.mockImplementation(async (_input: unknown, init?: RequestInit) => {
      if (init?.method === "POST") {return jsonResponse({ id: "dbx-1" });}
      return okResponse();
    });

    const before = Date.now();
    const result = await service.sync();
    const after = Date.now();
    expect(result.success).toBe(true);
    const raw = localStorage.getItem(STORAGE_KEYS.BOOKMARKFORGE_CLOUD_LASTBACKUP);
    expect(raw).not.toBeNull();
    const stored = Number(raw);
    expect(stored).toBeGreaterThanOrEqual(before - 1000);
    expect(stored).toBeLessThanOrEqual(after + 1000);
  });
});
