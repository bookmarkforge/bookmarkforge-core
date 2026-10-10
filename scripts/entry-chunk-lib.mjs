/**
 * scripts/entry-chunk-lib.mjs — shared SPA entry-chunk resolution.
 *
 * ADR-028: gate drift — since the marketing/SPA split the SPA entry is
 * emitted as app-*.js and referenced by dist/app.html's module script
 * (index-*.js was the pre-split name). Every bundle gate derives the entry
 * from the HTML module script so the gates track the real build output
 * instead of a stale filename pattern.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Resolve the emitted SPA entry chunk name (e.g. `app-DpNefikK.js`).
 *
 * @param {string} root project root (dist/ is read from here)
 * @param {string[]} files chunk file names inside dist/assets
 * @returns {string|undefined} the entry chunk name, or undefined
 */
export function resolveEntryChunk(root, files) {
  const fromHtml = ["app.html", "index.html"]
    .map((h) => {
      const p = join(root, "dist", h);
      return existsSync(p) ? readFileSync(p, "utf8") : "";
    })
    .flatMap((html) => [...html.matchAll(/<script\b([^>]*)>/g)].map((m) => m[1]))
    .filter((attrs) => /type="module"/.test(attrs))
    .map((attrs) => attrs.match(/src="[^"]*\/([^"/]+\.js)"/)?.[1])
    .filter((name) => name && files.includes(name));
  return fromHtml[0] ?? files.find((f) => /^(app|index)-/.test(f));
}
