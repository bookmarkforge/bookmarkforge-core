import { mkdtempSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { getAuditPayload, clearCache } from "../npm-audit-payload.mjs";

/** Synthetic repo root: manifests + a throwaway cache dir. */
function repoFixture() {
  const dir = mkdtempSync(join(tmpdir(), "audit-payload-"));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "fixture" }));
  writeFileSync(join(dir, "package-lock.json"), JSON.stringify({ lockfileVersion: 3 }));
  return dir;
}

/** Spawn stub: one JSON payload per call, records the argv it was asked to run. */
function fakeSpawn(payloads = []) {
  const calls = [];
  const spawn = (_exe, args) => {
    calls.push(args);
    const next = payloads[calls.length - 1];
    if (typeof next === "string") return { status: 1, stdout: "", stderr: next };
    return { status: 0, stdout: JSON.stringify({ vulnerabilities: {} }), stderr: "" };
  };
  return { spawn, calls };
}

let dir;
let envBackup;
beforeEach(() => {
  dir = repoFixture();
  envBackup = { ...process.env };
  delete process.env.BMF_AUDIT_FRESH;
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  process.env = envBackup;
});

const CACHE_DIR = () => join(dir, "cache");

describe("npm-audit-payload (shared single acquisition)", () => {
  it("runs the audit once and serves the second call from cache", () => {
    const { spawn, calls } = fakeSpawn();
    const log = vi.fn();

    const first = getAuditPayload({ includeDev: false, spawn, cacheDir: CACHE_DIR(), log });
    const second = getAuditPayload({ includeDev: false, spawn, cacheDir: CACHE_DIR(), log });

    expect(first).toEqual({ vulnerabilities: {} });
    expect(second).toEqual(first);
    expect(calls).toHaveLength(1); // the whole point: one npm audit, two gates
    expect(calls[0]).toContain("--omit=dev");
    expect(log).toHaveBeenCalledWith(expect.stringContaining("cache hit"));
  });

  it("keeps prod and dev profiles in separate cache slots", () => {
    const { spawn, calls } = fakeSpawn();

    getAuditPayload({ includeDev: false, spawn, cacheDir: CACHE_DIR(), log: vi.fn() });
    getAuditPayload({ includeDev: true, spawn, cacheDir: CACHE_DIR(), log: vi.fn() });

    expect(calls).toHaveLength(2);
    expect(calls[0]).not.toContain("--include-dev");
    expect(existsSync(join(CACHE_DIR(), "audit-prod.json"))).toBe(true);
    expect(existsSync(join(CACHE_DIR(), "audit-dev.json"))).toBe(true);
  });

  it("ignores the cache when the manifests changed since it was written", () => {
    const { spawn, calls } = fakeSpawn();
    const log = vi.fn();
    const cacheDir = CACHE_DIR();

    getAuditPayload({ spawn, cacheDir, root: dir, log: vi.fn() });
    // Touch package-lock.json so its mtime/size fingerprint no longer matches.
    const lockPath = join(dir, "package-lock.json");
    writeFileSync(lockPath, JSON.stringify({ lockfileVersion: 3, changed: true }));
    const t = new Date();
    utimesSync(lockPath, t, t);

    getAuditPayload({ spawn, cacheDir, root: dir, log });

    expect(calls).toHaveLength(2);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("stale"));
  });

  it("honours the TTL: an old cache entry forces a fresh run", () => {
    const { spawn, calls } = fakeSpawn();
    const cacheDir = CACHE_DIR();

    getAuditPayload({ spawn, cacheDir, now: 1_000, log: vi.fn() });
    getAuditPayload({ spawn, cacheDir, now: 1_000 + 10 * 60 * 1000 + 1, log: vi.fn() });

    expect(calls).toHaveLength(2);
  });

  it("degrades to a fresh audit when the cache file is corrupt", () => {
    const { spawn, calls } = fakeSpawn();
    const log = vi.fn();
    const cacheDir = CACHE_DIR();
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(join(cacheDir, "audit-prod.json"), "{not json");

    getAuditPayload({ spawn, cacheDir, log });

    expect(calls).toHaveLength(1);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("unreadable"));
  });

  it("BMF_AUDIT_FRESH=1 bypasses the cache entirely", () => {
    process.env.BMF_AUDIT_FRESH = "1";
    const { spawn, calls } = fakeSpawn();
    const cacheDir = CACHE_DIR();

    getAuditPayload({ spawn, cacheDir, log: vi.fn() });
    getAuditPayload({ spawn, cacheDir, log: vi.fn() });

    expect(calls).toHaveLength(2);
  });

  it("fail-closed: an npm audit that yields no JSON throws", () => {
    const { spawn } = fakeSpawn(["registry unreachable"]);
    expect(() =>
      getAuditPayload({ spawn, cacheDir: CACHE_DIR(), log: vi.fn() }),
    ).toThrow(/produced no JSON/);
  });

  it("a failing cache write never fails the gate after a successful audit", () => {
    // Cache dir path is occupied by a FILE, so mkdir/write inside it throws.
    const cacheDir = join(dir, "occupied");
    writeFileSync(cacheDir, "not a directory");
    const { spawn } = fakeSpawn();
    const log = vi.fn();

    const payload = getAuditPayload({ spawn, cacheDir, log });

    expect(payload).toEqual({ vulnerabilities: {} });
    expect(log).toHaveBeenCalledWith(expect.stringContaining("cache write failed"));
  });

  it("clearCache removes the cache directory", () => {
    const { spawn } = fakeSpawn();
    const cacheDir = CACHE_DIR();
    getAuditPayload({ spawn, cacheDir, log: vi.fn() });
    expect(existsSync(join(cacheDir, "audit-prod.json"))).toBe(true);

    clearCache({ dir: cacheDir });
    expect(existsSync(cacheDir)).toBe(false);
  });

  it("cached payload round-trips byte-faithfully through the wrapper format", () => {
    const { spawn } = fakeSpawn();
    const cacheDir = CACHE_DIR();
    getAuditPayload({ spawn, cacheDir, log: vi.fn() });

    const wrapped = JSON.parse(readFileSync(join(cacheDir, "audit-prod.json"), "utf8"));
    expect(wrapped.__npm_audit_payload_meta).toMatchObject({
      fingerprint: expect.stringContaining("package.json:"),
      cachedAt: expect.any(Number),
    });
    expect(wrapped.payload).toEqual({ vulnerabilities: {} });
  });
});
