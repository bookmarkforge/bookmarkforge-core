import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { validateZapWorkflowText } from "../validate-zap-workflow.mjs";

describe("DAST workflow validation", () => {
  it("requires restrictive auth-file handling and immutable image references", () => {
    const source = readFileSync(".github/workflows/dast-nightly.yml", "utf8");
    const errors = validateZapWorkflowText(source);
    expect(errors).toEqual([]);
    expect(errors).not.toContain("DAST password file permissions must be restricted");
    expect(errors).not.toContain("DAST password secret must fail closed when empty");
    expect(errors).not.toContain("DAST secrets must be scoped from the protected environment");
    expect(errors).not.toContain("DAST context must fail closed when the secret is empty");
    expect(errors).not.toContain("authenticated DAST scan must be opt-in");
    expect(errors).not.toContain("authenticated DAST execution must remain disabled until verified");
    expect(errors).not.toContain("authenticated context preparation must remain disabled until verified");
    expect(errors).not.toContain("all authenticated DAST steps must remain disabled until verified");
    expect(errors).not.toContain("DAST cleanup must run after failures");
  });

  it("rejects a workflow that passes a secret to docker", () => {
    const errors = validateZapWorkflowText("secrets.STAGING_DAST_CONTEXT_PASSWORD\ndocker run $DAST_CONTEXT_PASSWORD");
    expect(errors).toContain("DAST context secret contract missing");
    expect(errors).toContain("DAST secrets must not be passed as Docker arguments");
  });

  it("rejects an unresolved ZAP image digest placeholder", () => {
    const errors = validateZapWorkflowText(
      "ghcr.io/zaproxy/zaproxy@sha256:REPLACE_WITH_VERIFIED_ZAP_IMAGE_DIGEST zap-baseline.py",
    );
    expect(errors).toContain("ZAP image digest placeholder is not allowed");
  });
});
