#!/usr/bin/env node
/**
 * make-short.mjs — render a BookmarkForge Short from real screen recordings.
 *
 * Usage:
 *   node scripts/make-short.mjs \
 *     --hook "Stop losing your bookmarks." \
 *     --clip clips/vault-unlock.mp4:6:"Everything stays on your device" \
 *     --clip clips/search.mp4:5:"Find anything in seconds" \
 *     --cta "bookmarkforgeapp.com" \
 *     --cta-sub "Private. Local-first. Free forever." \
 *     --out out/my-short.mp4
 *
 * Clip spec format: <path>:<seconds>[:<caption>]
 * Paths are relative to video/public/.
 *
 * Requires: cd video && npm install   (once)
 * Then this script shells out to `npx remotion render`.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const VIDEO_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const out = { clips: [], captions: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case "--hook": out.hook = next(); break;
      case "--clip": {
        const spec = next() ?? "";
        const [src, seconds, ...cap] = spec.split(":");
        if (!src || !seconds) {
          console.error(`bad --clip spec: ${spec}`);
          process.exit(1);
        }
        out.clips.push({ src, seconds: Number(seconds), caption: cap.join(":") || undefined });
        break;
      }
      case "--cta": out.cta = next(); break;
      case "--cta-sub": out.ctaSub = next(); break;
      case "--narration": out.narration = next(); break;
      case "--out": out.out = next(); break;
      default:
        console.error(`unknown arg: ${a}`);
        process.exit(1);
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (!args.hook || args.clips.length === 0 || !args.cta || !args.out) {
  console.error("required: --hook, at least one --clip, --cta, --out");
  process.exit(1);
}

const props = {
  hook: args.hook,
  clips: args.clips,
  cta: args.cta,
  ...(args.ctaSub ? { ctaSub: args.ctaSub } : {}),
  ...(args.narration ? { narration: args.narration } : {}),
};

const propsPath = join(VIDEO_DIR, "props.short.json");
writeFileSync(propsPath, JSON.stringify(props, null, 2));

const outPath = join(VIDEO_DIR, args.out);
mkdirSync(dirname(outPath), { recursive: true });

console.log(`Rendering ${args.clips.length} clip(s) → ${args.out}`);
const result = spawnSync(
  "npx",
  [
    "remotion", "render", "Short",
    `"${outPath}"`,
    `--props="${propsPath}"`,
    "--codec=h264",
    "--pixel-format=yuv420p",
  ],
  { cwd: VIDEO_DIR, stdio: "inherit", shell: process.platform === "win32" },
);

if (result.status !== 0) process.exit(result.status ?? 1);
console.log(`Done: ${args.out}`);
