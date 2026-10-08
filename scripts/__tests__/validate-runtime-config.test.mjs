import { describe, expect, it } from "vitest";
import { validateRuntimeConfig } from "../validate-runtime-config.mjs";

const PROD = [
  "services:",
  "  api:",
  "    image: app:${IMAGE_TAG:?IMAGE_TAG is required}",
  "    environment:",
  "      NODE_ENV: production",
  '      TRUST_PROXY: "1"',
  "      AI_SESSION_ORIGINS: ${AI_SESSION_ORIGINS:?AI_SESSION_ORIGINS is required}",
  "      LICENSE_SIGNING_PRIVATE_KEY_FILE: /run/secrets/license_signing_key",
  "",
].join("\n");

const STAGING = [
  "services:",
  "  api:",
  "    environment:",
  "      NODE_ENV: staging",
  "    ports:",
  '      - "127.0.0.1:1:1"',
  "",
].join("\n");

const DOCKERFILE = "FROM nginx:1.27-alpine\nUSER bookmarkforge\nUSER node";

describe("validateRuntimeConfig", () => {
  it("accepts hardened runtime configuration", () => {
    expect(validateRuntimeConfig(PROD, STAGING, DOCKERFILE).errors).toEqual([]);
  });

  it("rejects production latest image defaults", () => {
    const result = validateRuntimeConfig(
      PROD.replace("${IMAGE_TAG:?IMAGE_TAG is required}", "${IMAGE_TAG:-latest}"),
      STAGING,
      DOCKERFILE,
    );
    expect(result.errors.some((error) => error.includes("must not default to latest"))).toBe(true);
  });

  it("requires an explicit production license-origin allowlist", () => {
    const result = validateRuntimeConfig(
      PROD.replace(
        "AI_SESSION_ORIGINS: ${AI_SESSION_ORIGINS:?AI_SESSION_ORIGINS is required}",
        "AI_SESSION_ORIGINS: https://bookmarkforgeapp.com",
      ),
      STAGING,
      DOCKERFILE,
    );
    expect(result.errors.some((error) => error.includes("origins must be required"))).toBe(true);
  });

  /**
   * Neither Compose file may reintroduce configuration that no code reads.
   */
  it("rejects retired configuration whose reader was removed", () => {
    const result = validateRuntimeConfig(
      `${PROD}      AI_PROXY_REDIS_URL: ${"${"}AI_PROXY_REDIS_URL:-redis://redis:6379/0}\n`,
      `${STAGING}      GEMINI_API_BASE: https://generativelanguage.googleapis.com/v1beta/models\n`,
      DOCKERFILE,
    );
    expect(
      result.errors.some((error) => error.includes("docker-compose.prod.yml") && error.includes("AI_PROXY_")),
    ).toBe(true);
    expect(
      result.errors.some((error) => error.includes("docker-compose.staging.yml") && error.includes("GEMINI_API_BASE")),
    ).toBe(true);
  });

  it("rejects a bundled Redis service left behind by the removed proxy", () => {
    const result = validateRuntimeConfig(
      `${PROD}  redis:\n    image: redis:7-alpine\n`,
      STAGING,
      DOCKERFILE,
    );
    expect(result.errors.some((error) => error.includes("Redis service"))).toBe(true);
  });

  it("rejects staging ports that do not bind loopback", () => {
    const result = validateRuntimeConfig(
      PROD,
      STAGING.replace('"127.0.0.1:1:1"', '"0.0.0.0:18080:8080"'),
      DOCKERFILE,
    );
    expect(result.errors.some((error) => error.includes("staging ports must bind loopback"))).toBe(true);
  });

  it("rejects images that run as root", () => {
    const result = validateRuntimeConfig(PROD, STAGING, "FROM nginx:1.27-alpine\nUSER root");
    expect(result.errors.some((error) => error.includes("non-root"))).toBe(true);
  });
});
