/**
 * Vite configuration — BookmarkForge
 *
 * Reconstructed from the production artifacts (dist/) and source
 * conventions. Key pieces:
 *
 *  - @vitejs/plugin-react for JSX/fast-refresh.
  *  - vite-plugin-pwa (Workbox) with `registerType: 'prompt'` — the app
  *    registers the SW itself via `virtual:pwa-register` (main.tsx).
  *    The update prompt UI lives inside `<MainApp />` via the
  *    `ReloadPrompt` component. The PWA manifest is the static
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
 *      * ADR-039: writes dist/integrity-manifest.json — the single source
 *        of truth for the SW-side verification surface.
 *  - bookmarkforge:sw-integrity-embed — reads that manifest and embeds it
 *        plus a hash-verification runtime (scripts/sw-integrity-runtime.js)
 *        at the top of the Workbox-generated dist/sw.js, so EVERY served
 *        chunk (lazy ones included) is hash-checked inside the service
 *        worker before it reaches the page (mismatch ⇒ 504 + cache
 *        eviction + bundle-integrity-failed notification). Its closeBundle
 *        is `order: "post"` so it runs after Workbox generated sw.js.
 *
  * Build-time env inlining: Vite auto-inlines all `VITE_*` variables
  * from `import.meta.env` into the bundle at build time (see
  * `src/env.config.ts` `ENV_REGISTRY`). No manual `define` entry is
  * needed — Vite handles `VITE_*` prefix vars automatically.
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
// Optional HTTPS for real-device drills (iOS Safari manual tests need a
// secure context: WebCrypto/camera/clipboard/PWA install all gate on it).
// Enabled ONLY via VITE_DEV_HTTPS=1 — never active for the e2e batteries,
// CI, or normal dev. Uses a self-signed cert: the iPhone must trust it once
// (see docs/ios-manual-test-script.md preparation).
import basicSsl from "@vitejs/plugin-basic-ssl";
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
 * ADR-039: source of the SW-side integrity runtime
 * (scripts/sw-integrity-runtime.js). Embedded verbatim into the generated
 * dist/sw.js by swIntegrityEmbedPlugin (see below) and kept as a standalone
 * file so it can be unit-tested in isolation — vitest executes it against a
 * synthetic self/FetchEvent environment.
 */
function readSwIntegrityRuntime(): string {
  return readFileSync(
    join(process.cwd(), "scripts", "sw-integrity-runtime.js"),
    "utf8",
  );
}

/**
 * ADR-039: embeds the integrity manifest + verification runtime into the
 * Workbox-generated dist/sw.js. Ordering: vite-plugin-pwa writes sw.js inside
 * ITS OWN closeBundle hook, and Rollup runs same-order closeBundle hooks in
 * plain plugin-array order (verified empirically — a "reverse order"
 * assumption made this hook run BEFORE sw.js existed and silently skip).
 * Declaring the hook `order: "post"` guarantees it runs after all
 * no-order hooks (VitePWA's generator and integrityManifestPlugin's
 * manifest writer), regardless of array position.
 *
 * The runtime is PREPENDED at the very top of sw.js so it installs before
 * any Workbox code, and the manifest is read from dist/integrity-manifest.
 * json written moments earlier by integrityManifestPlugin — a single source
 * of truth for the verified surface.
 */
function swIntegrityEmbedPlugin(): Plugin {
  return {
    name: "bookmarkforge:sw-integrity-embed",
    apply: "build",
    closeBundle: {
      // ADR-039: run after VitePWA's closeBundle has generated sw.js.
      order: "post",
      sequential: true,
      handler() {
        const swPath = join("dist", "sw.js");
        const manifestPath = join("dist", "integrity-manifest.json");
        if (!existsSync(swPath) || !existsSync(manifestPath)) {
          return; // no SW (e.g. PWA disabled) or no manifest — nothing to guard
        }
        let sw = readFileSync(swPath, "utf8");
        // Idempotency: strip any previous embed — closeBundle runs on every
        // rebuild and must not stack duplicate runtimes.
        sw = sw.replace(
          /\/\/ __BMF_SW_INTEGRITY_EMBED_START__[\s\S]*?\/\/ __BMF_SW_INTEGRITY_EMBED_END__\n?/g,
          "",
        );
        const embed =
          "// __BMF_SW_INTEGRITY_EMBED_START__ (ADR-039; injected by bookmarkforge:sw-integrity-embed)\n" +
          // Trailing semicolon is REQUIRED: the runtime body opens with an
          // IIFE `(function(){…})()` and without it the assignment would
          // ASI-join into a call of the object literal (caught by the
          // artifact smoke check — the SW would throw at eval time).
          "self.__BMF_SW_INTEGRITY_MANIFEST__ = " +
          readFileSync(manifestPath, "utf8").trim() +
          ";\n" +
          readSwIntegrityRuntime() +
          "\n// __BMF_SW_INTEGRITY_EMBED_END__\n";
        writeFileSync(swPath, embed + sw);
      },
    },
  };
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
        if (
          rel.split(sep).includes("..") ||
          rel === "index.html" ||
          rel === "sw.js"
        ) {
          // index.html contains this manifest and sw.js embeds the SW-side
          // copy (ADR-039), so hashing either would be self-referential —
          // and the sw.js embed below would invalidate the stored digest.
          // The HTML is protected by server transport + SRI attributes; the
          // SW is integrity-verified on every update check by the browser's
          // byte-diff and guarded in-flight by its own embedded runtime.
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

      // ── ADR-039: persist the manifest for tooling/diagnostics and as
      // the single source of truth for the SW embed (swIntegrityEmbedPlugin
      // reads this file in its own closeBundle, declared `order: "post"` so
      // it runs after BOTH this hook and VitePWA's Workbox generation).
      writeFileSync(
        join(outDir, "integrity-manifest.json"),
        JSON.stringify(manifest, null, 2) + "\n",
      );
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
    ...(process.env.VITE_DEV_HTTPS === "1" ? [basicSsl()] : []),
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
          /^\/[a-z]{2}\/privacy-and-terms/,
          // SEO: the landing pages (served at / and /es/ with a 200
          // rewrite) are the only indexable content. If the SW precached
          // shell answered these navigations, users with the SW installed
          // would see the private SPA instead of the marketing page — and
          // crawlers executing the SW would index an empty shell. Always
          // go to the network for them.
          /^\/(?:landing\.html)?$/,
          /^\/(?:es|fr|de|pt|it)\/?$/,
          /^\/pocket-alternative/,
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
          // The integrity manifest is verified by the SW integrity runtime
          // (sw-integrity-runtime.js) and must NOT be precached — a poisoned
          // precache entry could serve a tampered manifest with relaxed hashes.
          "**/integrity-manifest.json",
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
          // Public marketing/legal/share-card assets are served by the
          // network and are not part of the private app shell. Keeping them
          // out of the install precache avoids downloading duplicate
          // localized landing pages, legal pages, OG cards and comparison
          // assets for every app user; their navigation routes are already
          // denied by navigateFallbackDenylist above.
          "**/landing.{html,css,js}",
          "**/{de,es,fr,it,pt}.html",
          "**/{de,es,fr,it,pt}/**",
          "**/privacy-and-terms.{html,css}",
          "**/*/privacy-and-terms.html",
          "**/pocket-alternative.{html,css}",
          "**/404.{html,css,js}",
          "**/og-image*.{svg,png}",
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
    // ADR-039: last in the array for readability — its `order: "post"`
    // closeBundle runs after VitePWA (sw.js generated) and
    // integrityManifestPlugin (manifest written) regardless of position.
    integrityManifestPlugin(),
    swIntegrityEmbedPlugin(),
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
            // E2E: license routes live on the companion/signing server (8787),
            // NOT on the crisis companion that owns the generic /api space.
            // Without this, Pro activation from the browser hits the crisis
            // companion and fails; Vite preserves the Host header, so the
            // signing service's Origin/Host checks still match the app origin.
            // MUST be declared BEFORE the generic "/api" rule below: Vite
            // matches proxy keys in insertion order and the first prefix
            // match wins.
            "/api/license": {
              target: process.env.VITE_LICENSE_PROXY_TARGET || `http://127.0.0.1:${process.env.SIGNALING_PORT || "8787"}`,
            },
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
