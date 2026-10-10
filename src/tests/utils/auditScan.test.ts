import { describe, it, expect } from "vitest";
import {
  computeAuditScan,
  MAX_AUDIT_SAMPLE,
  type AuditBookmark,
} from "../../utils/auditScan";

function bm(
  id: string,
  title: string,
  tags: string[],
  createdAt: string,
  lastVisitedAt = "",
  updatedAt = createdAt,
): AuditBookmark {
  return { id, title, tags, createdAt, lastVisitedAt, updatedAt };
}

const NOW = Date.UTC(2026, 7, 15); // fixed clock for deterministic windows
const day = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

describe("computeAuditScan", () => {
  it("returns a zeroed result for empty or invalid input", () => {
    expect(computeAuditScan([], NOW)).toEqual({
      totalTags: 0,
      visitedIn30d: 0,
      coverageByTag: [],
      outdatedCount: 0,
    });
    expect(computeAuditScan([null as unknown as AuditBookmark], NOW)).toEqual({
      totalTags: 0,
      visitedIn30d: 0,
      coverageByTag: [],
      outdatedCount: 0,
    });
  });

  it("counts bookmarks visited within 30 days", () => {
    const result = computeAuditScan(
      [
        bm("1", "Recent", [], day(5), day(5)),
        bm("2", "Older", [], day(60), day(60)),
        bm("3", "Never", [], day(400), ""),
      ],
      NOW,
    );
    expect(result.visitedIn30d).toBe(1);
  });

  it("aggregates tag coverage with count and last-visit age", () => {
    const result = computeAuditScan(
      [
        bm("1", "A", ["ai", "ml"], day(10), day(10)),
        bm("2", "B", ["ai"], day(20), day(20)),
        bm("3", "C", ["web"], day(400), ""),
      ],
      NOW,
    );
    expect(result.totalTags).toBe(3);
    const ai = result.coverageByTag.find((c) => c.tag === "ai");
    expect(ai).toMatchObject({ count: 2, lastVisitDays: 10 });
    const web = result.coverageByTag.find((c) => c.tag === "web");
    expect(web).toMatchObject({ count: 1, lastVisitDays: -1 });
  });

  it("sorts coverage by count descending", () => {
    const result = computeAuditScan(
      [
        bm("1", "A", ["x"], day(1), day(1)),
        bm("2", "B", ["y", "y"], day(1), day(1)),
        bm("3", "C", ["z", "z", "z"], day(1), day(1)),
      ],
      NOW,
    );
    expect(result.coverageByTag.map((c) => c.tag)).toEqual(["z", "y", "x"]);
  });

  it("counts outdated bookmarks (older than 365 days, no recent visit)", () => {
    const result = computeAuditScan(
      [
        bm("1", "Old-unvisited", [], day(400)),
        bm("2", "Old-visited-recently", [], day(400), day(5)),
        bm("3", "New-unvisited", [], day(10)),
      ],
      NOW,
    );
    expect(result.outdatedCount).toBe(1);
  });

  it("skips malformed tag arrays instead of throwing", () => {
    const malformed = {
      id: "bad",
      title: "Bad",
      tags: "not-an-array",
      createdAt: day(10),
      lastVisitedAt: "",
      updatedAt: day(10),
    } as unknown as AuditBookmark;
    const result = computeAuditScan([malformed, bm("1", "A", ["ok"], day(1))], NOW);
    expect(result.totalTags).toBe(1);
    expect(result.coverageByTag).toHaveLength(1);
  });

  it("reports coarse progress checkpoints", () => {
    const progress: Array<[string, number]> = [];
    computeAuditScan(
      [bm("1", "A", ["ai"], day(1), day(1))],
      NOW,
      (phase, fraction) => progress.push([phase, fraction]),
    );
    expect(progress).toEqual([
      ["scanning", 0.05],
      ["aggregating", 0.5],
      ["done", 1],
    ]);
  });

  it("propagates a progress callback error for cancellation", () => {
    expect(() =>
      computeAuditScan(
        [bm("1", "A", ["ai"], day(1), day(1))],
        NOW,
        () => {
          throw new Error("cancelled");
        },
      ),
    ).toThrow("cancelled");
  });

  it("exposes the bounded sample cap", () => {
    expect(MAX_AUDIT_SAMPLE).toBeGreaterThan(0);
    expect(MAX_AUDIT_SAMPLE).toBeLessThanOrEqual(10_000);
  });
});
