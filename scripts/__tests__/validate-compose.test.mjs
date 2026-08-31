import { describe, expect, it } from "vitest";
import { validateCompose } from "../validate-compose-config.mjs";

describe("validateCompose", () => {
  it("rejects mutable production image defaults", () => {
    const result = validateCompose("docker-compose.prod.yml", "services:\n  web:\n    image: app:${IMAGE_TAG:-latest}\n  api:\n    image: api:${IMAGE_TAG:-latest}\n    environment:\n      NODE_ENV: production\n      TRUST_PROXY: \\\"1\\\"\n      AI_SESSION_ORIGINS: ${AI_SESSION_ORIGINS:?AI_SESSION_ORIGINS is required}\n      AI_SESSION_REQUIRE_LICENSE: ${AI_SESSION_REQUIRE_LICENSE:-1}\n      GEMINI_API_KEY: ${GEMINI_API_KEY:?required}\n    secrets: [license_signing_key]\nsecrets:\n  license_signing_key: {}\n");
    expect(result.errors.some((error) => error.includes("mutable latest"))).toBe(true);
  });

  it("accepts the repository production security contract", () => {
    const result = validateCompose("docker-compose.prod.yml", "services:\n  web:\n    image: app:${IMAGE_TAG}\n  api:\n    image: api:${IMAGE_TAG}\n    environment:\n      NODE_ENV: production\n      TRUST_PROXY: \\\"1\\\"\n      AI_SESSION_ORIGINS: ${AI_SESSION_ORIGINS:?AI_SESSION_ORIGINS is required}\n      AI_SESSION_REQUIRE_LICENSE: ${AI_SESSION_REQUIRE_LICENSE:-1}\n      GEMINI_API_KEY: ${GEMINI_API_KEY:?required}\n    secrets: [license_signing_key]\nsecrets:\n  license_signing_key: {}\n");
    expect(result.errors).toEqual([]);
  });
});
