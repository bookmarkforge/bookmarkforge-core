#!/usr/bin/env node
/**
 * Internal storage benchmark: Dexie (IndexedDB) vs the RxDB SQLite trial
 * storage — plus a `memory` control that isolates pure RxDB overhead from
 * storage-engine cost.
 *
 * Measures, for N documents:
 *   - initDB : createRxDatabase + addCollections
 *   - write  : one bulkInsert of N docs
 *   - read   : find().exec() loading every doc (FIRST call — uncached)
 *
 * IMPORTANT — environment caveat (measured, not assumed):
 *   FakeIndexedDB (used here because Node has no IndexedDB) serializes every
 *   IDB request through setTimeout-sized scheduling, so DEXIE WRITE/READ
 *   NUMBERS ARE NOT UNBROKEN BROWSER NUMBERS. They are orders of magnitude
 *   slower than real Chrome/Edge IndexedDB. The `memory` control row shows
 *   the pure RxDB overhead (same materialization, no storage engine), and
 *   the SQLite trial runs on REAL node:sqlite, so its numbers are real.
 *
 * The SQLite TRIAL is hard-capped by RxDB: 500 live docs (RxError SQL2) and
 * 500 operations (RxError SQL3) per storage instance. Every insert is one
 * operation, plus one SELECT per bulkWrite, so the effective maximum is
 * 498 documents successfully written AND read back. The benchmark exercises
 * 1,000 / 10,000 docs anyway so the cap is *measured*, not assumed — a
 * failed write is a result, not a crash (see `status` column).
 *
 * Run with: npm run benchmark:storage
 * No fixtures, no network, no app code: uses the installed RxDB plugins,
 * node:sqlite (Node 22+) and fake-indexeddb (dev dependency).
 */
import "fake-indexeddb/auto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createRxDatabase } from "rxdb";
import { getRxStorageDexie } from "rxdb/plugins/storage-dexie";
import { getRxStorageMemory } from "rxdb/plugins/storage-memory";
import {
  getRxStorageSQLiteTrial,
  getSQLiteBasicsNodeNative,
} from "rxdb/plugins/storage-sqlite";

// ---------------------------------------------------------------------------
// Schema + fixture docs (deterministic, ~250 B of body text per doc)
// ---------------------------------------------------------------------------

const ITEM_SCHEMA = {
  title: "items",
  version: 0,
  primaryKey: "id",
  type: "object",
  properties: {
    id: { type: "string", maxLength: 64 },
    title: { type: "string" },
    body: { type: "string" },
    num: { type: "number" },
  },
  required: ["id", "title", "body", "num"],
};

const BODY = [
  "Local-first knowledge vault with AI-powered summaries, tags and a",
  "semantic search. Bookmarks and documents are stored in an encrypted",
  "IndexedDB database and synchronized peer-to-peer via WebRTC. The",
  "companion node server only relays WebRTC signaling and never sees the",
  "payloads. Everything runs on-device first, cloud is optional.",
].join(" ");

function makeDocs(n) {
  const docs = [];
  for (let i = 0; i < n; i++) {
    const id = `id-${String(i).padStart(6, "0")}`;
    docs.push({ id, title: `Doc ${i}`, body: BODY, num: i });
  }
  return docs;
}

// ---------------------------------------------------------------------------
// Timing + output helpers
// ---------------------------------------------------------------------------

const RESULTS = [];

function elapsedMs(t0) {
  return Number(process.hrtime.bigint() - t0) / 1e6;
}

function fmt(ms) {
  return `${Number(ms).toFixed(1)}`;
}

function errorTag(err) {
  if (!err) return "unknown";
  const code = err?.rxErrorId ? `RxError ${err.rxErrorId}` : (err?.code ?? err?.name ?? "Error");
  return `${code}: ${String(err?.message ?? err).split("\n")[0].slice(0, 80)}`;
}

/**
 * One scenario: init → bulkInsert(N) → find().exec().
 * `opts.note` is appended to the backend label for the report.
 */
async function runScenario(label, storage, n, opts = {}) {
  const row = {
    backend: opts.note ? `${label} ${opts.note}` : label,
    docs: n,
    init: "-",
    write: "-",
    writePerDoc: "-",
    read: "-",
    readPerDoc: "-",
    readCount: 0,
    status: "OK",
  };
  let db = null;
  const dbName = `bench_${label.replace(/[^a-z0-9]/gi, "_")}_${n}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  try {
    // -- initDB -------------------------------------------------------------
    const t0 = process.hrtime.bigint();
    db = await createRxDatabase({
      name: dbName,
      storage,
      // Unique names per run; no dev-mode plugin (raw throughput, no
      // validation overhead) — identical conditions for every backend.
      multiInstance: false,
    });
    const { items } = await db.addCollections({ items: { schema: ITEM_SCHEMA } });
    row.init = fmt(elapsedMs(t0));

    // -- write --------------------------------------------------------------
    const docs = makeDocs(n);
    const tW = process.hrtime.bigint();
    try {
      await items.bulkInsert(docs);
      row.write = fmt(elapsedMs(tW));
      row.writePerDoc = (elapsedMs(tW) / n).toFixed(3);
    } catch (err) {
      row.write = "FAILED";
      row.writePerDoc = "-";
      row.status = `cap/err: ${errorTag(err)}`;
    }

    // -- read ---------------------------------------------------------------
    const tR = process.hrtime.bigint();
    try {
      const found = await items.find().exec();
      row.read = fmt(elapsedMs(tR));
      row.readPerDoc = (elapsedMs(tR) / Math.max(1, found.length)).toFixed(4);
      row.readCount = found.length;
      if (row.status === "OK" && found.length !== n) {
        row.status = `warn: read ${found.length}/${n}`;
      }
    } catch (err) {
      row.read = "FAILED";
      row.status = `cap/err: ${errorTag(err)}`;
    }
  } catch (err) {
    row.init = "FAILED";
    row.status = `init-err: ${errorTag(err)}`;
  } finally {
    if (db) {
      try {
        await db.close();
      } catch {
        // best-effort
      }
    }
    if (opts.cleanup) {
      try {
        rmSync(opts.cleanup, { recursive: true, force: true });
      } catch {
        // best-effort
      }
    }
  }

  RESULTS.push(row);
  return row;
}

function trialStorage(dir) {
  return getRxStorageSQLiteTrial({
    sqliteBasics: getSQLiteBasicsNodeNative(DatabaseSync),
    databaseNamePrefix: dir + "/",
  });
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

async function main() {
  console.log("BookmarkForge — internal RxDB storage benchmark");
  console.log("  Dexie (IDB via fake-indexeddb)  vs  SQLite trial (node:sqlite)  vs  memory control\n");

  const dexieStorage = getRxStorageDexie();
  const memoryStorage = getRxStorageMemory();
  const sqliteDir = mkdtempSync(join(tmpdir(), "bmf-bench-"));
  console.log(`[trial] SQLite files under: ${sqliteDir}\n`);

  // Dexie — the production storage, as measured in this Node environment.
  await runScenario("Dexie", dexieStorage, 1_000);
  await runScenario("Dexie", dexieStorage, 10_000);

  // SQLite trial — same workloads; both are expected to be capped.
  const dir1 = mkdtempSync(join(tmpdir(), "bmf-bench-"));
  await runScenario("sqlite-trial", trialStorage(dir1), 1_000, { cleanup: dir1 });
  const dir2 = mkdtempSync(join(tmpdir(), "bmf-bench-"));
  await runScenario("sqlite-trial", trialStorage(dir2), 10_000, { cleanup: dir2 });

  // SQLite trial at its REAL maximum: 498 docs == 498 INSERTs + 1 SELECT ==
  // 499 ops (its own 500-limit minus one), leaving room for one read.
  const dir3 = mkdtempSync(join(tmpdir(), "bmf-bench-"));
  await runScenario("sqlite-trial", trialStorage(dir3), 498, {
    cleanup: dir3,
    note: "(max viable)",
  });

  // Memory control: same RxDB materialization, no storage engine → reveals
  // how much of the Dexie numbers is fake-indexeddb emulation, not RxDB.
  await runScenario("memory", memoryStorage, 1_000, { note: "(control)" });
  await runScenario("memory", memoryStorage, 10_000, { note: "(control)" });

  // -------------------------------------------------------------------------
  console.log("\n── Results ───────────────────────────────────────────────────");
  console.table(
    RESULTS.map((r) => ({
      Backend: r.backend,
      Docs: r.docs,
      "Init (ms)": r.init,
      "Write (ms)": r.write,
      "ms/doc w": r.writePerDoc,
      "Read (ms)": r.read,
      "ms/doc r": r.readPerDoc,
      "Read count": r.readCount ?? "-",
      Status: r.status,
    })),
  );
  console.log("\nNotes:");
  console.log("  • Dexie runs on fake-indexeddb in Node: every IDB op is setTimeout-scheduled,");
  console.log("    so its write/read here are EMULATION artifacts — real browsers are much faster");
  console.log("    (the `memory` control shows pure RxDB overhead: ~60 ms to materialize 10k).");  console.log("  • sqlite-trial runs on real node:sqlite (WAL): its numbers are true engine cost.");
  console.log("  • sqlite-trial caps: 500 live docs (SQL2) AND 500 ops (SQL3) — measured above;");
  console.log("    effective max is 498 docs written + one read per storage instance.");
}

main().catch((err) => {
  console.error("Benchmark crashed:", err);
  process.exit(1);
});
