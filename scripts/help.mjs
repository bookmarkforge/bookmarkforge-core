#!/usr/bin/env node
/**
 * npm run help - Show most commonly used npm scripts (Core Only)
 *
 * This script displays the top 20 most frequently used npm scripts
 * with their descriptions and estimated execution times.
 * Adapted for the MIT-licensed Core repository (Pro features excluded).
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read package.json
const packageJsonPath = join(__dirname, "..", "package.json");
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));

// Top 20 most useful scripts with descriptions (Core-only, no Pro features)
const topScripts = [
  { name: "dev", desc: "Start development server", time: "-" },
  { name: "build", desc: "Build for production", time: "~2min" },
  { name: "build:ci", desc: "Build with all gates", time: "~3min" },
  { name: "typecheck", desc: "TypeScript type checking", time: "~30s" },
  { name: "typecheck:prod", desc: "Type check (prod config)", time: "~25s" },
  { name: "lint", desc: "ESLint (bounded)", time: "~20s" },
  { name: "test:fast", desc: "Critical path tests", time: "~2min" },
  { name: "test:slow", desc: "Full test suite", time: "~4min" },
  { name: "test:fast:watch", desc: "Watch mode for fast tests", time: "-" },
  { name: "e2e:smoke", desc: "Critical E2E tests", time: "~60s" },
  { name: "e2e:ui", desc: "Playwright UI mode", time: "-" },
  { name: "check", desc: "Run all check gates", time: "~5min" },
  { name: "check:ci", desc: "Full CI validation", time: "~8min" },
  { name: "check:env", desc: "Validate environment config", time: "~5s" },
  { name: "check:security-internal", desc: "Security checks", time: "~10s" },
  { name: "check:open-core", desc: "Verify Core/Pro boundary", time: "~3s" },
  { name: "check:i18n", desc: "i18n completeness", time: "~10s" },
  { name: "check:audit", desc: "npm audit (prod deps)", time: "~30s" },
  { name: "ci:local", desc: "Run CI locally", time: "~8min" },
  { name: "preview", desc: "Preview production build", time: "-" },
];

// Display help
console.log("\n" + "═".repeat(70));
console.log("  📚 BookmarkForge Core - Most Common NPM Scripts");
console.log("═".repeat(70));
console.log("\n🔥 Daily Development:\n");
console.log("  npm run dev              " + "-".repeat(40) + " Start development server");
console.log("  npm run typecheck        " + "-".repeat(40) + " TypeScript type checking");
console.log("  npm run typecheck:prod    " + "-".repeat(40) + " Type check (prod config)");
console.log("  npm run lint             " + "-".repeat(40) + " ESLint (bounded)");
console.log("  npm run test:fast        " + "-".repeat(40) + " Critical path tests");
console.log("  npm run test:fast:watch  " + "-".repeat(40) + " Watch mode for fast tests");

console.log("\n🏗️  Building:\n");
console.log("  npm run build            " + "-".repeat(40) + " Build for production");
console.log("  npm run build:ci         " + "-".repeat(40) + " Build with all gates");
console.log("  npm run preview          " + "-".repeat(40) + " Preview production build");

console.log("\n🧪 Testing:\n");
console.log("  npm run test:slow        " + "-".repeat(40) + " Full test suite");
console.log("  npm run e2e:smoke        " + "-".repeat(40) + " Critical E2E tests");
console.log("  npm run e2e:ui           " + "-".repeat(40) + " Playwright UI mode");

console.log("\n✅ Validation (Before Commit):\n");
console.log("  npm run verify:fast      " + "-".repeat(40) + " Typecheck + lint + fast tests");
console.log("  npm run ci:local         " + "-".repeat(40) + " Full CI validation locally");
console.log("  npm run check            " + "-".repeat(40) + " Run all check gates");

console.log("\n🔒 Core/Pro Boundary:\n");
console.log("  npm run check:open-core  " + "-".repeat(40) + " Verify Core/Pro boundary");
console.log("  npm run check:env        " + "-".repeat(40) + " Validate environment config");
console.log("  npm run check:security-internal " + "-".repeat(35) + " Security checks");

console.log("\n📖 Documentation:\n");
console.log("  docs/SETUP-CORE.md     " + "-".repeat(40) + " Core developer setup guide");
console.log("  docs/ENVIRONMENT.md     " + "-".repeat(40) + " Environment variables (Core only)");
console.log("  docs/architecture.md     " + "-".repeat(40) + " System architecture");
console.log("  AGENTS.md               " + "-".repeat(40) + " Engineering conventions");
console.log("  CONTRIBUTING.md         " + "-".repeat(40) + " Contribution guide");
console.log("  OPEN-CORE.md            " + "-".repeat(40) + " Open Core model");

console.log("\n" + "═".repeat(70));
console.log("  💡 Tip: Run 'npm run help' anytime to see this list");
console.log("  ⚠️  This is the MIT-licensed Core. Pro features are excluded.");
console.log("═".repeat(70) + "\n");
