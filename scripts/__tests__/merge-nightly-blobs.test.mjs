/**
 * scripts/__tests__/merge-nightly-blobs.test.mjs
 *
 * Unit tests for the resilient nightly blob-report merge
 * (scripts/merge-nightly-blobs.mjs): blob counting, the skip/merge decision
 * matrix, and the exit-code contract for graceful degradation vs real merge
 * failures.
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { countBlobs, decideMerge } from "../merge-nightly-blobs.mjs";

function makeDir() {
  return mkdtempSync(join(tmpdir(), "merge-blobs-test-"));
}

describe("countBlobs", () => {
  it("returns 0 when the directory does not exist", async () => {
    expect(await countBlobs(join(makeDir(), "nope"))).toBe(0);
  });

  it("counts .zip blob reports at the top level", async () => {
    const dir = makeDir();
    writeFileSync(join(dir, "report-abc-1.zip"), "zip1");
    writeFileSync(join(dir, "report-def-2.zip"), "zip2");
    writeFileSync(join(dir, "notes.txt"), "ignored");
    expect(await countBlobs(dir)).toBe(2);
    rmSync(dir, { recursive: true, force: true });
  });

  it("counts extracted blob dirs containing report.json", async () => {
    const dir = makeDir();
    const shard = join(dir, "human-like-blob-1");
    mkdirSync(shard, { recursive: true });
    writeFileSync(join(shard, "report.json"), "{}");
    expect(await countBlobs(dir)).toBe(1);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("decideMerge", () => {
  it("skips gracefully when no blobs were produced", () => {
    const d = decideMerge(0, 4);
    expect(d.action).toBe("skip");
    expect(d.reason).toContain("no blob reports");
  });

  it("skips with a warning on an incomplete shard set", () => {
    const d = decideMerge(3, 4);
    expect(d.action).toBe("skip");
    expect(d.reason).toContain("3/4");
  });

  it("merges when the full set is present", () => {
    expect(decideMerge(4, 4).action).toBe("merge");
    expect(decideMerge(2, 2).action).toBe("merge");
  });

  it("merges tolerating extra shards", () => {
    expect(decideMerge(5, 4).action).toBe("merge");
  });

  it("errors on invalid expected shard counts", () => {
    expect(decideMerge(2, 0).action).toBe("error");
    expect(decideMerge(2, -1).action).toBe("error");
  });
});
