#!/usr/bin/env node
/**
 * npm run help - Show most commonly used npm scripts
 *
 * This script displays the top 20 most frequently used npm scripts
 * with their descriptions and estimated execution times.
 */// Display help
console.log("\n" + "═".repeat(70));
console.log("  📚 BookmarkForge - Most Common NPM Scripts");
console.log("═".repeat(70));
console.log("\n🔥 Daily Development:\n");
console.log("  npm run dev              " + "-".repeat(40) + " Start development server");
console.log("  npm run typecheck        " + "-".repeat(40) + " TypeScript type checking");
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
console.log("  npm run e2e -- --ui     " + "-".repeat(40) + " Playwright UI mode");

console.log("\n✅ Validation (Before Commit):\n");
console.log("  npm run verify:fast      " + "-".repeat(40) + " Typecheck + lint + fast tests");
console.log("  npm run ci:local         " + "-".repeat(40) + " Full CI validation locally");
console.log("  npm run check            " + "-".repeat(40) + " Run all check gates");

console.log("\n🔒 Security Checks:\n");
console.log("  npm run check:env        " + "-".repeat(40) + " Validate environment config");
console.log("  npm run check:security-internal " + "-".repeat(35) + " Security checks");
console.log("  npm run check:open-core  " + "-".repeat(40) + " Verify Open Core boundary");

console.log("\n📖 Documentation:\n");
console.log("  docs/SETUP-DEVELOPMENT.md " + "-".repeat(35) + " Developer setup guide");
console.log("  docs/ENVIRONMENT.md      " + "-".repeat(40) + " Environment variables reference");
console.log("  scripts/README.md       " + "-".repeat(40) + " Complete script catalog (230+ scripts)");

console.log("\n" + "═".repeat(70));
console.log("  💡 Tip: Run 'npm run help' anytime to see this list");
console.log("═".repeat(70) + "\n");
