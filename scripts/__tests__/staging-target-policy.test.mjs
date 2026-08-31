import { describe, expect, it } from "vitest";
import { validateStagingUrl } from "../staging-target-policy.mjs";

describe("validateStagingUrl", () => {
  it("accepts an HTTPS staging host", () => {
    expect(validateStagingUrl("https://app-staging.example.test/path")).toBe(true);
  });

  it("rejects production, credentials, query strings, and HTTP", () => {
    expect(validateStagingUrl("https://bookmarkforge.com")).toBe(false);
    expect(validateStagingUrl("https://user:pass@app-staging.example.test")).toBe(false);
    expect(validateStagingUrl("https://app-staging.example.test?token=secret")).toBe(false);
    expect(validateStagingUrl("http://app-staging.example.test")).toBe(false);
    expect(validateStagingUrl("https://app-staging.example.test:8443")).toBe(false);
    expect(validateStagingUrl("https://app..staging.example.test")).toBe(false);
    expect(validateStagingUrl("https://-app-staging.example.test")).toBe(false);
    expect(validateStagingUrl("https://app--staging.example.test")).toBe(true);
    expect(validateStagingUrl("https://app-.staging.example.test")).toBe(false);
    expect(validateStagingUrl("https://app-staging.example.test/%2fadmin")).toBe(false);
    expect(validateStagingUrl("https://app-staging.example.test/%5Cadmin")).toBe(false);
  });
});
