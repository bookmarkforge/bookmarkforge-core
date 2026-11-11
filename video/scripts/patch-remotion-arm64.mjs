#!/usr/bin/env node
/**
 * patch-remotion-arm64.mjs — lets Remotion render on Windows ARM64.
 *
 * @remotion/renderer only ships compositor binaries for win32-x64 and has
 * no arm64 build. Windows 11 ARM64 runs x64 binaries under emulation, so we:
 *   1. extract @remotion/compositor-win32-x64-msvc into node_modules (npm
 *      refuses to install it because of its os/cpu constraints), and
 *   2. patch get-executable-path.js so process.arch === 'arm64' falls back
 *      to the x64 package.
 *
 * Idempotent — safe to run on every `npm install` (wired as postinstall).
 * On x64 machines it is a no-op.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const VIDEO_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const PKG = "@remotion/compositor-win32-x64-msvc";
const PKG_DIR = join(VIDEO_DIR, "node_modules", ...PKG.split("/"));
const TARGET = join(
  VIDEO_DIR,
  "node_modules/@remotion/renderer/dist/compositor/get-executable-path.js",
);

if (process.platform !== "win32" || process.arch !== "arm64") {
  console.log("[patch-remotion-arm64] not Windows ARM64 — nothing to do.");
  process.exit(0);
}

// 1. Ensure the x64 compositor package is present.
if (!existsSync(join(PKG_DIR, "package.json"))) {
  console.log("[patch-remotion-arm64] installing x64 compositor binaries…");
  const tmp = join(VIDEO_DIR, ".compositor-tmp");
  execFileSync(
    "npm",
    ["pack", `${PKG}@latest`, "--pack-destination", tmp],
    { cwd: VIDEO_DIR, stdio: "inherit", shell: process.platform === "win32" },
  );
  const tgz = execFileSync("cmd", ["/c", "dir", "/b", "*.tgz"], {
    cwd: tmp,
    encoding: "utf8",
  })
    .trim()
    .split(/\r?\n/)[0];
  execFileSync(
    "tar",
    ["-xzf", join(tmp, tgz), "-C", PKG_DIR, "--strip-components=1"],
    { stdio: "inherit" },
  );
}

// 2. Patch the arch switch (idempotent).
let src = readFileSync(TARGET, "utf8");
if (src.includes("arm64 falls back to x64")) {
  console.log("[patch-remotion-arm64] already patched.");
  process.exit(0);
}
const needle = `case 'win32':
            switch (process.arch) {
                case 'x64':
                    return require('@remotion/compositor-win32-x64-msvc').dir;
                default:
                    throw new Error(\`Unsupported architecture on Windows: \${process.arch}\`);`;
const replacement = `case 'win32':
            switch (process.arch) {
                case 'x64':
                case 'arm64': // arm64 falls back to x64 (runs under Prism emulation)
                    return require('@remotion/compositor-win32-x64-msvc').dir;
                default:
                    throw new Error(\`Unsupported architecture on Windows: \${process.arch}\`);`;
if (!src.includes(needle)) {
  console.error("[patch-remotion-arm64] target snippet not found — Remotion internals changed.");
  process.exit(1);
}
writeFileSync(TARGET, src.replace(needle, replacement));
console.log("[patch-remotion-arm64] patched get-executable-path.js");
