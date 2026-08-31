import { describe, expect, it } from "vitest";
import { validateWorkflowText } from "../validate-workflows.mjs";
import { validateHttpConfig } from "../validate-http-config.mjs";

describe("internal audit gates", () => {
  it("rejects mutable action secrets in Docker commands", () => {
    const result = validateWorkflowText("bad.yml", "name: bad\non:\n  push:\npermissions:\n  contents: read\njobs:\n  test:\n    steps:\n      - run: docker run -e TOKEN=${{ secrets.TOKEN }} image");
    expect(result.errors.some((error) => error.includes("secret interpolation"))).toBe(true);
  });

  it("flags write access to pull requests for explicit review", () => {
    const result = validateWorkflowText("review.yml", "name: review\non:\n  pull_request:\npermissions:\n  contents: read\n  pull-requests: write\njobs:\n  review:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm test");
    expect(result.warnings).toContain("review.yml: pull-requests write permission requires explicit review");
  });

  it("rejects a workflow with broad or missing read-only contents permission", () => {
    const result = validateWorkflowText("broad.yml", "name: broad\non:\n  push:\npermissions:\n  contents: write\njobs:\n  test:\n    steps:\n      - run: npm test");
    expect(result.errors).toContain("broad.yml: permissions must explicitly restrict contents to read");
  });

  it("accepts a workflow with explicit permissions and no secret leakage", () => {
    const result = validateWorkflowText("good.yml", "name: good\non:\n  push:\npermissions:\n  contents: read\njobs:\n  test:\n    steps:\n      - run: npm test");
    expect(result.errors).toEqual([]);
  });

  it("requires the production security headers and explicit API port", () => {
    const result = validateHttpConfig(
      "X-Content-Type-Options: nosniff\nX-Frame-Options: DENY\nReferrer-Policy: strict-origin\nStrict-Transport-Security: max-age=31536000; includeSubDomains\nPermissions-Policy: camera=()\nContent-Security-Policy: default-src 'self'; object-src 'none';",
      "add_header X-Content-Type-Options nosniff;\nadd_header X-Frame-Options DENY;\nadd_header Referrer-Policy strict-origin;\nadd_header Strict-Transport-Security \"max-age=31536000; includeSubDomains;\";\nadd_header Permissions-Policy \"camera=();\";\nadd_header Content-Security-Policy \"default-src 'self'; object-src 'none';\";\nproxy_pass http://bookmarkforge_api:8787;",
    );
    expect(result.errors).toEqual([]);
  });

  it("rejects dynamic secret-backed shell execution", () => {
    const result = validateWorkflowText("unsafe.yml", "name: unsafe\non:\n  workflow_dispatch:\npermissions:\n  contents: read\njobs:\n  deploy:\n    runs-on: ubuntu-latest\n    steps:\n      - run: bash -c \"$DEPLOY_COMMAND\"\n");
    expect(result.warnings).toContain("unsafe.yml: dynamic bash command should be replaced by a versioned script");
  });

  it("rejects external actions pinned only by a mutable tag", () => {
    const result = validateWorkflowText("tagged.yml", "name: tagged\non:\n  push:\npermissions:\n  contents: read\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n");
    expect(result.errors.some((error) => error.includes("pinned by full 40-char SHA"))).toBe(true);
  });

  it("accepts external actions pinned by full SHA and local references", () => {
    const result = validateWorkflowText("pinned.yml", "name: pinned\non:\n  push:\npermissions:\n  contents: read\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262\n      - uses: ./.github/workflows/staging-smoke.yml\n");
    expect(result.errors.filter((error) => error.includes("pinned by full 40-char SHA"))).toEqual([]);
  });
});
