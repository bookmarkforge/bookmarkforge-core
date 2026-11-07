/**
 * pin-model-digests.mjs — regenerate / verify src/data/modelDigests.json
 *
 * Referenced by src/utils/modelIntegrity.ts as the generator of the model
 * digest manifest, but the script itself was never committed (audit 5.2.5:
 * "the digests are static"). This implements it:
 *
 *   - For LFS-backed files (onnx/*.onnx): the digest is the `lfs.oid` from
 *     the Hugging Face tree API — the exact sha256 transformers.js derives
 *     from the downloaded bytes (verified: sha256 of the resolved content
 *     equals the LFS oid).
 *   - For plain files (config.json, tokenizer.json, …): the tree API only
 *     exposes the git-blob oid, NOT the content sha256, so the file bytes
 *     must be downloaded and hashed.
 *
 * Modes:
 *   node scripts/pin-model-digests.mjs            — regenerate the manifest
 *   node scripts/pin-model-digests.mjs --check    — verify the committed
 *       manifest still matches the remote (exit 1 on drift). Wire this into
 *       CI so model pins can never go stale silently.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = join(__dirname, "..", "src", "data", "modelDigests.json");
const HF_API = "https://huggingface.co/api/models";
const HF_RESOLVE = "https://huggingface.co";
const USER_AGENT = "bookmarkforge-pin-model-digests";
const REQUEST_TIMEOUT_MS = 30_000;

function requestOptions() {
  return {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  };
}

async function fetchJson(url) {
  const res = await fetch(url, requestOptions());
  if (!res.ok) throw new Error(`GET ${url} → HTTP ${res.status}`);
  return res.json();
}

async function fetchBuffer(url) {
  const res = await fetch(url, requestOptions());
  if (!res.ok) throw new Error(`GET ${url} → HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

// Exported for unit tests (vi.stubGlobal("fetch", …)); the script body runs
// only when executed directly (node scripts/pin-model-digests.mjs).

/**
 * Resolve the content sha256 for one model file.
 * LFS files report `lfs.oid` in the tree API — the exact digest
 * transformers.js derives, no download needed. Plain files must be
 * downloaded and hashed.
 */
async function fetchTree(model, revision) {
  return fetchJson(`${HF_API}/${model}/tree/${revision}?recursive=true`);
}

async function resolveDigest(model, revision, filePath, tree) {
  const entries = tree ?? (await fetchTree(model, revision));
  const entry = entries.find((e) => e.type === "file" && e.path === filePath);
  if (!entry) throw new Error(`file not found in tree: ${model}/${filePath}`);
  if (entry.lfs && entry.lfs.oid) return entry.lfs.oid;
  const bytes = await fetchBuffer(
    `${HF_RESOLVE}/${model}/resolve/${revision}/${filePath}`,
  );
  return createHash("sha256").update(bytes).digest("hex");
}

function loadManifest() {
  return JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
}

async function verifyManifest(manifest) {
  const drift = [];
  for (const [model, m] of Object.entries(manifest.models)) {
    let tree;
    try {
      tree = await fetchTree(model, m.revision);
    } catch (e) {
      for (const filePath of Object.keys(m.files)) {
        drift.push(`unreachable: ${model}/${filePath} — ${e.message}`);
      }
      continue;
    }
    for (const [filePath, pinned] of Object.entries(m.files)) {
      let actual;
      try {
        actual = await resolveDigest(model, m.revision, filePath, tree);
      } catch (e) {
        drift.push(`unreachable: ${model}/${filePath} — ${e.message}`);
        continue;
      }
      if (actual !== pinned) {
        drift.push(
          `drift: ${model}/${filePath}\n    pinned: ${pinned}\n    remote: ${actual}`,
        );
      }
    }
  }
  return drift;
}

async function regenerateManifest(manifest) {
  const models = {};
  for (const [model, m] of Object.entries(manifest.models)) {
    const tree = await fetchTree(model, m.revision);
    const files = {};
    for (const filePath of Object.keys(m.files)) {
      files[filePath] = await resolveDigest(model, m.revision, filePath, tree);
    }
    models[model] = { revision: m.revision, files };
  }
  return {
    schemaVersion: manifest.schemaVersion,
    pinnedAt: new Date().toISOString(),
    remoteHost: manifest.remoteHost,
    models,
  };
}

export { resolveDigest, verifyManifest, regenerateManifest, loadManifest, MANIFEST_PATH };

// Main guard: run the CLI only when executed directly.
const isMain =
  process.argv[1] &&
  import.meta.url ===
    new URL(`file://${process.argv[1].replace(/\\/g, "/")}`).href;

if (isMain) {
  const isCheck = process.argv.includes("--check");
  const manifest = loadManifest();

  if (isCheck) {
    const drift = await verifyManifest(manifest);
    if (drift.length > 0) {
      console.error(
        `[pin-model-digests] FAIL: ${drift.length} file(s) drifted from the pinned manifest —\n  ` +
          drift.join("\n  "),
      );
      console.error(
        "[pin-model-digests] Run `node scripts/pin-model-digests.mjs` and commit the updated manifest.",
      );
      process.exit(1);
    }
    console.log(
      `[pin-model-digests] ok: ${Object.values(manifest.models).reduce(
        (n, m) => n + Object.keys(m.files).length,
        0,
      )} pinned file(s) verified against ${manifest.remoteHost}`,
    );
  } else {
    const regenerated = await regenerateManifest(manifest);
    writeFileSync(MANIFEST_PATH, JSON.stringify(regenerated, null, 2) + "\n");
    console.log(
      `[pin-model-digests] manifest regenerated (${new Date(
        regenerated.pinnedAt,
      ).toISOString()})`,
    );
  }
}
