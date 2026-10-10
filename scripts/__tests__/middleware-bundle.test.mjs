// @vitest-environment node
/**
 * scripts/__tests__/middleware-bundle.test.mjs
 *
 * SKIPPED: functions/_middleware.js was removed from the repository.
 * The middleware functionality is now handled by nginx.conf and netlify.toml
 * configuration files directly. This test is no longer relevant.
 */

import { describe, it } from "vitest";

describe.skip("Cloudflare Functions bundle", () => {
  it("negotiation survives the build", () => {
    // Skipped - middleware no longer exists
  });
});
