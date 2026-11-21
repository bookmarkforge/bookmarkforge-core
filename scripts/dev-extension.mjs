#!/usr/bin/env node
/**
 * Development helper for BookmarkForge extension
 * Builds the extension and provides instructions for loading it in browsers
 */

import { execSync } from "child_process";
import { existsSync } from "fs";
import { join } from "path";

const EXTENSION_DIR = join(process.cwd(), "extension");
const DIST_EXTENSION_DIR = join(process.cwd(), "dist-extension");

console.log("🔧 BookmarkForge Extension Development Helper\n");

// Check if extension directory exists
if (!existsSync(EXTENSION_DIR)) {
  console.error("❌ Error: extension/ directory not found");
  process.exit(1);
}

console.log("📦 Building extension for development...\n");

try {
  // Build the extension
  execSync("npm run build:extension:custom", { stdio: "inherit" });
  
  console.log("\n✅ Extension built successfully!");
  console.log(`📁 Output directory: ${DIST_EXTENSION_DIR}\n`);
  
  console.log("🚀 Next steps:\n");
  
  console.log("Chrome/Chromium/Edge:");
  console.log("  1. Open chrome://extensions/");
  console.log("  2. Enable 'Developer mode' (toggle in top right)");
  console.log("  3. Click 'Load unpacked'");
  console.log(`  4. Select: ${DIST_EXTENSION_DIR}`);
  console.log("  5. Extension should now appear in your extensions list\n");
  
  console.log("Firefox:");
  console.log("  1. Open about:debugging#/runtime/this-firefox");
  console.log("  2. Click 'Load Temporary Add-on'");
  console.log(`  3. Select: ${join(DIST_EXTENSION_DIR, "manifest-firefox.json")}`);
  console.log("  4. Extension should now be loaded\n");
  
  console.log("💡 Tips:");
  console.log("  - Make sure BookmarkForge dev server is running: npm run dev");
  console.log("  - Configure extension URL to: http://localhost:5173");
  console.log("  - To reload after changes: click reload button in chrome://extensions/");
  console.log("  - For Firefox: reload the temporary add-on\n");
  
  console.log("📖 Documentation:");
  console.log("  See docs/EXTENSION-LOCAL-SETUP.md for detailed guide\n");
  
} catch (error) {
  console.error("❌ Error building extension:", error.message);
  process.exit(1);
}
