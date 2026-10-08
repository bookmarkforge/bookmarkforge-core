import { describe, expect, it } from "vitest";
import { findStaleRetiredKeys, validateCompose } from "../validate-compose-config.mjs";

const PROD_OK = [
  "services:",
  "  web:",
  "    image: app:${IMAGE_TAG:?IMAGE_TAG is required}",
  "  api:",
  "    image: api:${IMAGE_TAG:?IMAGE_TAG is required}",
  "    environment:",
  "      NODE_ENV: production",
  '      TRUST_PROXY: "1"',
  "      AI_SESSION_ORIGINS: ${AI_SESSION_ORIGINS:?AI_SESSION_ORIGINS is required}",
  "      WHOP_LICENSE_API_URL: ${WHOP_LICENSE_API_URL:?WHOP_LICENSE_API_URL is required}",
  "      LICENSE_SIGNING_PRIVATE_KEY_FILE: /run/secrets/license_signing_key",
  "    secrets: [license_signing_key]",
  "secrets:",
  "  license_signing_key: {}",
  "",
].join("\n");

const STAGING_OK = [
  "services:",
  "  web:",
  '    ports: ["127.0.0.1:${HTTP_PORT:-18080}:8080"]',
  "  api:",
  "    environment:",
  "      NODE_ENV: staging",
  "      AI_SESSION_ORIGINS: http://127.0.0.1:${HTTP_PORT:-18080},http://localhost:${HTTP_PORT:-18080}",
  "",
].join("\n");

describe("validateCompose", () => {
  it("accepts the repository production security contract", () => {
    expect(validateCompose("docker-compose.prod.yml", PROD_OK).errors).toEqual([]);
  });

  it("accepts the repository staging security contract", () => {
    expect(validateCompose("docker-compose.staging.yml", STAGING_OK).errors).toEqual([]);
  });

  it("rejects mutable production image defaults", () => {
    const result = validateCompose(
      "docker-compose.prod.yml",
      PROD_OK.replace("${IMAGE_TAG:?IMAGE_TAG is required}", "${IMAGE_TAG:-latest}"),
    );
    expect(result.errors.some((error) => error.includes("mutable latest"))).toBe(true);
  });

  it("rejects a production file that does not require the license origins", () => {
    const result = validateCompose(
      "docker-compose.prod.yml",
      PROD_OK.replace(
        "AI_SESSION_ORIGINS: ${AI_SESSION_ORIGINS:?AI_SESSION_ORIGINS is required}",
        "AI_SESSION_ORIGINS: https://bookmarkforgeapp.com",
      ),
    );
    expect(result.errors.some((error) => error.includes("origins must be required"))).toBe(true);
  });

  it("rejects staging AI_SESSION_ORIGINS hardcoded to 18080", () => {
    const result = validateCompose(
      "docker-compose.staging.yml",
      STAGING_OK.replace(
        "http://127.0.0.1:${HTTP_PORT:-18080},http://localhost:${HTTP_PORT:-18080}",
        "http://127.0.0.1:18080,http://localhost:18080",
      ),
    );
    expect(result.errors.some((error) => error.includes("interpolate HTTP_PORT"))).toBe(true);
  });

  it("accepts staging AI_SESSION_ORIGINS interpolating HTTP_PORT", () => {
    expect(validateCompose("docker-compose.staging.yml", STAGING_OK).errors).toEqual([]);
  });

  /**
   * The regression this gate exists for: retired configuration survived in both
   * Compose files for several commits. A compose file that names configuration
   * nothing reads must fail, not deploy a server that cannot read what it
   * configures.
   */
  it("rejects retired configuration whose only reader was removed", () => {
    for (const [file, source] of [
      ["docker-compose.prod.yml", PROD_OK],
      ["docker-compose.staging.yml", STAGING_OK],
    ]) {
      for (const [line, staleKey] of [
        ["AI_PROXY_REDIS_URL: redis://redis:6379/0", "AI_PROXY_"],
        ['AI_SESSION_REQUIRE_LICENSE: "0"', "AI_SESSION_REQUIRE_LICENSE"],
        ["GEMINI_API_KEY: ${GEMINI_API_KEY:?GEMINI_API_KEY is required}", "GEMINI_API_KEY"],
        [
          "GEMINI_API_BASE: https://generativelanguage.googleapis.com/v1beta/models",
          "GEMINI_API_BASE",
        ],
      ]) {
        const result = validateCompose(file, `${source}      ${line}\n`);
        expect(
          result.errors.some((error) => error.includes(staleKey)),
          `${file} should reject ${line}`,
        ).toBe(true);
      }
    }
  });

  it("rejects a bundled Redis service nothing reads", () => {
    const result = validateCompose(
      "docker-compose.prod.yml",
      `${PROD_OK}  redis:\n    image: redis:7-alpine\n`,
    );
    expect(result.errors.some((error) => error.includes("Redis service"))).toBe(true);
  });

  it("names every environment variable that lost its reader", () => {
    expect(findStaleRetiredKeys("AI_PROXY_X: 1\nGEMINI_API_KEY: k")).toEqual([
      "AI_PROXY_",
      "GEMINI_API_KEY",
    ]);
  });
});
