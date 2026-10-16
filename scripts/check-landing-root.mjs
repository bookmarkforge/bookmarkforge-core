#!/usr/bin/env node
/**
 * scripts/check-landing-root.mjs — the root-document contract gate.
 *
 * Every host must serve the SAME document at `/`: the generated EN landing
 * (`public/landing.html`). This gate reads the four shipped host configs
 * (vercel.json, public/_redirects, netlify.toml, public/nginx.conf), the tree on
 * disk and the committed HTML pages, and fails when
 *
 *   - a host answers `/` with a different file, a redirect, or nothing at all;
 *   - the hosts disagree with each other about what `/` serves (the exact bug
 *     this gate exists for: Vercel served the stale `dist/index.html` while the
 *     other three served the generated `landing.html`);
 *   - the served file is not the landing generator's EN output, or is missing;
 *   - a duplicate copy of the EN landing is back on disk (`index.html`,
 *     `public/index.html`) or any other page claims the landing's canonical URL;
 *   - the retired `/index.html` URL is not a permanent redirect to `/` on a host.
 *
 * The logic lives in scripts/landing-root-contract.mjs so the unit test can
 * drive it with broken fixtures. Freshness of the landing itself against the
 * generator stays check:landings-fresh's job.
 *
 * It is offline by contract (no build, no network): it reads the shipped files.
 *
 * Usage: node scripts/check-landing-root.mjs [--quiet]
 * Exit 0 clean, 1 findings.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join, relative, sep } from "node:path";
import { HOST_FILES } from "./spa-route-contract.mjs";
import {
  EN_LANDING_CANONICAL,
  EN_LANDING_SOURCE,
  EN_LANDING_TARGET,
  ROOT_ROUTE,
  assessLandingRoot,
} from "./landing-root-contract.mjs";

const ROOT = process.cwd();
const quiet = process.argv.includes("--quiet");

const require = createRequire(import.meta.url);
const builder = require("./build-landings.cjs");

function readIfPresent(path) {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

/** Every committed HTML page in the EN landing's two homes: the root and public/. */
function htmlPages() {
  const pages = [];
  const add = (rel) => {
    const abs = join(ROOT, rel.split("/").join(sep));
    if (!existsSync(abs)) return;
    pages.push({ file: rel, content: readFileSync(abs, "utf8") });
  };
  for (const entry of readdirSync(ROOT, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".html")) add(entry.name);
  }
  const publicDir = join(ROOT, "public");
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (entry.name.endsWith(".html")) {
        pages.push({ file: relative(ROOT, abs).split(sep).join("/"), content: readFileSync(abs, "utf8") });
      }
    }
  };
  walk(publicDir);
  return pages;
}

/** The generator's EN landing path, normalised to a repo-relative POSIX path. */
function generatorLandingPath() {
  const raw = builder.outputPathFor("landing", "en");
  const rel = raw.startsWith(ROOT) ? relative(ROOT, raw) : raw;
  return rel.split(sep).join("/").replace(/^\.\//, "");
}

const files = Object.fromEntries(
  Object.entries(HOST_FILES).map(([key, path]) => [key, readIfPresent(path)]),
);

const result = assessLandingRoot({
  files,
  fileExists: (rel) => existsSync(join(ROOT, rel.split("/").join(sep))),
  trackedHtml: htmlPages(),
  landingSource: EN_LANDING_SOURCE,
  generatorPath: generatorLandingPath(),
});

if (!result.ok) {
  console.error(`[check-landing-root] FAIL: ${result.failures.length} finding(s)`);
  for (const failure of result.failures) console.error(`  - ${failure}`);
  process.exit(1);
}

if (!quiet) {
  console.log(
    `[check-landing-root] ok  ${ROOT_ROUTE} is ${EN_LANDING_TARGET} on all ${result.checks} host configs ` +
      `(canonical ${EN_LANDING_CANONICAL}), /index.html retired with a permanent redirect, ` +
      `single generated source ${EN_LANDING_SOURCE}`,
  );
}
