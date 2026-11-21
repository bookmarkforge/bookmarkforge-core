#!/usr/bin/env node
/**
 * Enforce feature budgets against the production assets in dist/assets.
 *
 * Each feature owns filename patterns and a byte budget. Hashes are ignored by
 * matching the stable emitted prefix. Any asset above the classification
 * threshold must belong to a declared feature, so a new heavy module fails CI
 * instead of silently inflating the global bundle.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const FEATURE_BUDGET_SCHEMA = "bmf.feature-budgets/1";
const ROOT = process.env.BMF_ROOT || process.cwd();
const ASSETS = join(ROOT, "dist", "assets");
const CONFIG_PATH = process.env.BMF_FEATURE_BUDGETS
  ? resolve(ROOT, process.env.BMF_FEATURE_BUDGETS)
  : join(ROOT, "scripts", "feature-budgets.json");
const JSON_MODE = process.argv.includes("--json");

function fail(message) {
  throw new Error(`[check-feature-budgets] ${message}`);
}

export function loadFeatureBudgets(path = CONFIG_PATH) {
  if (!existsSync(path)) fail(`budget file missing: ${path}`);
  let config;
  try {
    config = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(`budget file is not valid JSON: ${error.message}`);
  }
  if (config?.schema !== FEATURE_BUDGET_SCHEMA) {
    fail(`budget schema mismatch (expected ${FEATURE_BUDGET_SCHEMA})`);
  }
  if (!Number.isInteger(config.unclassifiedThresholdBytes) || config.unclassifiedThresholdBytes <= 0) {
    fail("unclassifiedThresholdBytes must be a positive integer");
  }
  if (!Array.isArray(config.features) || config.features.length === 0) {
    fail("features must be a non-empty array");
  }
  const ids = new Set();
  for (const feature of config.features) {
    if (!feature?.id || ids.has(feature.id)) fail(`duplicate or missing feature id: ${feature?.id ?? "none"}`);
    ids.add(feature.id);
    if (!Array.isArray(feature.patterns) || feature.patterns.length === 0) fail(`${feature.id}: patterns are required`);
    if (!Number.isInteger(feature.budgetBytes) || feature.budgetBytes <= 0) fail(`${feature.id}: budgetBytes must be positive`);
    for (const pattern of feature.patterns) {
      try { new RegExp(pattern); } catch (error) { fail(`${feature.id}: invalid pattern ${pattern}: ${error.message}`); }
    }
  }
  return config;
}

export function readAssets(assetsDir = ASSETS) {
  if (!existsSync(assetsDir) || !statSync(assetsDir).isDirectory()) {
    fail("dist/assets not found — run npm run build:ci first");
  }
  return readdirSync(assetsDir)
    .filter((name) => /\.(?:js|mjs|css)$/.test(name))
    .map((name) => ({ name, bytes: statSync(join(assetsDir, name)).size }));
}

export function evaluateFeatureBudgets({ assets, config }) {
  const features = config.features.map((feature) => {
    const patterns = feature.patterns.map((pattern) => new RegExp(pattern));
    const matches = assets.filter((asset) => patterns.some((pattern) => pattern.test(asset.name)));
    const actualBytes = matches.reduce((total, asset) => total + asset.bytes, 0);
    const issues = [];
    if (matches.length === 0) issues.push("no emitted asset matched the declared patterns");
    if (actualBytes > feature.budgetBytes) {
      issues.push(`actual ${actualBytes} bytes exceeds budget ${feature.budgetBytes} bytes`);
    }
    return {
      id: feature.id,
      label: feature.label,
      budgetBytes: feature.budgetBytes,
      actualBytes,
      matchedAssets: matches.map((asset) => asset.name).sort(),
      ok: issues.length === 0,
      issues,
    };
  });

  const classified = new Set(features.flatMap((feature) => feature.matchedAssets));
  const unclassifiedLarge = assets.filter(
    (asset) => asset.bytes > config.unclassifiedThresholdBytes && !classified.has(asset.name),
  );
  const failures = [
    ...features.filter((feature) => !feature.ok).flatMap((feature) => feature.issues.map((issue) => `${feature.id}: ${issue}`)),
    ...unclassifiedLarge.map((asset) => `${asset.name}: ${asset.bytes} bytes is unclassified (threshold ${config.unclassifiedThresholdBytes})`),
  ];
  return {
    ok: failures.length === 0,
    thresholdBytes: config.unclassifiedThresholdBytes,
    features,
    unclassifiedLarge,
    failures,
  };
}

function formatBytes(bytes) {
  return `${(bytes / 1024).toFixed(0)} KiB`;
}

function main() {
  try {
    const config = loadFeatureBudgets();
    const result = evaluateFeatureBudgets({ assets: readAssets(), config });
    if (JSON_MODE) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      for (const feature of result.features) {
        console.log(`${feature.ok ? "PASS" : "FAIL"} ${feature.label}: ${formatBytes(feature.actualBytes)} / ${formatBytes(feature.budgetBytes)} (${feature.matchedAssets.join(", ")})`);
      }
      if (result.unclassifiedLarge.length > 0) {
        for (const asset of result.unclassifiedLarge) console.error(`FAIL unclassified large asset: ${asset.name} — ${formatBytes(asset.bytes)}`);
      }
      console.log(`[check-feature-budgets] ${result.ok ? "pass" : "fail"}: ${result.features.length} features, threshold=${formatBytes(result.thresholdBytes)}`);
    }
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    if (JSON_MODE) console.log(JSON.stringify({ ok: false, failures: [String(error)] }, null, 2));
    else console.error(String(error));
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
