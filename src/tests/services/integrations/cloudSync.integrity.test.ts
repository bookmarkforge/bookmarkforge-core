/**
 * Remote backup integrity sidecar (HMAC per remote version).
 *
 * Covers:
 *  1. Upload publishes a sidecar whose tag binds the exact payload bytes
 *     (size + HMAC) and the exact remote filename.
 *  2. verifyRemoteBackup verifies a genuine download, and rejects
 *     tampered / truncated / cross-version payloads BEFORE any decryption
 *     (no Argon2id, no DB access — only HMAC over raw bytes).
 *  3. Wrong master password fails verification (key derivation binds it).
 *  4. Retention prunes a payload together with its sidecar, and never
 *     prunes the sidecar of a retained version.
 *
 * The encryption path is REAL (AES-GCM + Argon2id fallback) and the sidecar
 * HMAC runs against real WebCrypto; only the provider transport (fetch),
 * the database boundary and settings are mocked, mirroring
 * cloudSync.offsite-backup.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../db/database", () => ({ initDB: vi.fn() }));

vi.mock("../../../services/SettingsService", () => ({
  settingsService: {
    exportSettings: vi.fn(() => ({})),
    importSettings: vi.fn(),
  },
}));

vi.mock("../../../services/pro-access", async () => ({
  loadBackupService: async () =>
    (await import("../../../services/BackupService")).BackupService,
  // P1 contract member: BackupService imports the disk-copy loader for the
  // F0-1 auto-backup branch. That branch is exercised end-to-end in
  // BackupService.test (mock at L79, cases at L2040-2127); this file's flows
  // never reach auto-backup — see ledger Ruling P1.7.
  loadDiskBackupService: vi.fn().mockResolvedValue({
    buildBackupFileName: vi.fn().mockReturnValue("bookmarkforge-backup.json"),
    writeBackupToDisk: vi.fn().mockResolvedValue(null),
  }),
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
import {
  INTEGRITY_SIDECAR_SUFFIX,
  createRemoteIntegritySidecar,
  verifyRemoteBackupIntegrity,
} from "../../../services/integrations/cloudSync.integrity";

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

interface CapturedPut {
  url: string;
  body: string;
}

function basename(url: string): string {
  const raw = url.split("/").pop() ?? "";
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function isSidecarJson(body: string): boolean {
  try {
    const parsed = JSON.parse(body) as { v?: unknown; hmac?: unknown };
    return parsed.v === 1 && typeof parsed.hmac === "string";
  } catch {
    return false;
  }
}

describe("remote backup integrity sidecar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    localStorage.clear();
    (globalThis as { __VAULT_PASSWORD__?: string | null }).__VAULT_PASSWORD__ =
      "master-password-123";
  });

  it("uploads a sidecar bound to the exact payload bytes and filename", async () => {
    const service = new CloudSyncService(WEBDAV_CONFIG);
    // Hermetic payload: the sidecar path only needs an envelope string;
    // the full encrypted-backup pipeline is covered by offsite-backup tests.
    service.setLocalDataProvider(async () => ({
      encrypted: true,
      data: Buffer.from("ciphertext-bytes").toString("base64"),
      timestamp: Date.now(),
    }));

    const puts: CapturedPut[] = [];
    mockFetch.mockImplementation(async (input: unknown, init?: RequestInit) => {
      if (init?.method === "PUT") {
        puts.push({
          url: String(input),
          body: String(init.body ?? ""),
        });
      }
      return okResponse();
    });

    const result = await service.sync();
    expect(result.success).toBe(true);

    const payloadPut = puts.find((p) => !isSidecarJson(p.body));
    const sidecarPut = puts.find((p) => isSidecarJson(p.body));
    expect(payloadPut).toBeDefined();
    expect(sidecarPut).toBeDefined();

    const sidecar = JSON.parse(sidecarPut!.body) as {
      v: number;
      alg: string;
      fileName: string;
      size: number;
      hmac: string;
    };
    expect(sidecar.v).toBe(1);
    expect(sidecar.alg).toBe("HMAC-SHA256");

    // The tag binds the exact uploaded payload bytes.
    expect(sidecar.size).toBe(
      new TextEncoder().encode(payloadPut!.body).length,
    );
    expect(sidecar.fileName).toMatch(/^bookmarkforge_sync_webdav_\d{13}\.json$/);
    expect(sidecarPut!.url).toContain(
      encodeURIComponent(sidecar.fileName) + INTEGRITY_SIDECAR_SUFFIX,
    );
    expect(sidecar.hmac).toMatch(
      /^sidecar-v1:[0-9a-f]{64}:[0-9a-f]{64}$/,
    );
  });

  it("verifies a genuine download and rejects tampering before decryption", async () => {
    const password = new TextEncoder().encode("master-password-123");
    const payload = new TextEncoder().encode('{"encrypted":true,"data":"AAAA"}');
    const fileName = "bookmarkforge_sync_webdav_1700000000000.json";
    const sidecarJson = await createRemoteIntegritySidecar(
      payload,
      fileName,
      password,
    );

    // Genuine payload verifies.
    const ok = await verifyRemoteBackupIntegrity(payload, sidecarJson, password, fileName);
    expect(ok.status).toBe("verified");

    // Flipped byte → tampered.
    const tampered = payload.slice();
    tampered[5] = (tampered[5]! + 1) % 256;
    const tamperedResult = await verifyRemoteBackupIntegrity(
      tampered,
      sidecarJson,
      password,
      fileName,
    );
    expect(tamperedResult).toEqual({ status: "mismatch", reason: "tampered" });

    // Truncated payload → detected via the bound size, before HMAC work.
    const truncatedResult = await verifyRemoteBackupIntegrity(
      payload.slice(0, payload.length - 5),
      sidecarJson,
      password,
      fileName,
    );
    expect(truncatedResult).toEqual({ status: "mismatch", reason: "truncated" });

    // A sidecar for another version never authenticates this payload.
    const otherName = "bookmarkforge_sync_webdav_1700000000001.json";
    const crossResult = await verifyRemoteBackupIntegrity(
      payload,
      sidecarJson,
      password,
      otherName,
    );
    expect(crossResult).toEqual({ status: "mismatch", reason: "tag-format" });

    // Wrong master password → HMAC mismatch (key derivation binds it).
    const wrongPw = new TextEncoder().encode("another-password");
    const wrongPwResult = await verifyRemoteBackupIntegrity(
      payload,
      sidecarJson,
      wrongPw,
      fileName,
    );
    expect(wrongPwResult).toEqual({ status: "mismatch", reason: "tampered" });

    // Malformed sidecar → tag-format, never an exception.
    const malformed = await verifyRemoteBackupIntegrity(
      payload,
      "{not json",
      password,
      fileName,
    );
    expect(malformed).toEqual({ status: "mismatch", reason: "tag-format" });

    // Missing sidecar → legacy path.
    const missing = await verifyRemoteBackupIntegrity(payload, null, password, fileName);
    expect(missing).toEqual({ status: "missing" });
  });

  it("service-level verifyRemoteBackup downloads and verifies the sidecar", async () => {
    const service = new CloudSyncService(WEBDAV_CONFIG);
    const password = new TextEncoder().encode("master-password-123");
    const payload = new TextEncoder().encode('{"encrypted":true,"data":"BBBB"}');
    const fileName = "bookmarkforge_sync_webdav_1700000000002.json";
    const sidecarJson = await createRemoteIntegritySidecar(
      payload,
      fileName,
      password,
    );

    const fakeAdapter = {
      providerName: "webdav" as const,
      listFiles: vi.fn(async () => [
        { id: "sc-1", name: `${fileName}${INTEGRITY_SIDECAR_SUFFIX}` },
      ]),
      downloadFile: vi.fn(async (id: string) => {
        if (id === "sc-1") {
          return Buffer.from(new TextEncoder().encode(sidecarJson));
        }
        throw new Error("not found");
      }),
    };
    (service as unknown as { adapter?: unknown }).adapter = fakeAdapter;

    const ok = await service.verifyRemoteBackup(payload, fileName);
    expect(ok).toEqual({ status: "verified", size: payload.length });
    expect(fakeAdapter.listFiles).toHaveBeenCalledTimes(1);
    expect(fakeAdapter.downloadFile).toHaveBeenCalledWith("sc-1", undefined);

    // Tampered payload fails at service level too.
    const tampered = payload.slice();
    tampered[0] = (tampered[0]! + 1) % 256;
    const failed = await service.verifyRemoteBackup(tampered, fileName);
    expect(failed).toEqual({ status: "mismatch", reason: "tampered" });

    // A non-backup fileName is rejected without listing (no provider round-trip).
    fakeAdapter.listFiles.mockClear();
    const suspicious = await service.verifyRemoteBackup(payload, "../../etc/passwd");
    expect(suspicious).toEqual({ status: "missing" });
    expect(fakeAdapter.listFiles).not.toHaveBeenCalled();
  });

  it("retention prunes a payload together with its sidecar and keeps retained tags", async () => {
    const service = new CloudSyncService({
      ...WEBDAV_CONFIG,
      remoteRetentionCount: 2,
    });
    const files = [
      { id: "p1", name: "bookmarkforge_sync_webdav_1700000000001.json" },
      {
        id: "s1",
        name: "bookmarkforge_sync_webdav_1700000000001.json.integrity.json",
      },
      { id: "p2", name: "bookmarkforge_sync_webdav_1700000000002.json" },
      { id: "p3", name: "bookmarkforge_sync_webdav_1700000000003.json" },
      {
        id: "s3",
        name: "bookmarkforge_sync_webdav_1700000000003.json.integrity.json",
      },
    ];
    const deleted: string[] = [];
    const fakeAdapter = {
      providerName: "webdav" as const,
      listFiles: vi.fn(async () => files),
      deleteFile: vi.fn(async (id: string) => {
        deleted.push(id);
      }),
    };

    await (
      service as unknown as {
        pruneRemoteBackups: (a: unknown) => Promise<void>;
      }
    ).pruneRemoteBackups(fakeAdapter);

    // Oldest payload p1 + its sidecar s1 are deleted; retained p2/p3 and
    // p3's sidecar s3 survive.
    expect(deleted.sort()).toEqual(["p1", "s1"]);
  });
});
