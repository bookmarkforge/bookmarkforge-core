#!/usr/bin/env node
/**
 * Validates that all Docker base images are pinned by digest (sha256:...).
 *
 * Rationale: tag-based image references (e.g. node:20-alpine) are mutable —
 * a malicious or accidental upstream change can alter the build environment
 * without any visible diff in the repo. Pinning by digest guarantees
 * bit-for-bit reproducibility and mitigates supply-chain risk.
 *
 * Scope: Dockerfile, docker-compose.prod.yml, docker-compose.staging.yml.
 * Project-built images (bookmarkforge/web, bookmarkforge/api) are excluded —
 * they are tagged by SHA via the deploy pipeline, not pulled from a registry.
 *
 * Audit 2026-08-30: previously only GitHub Actions were pinned by SHA;
 * Docker images were tag-only.
 */
import { readFileSync, existsSync } from "node:fs";
// `pathToFileURL` percent-encodes the path and supplies the `file:///` the URL
// form requires, so the CLI guard below matches on Windows and on any path
// with spaces; a `` `file://${process.argv[1]}` `` comparison matches neither
// (`file://D:\...` vs the real `file:///D:/...`), so main() never ran.
import { pathToFileURL } from "node:url";

const FILES = [
  "Dockerfile",
  "docker-compose.prod.yml",
  "docker-compose.staging.yml",
];

// Images that are built locally by the project, not pulled from a registry.
// They are tagged by SHA at deploy time (deploy-prod.mjs), so digest pinning
// does not apply.
const LOCAL_IMAGE_PREFIXES = ["bookmarkforge/"];

const FROM_PATTERN = /^FROM\s+([^\s]+)/gm;
const IMAGE_KEY_PATTERN = /image:\s*["']?([^\s"']+)/g;

function extractImages(content) {
  const images = [];
  // FROM directives (Dockerfile)
  let match;
  while ((match = FROM_PATTERN.exec(content)) !== null) {
    // Skip FROM ... AS alias — the image is the first token
    images.push(match[1].split(/\s+AS\s+/i)[0]);
  }
  // image: keys (compose)
  while ((match = IMAGE_KEY_PATTERN.exec(content)) !== null) {
    images.push(match[1]);
  }
  return images;
}

function isPinnedByDigest(image) {
  // Valid pin formats:
  //   repo:tag@sha256:...
  //   repo@sha256:... (rare, tagless)
  return /@sha256:[a-f0-9]{64}/.test(image);
}

function isLocalImage(image) {
  return LOCAL_IMAGE_PREFIXES.some((prefix) => image.startsWith(prefix));
}

function isBuildArg(image) {
  // ${VAR} or ${VAR:-default} — these are parameterized at build time
  return image.startsWith("${") || image.includes("${");
}

function isBuildStageAlias(image) {
  // Multi-stage build aliases (FROM ... AS base) — internal references,
  // not registry images. Common aliases: base, deps, build, web, api.
  return /^(base|deps|build|web|api|builder|final|runtime|dev|test)$/i.test(
    image,
  );
}
/**
 * Pure validation function — testable without filesystem.
 * @param {string} content — Dockerfile or compose file content.
 * @returns {{ errors: Array<{file?: string, image: string}>, checked: number }}
 */
export function validateImagePins(content) {
  const images = extractImages(content);
  const errors = [];
  let checked = 0;

  for (const image of images) {
    if (isBuildArg(image)) {
      checked++;
      continue;
    }
    if (isBuildStageAlias(image)) {
      continue;
    }
    if (isLocalImage(image)) {
      checked++;
      continue;
    }
    checked++;

    if (!isPinnedByDigest(image)) {
      errors.push({ image });
    }
  }
  return { errors, checked };
}

// ── CLI entry point ───────────────────────────────────────────────

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let violations = [];
  let checked = 0;

  for (const file of FILES) {
    if (!existsSync(file)) continue;
    const content = readFileSync(file, "utf8");
    const result = validateImagePins(content);
    checked += result.checked;
    for (const err of result.errors) {
      violations.push({ file, image: err.image });
    }
  }

  if (violations.length > 0) {
    console.error("[validate-image-pins] FAIL — Docker images not pinned by digest:");
    for (const { file, image } of violations) {
      console.error(`  ${file}: ${image}`);
    }
    console.error("");
    console.error(
      "All base images pulled from a registry must be pinned by digest (@sha256:...).",
    );
    console.error(
      "Project-built images (bookmarkforge/*) and build-arg parameterized images are exempt.",
    );
    console.error(
      "To obtain a digest: docker pull <image:tag> && docker image inspect --format='{{.RepoDigests}}' <image:tag>",
    );
    process.exit(1);
  }

  console.log(
    `[validate-image-pins] OK — ${checked} image(s) checked, all pinned by digest`,
  );
}
