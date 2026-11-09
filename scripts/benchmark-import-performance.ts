#!/usr/bin/env node
/**
 * scripts/benchmark-import-performance.ts
 *
 * Executable benchmark for the two hot paths the import/knowledge work
 * changed, measured against a real RxDB collection built from the shipped
 * `bookmarkSchema` (Dexie storage over fake-indexeddb by default, or the
 * memory storage with --storage memory):
 *
 *   1. Dedup lookup — per-record `findOne({ urlHash })`, the pattern the
 *      importer used before, versus the windowed `$in` query it uses now
 *      (`EXISTENCE_QUERY_BATCH = 400` in src/services/UniversalImporter.ts,
 *      mirrored here because that module imports `import.meta.env` and
 *      cannot be loaded outside Vite).
 *   2. Bounded knowledge scan — unbounded `find().exec()` versus the real
 *      `boundedBookmarkQuery()` helper (`MAX_KNOWLEDGE_SCAN_ITEMS = 2000`).
 *   3. Bookmark insert — one `insert` transaction per row, the shape the
 *      importer used before, versus `bulkInsert` chunks of
 *      `BOOKMARK_BULK_INSERT_CHUNK` (100, mirrored from the importer).
 *
 * Both dedup arms must return the same match count; a faster arm that
 * reports different hits is a bug, so the run fails instead of printing a
 * speedup. Timings are the median of `--repeats` passes after one warmup.
 *
 * Usage:
 *   npx tsx scripts/benchmark-import-performance.ts
 *   npx tsx scripts/benchmark-import-performance.ts --items 50000 --storage memory
 *   npx tsx scripts/benchmark-import-performance.ts --items 20000 --repeats 5 --json
 *
 * The numbers are local measurements on the Node implementation of
 * IndexedDB, not browser numbers: use the ratios to compare strategies, and
 * re-run on the target machine before quoting an absolute figure.
 */
import "fake-indexeddb/auto";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { addRxPlugin, createRxDatabase, type RxCollection } from "rxdb";
import { RxDBMigrationSchemaPlugin } from "rxdb/plugins/migration-schema";
import { RxDBQueryBuilderPlugin } from "rxdb/plugins/query-builder";
import { RxDBLeaderElectionPlugin } from "rxdb/plugins/leader-election";
import { getRxStorageDexie } from "rxdb/plugins/storage-dexie";
import { getRxStorageMemory } from "rxdb/plugins/storage-memory";
import { bookmarkSchema, type BookmarkDocType } from "../src/db/schema";
import {
  boundedBookmarkQuery,
  MAX_KNOWLEDGE_SCAN_ITEMS,
} from "../src/utils/knowledgeCardBounds";

/**
 * Same basis as `hashString` in src/utils/crypto-core.ts: SHA-256 hex of the
 * UTF-8 URL. `node:crypto` is used because importing crypto-core pulls the
 * app logger, whose `import.meta.env.DEV` only resolves inside Vite.
 */
function hashString(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

addRxPlugin(RxDBMigrationSchemaPlugin);
addRxPlugin(RxDBQueryBuilderPlugin);
addRxPlugin(RxDBLeaderElectionPlugin);

/** Mirrors EXISTENCE_QUERY_BATCH in src/services/UniversalImporter.ts. */
const EXISTENCE_QUERY_BATCH = 400;
/**
 * Hashes probed per dedup pass. The per-record arm costs one IndexedDB query
 * per hash, so scaling the probe with the corpus would turn the run into
 * minutes of fake-IDB round-trips without changing the conclusion; the win is
 * per-query and the reported query counts scale it explicitly.
 */
const DEDUP_PROBE_SIZE = 1_000;
const INSERT_CHUNK = 500;
/**
 * Documents written per insert-arm pass. The arms run after the query arms so
 * the extra rows cannot inflate the scan results, and 1,000 rows already
 * separates the two write shapes by an order of magnitude.
 */
const INSERT_PROBE_SIZE = 1_000;
/** Mirrors BOOKMARK_BULK_INSERT_CHUNK in src/services/UniversalImporter.ts. */
const BOOKMARK_BULK_INSERT_CHUNK = 100;

type StorageChoice = "dexie" | "memory";

interface BenchmarkOptions {
  items: number;
  storage: StorageChoice;
  repeats: number;
  json: boolean;
}

interface ArmResult {
  label: string;
  operations: number;
  documents: number;
  medianMs: number;
}

function parseArgs(argv: readonly string[]): BenchmarkOptions {
  const read = (flag: string, fallback: number): number => {
    const index = argv.indexOf(flag);
    if (index === -1) {
      return fallback;
    }
    const parsed = Number.parseInt(argv[index + 1] ?? "", 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  };
  const storageArg = argv[argv.indexOf("--storage") + 1];
  return {
    items: read("--items", 5_000),
    storage: storageArg === "memory" ? "memory" : "dexie",
    repeats: read("--repeats", 3),
    json: argv.includes("--json"),
  };
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

async function timeArm(
  label: string,
  repeats: number,
  run: () => Promise<{ operations: number; documents: number }>,
): Promise<ArmResult> {
  // One warmup pass: first-touch index pages are not what we are comparing.
  const warm = await run();
  const samples: number[] = [];
  let last = warm;
  for (let pass = 0; pass < repeats; pass++) {
    const started = performance.now();
    last = await run();
    samples.push(performance.now() - started);
  }
  return {
    label,
    operations: last.operations,
    documents: last.documents,
    medianMs: median(samples),
  };
}

/** Insert-arm corpus with per-pass unique ids and URLs (no PK conflicts). */
function buildInsertDocuments(
  count: number,
  pass: number,
): BookmarkDocType[] {
  const corpus = Array.from({ length: count }, (_, index) => {
    const url = `https://example.com/insert/${pass}/${index}?src=benchmark`;
    return { url, urlHash: hashString(url), index };
  });
  return toDocuments(corpus, Date.parse("2026-01-01T00:00:00Z"), `insert-${pass}`);
}

/** Distinguishes insert-arm passes so ids never collide across repeats. */
let insertPass = 0;

function buildCorpus(count: number): Array<{ url: string; urlHash: string; index: number }> {
  return Array.from({ length: count }, (_, index) => ({
    url: `https://example.com/library/${index}?src=benchmark`,
    urlHash: "",
    index,
  }));
}

function hashCorpus(corpus: Array<{ url: string; urlHash: string }>): void {
  for (const entry of corpus) {
    entry.urlHash = hashString(entry.url);
  }
}

function toDocuments(
  corpus: readonly { url: string; urlHash: string; index: number }[],
  baseTime: number,
  idPrefix = "bench",
): BookmarkDocType[] {
  return corpus.map((entry) => {
    const stamp = new Date(baseTime + entry.index).toISOString();
    return {
      id: `${idPrefix}-${entry.index}`,
      url: entry.url,
      urlHash: entry.urlHash,
      title: `Benchmark bookmark ${entry.index}`,
      content: "",
      summary: "",
      tags: [],
      relatedLinks: [],
      embedding: [],
      processed: true,
      isPrivate: false,
      isDeleted: entry.index % 50 === 0,
      broken: false,
      lastChecked: stamp,
      lastVisitedAt: stamp,
      visitCount: entry.index % 97,
      isRead: true,
      createdAt: stamp,
      updatedAt: stamp,
    } satisfies BookmarkDocType;
  });
}

async function seed(
  collection: RxCollection<BookmarkDocType>,
  documents: readonly BookmarkDocType[],
): Promise<number> {
  const started = performance.now();
  for (let start = 0; start < documents.length; start += INSERT_CHUNK) {
    await collection.bulkInsert(documents.slice(start, start + INSERT_CHUNK));
  }
  return performance.now() - started;
}

/** Legacy dedup: one indexed findOne per imported row. */
async function dedupPerRecord(
  collection: RxCollection<BookmarkDocType>,
  hashes: readonly string[],
): Promise<{ operations: number; documents: number }> {
  let matches = 0;
  for (const hash of hashes) {
    const doc = await collection.findOne({ selector: { urlHash: hash } }).exec();
    if (doc) {
      matches++;
    }
  }
  return { operations: hashes.length, documents: matches };
}

/** Current dedup: windowed `$in`, each window one indexed query. */
async function dedupWindowed(
  collection: RxCollection<BookmarkDocType>,
  hashes: readonly string[],
): Promise<{ operations: number; documents: number }> {
  const unique = Array.from(new Set(hashes));
  let matches = 0;
  let operations = 0;
  for (let start = 0; start < unique.length; start += EXISTENCE_QUERY_BATCH) {
    const slice = unique.slice(start, start + EXISTENCE_QUERY_BATCH);
    const docs = await collection
      .find({ selector: { urlHash: { $in: slice } } })
      .exec();
    matches += docs.length;
    operations++;
  }
  return { operations, documents: matches };
}

function printTable(rows: readonly ArmResult[]): void {
  const header = ["scenario", "queries", "docs", "median"];
  const body = rows.map((row) => [
    row.label,
    row.operations.toLocaleString("en-US"),
    row.documents.toLocaleString("en-US"),
    `${row.medianMs.toFixed(1)} ms`,
  ]);
  const widths = header.map((title, column) =>
    Math.max(title.length, ...body.map((line) => line[column].length)),
  );
  const render = (cells: readonly string[]) =>
    cells.map((cell, column) => cell.padEnd(widths[column])).join("  ").trimEnd();
  console.log(`\n${render(header)}`);
  console.log(widths.map((width) => "-".repeat(width)).join("  "));
  body.forEach((line) => console.log(render(line)));
}

function speedup(before: ArmResult, after: ArmResult): string {
  const factor = before.medianMs / Math.max(after.medianMs, 0.001);
  if (factor < 1.05) {
    return `no measurable gain at this size (${factor.toFixed(2)}x, within noise)`;
  }
  return `${factor.toFixed(1)}x faster, ${(
    100 *
    (1 - after.medianMs / before.medianMs)
  ).toFixed(1)}% less wall time`;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const corpus = buildCorpus(options.items);
  hashCorpus(corpus);

  // `ignoreDuplicate` only exists in dev-mode (RxDB DB9), and dev-mode adds
  // validation overhead to every read, so the name is unique instead.
  const db = await createRxDatabase({
    name: `benchmark-hot-paths-${options.storage}-${options.items}-${Date.now()}`,
    storage:
      options.storage === "dexie" ? getRxStorageDexie() : getRxStorageMemory(),
  });
  // The benchmark isolates query cost: drop the `encrypted` declaration,
  // which RxDB rejects on a raw storage (UT6) and which would add the same
  // per-document decryption cost to every arm. Shape and indexes stay
  // identical to the shipped schema.
  const querySchema = { ...bookmarkSchema } as Record<string, unknown>;
  delete querySchema.encrypted;
  const { bookmarks } = await db.addCollections({
    bookmarks: { schema: querySchema as unknown as typeof bookmarkSchema },
  });

  try {
    const documents = toDocuments(corpus, Date.parse("2026-01-01T00:00:00Z"));
    const seedMs = await seed(bookmarks, documents);
    console.error(`[bench] seeded ${documents.length} docs in ${seedMs.toFixed(0)} ms`);

    // Half the corpus exists already: a dedup arm that found nothing would
    // look fast for the wrong reason, so exercise real hits and real misses.
    const half = Math.floor(DEDUP_PROBE_SIZE / 2);
    const existingProbe = corpus
      .filter((entry) => entry.index % 2 === 0)
      .slice(0, half)
      .map((entry) => entry.urlHash);
    const missingProbe = Array.from(
      { length: DEDUP_PROBE_SIZE - half },
      (_, index) => `absent-${index}`,
    );
    const dedupProbe = [...existingProbe, ...missingProbe];

    const perRecord = await timeArm("dedup: findOne per record", options.repeats, () =>
      dedupPerRecord(bookmarks, dedupProbe),
    );
    const windowed = await timeArm(
      `dedup: $in windows of ${EXISTENCE_QUERY_BATCH}`,
      options.repeats,
      () => dedupWindowed(bookmarks, dedupProbe),
    );

    console.error("[bench] dedup arms done");
    if (perRecord.documents !== windowed.documents) {
      throw new Error(
        `dedup arms disagree: findOne matched ${perRecord.documents}, windowed matched ${windowed.documents}`,
      );
    }

    const unbounded = await timeArm("scan: unbounded find()", options.repeats, async () => {
      const docs = await bookmarks.find().exec();
      return { operations: 1, documents: docs.length };
    });
    const bounded = await timeArm(
      `scan: bounded query (${MAX_KNOWLEDGE_SCAN_ITEMS})`,
      options.repeats,
      async () => {
        const docs = await boundedBookmarkQuery(
          bookmarks,
          MAX_KNOWLEDGE_SCAN_ITEMS,
          { isDeleted: false },
        ).exec();
        return { operations: 1, documents: docs.length };
      },
    );
    const legacyScan = await timeArm(
      "scan: unbounded + isDeleted filter",
      options.repeats,
      async () => {
        const docs = await bookmarks
          .find({ selector: { isDeleted: false } })
          .exec();
        return { operations: 1, documents: docs.length };
      },
    );

    console.error("[bench] scan arms done");

    // Insert arms run last: every pass adds rows to the same collection, so
    // running them earlier would inflate the scan arms' document counts.
    const sequentialInsert = await timeArm(
      "insert: one transaction per row",
      options.repeats,
      async () => {
        insertPass += 1;
        const docs = buildInsertDocuments(INSERT_PROBE_SIZE, insertPass);
        for (const doc of docs) {
          await bookmarks.insert(doc);
        }
        return { operations: docs.length, documents: docs.length };
      },
    );
    const batchedInsert = await timeArm(
      `insert: bulkInsert chunks of ${BOOKMARK_BULK_INSERT_CHUNK}`,
      options.repeats,
      async () => {
        insertPass += 1;
        const docs = buildInsertDocuments(INSERT_PROBE_SIZE, insertPass);
        let calls = 0;
        for (
          let start = 0;
          start < docs.length;
          start += BOOKMARK_BULK_INSERT_CHUNK
        ) {
          await bookmarks.bulkInsert(
            docs.slice(start, start + BOOKMARK_BULK_INSERT_CHUNK),
          );
          calls += 1;
        }
        return { operations: calls, documents: docs.length };
      },
    );
    console.error("[bench] insert arms done");

    const summary = {
      storage: options.storage,
      items: options.items,
      repeats: options.repeats,
      seedMs,
      dedup: { perRecord, windowed },
      scan: { unbounded, legacyFilter: legacyScan, bounded },
      insert: {
        probeSize: INSERT_PROBE_SIZE,
        sequential: sequentialInsert,
        batched: batchedInsert,
      },
    };

    if (options.json) {
      console.log(JSON.stringify(summary, null, 2));
    } else {
      console.log(
        `\nbookmarkSchema v${bookmarkSchema.version} · ${options.storage} storage · ` +
          `${options.items.toLocaleString("en-US")} bookmarks seeded in ${seedMs.toFixed(0)} ms`,
      );
      printTable([
        perRecord,
        windowed,
        unbounded,
        legacyScan,
        bounded,
        sequentialInsert,
        batchedInsert,
      ]);
      console.log(`\ndedup   ${perRecord.operations.toLocaleString("en-US")} queries -> ${windowed.operations} queries: ${speedup(perRecord, windowed)}`);
      const cappedPercent =
        (1 - bounded.documents / Math.max(legacyScan.documents, 1)) * 100;
      console.log(
        `scan    ${legacyScan.documents.toLocaleString("en-US")} docs materialized -> ` +
          `${bounded.documents.toLocaleString("en-US")} (${cappedPercent.toFixed(0)}% less work), ` +
          `wall ${legacyScan.medianMs.toFixed(1)} ms -> ${bounded.medianMs.toFixed(1)} ms`,
      );
      console.log(
        `insert  ${sequentialInsert.documents.toLocaleString("en-US")} docs: ` +
          `${sequentialInsert.operations.toLocaleString("en-US")} row transactions -> ` +
          `${batchedInsert.operations} bulkInsert calls (median of ${options.repeats}): ` +
          `${speedup(sequentialInsert, batchedInsert)}`,
      );
      console.log(
        `\nnote: Node fake-indexeddb timings; ratios compare strategies, absolute ms is machine-local.`,
      );
    }
  } finally {
    await db.close();
    await db.remove();
  }
}

main()
  .then(() => {
    // The leader-election plugin keeps timers on the loop; without an
    // explicit exit the process outlives its output.
    process.exit(0);
  })
  .catch((error: unknown) => {
    console.error(
      `benchmark failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  });
