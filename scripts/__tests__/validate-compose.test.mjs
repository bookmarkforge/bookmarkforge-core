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
  "",
].join("\n");

const STAGING_OK = [
  "services:",
  "  web:",
  '    ports: ["127.0.0.1:${HTTP_PORT:-18080}:8080"]',
  "  api:",
  "    environment:",
  "      NODE_ENV: staging",
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

  it("does not demand license config the signaling container never reads", () => {
    // `/api/license/*` is served by api/license/[action].ts (serverless), so a
    // production Compose file without AI_SESSION_ORIGINS / signing-key config
    // is correct, not a regression. Re-adding the requirement would force
    // variables this container cannot read.
    expect(validateCompose("docker-compose.prod.yml", PROD_OK).errors).toEqual([]);
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
