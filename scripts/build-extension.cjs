/**
 * scripts/build-extension.cjs — browser extension packaging.
 *
 * Packages the extension/ sources into the output directory controlled by
 * the OUTPUT_DIR environment variable (default: dist-extension).
 *
 * The extension is plain vanilla JS (Chrome MV3 / Firefox MV2), so
 * "packaging" essentially means copying the sources (minus tests) and
 * writing both manifests at the output root.
 *
 * Sidecar artifacts (for reproducibility / signed-off publication):
 *
 *   dist-extension/SHA256SUMS.txt
 *     POSIX `sha256sum -c`-compatible: one line per file with the canonical
 *     `<hex>  <basename>` two-space separator, sorted alphabetically,
 *     comment lines at the top ignored by `sha256sum -c`.
 *
 *   dist-extension/MANIFEST.md
 *     Human-readable build provenance: timestamp, source/output root, the
 *     excluded list, a per-file table (file | size | sha256 | role), and
 *     verify/reproduce instructions for the operator.
 *
 * The 9 source files are byte-deterministic across builds (no minification,
 * no format-changing transforms); MANIFEST.md differs on each run because
 * of the build timestamp, and is therefore not listed in SHA256SUMS.txt
 * (which covers the 9 published artifacts only).
 *
 * Usage: npm run build:extension:custom
 */
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const ROOT = process.cwd();
const SRC = path.join(ROOT, "extension");
const OUTPUT_DIR = process.env.OUTPUT_DIR || "dist-extension";
// Honor an absolute OUTPUT_DIR verbatim; path.join would prepend ROOT.
const OUT = path.isAbsolute(OUTPUT_DIR)
  ? OUTPUT_DIR
  : path.join(ROOT, OUTPUT_DIR);
const EXCLUDED = new Set(["__tests__", "README.md", "PRIVACY.md"]);

/**
 * Per-file role description surfaced in MANIFEST.md so a reviewer can read
 * the artifact list without opening each file.
 */
const ROLE_TABLE = {
  "manifest.json":
    "Chrome MV3 manifest (service worker + action + minimum permissions + CSP)",
  "manifest-firefox.json":
    "Firefox MV2 manifest (background.scripts + browser_action + gecko id + CSP)",
  "background.js":
    "Chrome MV3 service worker; conditionally imports capture-url.js via importScripts",
  "capture-url.js":
    "Shared capture-URL builder + bookmarklet serializer; imported by background.js (MV3), loaded by popup.html (MV2)",
  "popup.html":
    "Popup UI shell (CSP-locked, fragment-hash capture flow, settings panel)",
  "popup.css":
    "Popup stylesheet (externalized from popup.html so the manifest CSP can use style-src 'self' without 'unsafe-inline')",
  "popup.js":
    "Popup logic (DOM, settings save/reset, capture dispatch via chrome.tabs.create)",
  "icon-16.png": "Toolbar icon at 16×16",
  "icon-48.png": "Toolbar icon at 48×48",
  "icon-128.png": "Store / marketplace icon at 128×128",
};

/**
 * Compute SHA-256 of `filePath` synchronously using a bounded buffer. The
 * icon-128.png file is ~42 KB today so an in-memory read is fine; this
 * approach generalises cleanly to larger future assets without changing
 * the API.
 */
function sha256OfFile(filePath) {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(buf).digest("hex");
}

if (!fs.existsSync(SRC)) {
  console.error("[build-extension] FAIL: extension/ sources missing");
  process.exit(1);
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------------------
// Phase 1: copy the 9 source files (deterministic order = source-dir order).
// ---------------------------------------------------------------------------

let copied = 0;
for (const entry of fs.readdirSync(SRC)) {
  if (EXCLUDED.has(entry)) continue;
  const srcPath = path.join(SRC, entry);
  const destPath = path.join(OUT, entry);
  if (fs.statSync(srcPath).isDirectory()) {
    fs.cpSync(srcPath, destPath, { recursive: true });
  } else {
    fs.copyFileSync(srcPath, destPath);
  }
  copied += 1;
}

// ---------------------------------------------------------------------------
// Phase 2: inventory the 9 shipped artifacts (alphabetical, deterministic).
// We deliberately read the OUT directory BEFORE writing SHA256SUMS.txt and
// MANIFEST.md so the inventory covers exactly the 9 source files and not
// the sidecar artifacts we are about to emit.
// ---------------------------------------------------------------------------

const inventory = fs
  .readdirSync(OUT)
  .filter((entry) => fs.statSync(path.join(OUT, entry)).isFile())
  .sort()
  .map((entry) => {
    const filePath = path.join(OUT, entry);
    const stat = fs.statSync(filePath);
    return {
      file: entry,
      size: stat.size,
      sha256: sha256OfFile(filePath),
      role: ROLE_TABLE[entry] || "—",
    };
  });

// ---------------------------------------------------------------------------
// Phase 3a: emit MANIFEST.md (byte-deterministic, references build-manifest.json).
//
// MANIFEST.md is intentionally byte-deterministic given the same
// `extension/` source — no `Built at:` timestamp; the timestamp belongs
// in `RELEASE.md` at release time. This lets MANIFEST.md be checksummed
// in SHA256SUMS.txt alongside the source artifacts.
//
// The JSON sibling is named `build-manifest.json` (not the more obvious
// `MANIFEST.json`) because `extension/manifest.json` already exists as
// the Chrome MV3 manifest. On case-insensitive filesystems (NTFS, the
// default HFS+/APFS) the two names would collide and the write would
// silently overwrite the actual extension manifest. `build-manifest.json`
// is unambiguous on every filesystem.
// ---------------------------------------------------------------------------

const outRel = path.relative(ROOT, OUT) || ".";
const excludedList = Array.from(EXCLUDED).sort().map((s) => "`" + s + "`");

const MANIFEST = [
  `# BookmarkForge extension — Build Manifest`,
  ``,
  `**Source root:** \`extension/\`  `,
  `**Output root:** \`${outRel}/\`  `,
  `**Source files:** ${inventory.length}  `,
  `**Excluded:** ${excludedList.join(", ")}  `,
  `**Build script:** \`scripts/build-extension.cjs\` (no minification, no bundling — the ${inventory.length} source files are byte-deterministic)  `,
  ``,
  `## Inventory`,
  ``,
  `See [\`build-manifest.json\`](build-manifest.json) for the parseable, machine-readable inventory: one entry per shipped artifact (\`name\`, \`size\`, \`sha256\`, \`role\`). Machine consumers should read JSON, not this markdown.`,
  ``,
  `## Auxiliary sidecars (in this directory)`,
  ``,
  `| Sidecar | Purpose |`,
  `|---------|---------|`,
  `| \`SHA256SUMS.txt\` | Canonical POSIX \`sha256sum -c\` checksums for every other file in this directory (\`SHA256SUMS.txt\` itself excluded — a file cannot checksum itself): ${inventory.length} source artifacts + this MANIFEST.md + build-manifest.json + README.md. |`,
  `| \`build-manifest.json\` | Parseable inventory — same data the markdown table would have shown, in JSON form. |`,
  `| \`MANIFEST.md\` | This file — human-readable description + pointers to the parseable inventory and the sha256 manifest. |`,
  `| \`README.md\` | Consumer-facing guide — publishing checklist (ship the sidecars with the CRX) + what each sidecar means for downstream consumers. |`,
  ``,
  `## Verify`,
  ``,
  "```bash",
  `cd ${outRel}`,
  `sha256sum -c SHA256SUMS.txt`,
  "```",
  ``,
  `## Reproduce`,
  ``,
  "```bash",
  `npm run build:extension:custom`,
  "```",
  ``,
  `All files in this directory (${inventory.length} source artifacts + build-manifest.json + this MANIFEST.md + README.md) are byte-deterministic given the same \`extension/\` source and are listed in \`SHA256SUMS.txt\`. The build timestamp, when needed, lives in \`RELEASE.md\` at release time.`,
  ``,
].join("\n");

fs.writeFileSync(path.join(OUT, "MANIFEST.md"), MANIFEST);

// ---------------------------------------------------------------------------
// Phase 3b: emit build-manifest.json (parseable sibling inventory).
//
// The JSON shape is intentional and stable: machine consumers (CI checks,
// browser-extension smoke tests, or any external auditor) read this file
// rather than parsing the markdown table — which is the whole point of
// splitting the inventory into a sibling.
// ---------------------------------------------------------------------------

const manifestJson = {
  schema: {
    version: 1,
    notes: "byte-deterministic given the same extension/ source; sha256 sums cross-check against SHA256SUMS.txt.",
  },
  metadata: {
    source_root: "extension/",
    output_root: `${outRel}/`,
    source_files_count: inventory.length,
    excluded: Array.from(EXCLUDED).sort(),
    build_script: "scripts/build-extension.cjs",
  },
  files: inventory.map((i) => ({
    name: i.file,
    size: i.size,
    sha256: i.sha256,
    role: i.role,
  })),
};

// Use 2-space indent + trailing newline — matches every other JSON sidecar
// in the repo and keeps the file byte-deterministic across Node versions
// (Node's JSON.stringify formatting has been stable since 0.x for objects
// with insertion-ordered keys).
fs.writeFileSync(
  path.join(OUT, "build-manifest.json"),
  JSON.stringify(manifestJson, null, 2) + "\n",
);

// ---------------------------------------------------------------------------
// Phase 3c: emit README.md (consumer-facing guide, byte-deterministic).
//
// The README is part of the shipped bundle: it documents the OUTPUT_DIR
// contract and reminds operators to publish SHA256SUMS.txt +
// MANIFEST.md + build-manifest.json together with the unpacked CRX, and
// documents what each sidecar means for downstream consumers. It is
// byte-deterministic given the same `extension/` source (no timestamps),
// so Phase 4 can checksum it in SHA256SUMS.txt like the other sidecars.
// ---------------------------------------------------------------------------

const README = [
  `# BookmarkForge browser extension — packaged output`,
  ``,
  `This directory is the packaged, reproducible build of the \`extension/\` source tree`,
  `(Chrome MV3 + Firefox MV2), generated by \`npm run build:extension:custom\`. It is`,
  `never committed to version control — the \`OUTPUT_DIR\` env var selects the target (default \`dist-extension/\`).`,
  ``,
  `## Publishing — ship the sidecars with the CRX`,
  ``,
  `When publishing, upload the unpacked CRX together with \`SHA256SUMS.txt\`, \`MANIFEST.md\`,`,
  `and \`build-manifest.json\`. Never publish the extension bundle alone: a downstream`,
  `verifier cannot confirm the integrity or provenance of the files without the checksums`,
  `and the inventory. The sidecars must stay byte-identical to what`,
  `\`npm run build:extension:custom\` emitted.`,
  ``,
  `## What the sidecar files mean`,
  ``,
  `| File | Meaning for downstream consumers |`,
  `|------|----------------------------------|`,
  `| \`SHA256SUMS.txt\` | Canonical POSIX \`sha256sum -c\` checksums: the SHA-256 of every other file in this directory. Run \`sha256sum -c SHA256SUMS.txt\` from this directory to verify the bundle is byte-exact. |`,
  `| \`MANIFEST.md\` | Human-readable build manifest — source root, output root, excluded files, pointers to the machine-readable inventory. |`,
  `| \`build-manifest.json\` | Machine-readable inventory — one entry per shipped artifact (\`name\`, \`size\`, \`sha256\`, \`role\`). Automation should parse this, not the markdown. |`,
  `| \`README.md\` | This file — the operator/consumer guidance you are reading. |`,
  ``,
  `## Verify`,
  ``,
  "```bash",
  `cd ${outRel}`,
  `sha256sum -c SHA256SUMS.txt`,
  "```",
  ``,
  `## Reproduce`,
  ``,
  "```bash",
  `npm run build:extension:custom`,
  "```",
  ``,
  `All files here (except \`SHA256SUMS.txt\`, which cannot checksum itself) are`,
  `byte-deterministic given the same \`extension/\` source and are listed in`,
  `\`SHA256SUMS.txt\`.`,
  ``,
].join("\n");

fs.writeFileSync(path.join(OUT, "README.md"), README);

// ---------------------------------------------------------------------------
// Phase 4: emit SHA256SUMS.txt (POSIX sha256sum -c compatible).
//
// We re-scan the OUT directory at this point so the sums include the
// freshly-written MANIFEST.md and build-manifest.json — both are now
// byte-deterministic given the same `extension/` source, so listing
// them in SHA256SUMS.txt is safe and gives a verifier a single
// checksum that covers every file in the bundle.
// ---------------------------------------------------------------------------

const fullInventory = fs
  .readdirSync(OUT)
  .filter((entry) => fs.statSync(path.join(OUT, entry)).isFile())
  .sort()
  .map((entry) => {
    const filePath = path.join(OUT, entry);
    const buf = fs.readFileSync(filePath);
    const sha256 = crypto.createHash("sha256").update(buf).digest("hex");
    return { file: entry, sha256 };
  });

const SUMS_HEADER = [
  `# BookmarkForge extension — SHA-256 checksums`,
  `# Regenerate via: npm run build:extension:custom`,
  `# Verify with:    (cd ${path.relative(ROOT, OUT) || "."} && sha256sum -c SHA256SUMS.txt)`,
  `# Format:         POSIX <hex>  <basename> (two-space separator, alphabetical).`,
  `# Lines starting with '#' are ignored by sha256sum -c.`,
  `# Covers all ${fullInventory.length} files in this directory: ${inventory.length} source artifacts + MANIFEST.md + build-manifest.json + README.md.`,
];
const SUMS_LINES = SUMS_HEADER.concat(
  fullInventory.map((i) => `${i.sha256}  ${i.file}`),
);
fs.writeFileSync(
  path.join(OUT, "SHA256SUMS.txt"),
  SUMS_LINES.join("\n") + "\n",
);

// ---------------------------------------------------------------------------
// Phase 5: log summary.
// ---------------------------------------------------------------------------

console.log(
  `[build-extension] packaged extension/ -> ${outRel} (${inventory.length} files, ${copied} copies)`,
);
console.log(
  `[build-extension] wrote ${outRel}/MANIFEST.md (deterministic, references build-manifest.json)`,
);
console.log(
  `[build-extension] wrote ${outRel}/build-manifest.json (parseable inventory of ${inventory.length} files)`,
);
console.log(
  `[build-extension] wrote ${outRel}/README.md (consumer guide; OUTPUT_DIR + sidecar meanings)`,
);
console.log(
  `[build-extension] wrote ${outRel}/SHA256SUMS.txt (${fullInventory.length} entries, sha256sum -c compatible; covers both sidecars)`,
);
