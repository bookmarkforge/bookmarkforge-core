#!/usr/bin/env node
/**
 * Large CSV importer benchmark.
 *
 * This is intentionally a standalone benchmark, not a Vitest test:
 *   - it is not named *.test.*;
 *   - it lives outside scripts/__tests__/ and src/;
 *   - it is never collected by scripts/test-bounded.mjs;
 *   - it does not read or update the unit-test timing baseline.
 *
 * The benchmark loads the production UniversalImporter through Vite SSR and
 * measures its public importData() streaming path. Database writes are
 * represented by a discard-only double so the result isolates CSV decoding,
 * parsing, sanitization, hashing, and importer scheduling from IndexedDB
 * variance. Use benchmark-storage for storage-engine measurements.
 *
 * Run:
 *   npm run benchmark:import-csv
 *   npm run benchmark:import-csv -- --rows=50000 --repetitions=3
 *
 * The default is 99,999 data rows. The importer counts the header as a record,
 * so this is the largest successful generic CSV import under its 100,000
 * record limit.
 */
import { createServer } from "vite";
import { JSDOM } from "jsdom";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_ROWS = 99_999;
const DEFAULT_ROWS_PER_CHUNK = 512;
const DEFAULT_REPETITIONS = 1;
const DEFAULT_WARMUPS = 1;
const MI_B = 1024 * 1024;

function parsePositiveInteger(value, flag, fallback, { allowZero = false } = {}) {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  const minimum = allowZero ? 0 : 1;
  if (!Number.isInteger(parsed) || parsed < minimum) {
    throw new Error(`${flag} must be a ${allowZero ? "non-negative" : "positive"} integer`);
  }
  return parsed;
}

function parseArgs(argv) {
  const values = new Map();
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      values.set("help", true);
      continue;
    }
    const match = /^(--[a-z-]+)(?:=(.*))?$/.exec(arg);
    if (!match) {
      throw new Error(`Unknown argument "${arg}"; use --help for usage`);
    }
    values.set(match[1], match[2]);
  }

  return {
    help: values.get("help") === true,
    rows: parsePositiveInteger(values.get("--rows"), "--rows", DEFAULT_ROWS),
    rowsPerChunk: parsePositiveInteger(
      values.get("--rows-per-chunk"),
      "--rows-per-chunk",
      DEFAULT_ROWS_PER_CHUNK,
    ),
    repetitions: parsePositiveInteger(
      values.get("--repetitions"),
      "--repetitions",
      DEFAULT_REPETITIONS,
    ),
    warmups: parsePositiveInteger(
      values.get("--warmups"),
      "--warmups",
      DEFAULT_WARMUPS,
      { allowZero: true },
    ),
    json: values.has("--json") && values.get("--json") !== "false",
  };
}

function printHelp() {
  console.log(`BookmarkForge large CSV importer benchmark

Usage:
  npm run benchmark:import-csv
  npm run benchmark:import-csv -- --rows=50000 --repetitions=3

Options:
  --rows=N             Data rows per run (default: ${DEFAULT_ROWS})
  --rows-per-chunk=N   Generated rows per stream chunk (default: ${DEFAULT_ROWS_PER_CHUNK})
  --repetitions=N      Measured runs (default: ${DEFAULT_REPETITIONS})
  --warmups=N          Unmeasured warmup runs (default: ${DEFAULT_WARMUPS})
  --json[=false]       Emit a machine-readable summary after the table
  --help               Show this help
`);
}

function installDomGlobals() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "https://benchmark.bookmarkforge.invalid/",
  });
  const globals = [
    "window",
    "document",
    "DOMParser",
    "Node",
    "Element",
    "HTMLElement",
    "navigator",
    "location",
    "localStorage",
    "sessionStorage",
  ];
  for (const name of globals) {
    if (globalThis[name] === undefined && dom.window[name] !== undefined) {
      Object.defineProperty(globalThis, name, {
        configurable: true,
        value: dom.window[name],
      });
    }
  }
  return dom;
}

function createDiscardDb() {
  let inserted = 0;
  const bookmarks = {
    findOne: () => ({ exec: async () => null }),
    insert: async () => {
      inserted += 1;
      return {};
    },
    find: () => ({ exec: async () => [] }),
    bulkRemove: async () => {},
  };
  const emptyCollection = {
    find: () => ({ exec: async () => [] }),
    findOne: () => ({ exec: async () => null }),
    insert: async () => ({}),
    bulkRemove: async () => {},
  };

  return {
    bookmarks,
    documents: emptyCollection,
    folders: emptyCollection,
    getInsertedCount: () => inserted,
  };
}

function formatMiB(bytes) {
  return `${(bytes / MI_B).toFixed(2)} MiB`;
}

function formatMs(ms) {
  return `${ms.toFixed(1)} ms`;
}

function formatRowsPerSecond(rows, ms) {
  return `${(rows / Math.max(ms, 0.001) * 1000).toFixed(0)} rows/s`;
}

function formatDelta(bytes) {
  const sign = bytes >= 0 ? "+" : "";
  return `${sign}${(bytes / MI_B).toFixed(2)} MiB`;
}

async function loadBenchmarkModules() {
  const server = await createServer({
    root: ROOT,
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });

  try {
    const [{ UniversalImporter }, { createStreamingCsvRowsFile }] = await Promise.all([
      server.ssrLoadModule("/src/services/UniversalImporter.ts"),
      server.ssrLoadModule("/src/tests/helpers/csvFixtures.ts"),
    ]);
    return { UniversalImporter, createStreamingCsvRowsFile };
  } finally {
    await server.close();
  }
}

async function runImport(UniversalImporter, createStreamingCsvRowsFile, options) {
  const db = createDiscardDb();
  let generatedBytes = 0;
  const file = createStreamingCsvRowsFile({
    rowCount: options.rows,
    rowsPerChunk: options.rowsPerChunk,
    name: "benchmark-large.csv",
    // The fixture is lazy; this metadata only needs to stay below the
    // importer's 50 MB preflight limit. Actual generated bytes are reported
    // separately and never require materializing the complete file.
    size: 1,
    header: "Title,URL\n",
    row: (index) => {
      const row = `Bookmark ${index},https://benchmark-${index}.example\n`;
      generatedBytes += Buffer.byteLength(row);
      return row;
    },
  });
  const importer = new UniversalImporter();
  const before = process.memoryUsage();
  const startedAt = process.hrtime.bigint();
  const result = await importer.importData(db, file);
  const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
  const after = process.memoryUsage();

  if (!result.success || result.importedCount !== options.rows) {
    throw new Error(
      `benchmark import failed: ${JSON.stringify({
        success: result.success,
        importedCount: result.importedCount,
        skippedCount: result.skippedCount,
        error: result.error,
      })}`,
    );
  }

  return {
    rows: options.rows,
    bytes: generatedBytes + Buffer.byteLength("Title,URL\n"),
    elapsedMs,
    rowsPerSecond: options.rows / Math.max(elapsedMs, 0.001) * 1000,
    heapDeltaBytes: after.heapUsed - before.heapUsed,
    rssDeltaBytes: after.rss - before.rss,
    inserted: db.getInsertedCount(),
  };
}

function printResults(config, results) {
  const elapsedValues = results.map((result) => result.elapsedMs);
  const totalMs = elapsedValues.reduce((sum, value) => sum + value, 0);
  const bestMs = Math.min(...elapsedValues);
  const averageMs = totalMs / results.length;
  const last = results[results.length - 1];

  console.log("\n── Large CSV import benchmark ─────────────────────────────────");
  console.table(
    results.map((result, index) => ({
      Run: index + 1,
      Rows: result.rows,
      "Input (MiB)": (result.bytes / MI_B).toFixed(2),
      "Elapsed (ms)": result.elapsedMs.toFixed(1),
      "Rows/s": Math.round(result.rowsPerSecond),
      "Heap Δ (MiB)": (result.heapDeltaBytes / MI_B).toFixed(2),
      "RSS Δ (MiB)": (result.rssDeltaBytes / MI_B).toFixed(2),
      Inserted: result.inserted,
    })),
  );
  console.log(`Rows:             ${config.rows.toLocaleString()}`);
  console.log(`Rows per chunk:   ${config.rowsPerChunk.toLocaleString()}`);
  console.log(`Warmups:          ${config.warmups}`);
  console.log(`Measured runs:    ${config.repetitions}`);
  console.log(`Average:          ${formatMs(averageMs)} (${formatRowsPerSecond(config.rows, averageMs)})`);
  console.log(`Best:             ${formatMs(bestMs)} (${formatRowsPerSecond(config.rows, bestMs)})`);
  console.log(`Last input size:  ${formatMiB(last.bytes)}`);
  console.log(`Last heap delta:  ${formatDelta(last.heapDeltaBytes)}`);
  console.log(`Last RSS delta:   ${formatDelta(last.rssDeltaBytes)}`);
  console.log("Database:         discard-only double; use benchmark:storage for storage cost");
  console.log("Timing budget:    standalone; no Vitest/timing-baseline integration");

  if (config.json) {
    console.log(
      JSON.stringify({
        benchmark: "large-csv-import",
        rows: config.rows,
        rowsPerChunk: config.rowsPerChunk,
        warmups: config.warmups,
        repetitions: config.repetitions,
        averageMs,
        bestMs,
        averageRowsPerSecond: config.rows / Math.max(averageMs, 0.001) * 1000,
        results,
      }),
    );
  }
}

async function main() {
  const config = parseArgs(process.argv.slice(2));
  if (config.help) {
    printHelp();
    return;
  }

  const dom = installDomGlobals();
  try {
    console.log(
      `Loading importer through Vite SSR; ${config.rows.toLocaleString()} data rows, ` +
        `${config.rowsPerChunk.toLocaleString()} rows/chunk...`,
    );
    const { UniversalImporter, createStreamingCsvRowsFile } =
      await loadBenchmarkModules();

    for (let index = 0; index < config.warmups; index += 1) {
      await runImport(UniversalImporter, createStreamingCsvRowsFile, config);
    }

    const results = [];
    for (let index = 0; index < config.repetitions; index += 1) {
      results.push(
        await runImport(UniversalImporter, createStreamingCsvRowsFile, config),
      );
    }
    printResults(config, results);
  } finally {
    dom.window.close();
  }
}

main().catch((error) => {
  console.error(`Benchmark failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
