/**
 * scripts/build-extension-release.mjs — bundle `dist-extension/RELEASE.md`
 * for a signed browser-extension release.
 *
 * Companion to `.github/workflows/release.yml`. The workflow produces the
 * cosign signature + public key and captures the build commit / tag /
 * timestamp; this script reads those inputs from the env and writes a
 * single, human-readable bundle (`RELEASE.md`) into the dist directory.
 *
 * Inputs (env vars set by the workflow):
 *   BUILD_COMMIT        Full hex commit SHA of the build (required)
 *   BUILD_COMMIT_SHORT  Short hex commit SHA (optional; defaults to first 7)
 *   BUILD_TAG           Tag name that triggered the release (v1.2.3, optional)
 *   BUILD_AT            ISO-8601 UTC timestamp (optional; defaults to now)
 *
 * Inputs (files in DIST):
 *   SHA256SUMS.txt      The checksums file that was signed
 *   SHA256SUMS.sig      cosign detached signature (binary blob)
 *   SHA256SUMS.pub      cosign verifying (public) key (PEM)
 *   MANIFEST.md         Built earlier by scripts/build-extension.cjs
 *
 * Output:
 *   RELEASE.md          A single markdown file containing: build commit +
 *                       tag + timestamp, the public key verbatim, the
 *                       signature's sha256 + base64 (so a human can paste
 *                       it elsewhere), and the exact `cosign verify-blob`
 *                       invocation needed to reproduce verification.
 *
 * Exit codes:
 *   0 — RELEASE.md written
 *   1 — missing one of the required artifacts or env vars
 *   2 — FATAL internal error
 */
import {
  existsSync,
  readFileSync,
  writeFileSync,
  readdirSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { join, isAbsolute } from "node:path";

const ROOT = process.cwd();
const OUTPUT_DIR = process.env.OUTPUT_DIR || "dist-extension";
const DIST = isAbsolute(OUTPUT_DIR) ? OUTPUT_DIR : join(ROOT, OUTPUT_DIR);

function env(k, fallback = "") {
  const v = process.env[k];
  return v === undefined || v === "" ? fallback : v;
}

const BUILD_COMMIT = env("BUILD_COMMIT");
const BUILD_COMMIT_SHORT = env(
  "BUILD_COMMIT_SHORT",
  BUILD_COMMIT.slice(0, 7),
);
const BUILD_TAG = env("BUILD_TAG");
const BUILD_AT = env("BUILD_AT", new Date().toISOString());

const SIDECAR_SUMS = join(DIST, "SHA256SUMS.txt");
const SIDECAR_SIG = join(DIST, "SHA256SUMS.sig");
const SIDECAR_PUB = join(DIST, "SHA256SUMS.pub");
const SIDECAR_MANIFEST = join(DIST, "MANIFEST.md");
const OUTPUT = join(DIST, "RELEASE.md");

/**
 * Walk the dist directory and surface the files + sizes + sha256s so the
 * operator can verify everything in one read.
 */
function inventory(dist) {
  const files = readdirSync(dist)
    .filter((name) => existsSync(join(dist, name)))
    .sort();
  return files.map((name) => {
    const full = join(dist, name);
    const buf = readFileSync(full);
    const sha = createHash("sha256").update(buf).digest("hex");
    const size = buf.length;
    return { name, size, sha };
  });
}

/** Sha256 + base64 (for human-readable copy of the binary cosign signature). */
function fingerprint(buf) {
  return {
    sha256: createHash("sha256").update(buf).digest("hex"),
    base64: buf.toString("base64"),
  };
}

function fail(reason, path) {
  console.error(`[build-extension-release] FAIL ${reason}${path ? `: ${path}` : ""}`);
  process.exit(1);
}

function main() {
  if (!BUILD_COMMIT) fail("BUILD_COMMIT env var not set");
  for (const p of [SIDECAR_SUMS, SIDECAR_SIG, SIDECAR_PUB, SIDECAR_MANIFEST]) {
    if (!existsSync(p)) fail(`${p.split(/[\\/]/).pop()} missing`, p);
  }

  const sumsBytes = readFileSync(SIDECAR_SUMS);
  const sigBytes = readFileSync(SIDECAR_SIG);
  const pubKey = readFileSync(SIDECAR_PUB, "utf8");
  const manifestBytes = readFileSync(SIDECAR_MANIFEST);

  const sumsFp = fingerprint(sumsBytes);
  const sigFp = fingerprint(sigBytes);
  const manifestFp = fingerprint(manifestBytes);
  const pubSha = createHash("sha256")
    .update(readFileSync(SIDECAR_PUB))
    .digest("hex");
  const inventoryRows = inventory(DIST);

  // Pretty bullet for the base64 signature: 80-char line breaks.
  const formattedBase64 = sigFp.base64.match(/.{1,80}/g).join("\n");

  const doc = [
    `# BookmarkForge extension — Release Manifest`,
    ``,
    `**Tag:** \`${BUILD_TAG || "(untagged run)"}\`  `,
    `**Build commit:** \`${BUILD_COMMIT}\` (\`${BUILD_COMMIT_SHORT}\`)  `,
    `**Built at:** \`${BUILD_AT}\`  `,
    `**Output root:** \`${OUTPUT_DIR}/\`  `,
    `**Sign algorithm:** \`cosign sign-blob --key\` (ECDSA P-256 over SHA-256 by default)  `,
    ``,
    `## Verify`,
    ``,
    `After downloading the dist, an operative party can verify the`,
    `checksums file with the bundled public key and detached signature`,
    `without trusting the GitHub UI:`,
    ``,
    "```bash",
    `cd ${OUTPUT_DIR}`,
    `cosign verify-blob \\`,
    `  --key SHA256SUMS.pub \\`,
    `  --signature SHA256SUMS.sig \\`,
    `  SHA256SUMS.txt`,
    `expected line: '\"SHA256SUMS.txt\" : verified'`,
    "```",
    ``,
    `Then verify each shipped artifact against \`SHA256SUMS.txt\`:`,
    ``,
    "```bash",
    `cd ${OUTPUT_DIR}`,
    `sha256sum -c SHA256SUMS.txt`,
    "```",
    ``,
    `## Signature`,
    ``,
    `| Field | Value |`,
    `|---|---|`,
    `| Signature file | \`SHA256SUMS.sig\` (${sigBytes.length} bytes) |`,
    `| Signature sha256 | \`${sigFp.sha256}\` |`,
    `| Signed file | \`SHA256SUMS.txt\` (${sumsBytes.length} bytes, sha256 \`${sumsFp.sha256}\`) |`,
    ``,
    `Base64 (paste into another tool if needed):`,
    ``,
    "```",
    formattedBase64,
    "```",
    ``,
    `## Verifying key (PEM)`,
    ``,
    `| Field | Value |`,
    `|---|---|`,
    `| Public key file | \`SHA256SUMS.pub\` |`,
    `| Public key sha256 | \`${pubSha}\` |`,
    ``,
    "```",
    pubKey.trim(),
    "```",
    ``,
    `## Manifest cross-reference`,
    ``,
    `| Field | Value |`,
    `|---|---|`,
    `| Original MANIFEST.md | \`MANIFEST.md\` (${manifestBytes.length} bytes) |`,
    `| MANIFEST.md sha256 | \`${manifestFp.sha256}\` |`,
    ``,
    `## Dist inventory`,
    ``,
    `| File | Size (bytes) | SHA-256 |`,
    `|------|-------------:|---------|`,
    ...inventoryRows.map(
      (i) => `| \`${i.name}\` | ${i.size} | \`${i.sha}\` |`,
    ),
    ``,
    `## Reproduce the build`,
    ``,
    "```bash",
    `npm ci`,
    `npm run build:extension:custom`,
    `node scripts/check-extension-dist.mjs`,
    "```",
    ``,
    `## Provenance`,
    ``,
    `- Commit \`${BUILD_COMMIT}\` was the HEAD at release time.`,
    BUILD_TAG
      ? `- Tag \`${BUILD_TAG}\` pins the commit for verification (immutable).`
      : `- No tag was applied at release time — verify the commit before trusting.`,
    ``,
    `Generated by \`scripts/build-extension-release.mjs\` in the`,
    `\`release\` workflow job (see \`.github/workflows/release.yml\`).`,
    `Treat the public key as the source of trust: it is the only`,
    `artifact required to validate the signature without contacting`,
    `GitHub or any other service.`,
    ``,
  ].join("\n");

  writeFileSync(OUTPUT, doc);
  console.log(
    `[build-extension-release] wrote ${OUTPUT} (${inventoryRows.length} dist files inventoried, signature sha256=${sigFp.sha256.slice(0, 16)}…)`,
  );
}

// Direct-invocation guard (matches scripts/check-extension-csp.mjs, scripts/audit-anchors.mjs).
function isDirectInvocation() {
  const entry = process.argv[1];
  if (!entry) return false;
  const entryBase = entry.split(/[\\/]/).pop();
  const moduleBase = import.meta.url.split("/").pop();
  return entryBase === moduleBase;
}

if (isDirectInvocation()) {
  try {
    main();
  } catch (error) {
    console.error(
      `[build-extension-release] FATAL: ${error?.message ?? String(error)}`,
    );
    process.exit(2);
  }
}

export { main, inventory, fingerprint };
