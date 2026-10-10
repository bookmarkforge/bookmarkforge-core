import { defineConfig, mergeConfig } from "vitest/config";
import baseConfig from "./vitest.config";

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      coverage: {
        enabled: true,
        all: true,
        reporter: ["json"],
        include: ["src/**/*.{ts,tsx}"],
        exclude: [
          "server/**",
          "src/tests/**",
          "src/**/*.test.{ts,tsx}",
          "**/*.d.ts",
          "src/polyfills.ts",
          "src/main.tsx",
          "src/index.ts",
          "src/App.tsx",
          "src/workers/**",
          "src/services/ai/embedding.worker.ts",
          "src/db/__tests__/**",
        ],
        thresholds: {
          statements: 0,
          branches: 0,
          functions: 0,
          lines: 0,
        },
      },
    },
  }),
);