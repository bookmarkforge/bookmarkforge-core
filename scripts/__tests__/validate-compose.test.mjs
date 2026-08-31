import { describe, expect, it } from "vitest";
import { validateCompose } from "../validate-compose-config.mjs";

describe("validateCompose", () => {
  it("rejects mutable production image defaults", () => {
    const result = validateCompose("docker-compose.prod.yml", "services:\n  web:\n    image: app:${IMAGE_TAG:-latest}\n  api:\n    image: api:${IMAGE_TAG:-latest}\n    environment:\n      NODE_ENV: production\n      TRUST_PROXY: \\\"1\\\"\n      AI_SESSION_ORIGINS: ${AI_SESSION_ORIGINS:?AI_SESSION_ORIGINS is required}\n      AI_SESSION_REQUIRE_LICENSE: ${AI_SESSION_REQUIRE_LICENSE:-1}\n      GEMINI_API_KEY: ${GEMINI_API_KEY:?required}\n    secrets: [license_signing_key]\nsecrets:\n  license_signing_key: {}\n");
    expect(result.errors.some((error) => error.includes("mutable latest"))).toBe(true);
  });

  it("rejects staging AI_SESSION_ORIGINS hardcoded to 18080", () => {
    const result = validateCompose(
      "docker-compose.staging.yml",
      "services:\n  web:\n    ports:\n      - 127.0.0.1:${HTTP_PORT:-18080}:8080\n  api:\n    environment:\n      NODE_ENV: staging\n      AI_SESSION_ORIGINS: http://127.0.0.1:18080,http://localhost:18080\n      AI_PROXY_REDIS_FAILURE_MODE: fail-closed\n",
    );
    expect(result.errors.some((error) => error.includes("interpolate HTTP_PORT"))).toBe(true);
  });

  it("accepts staging AI_SESSION_ORIGINS interpolating HTTP_PORT", () => {
    const result = validateCompose(
      "docker-compose.staging.yml",
      "services:\n  web:\n    ports:\n      - 127.0.0.1:${HTTP_PORT:-18080}:8080\n  api:\n    environment:\n      NODE_ENV: staging\n      AI_SESSION_ORIGINS: http://127.0.0.1:${HTTP_PORT:-18080},http://localhost:${HTTP_PORT:-18080}\n      AI_PROXY_REDIS_FAILURE_MODE: fail-closed\n",
    );
    expect(result.errors.some((error) => error.includes("interpolate HTTP_PORT"))).toBe(false);
  });

  it("accepts the repository production security contract", () => {
    const result = validateCompose("docker-compose.prod.yml", "services:\n  web:\n    image: app:${IMAGE_TAG}\n  api:\n    image: api:${IMAGE_TAG}\n    environment:\n      NODE_ENV: production\n      TRUST_PROXY: \\\"1\\\"\n      AI_SESSION_ORIGINS: ${AI_SESSION_ORIGINS:?AI_SESSION_ORIGINS is required}\n      AI_SESSION_REQUIRE_LICENSE: ${AI_SESSION_REQUIRE_LICENSE:-1}\n      GEMINI_API_KEY: ${GEMINI_API_KEY:?required}\n    secrets: [license_signing_key]\nsecrets:\n  license_signing_key: {}\n");
    expect(result.errors).toEqual([]);
  });
});
