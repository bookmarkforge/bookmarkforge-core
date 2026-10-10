// P0 regression — A-1: per-vault Argon2id salt (v6 payloads) + transparent
// migration of legacy v5 payloads.
//
// The exposure this pins: the v5/session master-key derivations used a
// CONSTANT bundle-wide Argon2id salt, so one Argon2id pass over a candidate
// password served every vault in the world (an attacker with a corpus of
// password-encrypted blobs — verification token, encrypted_db_key,
// encrypted_api_key — could reuse a single dictionary). Every vault now mints
// a random salt, payloads embed it (`v6:`), and legacy payloads keep
// decrypting and get re-wrapped.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Subject } from "rxjs";

import { authenticatedEncryptionStorage } from "../../db/authEncryptionStorage";
import {
  decrypt,
  decryptWithSessionKey,
  encrypt,
  encryptWithSessionKey,
  getVaultKdfSaltHex,
  resetSessionKeyCache,
  setVaultKdfSalt,
  VAULT_KDF_SALT_BYTES,
} from "../../utils/crypto-core";
import {
  adoptVaultKdfSaltFromStorage,
  ensureVaultKdfSalt,
  isVaultKdfSaltHex,
  migrateVaultSecretsToVaultSalt,
  restoreVaultKdfSalt,
  rotateVaultKdfSalt,
  snapshotVaultKdfSalt,
} from "../../services/security-vault/kdf-salt";
import {
  announceVaultKdfSaltChange,
  KDF_SALT_CHANGED_MESSAGE,
  KDF_SALT_SYNC_CHANNEL,
  startVaultKdfSaltSync,
  stopVaultKdfSaltSync,
} from "../../services/security-vault/kdf-salt-sync";
import { SECURE_STORAGE_KEYS } from "../../services/security-vault/constants";

const SALT_A = "01".repeat(16);
const SALT_B = "ff".repeat(16);
const SALT_C = "cc".repeat(16);
const PASSWORD = "correct-horse-battery-staple";

/** Hex of a byte slice (Buffer is not what Uint8Array.toString uses here). */
const hex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

const mocks = vi.hoisted(() => ({
  secureStorage: {
    getSecret: vi.fn(),
    setSecret: vi.fn(),
    deleteSecret: vi.fn(),
  },
  encryptionService: {
    configureVaultKdfSalt: vi.fn(),
    getVaultKdfSaltHex: vi.fn(),
    decryptWithBytes: vi.fn(),
    encryptWithBytes: vi.fn(),
  },
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../../services/SecureStorage", () => ({
  secureStorage: mocks.secureStorage,
}));
vi.mock("../../services/EncryptionService", () => ({
  encryptionService: mocks.encryptionService,
}));
vi.mock("../../utils/logger", () => ({ logger: mocks.logger }));

/**
 * Minimal inner RxStorage that records what the outer envelope wrote and
 * serves those rows back on read — enough to drive the authenticated storage
 * wrapper's encrypt/decrypt paths.
 */
function makeFakeInnerStorage() {
  const writes: Array<Record<string, unknown>> = [];
  const instance = {
    databaseName: "unit-db",
    collectionName: "docs",
    internals: { inner: true },
    options: {},
    schema: {},
    cleanup: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    count: vi.fn(async () => writes.length),
    remove: vi.fn(async () => undefined),
    getAttachmentData: vi.fn(async () => ({})),
    bulkWrite: vi.fn(async (rows: Array<{ document: unknown }>) => {
      writes.length = 0;
      for (const row of rows) {
        writes.push(row.document as Record<string, unknown>);
      }
      return { error: [] };
    }),
    query: vi.fn(async () => ({ documents: writes })),
    findDocumentsById: vi.fn(async () => writes),
    getChangedDocumentsSince: vi.fn(async () => ({
      checkpoint: { l: 1 },
      documents: writes,
    })),
    changeStream: vi.fn(() => new Subject()),
  };
  const storage = {
    name: "fake-inner",
    createStorageInstance: vi.fn(async () => instance),
  };
  return { storage, instance, writes };
}

const AUTH_SCHEMA = {
  title: "docs",
  version: 0,
  primaryKey: "id",
  type: "object",
  properties: {
    id: { type: "string", maxLength: 100 },
    secret: { type: "string", maxLength: 500 },
  },
  required: ["id"],
  encrypted: ["secret"],
};

describe("P0 — per-vault Argon2id salt (A-1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setVaultKdfSalt(null);
    resetSessionKeyCache();
  });

  afterEach(() => {
    setVaultKdfSalt(null);
    resetSessionKeyCache();
  });

  describe("v6 wire format", () => {
    it("encrypts as v5 without a vault salt (legacy behaviour preserved)", async () => {
      const payload = await encrypt("legacy-mode", PASSWORD);
      expect(payload.startsWith("v5:")).toBe(true);
      expect(await decrypt(payload, PASSWORD)).toBe("legacy-mode");
    });

    it("encrypts as a self-describing v6 payload once a vault salt is installed", async () => {
      setVaultKdfSalt(SALT_A);
      expect(getVaultKdfSaltHex()).toBe(SALT_A);

      const payload = await encrypt("vault-mode", PASSWORD);
      expect(payload.startsWith("v6:")).toBe(true);
      expect(await decrypt(payload, PASSWORD)).toBe("vault-mode");

      // The payload embeds the 16-byte vault salt ahead of the 16-byte HKDF
      // salt, the 12-byte IV and the ciphertext.
      const body = Buffer.from(payload.slice(3), "base64");
      expect(hex(body.subarray(0, VAULT_KDF_SALT_BYTES))).toBe(SALT_A);
    });

    it("keeps decrypting a v6 payload regardless of the locally installed salt", async () => {
      // Decryption is password + embedded salt: this is what makes shares,
      // backups and pre-migration blobs readable on any device (and after the
      // local salt is rotated).
      setVaultKdfSalt(SALT_A);
      const payload = await encrypt("portable", PASSWORD);

      setVaultKdfSalt(SALT_B);
      expect(await decrypt(payload, PASSWORD)).toBe("portable");

      setVaultKdfSalt(null);
      expect(await decrypt(payload, PASSWORD)).toBe("portable");
    });

    it("binds the master key to the embedded vault salt (a fixed-salt dictionary is useless)", async () => {
      setVaultKdfSalt(SALT_A);
      const payload = await encrypt("secret", PASSWORD);

      // Swap the embedded salt for another vault's salt, keeping the same
      // password and ciphertext: if the derivation ignored the per-vault salt
      // (the pre-A-1 behavior), the payload would still open.
      const body = Buffer.from(payload.slice(3), "base64");
      const forged = Buffer.from(body);
      Buffer.from(SALT_B, "hex").copy(forged, 0);
      const forgedPayload = "v6:" + forged.toString("base64");

      await expect(decrypt(forgedPayload, PASSWORD)).rejects.toBeDefined();
      // Control: the untouched payload still opens with the same password.
      expect(await decrypt(payload, PASSWORD)).toBe("secret");
    });

    it("still rejects the wrong password in v6 mode", async () => {
      setVaultKdfSalt(SALT_A);
      const payload = await encrypt("secret", PASSWORD);
      await expect(decrypt(payload, "wrong-password")).rejects.toBeDefined();
    });

    it("reads a legacy v5 payload after a vault salt is installed (migration read-compat)", async () => {
      // Written before the upgrade…
      const legacy = await encrypt("pre-migration", PASSWORD);
      expect(legacy.startsWith("v5:")).toBe(true);

      // …and read after it.
      setVaultKdfSalt(SALT_A);
      expect(await decrypt(legacy, PASSWORD)).toBe("pre-migration");
    });

    it("rejects a malformed vault salt instead of silently using it", () => {
      expect(() => setVaultKdfSalt("not-hex")).toThrow(/Invalid vault KDF salt/);
      expect(() => setVaultKdfSalt("ab".repeat(15))).toThrow(
        /Invalid vault KDF salt/,
      );
      expect(() => setVaultKdfSalt(new Uint8Array(8))).toThrow(
        /Invalid vault KDF salt/,
      );
      expect(getVaultKdfSaltHex()).toBeNull();
    });

    it("accepts the salt as bytes as well as hex", async () => {
      const bytes = new Uint8Array(VAULT_KDF_SALT_BYTES).fill(0x7f);
      setVaultKdfSalt(bytes);
      expect(getVaultKdfSaltHex()).toBe("7f".repeat(16));
      const payload = await encrypt("bytes-salt", PASSWORD);
      expect(payload.startsWith("v6:")).toBe(true);
      expect(await decrypt(payload, PASSWORD)).toBe("bytes-salt");
    });
  });

  describe("session-key format", () => {
    it("round-trips with the vault-salt marker and still reads the legacy layout", async () => {
      const data = new TextEncoder().encode("session-payload");

      // Legacy payload (no salt installed): no marker byte, so its length is
      // exactly hkdf_salt + iv + ciphertext (the marker byte is random for
      // legacy blobs, hence the length check instead of a marker check).
      const legacy = await encryptWithSessionKey(data, PASSWORD);
      expect(legacy.length).toBe(16 + 12 + data.length + 16);

      // After the upgrade: marked layout, and the legacy payload still reads.
      setVaultKdfSalt(SALT_A);
      expect(Array.from(await decryptWithSessionKey(legacy, PASSWORD))).toEqual(
        Array.from(data),
      );

      const salted = await encryptWithSessionKey(data, PASSWORD);
      expect(salted[0]).toBe(0x06);
      expect(hex(salted.subarray(1, 1 + VAULT_KDF_SALT_BYTES))).toBe(SALT_A);
      expect(
        Array.from(await decryptWithSessionKey(salted, PASSWORD)),
      ).toEqual(Array.from(data));
    });

    it("fails closed on a corrupted vault-salted session payload", async () => {
      setVaultKdfSalt(SALT_A);
      const salted = await encryptWithSessionKey(
        new TextEncoder().encode("payload"),
        PASSWORD,
      );
      salted[salted.length - 1]! ^= 0x01;
      await expect(decryptWithSessionKey(salted, PASSWORD)).rejects.toBeDefined();
    });
  });

  describe("authenticated storage envelope (RxDB outer layer)", () => {
    it("writes v6 envelopes and unwraps them on a read with no local salt", async () => {
      const { storage, writes } = makeFakeInnerStorage();
      const wrapped = authenticatedEncryptionStorage({
        storage: storage as never,
        name: "kdf-salt-regression",
      }) as unknown as {
        createStorageInstance: (params: unknown) => Promise<{
          bulkWrite: (rows: unknown[], context: string) => Promise<unknown>;
          query: (query: unknown) => Promise<{ documents: Array<Record<string, unknown>> }>;
        }>;
      };
      const inst = await wrapped.createStorageInstance({
        databaseName: "unit-db",
        collectionName: "docs",
        schema: AUTH_SCHEMA,
        options: {},
        password: "database-password",
        multiInstance: false,
        eventReduce: true,
      });

      setVaultKdfSalt(SALT_A);
      await inst.bulkWrite(
        [{ previous: null, document: { id: "d1", secret: "plaintext-secret" } }],
        "unit",
      );
      // The row is stored under the per-vault salt…
      expect(String(writes[0]!.secret)).toMatch(/^v6:/);
      expect(String(writes[0]!.secret)).not.toContain("plaintext-secret");

      // …and a fresh process (no vault salt installed yet) still unwraps it,
      // because the v6 envelope embeds the salt it was written with. A read
      // path that only recognised v4/v5 markers would hand the raw envelope
      // back to RxDB as the field value.
      setVaultKdfSalt(null);
      const queried = await inst.query({});
      expect(queried.documents[0]!.secret).toBe("plaintext-secret");
    });
  });

  describe("ensureVaultKdfSalt", () => {
    it("mints, persists and installs a salt when the vault has none", async () => {
      mocks.secureStorage.getSecret.mockResolvedValue(null);
      mocks.secureStorage.setSecret.mockResolvedValue(undefined);
      mocks.encryptionService.configureVaultKdfSalt.mockResolvedValue(
        undefined,
      );

      const salt = await ensureVaultKdfSalt();

      expect(salt).toMatch(/^[0-9a-f]{32}$/);
      expect(mocks.secureStorage.setSecret).toHaveBeenCalledWith(
        SECURE_STORAGE_KEYS.KDF_SALT,
        salt,
      );
      expect(mocks.encryptionService.configureVaultKdfSalt).toHaveBeenCalledWith(
        salt,
      );
    });

    it("reuses the stored salt without rewriting it", async () => {
      mocks.secureStorage.getSecret.mockResolvedValue(SALT_A.toUpperCase());
      mocks.encryptionService.configureVaultKdfSalt.mockResolvedValue(
        undefined,
      );

      await expect(ensureVaultKdfSalt()).resolves.toBe(SALT_A);
      expect(mocks.secureStorage.setSecret).not.toHaveBeenCalled();
      expect(mocks.encryptionService.configureVaultKdfSalt).toHaveBeenCalledWith(
        SALT_A,
      );
    });

    it("stays in legacy mode when the stored salt is unreadable", async () => {
      mocks.secureStorage.getSecret.mockRejectedValue(
        Object.assign(new Error("device key wrapped"), {
          name: "DEVICE_KEY_WRAPPED",
        }),
      );

      await expect(ensureVaultKdfSalt()).resolves.toBeNull();
      expect(mocks.secureStorage.setSecret).not.toHaveBeenCalled();
      expect(
        mocks.encryptionService.configureVaultKdfSalt,
      ).not.toHaveBeenCalled();
    });

    it("keeps the minted salt usable when persisting it fails", async () => {
      mocks.secureStorage.getSecret.mockResolvedValue(null);
      mocks.secureStorage.setSecret.mockRejectedValue(new Error("quota"));
      mocks.encryptionService.configureVaultKdfSalt.mockResolvedValue(
        undefined,
      );

      const salt = await ensureVaultKdfSalt();
      // v6 payloads carry the salt themselves, so a failed write costs an
      // Argon2id re-derivation next session — never access to the data.
      expect(salt).toMatch(/^[0-9a-f]{32}$/);
      expect(mocks.encryptionService.configureVaultKdfSalt).toHaveBeenCalledWith(
        salt,
      );
    });
  });

  describe("migrateVaultSecretsToVaultSalt", () => {
    it("re-wraps legacy password-encrypted secrets and leaves v6 ones alone", async () => {
      mocks.secureStorage.getSecret.mockImplementation((key: string) =>
        Promise.resolve(
          key === SECURE_STORAGE_KEYS.DB_KEY
            ? "v5:legacy-db-key"
            : key === SECURE_STORAGE_KEYS.API_KEY
              ? "v6:already-salted"
              : null,
        ),
      );
      mocks.encryptionService.decryptWithBytes.mockResolvedValue("plaintext");
      mocks.encryptionService.encryptWithBytes.mockResolvedValue("v6:rewrapped");
      mocks.secureStorage.setSecret.mockResolvedValue(undefined);

      const result = await migrateVaultSecretsToVaultSalt(PASSWORD);

      expect(result.migrated).toEqual([SECURE_STORAGE_KEYS.DB_KEY]);
      expect(result.failed).toEqual([]);
      expect(mocks.secureStorage.setSecret).toHaveBeenCalledTimes(1);
      expect(mocks.secureStorage.setSecret).toHaveBeenCalledWith(
        SECURE_STORAGE_KEYS.DB_KEY,
        "v6:rewrapped",
      );
      // The plaintext is never touched by the migration itself: it is
      // decrypted with the just-verified password and immediately re-encrypted.
      expect(mocks.encryptionService.decryptWithBytes).toHaveBeenCalledWith(
        "v5:legacy-db-key",
        expect.any(Uint8Array),
      );
    });

    it("leaves an unreadable secret untouched and never throws", async () => {
      mocks.secureStorage.getSecret.mockRejectedValue(
        new Error("device key wrapped"),
      );

      const result = await migrateVaultSecretsToVaultSalt(PASSWORD);

      expect(result).toEqual({ migrated: [], failed: [] });
      expect(mocks.secureStorage.setSecret).not.toHaveBeenCalled();
    });

    it("keeps a legacy secret readable when re-wrapping it fails", async () => {
      mocks.secureStorage.getSecret.mockResolvedValue("v5:legacy");
      mocks.encryptionService.decryptWithBytes.mockRejectedValue(
        new Error("auth failed"),
      );

      const result = await migrateVaultSecretsToVaultSalt(PASSWORD);

      // Every listed legacy secret is reported as untouched (and therefore
      // still readable with the legacy derivation) — the migration is
      // per-key and non-fatal.
      expect(result.failed).toEqual([
        SECURE_STORAGE_KEYS.DB_KEY,
        SECURE_STORAGE_KEYS.API_KEY,
      ]);
      expect(mocks.secureStorage.setSecret).not.toHaveBeenCalled();
    });

    it("does nothing without a password", async () => {
      await expect(migrateVaultSecretsToVaultSalt("")).resolves.toEqual({
        migrated: [],
        failed: [],
      });
      expect(mocks.secureStorage.getSecret).not.toHaveBeenCalled();
    });
  });

  // A-1 rotation: a password change must invalidate the salt too, because the
  // harvested corpus (token + encrypted keys) is what a dictionary attacks and
  // a dictionary is only useful while the salt that produced it stays in use.
  describe("rotateVaultKdfSalt", () => {
    beforeEach(() => {
      mocks.secureStorage.getSecret.mockResolvedValue(null);
      mocks.secureStorage.setSecret.mockResolvedValue(undefined);
      mocks.secureStorage.deleteSecret.mockResolvedValue(undefined);
      mocks.encryptionService.configureVaultKdfSalt.mockResolvedValue(
        undefined,
      );
      mocks.encryptionService.getVaultKdfSaltHex.mockReturnValue(null);
    });

    it("persists the new salt BEFORE installing it, and never reuses the old one", async () => {
      mocks.secureStorage.getSecret.mockResolvedValue(SALT_A);
      mocks.encryptionService.getVaultKdfSaltHex.mockReturnValue(SALT_A);

      const snapshot = await snapshotVaultKdfSalt();
      expect(snapshot).toEqual({ stored: SALT_A, installed: SALT_A });

      const fresh = await rotateVaultKdfSalt(snapshot);
      expect(fresh).toMatch(/^[0-9a-f]{32}$/);
      expect(fresh).not.toBe(SALT_A);
      expect(mocks.secureStorage.setSecret).toHaveBeenCalledWith(
        SECURE_STORAGE_KEYS.KDF_SALT,
        fresh,
      );
      expect(mocks.encryptionService.configureVaultKdfSalt).toHaveBeenCalledWith(
        fresh,
      );

      // Persist-then-install: until the new salt is durable, the vault must
      // keep encrypting with the old one, so a crash can never leave it
      // writing under a salt storage has not seen.
      expect(
        mocks.secureStorage.setSecret.mock.invocationCallOrder[0],
      ).toBeLessThan(
        mocks.encryptionService.configureVaultKdfSalt.mock
          .invocationCallOrder[0]!,
      );
    });

    it("fails loudly and installs nothing when the new salt cannot be persisted", async () => {
      mocks.secureStorage.getSecret.mockResolvedValue(SALT_A);
      mocks.encryptionService.getVaultKdfSaltHex.mockReturnValue(SALT_A);
      mocks.secureStorage.setSecret.mockRejectedValue(new Error("quota"));

      await expect(
        rotateVaultKdfSalt(await snapshotVaultKdfSalt()),
      ).rejects.toThrow(/quota/);
      expect(
        mocks.encryptionService.configureVaultKdfSalt,
      ).not.toHaveBeenCalled();
    });

    it("refuses to hand back a repeated salt (a broken RNG must not silently defeat the rotation)", async () => {
      const spy = vi
        .spyOn(globalThis.crypto, "getRandomValues")
        .mockImplementation(((bytes: Uint8Array) => {
          bytes.fill(0);
          return bytes;
        }) as never);
      try {
        await expect(
          rotateVaultKdfSalt({
            stored: "00".repeat(16),
            installed: "00".repeat(16),
          }),
        ).rejects.toThrow(/repeated salt/);
        expect(mocks.secureStorage.setSecret).not.toHaveBeenCalled();
      } finally {
        spy.mockRestore();
      }
    });

    it("reports an unreadable stored salt as unknown, not as absent", async () => {
      mocks.secureStorage.getSecret.mockRejectedValue(
        Object.assign(new Error("device key wrapped"), {
          name: "DEVICE_KEY_WRAPPED",
        }),
      );
      mocks.encryptionService.getVaultKdfSaltHex.mockReturnValue(SALT_B);

      await expect(snapshotVaultKdfSalt()).resolves.toEqual({
        stored: undefined,
        installed: SALT_B,
      });
    });

    it("re-keys the vault: the new salt reaches the crypto layer and nothing old becomes unreadable", async () => {
      // Real crypto-core (not mocked in this file) wired the way
      // EncryptionService wires it: the mocked configureVaultKdfSalt delegates
      // to the real setVaultKdfSalt.
      setVaultKdfSalt(SALT_A);
      const before = await encrypt("before-rotation", PASSWORD);
      expect(before.startsWith("v6:")).toBe(true);

      mocks.secureStorage.getSecret.mockResolvedValue(SALT_A);
      mocks.encryptionService.getVaultKdfSaltHex.mockReturnValue(SALT_A);
      mocks.encryptionService.configureVaultKdfSalt.mockImplementation(
        async (salt: string | null) => {
          setVaultKdfSalt(salt);
        },
      );

      const fresh = await rotateVaultKdfSalt(await snapshotVaultKdfSalt());
      expect(getVaultKdfSaltHex()).toBe(fresh);

      // Everything written from now on embeds the NEW salt…
      const after = await encrypt("after-rotation", PASSWORD);
      expect(
        hex(Buffer.from(after.slice(3), "base64").subarray(0, VAULT_KDF_SALT_BYTES)),
      ).toBe(fresh);
      // …and the payload from before still opens, because v6 carries its own.
      expect(await decrypt(before, PASSWORD)).toBe("before-rotation");
      expect(await decrypt(after, PASSWORD)).toBe("after-rotation");
    });
  });

  describe("restoreVaultKdfSalt", () => {
    beforeEach(() => {
      mocks.secureStorage.getSecret.mockResolvedValue(null);
      mocks.secureStorage.setSecret.mockResolvedValue(undefined);
      mocks.secureStorage.deleteSecret.mockResolvedValue(undefined);
      mocks.encryptionService.configureVaultKdfSalt.mockResolvedValue(
        undefined,
      );
      mocks.encryptionService.getVaultKdfSaltHex.mockReturnValue(null);
    });

    it("puts both halves back", async () => {
      await restoreVaultKdfSalt({ stored: SALT_A, installed: SALT_A });

      expect(mocks.secureStorage.setSecret).toHaveBeenCalledWith(
        SECURE_STORAGE_KEYS.KDF_SALT,
        SALT_A,
      );
      expect(mocks.encryptionService.configureVaultKdfSalt).toHaveBeenCalledWith(
        SALT_A,
      );
    });

    it("clears a salt that did not exist before, and still re-installs the in-memory one when the write fails", async () => {
      mocks.secureStorage.setSecret.mockRejectedValue(
        new Error("storage down"),
      );

      await restoreVaultKdfSalt({ stored: null, installed: SALT_B });

      expect(mocks.secureStorage.deleteSecret).toHaveBeenCalledWith(
        SECURE_STORAGE_KEYS.KDF_SALT,
      );
      // The session continues with the old password, so it must also continue
      // under the derivation that password was stretched with.
      expect(mocks.encryptionService.configureVaultKdfSalt).toHaveBeenCalledWith(
        SALT_B,
      );
    });

    it("never deletes storage it could not read", async () => {
      await restoreVaultKdfSalt({ stored: undefined, installed: SALT_B });

      expect(mocks.secureStorage.deleteSecret).not.toHaveBeenCalled();
      expect(mocks.secureStorage.setSecret).not.toHaveBeenCalled();
      expect(mocks.encryptionService.configureVaultKdfSalt).toHaveBeenCalledWith(
        SALT_B,
      );
    });

    it("treats a malformed stored salt as no salt (the next unlock mints a valid one)", async () => {
      await restoreVaultKdfSalt({ stored: "not-hex", installed: SALT_A });

      expect(mocks.secureStorage.deleteSecret).toHaveBeenCalledWith(
        SECURE_STORAGE_KEYS.KDF_SALT,
      );
      expect(mocks.encryptionService.configureVaultKdfSalt).toHaveBeenCalledWith(
        SALT_A,
      );
    });
  });

  // ── A-1 / ADR-046: ordering contracts ────────────────────────────────
  //
  // These tests encode the snapshot → persist → install ordering as a
  // first-class invariant.  A refactor that reorders the two awaits in
  // `rotateVaultKdfSalt` (install before persist) will break the vault on
  // the next crash; the test below is the only thing that catches that
  // without running the full crash-recovery suite.
  describe("persist-before-install ordering contract (A-1 / ADR-046)", () => {
    beforeEach(() => {
      mocks.secureStorage.getSecret.mockResolvedValue(null);
      mocks.secureStorage.setSecret.mockResolvedValue(undefined);
      mocks.secureStorage.deleteSecret.mockResolvedValue(undefined);
      mocks.encryptionService.configureVaultKdfSalt.mockResolvedValue(
        undefined,
      );
      mocks.encryptionService.getVaultKdfSaltHex.mockReturnValue(null);
    });

    it("snapshot is side-effect free: no writes to storage or crypto layer", async () => {
      mocks.secureStorage.getSecret.mockResolvedValue(SALT_B);
      mocks.encryptionService.getVaultKdfSaltHex.mockReturnValue(SALT_B);

      await snapshotVaultKdfSalt();

      expect(mocks.secureStorage.setSecret).not.toHaveBeenCalled();
      expect(mocks.secureStorage.deleteSecret).not.toHaveBeenCalled();
      expect(
        mocks.encryptionService.configureVaultKdfSalt,
      ).not.toHaveBeenCalled();
    });

    it("persists the salt BEFORE installing it in the crypto layer", async () => {
      mocks.secureStorage.getSecret.mockResolvedValue(SALT_A);
      mocks.encryptionService.getVaultKdfSaltHex.mockReturnValue(SALT_A);

      const snapshot = await snapshotVaultKdfSalt();
      // Clear call history so we track only what rotateVaultKdfSalt does.
      mocks.secureStorage.setSecret.mockClear();
      mocks.encryptionService.configureVaultKdfSalt.mockClear();

      const fresh = await rotateVaultKdfSalt(snapshot);

      // The new salt must reach storage BEFORE it reaches the crypto layer:
      // a crash after the persist is recoverable; a crash after install-but-
      // before-persist is not — the vault would keep encrypting under a salt
      // that storage has not seen, and the next unlock would split it.
      const saltWriteOrder =
        mocks.secureStorage.setSecret.mock.invocationCallOrder[
          mocks.secureStorage.setSecret.mock.calls.findIndex(
            ([key]) => key === SECURE_STORAGE_KEYS.KDF_SALT,
          )
        ]!;
      const saltInstallOrder =
        mocks.encryptionService.configureVaultKdfSalt.mock.invocationCallOrder[
          mocks.encryptionService.configureVaultKdfSalt.mock.calls.findIndex(
            ([salt]) => salt === fresh,
          )
        ]!;
      expect(saltWriteOrder).toBeLessThan(saltInstallOrder);
    });

    it("fails CLOSED: if persistence fails, the crypto layer must NOT be updated", async () => {
      mocks.secureStorage.getSecret.mockResolvedValue(SALT_A);
      mocks.encryptionService.getVaultKdfSaltHex.mockReturnValue(SALT_A);
      mocks.secureStorage.setSecret.mockRejectedValue(
        new Error("IndexedDB quota"),
      );

      await expect(
        rotateVaultKdfSalt(await snapshotVaultKdfSalt()),
      ).rejects.toThrow("IndexedDB quota");

      // The crypto layer must still hold the OLD salt — the new one was
      // never durable, so we must not install it.
      expect(
        mocks.encryptionService.configureVaultKdfSalt,
      ).not.toHaveBeenCalled();
    });

    it("installs BEFORE the first write that uses the new salt", async () => {
      mocks.secureStorage.getSecret.mockResolvedValue(SALT_A);
      mocks.encryptionService.getVaultKdfSaltHex.mockReturnValue(SALT_A);

      const snapshot = await snapshotVaultKdfSalt();
      mocks.secureStorage.setSecret.mockClear();
      mocks.encryptionService.configureVaultKdfSalt.mockClear();

      const fresh = await rotateVaultKdfSalt(snapshot);

      // After rotateVaultKdfSalt returns, the crypto layer must already
      // be on the new salt — any payload encrypted before this check
      // would use the old one, which is wrong.
      expect(mocks.encryptionService.configureVaultKdfSalt).toHaveBeenCalledWith(
        fresh,
      );
    });
  });

  describe("cross-tab propagation of the salt (A-1 / ADR-046)", () => {
    /**
     * The module owns ONE channel, so a "sibling tab" is simulated with a
     * second channel of the same name: BroadcastChannel never delivers a
     * message to its own sender, which is exactly the semantics under test.
     */
    class FakeBroadcastChannel {
      static instances: FakeBroadcastChannel[] = [];
      readonly name: string;
      onmessage: ((event: MessageEvent) => void) | null = null;
      closed = false;
      sent: unknown[] = [];

      constructor(name: string) {
        this.name = name;
        FakeBroadcastChannel.instances.push(this);
      }

      postMessage(data: unknown): void {
        this.sent.push(data);
        for (const peer of FakeBroadcastChannel.instances) {
          if (peer !== this && peer.name === this.name && !peer.closed) {
            peer.onmessage?.({ data } as MessageEvent);
          }
        }
      }

      close(): void {
        this.closed = true;
      }

      static reset(): void {
        FakeBroadcastChannel.instances = [];
      }
    }

    const installFakeChannel = (): void => {
      (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel =
        FakeBroadcastChannel;
    };
    const removeFakeChannel = (): void => {
      delete (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel;
    };
    /** A channel standing in for the sibling tab (never the app's own). */
    const siblingTab = (): FakeBroadcastChannel =>
      new FakeBroadcastChannel(KDF_SALT_SYNC_CHANNEL);
    /** Let the fire-and-forget message handler finish its storage read. */
    const flush = async (): Promise<void> => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
    };

    /** The channel the module itself listens on and announces from. */
    let moduleChannel: FakeBroadcastChannel;

    beforeEach(() => {
      FakeBroadcastChannel.reset();
      installFakeChannel();
      startVaultKdfSaltSync();
      moduleChannel = FakeBroadcastChannel.instances[0]!;
    });

    afterEach(() => {
      stopVaultKdfSaltSync();
      FakeBroadcastChannel.reset();
      removeFakeChannel();
    });

    it("adopts the salt the sibling tab persisted, not the one in module state", async () => {
      mocks.secureStorage.getSecret.mockResolvedValue(SALT_B);
      mocks.encryptionService.getVaultKdfSaltHex.mockReturnValue(SALT_A);

      siblingTab().postMessage({ type: KDF_SALT_CHANGED_MESSAGE });
      await flush();

      expect(mocks.secureStorage.getSecret).toHaveBeenCalledWith(
        SECURE_STORAGE_KEYS.KDF_SALT,
      );
      expect(mocks.encryptionService.configureVaultKdfSalt).toHaveBeenCalledWith(
        SALT_B,
      );
    });

    it("serializes overlapping notifications so a slower old read cannot win", async () => {
      let releaseFirstRead!: (salt: string) => void;
      const firstRead = new Promise<string>((resolve) => {
        releaseFirstRead = resolve;
      });
      mocks.secureStorage.getSecret
        .mockImplementationOnce(() => firstRead)
        .mockResolvedValue(SALT_C);
      mocks.encryptionService.getVaultKdfSaltHex.mockReturnValue(SALT_A);

      const sibling = siblingTab();
      sibling.postMessage({ type: KDF_SALT_CHANGED_MESSAGE });
      sibling.postMessage({ type: KDF_SALT_CHANGED_MESSAGE });
      await new Promise((resolve) => setTimeout(resolve, 0));

      // The second notification must wait for the first storage read instead
      // of installing SALT_C and then being overwritten by the stale SALT_B.
      releaseFirstRead(SALT_B);
      await flush();

      expect(mocks.encryptionService.configureVaultKdfSalt).toHaveBeenNthCalledWith(
        1,
        SALT_B,
      );
      expect(mocks.encryptionService.configureVaultKdfSalt).toHaveBeenNthCalledWith(
        2,
        SALT_C,
      );

      sibling.close();
    });

    it("ignores any salt the message carries — storage is the authority", async () => {
      mocks.secureStorage.getSecret.mockResolvedValue(SALT_B);
      mocks.encryptionService.getVaultKdfSaltHex.mockReturnValue(SALT_A);

      // A forged payload: an attacker-chosen salt would make a single
      // dictionary reusable across vaults again, which is the downgrade that
      // matters. The message is only a trigger, so this value is never read.
      siblingTab().postMessage({
        type: KDF_SALT_CHANGED_MESSAGE,
        salt: SALT_C,
      });
      await flush();

      expect(mocks.encryptionService.configureVaultKdfSalt).toHaveBeenCalledWith(
        SALT_B,
      );
      expect(
        mocks.encryptionService.configureVaultKdfSalt,
      ).not.toHaveBeenCalledWith(SALT_C);
    });

    it("leaves the installed salt alone when storage already matches", async () => {
      mocks.secureStorage.getSecret.mockResolvedValue(SALT_A);
      mocks.encryptionService.getVaultKdfSaltHex.mockReturnValue(SALT_A);

      siblingTab().postMessage({ type: KDF_SALT_CHANGED_MESSAGE });
      await flush();

      expect(mocks.encryptionService.configureVaultKdfSalt).not.toHaveBeenCalled();
    });

    it("normalises the stored salt before comparing it with the installed one", async () => {
      mocks.secureStorage.getSecret.mockResolvedValue(`  ${SALT_B.toUpperCase()}  `);
      mocks.encryptionService.getVaultKdfSaltHex.mockReturnValue(SALT_A);

      expect(await adoptVaultKdfSaltFromStorage()).toEqual({
        status: "adopted",
        salt: SALT_B,
      });
      expect(mocks.encryptionService.configureVaultKdfSalt).toHaveBeenCalledWith(
        SALT_B,
      );
    });

    it("refuses a malformed stored salt instead of installing it", async () => {
      mocks.secureStorage.getSecret.mockResolvedValue("not-hex");
      mocks.encryptionService.getVaultKdfSaltHex.mockReturnValue(SALT_A);

      expect(await adoptVaultKdfSaltFromStorage()).toEqual({
        status: "malformed",
      });
      // Replacing a malformed salt is the unlock path's job; here it would only
      // race the tab that owns the change.
      expect(mocks.encryptionService.configureVaultKdfSalt).not.toHaveBeenCalled();
      expect(mocks.logger.warn).toHaveBeenCalled();
    });

    it("does nothing when storage holds no salt (the vault is still legacy)", async () => {
      mocks.secureStorage.getSecret.mockResolvedValue(null);
      mocks.encryptionService.getVaultKdfSaltHex.mockReturnValue(SALT_A);

      expect(await adoptVaultKdfSaltFromStorage()).toEqual({ status: "absent" });
      expect(mocks.encryptionService.configureVaultKdfSalt).not.toHaveBeenCalled();
    });

    it("survives an unreadable salt (locked device key) without throwing", async () => {
      mocks.secureStorage.getSecret.mockRejectedValue(
        new Error("device key not materialized"),
      );

      expect(await adoptVaultKdfSaltFromStorage()).toEqual({
        status: "unreadable",
      });
      expect(mocks.encryptionService.configureVaultKdfSalt).not.toHaveBeenCalled();
      expect(mocks.logger.warn).toHaveBeenCalled();
    });

    it("stops adopting once the tab stops listening", async () => {
      stopVaultKdfSaltSync();
      mocks.secureStorage.getSecret.mockResolvedValue(SALT_B);
      mocks.encryptionService.getVaultKdfSaltHex.mockReturnValue(SALT_A);

      siblingTab().postMessage({ type: KDF_SALT_CHANGED_MESSAGE });
      await flush();

      expect(mocks.encryptionService.configureVaultKdfSalt).not.toHaveBeenCalled();
    });

    it("ignores anything that is not the salt notification", async () => {
      mocks.secureStorage.getSecret.mockResolvedValue(SALT_B);
      mocks.encryptionService.getVaultKdfSaltHex.mockReturnValue(SALT_A);

      const sibling = siblingTab();
      sibling.postMessage({ type: "SOMETHING_ELSE" });
      sibling.postMessage(KDF_SALT_CHANGED_MESSAGE);
      sibling.postMessage(null);
      sibling.postMessage([KDF_SALT_CHANGED_MESSAGE]);
      await flush();

      expect(mocks.encryptionService.configureVaultKdfSalt).not.toHaveBeenCalled();
    });

    it("announces a change with no payload at all", () => {
      siblingTab();

      announceVaultKdfSaltChange();

      // The value never travels: there is nothing on the wire for a same-origin
      // script to forge, so a receiver can only re-read storage.
      expect(moduleChannel.sent).toEqual([{ type: KDF_SALT_CHANGED_MESSAGE }]);
      expect(JSON.stringify(moduleChannel.sent)).not.toContain(SALT_A);
      expect(JSON.stringify(moduleChannel.sent)).not.toContain(SALT_B);
    });

    it("does not throw when BroadcastChannel is unavailable", () => {
      stopVaultKdfSaltSync();
      removeFakeChannel();

      expect(() => startVaultKdfSaltSync()).not.toThrow();
      expect(() => announceVaultKdfSaltChange()).not.toThrow();
    });

    it("exports one definition of the salt shape for both readers", () => {
      expect(isVaultKdfSaltHex(SALT_A)).toBe(true);
      expect(isVaultKdfSaltHex(SALT_A.toUpperCase())).toBe(true);
      expect(isVaultKdfSaltHex(` ${SALT_A} `)).toBe(true);
      expect(isVaultKdfSaltHex(SALT_A.slice(1))).toBe(false);
      expect(isVaultKdfSaltHex("not-hex")).toBe(false);
      expect(isVaultKdfSaltHex("")).toBe(false);
      expect(isVaultKdfSaltHex(null)).toBe(false);
      expect(isVaultKdfSaltHex(undefined)).toBe(false);
    });
  });
});
