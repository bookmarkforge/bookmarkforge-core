import baseConfig from "./playwright.config";
import { defineConfig } from "@playwright/test";

// Demo-recording profile — NOT a test gate. Runs tests/e2e/demo-recording.spec.ts
// against the dev server (--mode test keeps Argon2id on fast params) and keeps
// a .webm per page instead of retain-on-failure, so the product tour can be
// assembled into a launch video. The spec itself saves each page's video to
// demo-output/ under stable names (setup.webm is discarded, demo.webm kept).
export default defineConfig({
  ...baseConfig,
  // Own testDir (same pattern as e2e-public-relay): the recorder is not part
  // of the nightly multiuser sweep and must not move the vacuous-tests
  // surface count for tests/e2e.
  testDir: "./tests/e2e-demo",
  testMatch: ["demo-recording.spec.ts"],
  projects: (baseConfig.projects ?? []).filter(
    (project) => project.name === "chromium",
  ),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "line",
  timeout: 360_000,
  use: {
    ...baseConfig.use,
    viewport: { width: 1920, height: 1080 },
    video: { mode: "on", size: { width: 1920, height: 1080 } },
    // No slowMo: the spec paces itself with explicit human pauses, which are
    // easier to tune per scene than a global action delay.
  },
});
