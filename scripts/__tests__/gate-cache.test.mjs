import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { CACHE_VERSION, getCachedVerdict, putCachedVerdict, treeFingerprint } from "../gate-cache.mjs";

let dir;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "gate-cache-"));
  writeFileSync(join(dir, "a.ts"), "export const a = 1;\n");
  writeFileSync(join(dir, "b.tsx"), "export const b = 2;\n");
  process.env.BMF_GATE_CACHE_OFF = "";
  delete process.env.BMF_GATE_CACHE_OFF;
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.BMF_GATE_CACHE_OFF;
});

const CACHE_DIR = () => join(dir, "cache");

describe("treeFingerprint", () => {
  it("is stable across calls when the tree does not change", () => {
    const f1 = treeFingerprint({ root: dir });
    const f2 = treeFingerprint({ root: dir });
    expect(f1).toBe(f2);
  });

  it("changes when a file content (size) changes", () => {
    const f1 = treeFingerprint({ root: dir });
    writeFileSync(join(dir, "a.ts"), "export const a = 22;\n");
    expect(treeFingerprint({ root: dir })).not.toBe(f1);
  });

  it("changes when a file mtime changes even with equal size", () => {
    const f1 = treeFingerprint({ root: dir });
    const t = new Date(Date.now() + 50_000);
    utimesSync(join(dir, "a.ts"), t, t);
    expect(treeFingerprint({ root: dir })).not.toBe(f1);
  });

  it("changes when a file is added or deleted", () => {
    const f1 = treeFingerprint({ root: dir });
    writeFileSync(join(dir, "new.ts"), "x");
    const f2 = treeFingerprint({ root: dir });
    expect(f2).not.toBe(f1);
    rmSync(join(dir, "new.ts"));
    expect(treeFingerprint({ root: dir })).toBe(f1);
  });

  it("hash mode: detects a same-length edit the mtime+size mode can miss", () => {
    const before = treeFingerprint({ root: dir, hash: true });
    writeFileSync(join(dir, "a.ts"), "export const a = 2;\n"); // same length
    const t = new Date();
    utimesSync(join(dir, "a.ts"), t, t); // freeze mtime to what it was
    const after = treeFingerprint({ root: dir, hash: true });
    expect(after).not.toBe(before);
  });

  it("hash mode: ignores mtime-only changes (content is the truth)", () => {
    const before = treeFingerprint({ root: dir, hash: true });
    const t = new Date(Date.now() + 50_000);
    utimesSync(join(dir, "a.ts"), t, t);
    expect(treeFingerprint({ root: dir, hash: true })).toBe(before);
  });

  it("honours extension filters and skipDirs", () => {
    writeFileSync(join(dir, "notes.txt"), "not code");
    mkdirSync(join(dir, "dist"));
    writeFileSync(join(dir, "dist", "built.ts"), "x");
    const fp = treeFingerprint({ root: dir });
    expect(fp).not.toContain("notes.txt");
    expect(fp).not.toContain("built.ts");
    expect(fp).toContain("a.ts");
  });

  it("accepts a Set of extensions (pro-boundary SCAN_EXTENSIONS shape)", () => {
    const fp = treeFingerprint({
      root: dir,
      extensions: new Set([".ts", ".tsx"]),
    });
    expect(fp).toContain("a.ts");
    expect(fp).toContain("b.tsx");
  });

  it("with extensions:null fingerprints every file regardless of type", () => {
    writeFileSync(join(dir, "c.json"), "{}");
    const fp = treeFingerprint({ root: dir, extensions: null });
    expect(fp).toContain("c.json");
  });
});

describe("verdict cache", () => {
  it("stores and retrieves a PASS verdict on fingerprint match", () => {
    const fp = treeFingerprint({ root: dir });
    putCachedVerdict({ gateName: "g1", fingerprint: fp, cacheDir: CACHE_DIR() });
    expect(getCachedVerdict({ gateName: "g1", fingerprint: fp, cacheDir: CACHE_DIR() })).toBe("pass");
  });

  it("misses when the fingerprint differs (tree changed)", () => {
    const fp = treeFingerprint({ root: dir });
    putCachedVerdict({ gateName: "g2", fingerprint: fp, cacheDir: CACHE_DIR() });
    // Deliberately size-changing: mtime+size cannot see a same-length edit
    // inside one mtime tick (that case is the hash-mode test below).
    writeFileSync(join(dir, "a.ts"), "export const a = 3333;\n");
    expect(getCachedVerdict({ gateName: "g2", fingerprint: treeFingerprint({ root: dir }), cacheDir: CACHE_DIR() })).toBeUndefined();
  });

  it("misses for a different gate name (namespacing)", () => {
    const fp = treeFingerprint({ root: dir });
    putCachedVerdict({ gateName: "gA", fingerprint: fp, cacheDir: CACHE_DIR() });
    expect(getCachedVerdict({ gateName: "gB", fingerprint: fp, cacheDir: CACHE_DIR() })).toBeUndefined();
  });

  it("degrades to a miss on a corrupt cache file", () => {
    mkdirSync(CACHE_DIR(), { recursive: true });
    writeFileSync(join(CACHE_DIR(), "g3.json"), "{broken");
    const fp = treeFingerprint({ root: dir });
    expect(getCachedVerdict({ gateName: "g3", fingerprint: fp, cacheDir: CACHE_DIR() })).toBeUndefined();
  });

  it("BMF_GATE_CACHE_OFF=1 bypasses reads and writes", () => {
    process.env.BMF_GATE_CACHE_OFF = "1";
    const fp = treeFingerprint({ root: dir });
    putCachedVerdict({ gateName: "g4", fingerprint: fp, cacheDir: CACHE_DIR() });
    expect(Object.keys(getCachedVerdict({ gateName: "g4", fingerprint: fp, cacheDir: CACHE_DIR() }) ?? {})).toEqual([]);
    expect(getCachedVerdict({ gateName: "g4", fingerprint: fp, cacheDir: CACHE_DIR() })).toBeUndefined();
  });

  it("a failing cache write is logged, never thrown", () => {
    const occupied = join(dir, "occupied");
    writeFileSync(occupied, "not a directory");
    const log = vi.fn();
    expect(() =>
      putCachedVerdict({ gateName: "g5", fingerprint: "x", cacheDir: occupied, log }),
    ).not.toThrow();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("cache write failed"));
  });

  it("entries carry the cache version for future invalidations", () => {
    const fp = treeFingerprint({ root: dir });
    putCachedVerdict({ gateName: "g6", fingerprint: fp, cacheDir: CACHE_DIR() });
    const raw = JSON.parse(readFileSync(join(CACHE_DIR(), "g6.json"), "utf8"));
    expect(raw.version).toBe(CACHE_VERSION);
    expect(raw.verdict).toBe("pass");
  });
});
