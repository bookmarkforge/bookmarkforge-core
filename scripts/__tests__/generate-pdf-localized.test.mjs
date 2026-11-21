import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pdfDate, selectDocuments } from "../generate-pdf-localized.mjs";

const script = join(import.meta.dirname, "..", "generate-pdf-localized.mjs");
const roots = [];

function scratch() {
  const dir = mkdtempSync(join(tmpdir(), "bf-manual-pdf-"));
  roots.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function build(dir, env = {}) {
  const clean = { ...process.env };
  delete clean.SOURCE_DATE_EPOCH;
  execFileSync(process.execPath, [script, "--only", "en", "--out-dir", dir], {
    env: { ...clean, ...env },
    stdio: "pipe",
  });
  return readFileSync(join(dir, "user-manual-en.pdf"));
}

const inventory = [
  { code: "es" },
  { code: "en" },
  { code: "cs", },
  { code: "fr" },
];

describe("generate-pdf-localized: reproducible artifacts", () => {
  it("pins CreationDate to the month the manuals' footer declares", () => {
    vi.stubEnv("SOURCE_DATE_EPOCH", "");
    expect(pdfDate().toISOString()).toBe("2026-09-01T00:00:00.000Z");
  });

  it("honours SOURCE_DATE_EPOCH in UTC, whatever the local zone is", () => {
    vi.stubEnv("SOURCE_DATE_EPOCH", "1700000000");
    expect(pdfDate().toISOString()).toBe("2023-11-14T22:13:20.000Z");
    // The env path trims surrounding whitespace.
    vi.stubEnv("SOURCE_DATE_EPOCH", " 1700000000 ");
    expect(pdfDate().toISOString()).toBe("2023-11-14T22:13:20.000Z");
    // An explicit epoch argument is accepted too.
    expect(pdfDate("1700000000").toISOString()).toBe("2023-11-14T22:13:20.000Z");
    vi.stubEnv("SOURCE_DATE_EPOCH", "");
    expect(pdfDate().toISOString()).toBe("2026-09-01T00:00:00.000Z");
  });

  it("refuses a SOURCE_DATE_EPOCH it cannot trust", () => {
    expect(() => pdfDate("2026-09-01")).toThrow(/whole seconds/);
    expect(() => pdfDate("99999999999999999999")).toThrow(/out of range/);
  });

  it("keeps the full inventory unless --only narrows it", () => {
    expect(selectDocuments(inventory, [])).toEqual(inventory);
    expect(selectDocuments(inventory, ["--only=cs,fr"]).map((item) => item.code)).toEqual(["cs", "fr"]);
    expect(selectDocuments(inventory, ["--only", "cs"]).map((item) => item.code)).toEqual(["cs"]);
    expect(selectDocuments(inventory, ["--only=FR"]).map((item) => item.code)).toEqual(["fr"]);
  });

  it("names the valid locales when --only asks for an unknown one", () => {
    expect(() => selectDocuments(inventory, ["--only=klingon"])).toThrow(/does not know klingon/);
    expect(() => selectDocuments(inventory, ["--only=klingon"])).toThrow(/es, en, cs, fr/);
    expect(() => selectDocuments(inventory, ["--only="])).toThrow(/needs a value/);
  });

  it("writes byte-identical PDFs for identical sources", () => {
    const first = build(scratch());
    const second = build(scratch());
    // The regression: pdfkit stamped the info dict and the trailer /ID with
    // `new Date()`, so every run rewrote all thirty binaries.
    expect(second.equals(first)).toBe(true);
    expect(first.includes(Buffer.from("(D:20260901000000Z)"))).toBe(true);
  });

  it("lets SOURCE_DATE_EPOCH move the stamp without moving the text", () => {
    const pinned = build(scratch());
    const shifted = build(scratch(), { SOURCE_DATE_EPOCH: "1700000000" });
    expect(shifted.includes(Buffer.from("(D:20231114221320Z)"))).toBe(true);
    expect(shifted.equals(pinned)).toBe(false);
    expect(shifted.length).toBe(pinned.length);
  });
});
