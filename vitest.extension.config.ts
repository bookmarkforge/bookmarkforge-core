import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    include: ["extension/__tests__/**/*.test.ts"],
    setupFiles: ["./extension/__tests__/setup.ts"],
    testTimeout: 10_000,
  },
});
