/**
 * scripts/build-server.mjs — production build of the self-hosted signaling server.
 *
 * the `api` Docker target installed `npm ci --omit=dev`
 * and then ran `node_modules/.bin/tsx server/src/index.ts`. `tsx` is a
 * devDependency, so the image had no loader and the container died on start
 * (`docker compose up` left the signaling server down). Shipping the TypeScript
 * transpiler in a production image is the wrong fix: the server is bundled here
 * once, at build time, and the runtime image runs plain Node.
 *
 * Why a bundler instead of `tsc`: `server/src` imports its own modules without
 * file extensions (`./lib/config`), which Node's ESM resolver rejects. esbuild
 * resolves them and emits a single ESM file.
 *
 * `packages: "external"` keeps node_modules imports (`ws`) as real runtime
 * imports: the container installs them via the `deps` stage, and bundling `ws`
 * would drag its optional native addons (bufferutil / utf-8-validate) into the
 * output.
 *
 * Use via `npm run server:build`. Output: server/dist/index.mjs.
 */
import { mkdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { build } from "esbuild";

const ROOT = process.cwd();
const ENTRY = join(ROOT, "server", "src", "index.ts");
const OUT_DIR = join(ROOT, "server", "dist");
const OUT_FILE = join(OUT_DIR, "index.mjs");

mkdirSync(OUT_DIR, { recursive: true });

const result = await build({
  entryPoints: [ENTRY],
  outfile: OUT_FILE,
  bundle: true,
  platform: "node",
  // package.json engines: node >=22 — the Docker base is node:24.
  target: "node22",
  format: "esm",
  packages: "external",
  legalComments: "none",
  sourcemap: false,
  logLevel: "info",
  metafile: true,
});

const warnings = result.warnings ?? [];
if (warnings.length > 0) {
  console.warn(`[build-server] ${warnings.length} esbuild warning(s)`);
}

const bytes = statSync(OUT_FILE).size;
if (bytes === 0) {
  console.error("[build-server] bundle is empty — refusing to ship a dead server");
  process.exit(1);
}

console.log(
  `[build-server] wrote ${relative(ROOT, OUT_FILE)} (${(bytes / 1024).toFixed(1)} KiB)`,
);
