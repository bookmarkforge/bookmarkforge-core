import { describe, expect, it } from "vitest";
import {
  evaluateWebRtcCertification,
  parseCertifiedProjects,
} from "../check-webrtc-certification.mjs";

const MATRIX = `
| Browser engine | Build | Configuration | Sync certification |
|---|---|---|---|
| Chromium | pinned | nightly | **Certified** for the real flow |
| Firefox | pinned | browsers | **Failed compatibility run** |
| WebKit | pinned | browsers | **Not certified** |
`;

function reportFor(project, statuses = ["passed"]) {
  const attempts = Array.isArray(statuses) ? statuses : [statuses];
  return {
    suites: [
      {
        specs: [
          {
            title: "real sync",
            file: "tests/e2e/vault-sync-real.spec.ts",
            tests: [
              {
                projectName: project,
                title: "replicates both vaults",
                results: attempts.map((status) => ({ status })),
              },
            ],
          },
        ],
      },
    ],
  };
}

describe("WebRTC certification gate", () => {
  it("derives only explicitly certified projects from the matrix", () => {
    expect(parseCertifiedProjects(MATRIX)).toEqual(["chromium"]);
  });

  it("passes when the certified project has a passed contract result", () => {
    const result = evaluateWebRtcCertification({
      report: reportFor("chromium"),
      matrixText: MATRIX,
    });
    expect(result.ok).toBe(true);
    expect(result.projects).toEqual([
      expect.objectContaining({
        project: "chromium",
        contractTests: 1,
        passed: 1,
        skipped: 0,
        failed: 0,
        ok: true,
      }),
    ]);
  });

  it("fails explicitly when a certified project's contract is skipped", () => {
    const result = evaluateWebRtcCertification({
      report: reportFor("chromium", "skipped"),
      matrixText: MATRIX,
    });
    expect(result.ok).toBe(false);
    expect(result.failures).toContain("chromium: 1 contract spec(s) skipped");
  });

  it("fails when a certified project has no contract coverage in the report", () => {
    const result = evaluateWebRtcCertification({
      report: reportFor("firefox"),
      matrixText: MATRIX,
    });
    expect(result.ok).toBe(false);
    expect(result.failures).toContain("chromium: contract spec coverage absent");
    expect(result.projects[0]).toMatchObject({
      project: "chromium",
      contractTests: 0,
      ok: false,
    });
  });

  it("counts a retried test by its final attempt (skipped then failed)", () => {
    // A skipped intermediate attempt must not mask a failed final attempt:
    // the test ultimately failed, so it is a failure, not skipped.
    const result = evaluateWebRtcCertification({
      report: reportFor("chromium", ["skipped", "failed"]),
      matrixText: MATRIX,
    });
    expect(result.ok).toBe(false);
    expect(result.projects[0]).toMatchObject({
      project: "chromium",
      contractTests: 1,
      passed: 0,
      skipped: 0,
      failed: 1,
    });
    expect(result.failures).toContain(
      "chromium: 1 contract spec(s) failed or did not finish passed",
    );
    expect(result.failures).not.toContain("chromium: 1 contract spec(s) skipped");
  });

  it("counts a retried test that passed on its final attempt as passed", () => {
    // A failed intermediate attempt followed by a passed retry is a pass.
    const result = evaluateWebRtcCertification({
      report: reportFor("chromium", ["failed", "passed"]),
      matrixText: MATRIX,
    });
    expect(result.ok).toBe(true);
    expect(result.projects[0]).toMatchObject({
      project: "chromium",
      contractTests: 1,
      passed: 1,
      skipped: 0,
      failed: 0,
    });
  });
});
