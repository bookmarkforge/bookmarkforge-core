/**
 * Vite configuration — BookmarkForge
 *
 * Reconstructed from the production artifacts (dist/) and source
 * conventions. Key pieces:
 *
 *  - @vitejs/plugin-react for JSX/fast-refresh.
 *  - vite-plugin-pwa (Workbox) with `registerType: 'prompt'` — the app
 *    registers the SW itself via `virtual:pwa-register` (main.tsx /
 *    ReloadPrompt.tsx), and the PWA manifest is the static
 *    `public/manifest.json` (`manifest: false` disables the plugin's own).
 *  - bookmarkforge:integrity-manifest — a custom plugin that recreates the
 *    build-time integrity pipeline observed in dist/:
 *      * Adds `integrity="sha256-…" crossorigin="anonymous"` to every
 *        /assets/ script & link emitted by the build.
 *      * Injects `<script id="__BMF_INTEGRITY_MANIFEST__" type="application/json">`
 *        into index.html with a sha256 of every emitted + public file. The
 *        runtime integrity check (src/utils/bundleIntegrity.ts) treats the
 *        absence of this manifest in production as a hard failure, so the
 *        plugin is required for a functional production build.
 *
 * Build-time env inlining: VITE_APP_VERSION is defined here so
 * `import.meta.env.VITE_APP_VERSION` resolves in the bundle without a .env.
 */
import { createHash } from "node:crypto";
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, relative, sep } from "node:path";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, type Plugin } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import { CSP_MODERATE, CSP_OPEN, CSP_STRICT } from "./scripts/csp-config.js";

function sha256Hex(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

function walkDir(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) {
      out.push(...walkDir(p));
    } else {
      out.push(p);
    }
  }
  return out;
}

function readPackageVersion(root: string): string {
  try {
    const pkg = JSON.parse(
      readFileSync(join(root, "package.json"), "utf8"),
    ) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/**
 * Recreates the BookmarkForge build-time integrity manifest + SRI hashes.
 * See the file header for why this exists. Production-only (`apply`).
 */
function integrityManifestPlugin(): Plugin {
  let outDir = "dist";
  let root = process.cwd();
  let version = "1.0.0";
  return {
    name: "bookmarkforge:integrity-manifest",
    apply: "build",
    config(config) {
      root = config.root ?? process.cwd();
      version = readPackageVersion(root);
      // NOTE: VITE_APP_VERSION is intentionally NOT defined here — Vite
      // ignores `define` keys on import.meta.env.* (env replacement wins).
      // Set it via .env (see .env.example) if the UI should show the
      // version; the manifest below always carries package.json's version.
      return {};
    },
    configResolved(config) {
      outDir = config.build.outDir;
    },
    async closeBundle() {
      const indexHtmlPath = join(outDir, "index.html");
      if (!existsSync(indexHtmlPath)) {
        return;
      }
      const files: Record<string, string> = {};
      for (const file of walkDir(outDir)) {
        const rel = relative(outDir, file);
        if (rel.split(sep).includes("..") || rel === "index.html") {
          // index.html contains this manifest, so including its digest would
          // create a self-referential hash. Runtime checks validate the
          // emitted assets instead; the HTML itself is protected by its
          // server transport/CSP and the SRI attributes below.
          continue;
        }
        files[`/${rel.split(sep).join("/")}`] = sha256Hex(readFileSync(file));
      }
      const manifest = {
        version,
        buildHash: sha256Hex(Object.values(files).sort().join("|")),
        buildTime: new Date().toISOString(),
        files,
      };
      let html = readFileSync(indexHtmlPath, "utf8");
      // SRI: hash straight from the on-disk files (the hashes in
      // `files`) so integrity attributes always match what is actually
      // served — hashing `ctx.bundle` chunk code pre-write produced
      // mismatches with rolldown's final output.
      if (!html.includes(' integrity="sha256-')) {
        html = html.replace(
          /(<(?:script|link)\b[^>]*?\b(?:src|href)=")(\/assets\/[^"]+)(")/g,
          (match, pre: string, file: string, post: string) => {
            const hash = files[file];
            if (!hash) {
              return match;
            }
            const b64 = Buffer.from(hash, "hex").toString("base64");
            return `${pre}${file}${post} integrity="sha256-${b64}" crossorigin="anonymous"`;
          },
        );
      }
      if (!html.includes("__BMF_INTEGRITY_MANIFEST__")) {
        const tag = `<script id="__BMF_INTEGRITY_MANIFEST__" type="application/json">${JSON.stringify(manifest)}</script>`;
        html = html.replace("</head>", `${tag}\n</head>`);
      }
      writeFileSync(indexHtmlPath, html);
    },
  };
}

export default defineConfig(({ mode, isPreview }) => ({
  // CSP profiles + app version are inlined at build time. Without the
  // __CSP_*__ defines the built bundle keeps the literal tokens and the
  // app crashes at startup (src/utils/cspReportThrottle.ts).
  define: {
    __CSP_STRICT__: JSON.stringify(CSP_STRICT),
    __CSP_MODERATE__: JSON.stringify(CSP_MODERATE),
    __CSP_OPEN__: JSON.stringify(CSP_OPEN),
  },
  plugins: [
    babel({
      presets: [reactCompilerPreset()],
    }),
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "prompt",
      // The static public/manifest.json is the PWA manifest (share_target,
      // protocol_handlers, edge_side_panel, …). Keep the plugin from
      // generating/injecting a second one.
      manifest: false,
      workbox: {
        cleanupOutdatedCaches: true,
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [
          /^\/404/,
          /^\/offline/,
          /^\/privacy-and-terms/,
        ],
        globPatterns: [
          "**/*.{js,css,html,ico,png,svg,woff2,json}",
        ],
        // The ORT (ONNX runtime) WASM is ~24 MB and only needed lazily by
        // the onnx backend of transformers.js — precaching it would bloat
        // the service-worker download. The original production sw.js
        // (dist/) did not precache it either; it is served from network on
        // demand.
        globIgnores: [
          "**/assets/ort-wasm-*",
          // These feature bundles are reached only after navigating to PDF,
          // import or editor flows. Keep them out of the install-time
          // precache and cache them on first use via runtimeCaching below.
          "**/assets/blocknote-*.{js,css}",
          // Emoji dataset chunk is imported exclusively by the blocknote
          // editor; with the editor excluded from the precache this data
          // would never be requested without it. Cache it on first use.
          "**/assets/native-*.js",
          "**/assets/html2pdf-*.js",
          // pdfjs-dist is split by rolldown into `pdf-*.js` (main) and
          // `pdf.worker.min-*.mjs` (worker). Both are only reached inside
          // the PdfUploader flow, so keep them out of the install precache
          // and cache on first use via runtimeCaching below.
          "**/assets/pdfjs-*.js",
          "**/assets/pdf-*.js",
          "**/assets/pdf.worker.min-*.mjs",
          // The AI runtime bundles (WebLLM ~6 MB + transformers.js ~1 MB)
          // are only loaded lazily when the user actually starts local AI /
          // embedding features. Precaching them at install would force every
          // visitor to download ~7 MB they may never use; cache them on first
          // use via runtimeCaching instead, exactly like the PDF/editor flows.
          "**/assets/lib-*.js",
          "**/assets/transformers.web-*.js",
          // i18n locale files: only the user's active language is ever
          // requested (loadPath /locales/{{lng}}.json), so precaching all 30
          // (~3.3 MB) would download ~29 unused files on every install.
          // Cache each language on first use via runtimeCaching below; the
          // fallback locale is also fetched at boot, so offline works after
          // the first visit just like the lazy feature bundles.
          "**/locales/*.json",
        ],
        runtimeCaching: [
          {
            // Same-origin only: check the parsed URL rather than matching a
            // substring, so a third-party URL cannot poison this cache merely
            // by containing an `/assets/...` path.
            urlPattern: ({ url }) =>
              url.origin === self.location.origin &&
              /^\/assets\/(?:blocknote|native|html2pdf|pdfjs|pdf-|pdf\.worker\.min|lib|transformers\.web)-[^/]+\.(?:js|css|mjs)$/.test(
                url.pathname,
              ),
            handler: "CacheFirst",
            options: {
              cacheName: "bookmarkforge-lazy-assets",
              cacheableResponse: { statuses: [0, 200] },
              expiration: {
                maxEntries: 30,
                maxAgeSeconds: 30 * 24 * 60 * 60,
              },
            },
          },
          {
            // Locales: cache each language file on first use so language
            // switching stays instant and works offline after the initial
            // visit, without precaching all 30 languages up front.
            //
            // IMPORTANT: locale URLs carry NO content hash (/locales/es.json
            // is a fixed path), so CacheFirst would serve stale translations
            // for up to 30 days after a deploy — a deployed i18n fix would
            // never reach users on the old SW until the cache expired.
            // StaleWhileRevalidate serves the cached copy instantly (offline
            // works) but revalidates in the background, so translation
            // updates reach users on their next visit. It also self-heals
            // stale entries cached by older SW versions: the first request
            // after the new SW activates revalidates and overwrites them,
            // so no manual cache purge is needed on deploy.
            urlPattern: ({ url }) =>
              url.origin === self.location.origin &&
              /^\/locales\/[a-z]{2}\.json$/.test(url.pathname),
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "bookmarkforge-locales",
              cacheableResponse: { statuses: [0, 200] },
              expiration: {
                maxEntries: 30,
                maxAgeSeconds: 30 * 24 * 60 * 60,
              },
            },
          },
        ],
        // The lazy-loaded AI runtime chunk is ~6.5 MB and is no longer part of
        // the install-time precache (see globIgnores). The cap still matters:
        // runtimeCaching (CacheFirst) uses it to decide whether a response is
        // large enough to cache, so keep it above the WebLLM chunk size to
        // preserve offline use after first load.
        maximumFileSizeToCacheInBytes: 10 * 1024 * 1024,
      },
    }),
    integrityManifestPlugin(),
  ],
  // Workers are created with `new Worker(url, { type: "module" })`
  // (EncryptionService, VectorIndexService, WorkerPool) and the voy-search
  // WASM wrapper uses top-level await — both require ESM worker output
  // (the iife default fails the build on `await` at top level).
  worker: {
    format: "es",
  },
  // In test mode (Playwright E2E) the companion server is real: the spec
  // spawns it on 8799, and /api/* is proxied to it so the client event
  // reporter reaches the REAL /api/client-events endpoint over the real
  // network path (page → Vite proxy → companion server), matching the
  // production topology where nginx proxies /api to the companion. Normal
  // `npm run dev` is untouched (no proxy outside test mode).
  server:
    mode === "test"
      ? {
          proxy: {
            "/api": {
              target: process.env.VITE_API_PROXY_TARGET || `http://127.0.0.1:${process.env.CRISIS_COMPANION_PORT || "8799"}`,
            },
          },
          // Exclude Playwright trace/artifact directories from the file watcher
          // to prevent EBUSY errors on Windows when traces are being written.
          watch: {
            ignored: ["**/test-results/**", "**/test-results-*/**", "**/.playwright-artifacts-*/**"],
          },
        }
      : undefined,
  // `vite preview` (production build): same /api proxy, so the crisis E2E
  // against dist/ reaches the REAL companion server exactly like dev/test
  // mode and like the production nginx topology. Only active when actually
  // previewing (isPreview); plain builds are untouched.
  preview:
    isPreview
      ? {
          proxy: {
            "/api": {
              target: process.env.VITE_API_PROXY_TARGET || `http://127.0.0.1:${process.env.CRISIS_COMPANION_PORT || "8799"}`,
            },
          },
        }
      : undefined,
  build: {
    // React.lazy() routes should not turn their dependencies into critical
    // network requests. Vite emits modulepreload hints for the dependency
    // graph; filter only the known feature bundles so the shell stays fast,
    // while route navigation still loads them through the normal import().
    modulePreload: {
      resolveDependencies(_filename, deps) {
        return deps.filter(
          (dep) =>
            !/(^|\/)(?:blocknote|html2pdf|pdfjs|pdf-|pdf\.worker\.min)-[^/]+\.(?:js|css|mjs)$/.test(
              dep,
            ),
        );
      },
    },
    // Deliberately NO manualChunks here. rolldown-vite (Vite 8) splits
    // shared vendor modules automatically, and the previous manualChunks
    // rules (html2pdf/pdfjs/blocknote) caused rolldown to merge the React
    // runtime into the blocknote chunk — making the 1 MB editor chunk part
    // of the eager entry chain. Without them, React gets its own small
    // chunks and blocknote stays genuinely lazy (imported only by the
    // BlockEditor/SharedDocumentView lazy routes, and excluded from the SW
    // precache via globIgnores).
    // The WebLLM/transformers AI runtime chunk is large by design and lazy
    // loaded; silence the default 500 kB warning noise for it.
    chunkSizeWarningLimit: 9000,
  },
}));
