import { describe, expect, it } from "vitest";
import { validateWorkflowArtifacts } from "../validate-workflow-artifacts.mjs";

describe("validateWorkflowArtifacts", () => {
  it("accepts bounded diagnostic artifacts", () => {
    const errors = validateWorkflowArtifacts("ci.yml", `
      permissions:
        contents: read
      uses: actions/upload-artifact@v4
      if-no-files-found: ignore
      retention-days: 14
      path: |
        test-results/
        playwright-report/
    `);
    expect(errors).toEqual([]);
  });

  it("stops the path block at the next job id, digits included", () => {
    // The job that follows the upload path names a secret in its own body
    // (a comment, an env var). A job id containing a digit must still end the
    // scan of the path block, or that unrelated text is read as an artifact
    // path and the gate fails on wording instead of on a real leak.
    const errors = validateWorkflowArtifacts("ci.yml", `
      permissions:
        contents: read
      uses: actions/upload-artifact@v4
      if-no-files-found: ignore
      retention-days: 14
      path: |
        test-results/
        playwright-report/

  e2e-public-relay:
    # no secret material is uploaded by this job
    env:
      TOKEN_PLACEHOLDER: 'not-a-real-secret'
`);
    expect(errors).toEqual([]);
  });

  it("rejects missing retention and sensitive paths", () => {
    const errors = validateWorkflowArtifacts("bad.yml", `
      permissions:
        contents: read
      uses: actions/upload-artifact@v4
      path: |
        .env
        credentials.json
    `);
    expect(errors).toContain("bad.yml: artifact retention must be between 1 and 90 days");
    expect(errors).toContain("bad.yml: artifact paths must exclude credentials and secret material");
    expect(errors).toContain("bad.yml: artifact upload must define if-no-files-found");
  });
});
