import { describe, expect, it } from "vitest";
import { validateRuntimeConfig } from "../validate-runtime-config.mjs";

describe("validateRuntimeConfig", () => {
  it("requires explicit production AI origin and proxy settings", () => {
    const result = validateRuntimeConfig(
      "services:\n  api:\n    NODE_ENV: production\n    AI_SESSION_ORIGINS: ${AI_SESSION_ORIGINS:?AI_SESSION_ORIGINS is required}\n    TRUST_PROXY: \"1\"\n    AI_PROXY_REDIS_URL: ${AI_PROXY_REDIS_URL:-redis://redis:6379/0}\n    AI_PROXY_REDIS_FAILURE_MODE: ${AI_PROXY_REDIS_FAILURE_MODE:-fail-closed}\n    AI_SESSION_REQUIRE_LICENSE: ${AI_SESSION_REQUIRE_LICENSE:-1}\n    GEMINI_API_KEY: ${GEMINI_API_KEY:?required}\n    secrets: [license_signing_key]\n",
      "services:\n  api:\n    NODE_ENV: staging\n    AI_SESSION_REQUIRE_LICENSE: \"0\"\n    ports:\n - \"127.0.0.1:1:1\"",
      "USER node\nFROM nginx:1.27-alpine\nUSER bookmarkforge",
    );
    expect(result.errors).toEqual([]);
  });

  it("rejects production fail-open and latest defaults", () => {
    const result = validateRuntimeConfig(
      "services:\n image: app:${IMAGE_TAG:-latest}\n AI_PROXY_REDIS_FAILURE_MODE: fail-open",
      "ports:\n - \"127.0.0.1:1:1\"\n AI_SESSION_REQUIRE_LICENSE: \"0\"",
      "USER node",
    );
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
  });

  it("accepts hardened runtime configuration", () => {
    const result = validateRuntimeConfig(
      "services:\n image: app:${IMAGE_TAG:?required}\n TRUST_PROXY: \"1\"\n AI_SESSION_ORIGINS: ${AI_SESSION_ORIGINS:?AI_SESSION_ORIGINS is required}\n AI_SESSION_REQUIRE_LICENSE: ${AI_SESSION_REQUIRE_LICENSE:-1}\n AI_PROXY_REDIS_URL: ${AI_PROXY_REDIS_URL:-redis://redis:6379/0}\n AI_PROXY_REDIS_FAILURE_MODE: ${AI_PROXY_REDIS_FAILURE_MODE:-fail-closed}",
      "ports:\n - \"127.0.0.1:1:1\"\n AI_SESSION_REQUIRE_LICENSE: \"0\"",
      "FROM nginx:1.27-alpine\nUSER bookmarkforge\nUSER node",
    );
    expect(result.errors).toEqual([]);
  });
});
