#!/usr/bin/env node
/**
 * Nightly refresh of the README demo media.
 *
 * The stills, the GIF and the video are shipped artifacts built from the UI. If
 * the UI changes and nobody rebuilds them, the README keeps advertising an
 * interface that no longer exists — and no code review catches it, because the
 * diff is a binary blob.
 *
 * This runner does the whole refresh in one versioned command so the workflow
 * stays declarative, and it answers two questions:
 *
 *   budget — does the regenerated GIF still fit the README budget?
 *            (enforced by the GIF builder and re-checked on the final file)
 *   drift  — do the captures still match the committed images?
 *            (pixel comparison with a tolerance, see compare-demo-media.mjs)
 *
 * It never writes into `docs/`: fresh media goes to a scratch directory that the
 * workflow uploads as an artifact, so a human reviews the change and commits it.
 *
 * Usage:
 *   node scripts/run-demo-media-nightly.mjs
 *   node scripts/run-demo-media-nightly.mjs --base-url http://127.0.0.1:5199
 *   node scripts/run-demo-media-nightly.mjs --keep-server --report /tmp/report.json
 *   node scripts/run-demo-media-nightly.mjs --no-drift-check   # budget only
 */
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const DEFAULT_PORT = 5199;
const READY_TIMEOUT_MS = 180_000;
const SCRATCH_DEFAULT = "node_modules/.cache/demo-media";

function log(message) {
  console.error(`[demo-nightly] ${message}`);
}

function parseArgs(argv) {
  const options = {
    baseUrl: null,
    port: DEFAULT_PORT,
    scratch: resolve(ROOT, SCRATCH_DEFAULT),
    reference: resolve(ROOT, "docs"),
    keepServer: false,
    driftCheck: true,
    report: null,
    maxDiffRatio: null,
  };
  for (let i = 2; i < argv.length; i++) {
    switch (argv[i]) {
      case "--base-url":
        options.baseUrl = argv[++i];
        break;
      case "--port":
        options.port = Number(argv[++i]);
        break;
      case "--scratch":
        options.scratch = resolve(argv[++i]);
        break;
      case "--reference":
        options.reference = resolve(argv[++i]);
        break;
      case "--max-diff-ratio":
        options.maxDiffRatio = Number(argv[++i]);
        break;
      case "--report":
        options.report = resolve(argv[++i]);
        break;
      case "--keep-server":
        options.keepServer = true;
        break;
      case "--no-drift-check":
        options.driftCheck = false;
        break;
      default:
        throw new Error(`Unknown argument: ${argv[i]}`);
    }
  }
  if (!options.baseUrl) options.baseUrl = `http://127.0.0.1:${options.port}`;
  return options;
}

/** Runs one pipeline step, streaming its output and failing loudly. */
function runStep(label, script, args) {
  log(`${label}: node ${script} ${args.join(" ")}`);
  execFileSync(process.execPath, [join(ROOT, "scripts", script), ...args], {
    cwd: ROOT,
    stdio: "inherit",
  });
}

/** Reads the platform recorded with the committed media, if it declares one. */
function readManifestPlatform(referenceDir) {
  const manifestPath = join(referenceDir, "bookmarkforge-demo-manifest.json");
  if (!existsSync(manifestPath)) return null;
  try {
    return JSON.parse(readFileSync(manifestPath, "utf8")).platform ?? null;
  } catch {
    return null;
  }
}

async function waitForServer(baseUrl, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(baseUrl, { redirect: "manual" });
      if (response.status < 500) return true;
    } catch {
      // server not listening yet
    }
    await new Promise((done) => setTimeout(done, 500));
  }
  return false;
}

/** Starts the Vite dev server directly (no npm indirection, killable child). */
function startDevServer({ port }) {
  const viteBin = join(ROOT, "node_modules", "vite", "bin", "vite.js");
  if (!existsSync(viteBin)) {
    throw new Error(`vite entry point not found at ${viteBin} — run npm ci first`);
  }
  const child = spawn(
    process.execPath,
    [viteBin, "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
    { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] },
  );
  const output = [];
  for (const stream of [child.stdout, child.stderr]) {
    stream?.setEncoding("utf8");
    stream?.on("data", (chunk) => {
      output.push(chunk);
      if (output.length > 60) output.shift();
    });
  }
  return { child, output };
}

function stopDevServer(child) {
  if (!child || child.exitCode !== null) return;
  child.kill();
  // The dev server is the direct child here, so a plain kill is enough on every
  // platform; SIGKILL is only a fallback for a wedged process.
  setTimeout(() => child.kill("SIGKILL"), 3000).unref?.();
}

function writeReport(path, report) {
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
  log(`report written to ${path}`);
}

async function main() {
  const options = parseArgs(process.argv);
  const report = {
    baseUrl: options.baseUrl,
    scratch: options.scratch,
    reference: options.reference,
    startedAt: new Date().toISOString(),
    steps: [],
    drift: null,
    gif: null,
    ok: false,
  };
  const reportPath = options.report ?? join(options.scratch, "demo-media-nightly-report.json");

  rmSync(options.scratch, { recursive: true, force: true });
  mkdirSync(options.scratch, { recursive: true });
  mkdirSync(dirname(reportPath), { recursive: true });

  let server = null;
  let failure = null;
  try {
    if (!/^https?:\/\//.test(options.baseUrl)) {
      throw new Error("--base-url must be an http(s) URL");
    }
    // Reuse a server that is already answering (a developer running `npm run
    // dev`, or a retry in the same job) and only spawn one when nothing is
    // listening on a local address.
    if (!(await waitForServer(options.baseUrl, 1500))) {
      const isLocal = /^https?:\/\/(?:127\.0\.0\.1|localhost)(?::|\/|$)/.test(options.baseUrl);
      if (!isLocal) {
        throw new Error(`no server answers at ${options.baseUrl} and it is not a local address`);
      }
      log(`starting dev server on ${options.baseUrl}`);
      server = startDevServer({ port: Number(new URL(options.baseUrl).port) || DEFAULT_PORT });
      if (!(await waitForServer(options.baseUrl, READY_TIMEOUT_MS))) {
        throw new Error(
          `dev server never answered at ${options.baseUrl}\n` +
            server.output.join("").slice(-2000),
        );
      }
    } else {
      log(`using the server already running at ${options.baseUrl}`);
    }

    runStep("desktop captures", "capture-demo-screens.mjs", [
      "--base-url",
      options.baseUrl,
      "--out-dir",
      options.scratch,
    ]);
    report.steps.push("desktop-captures");

    runStep("mobile captures", "capture-demo-screens.mjs", [
      "--base-url",
      options.baseUrl,
      "--mobile",
      "--out-dir",
      options.scratch,
    ]);
    report.steps.push("mobile-captures");

    const gifPath = join(options.scratch, "bookmarkforge-demo-tour.gif");
    runStep("gif rebuild", "build-demo-gif.mjs", [
      "--from-dir",
      options.scratch,
      "--out",
      gifPath,
    ]);
    report.steps.push("gif-rebuild");
    if (!existsSync(gifPath)) throw new Error("the GIF builder did not produce an output file");
    report.gif = { path: gifPath, bytes: statSync(gifPath).size };

    // The builder already enforces the budget; this re-checks the final file on
    // disk, including its structure, so a partially written GIF cannot pass.
    runStep("gif budget", "check-demo-media.mjs", ["--gif", gifPath]);
    report.steps.push("gif-budget");

    if (options.driftCheck) {
      const driftArgs = [
        "--reference",
        options.reference,
        "--generated",
        options.scratch,
        "--json",
      ];
      if (options.maxDiffRatio !== null) {
        driftArgs.push("--max-diff-ratio", String(options.maxDiffRatio));
      }

      // Font rasterisation is platform-specific, so a pixel comparison only
      // means "the UI changed" when the reference was produced on this same
      // platform. Otherwise the honest verdict is "different environment" and
      // the run reports instead of failing — the artifacts are still uploaded
      // for review, and the strict gate resumes once media from this platform
      // is committed. The byte budget is enforced either way.
      const provenance = readManifestPlatform(options.reference);
      report.referencePlatform = provenance;
      report.runnerPlatform = process.platform;
      const comparable = provenance === null || provenance === process.platform;
      if (!comparable) {
        log(
          `reference media was captured on ${provenance}, this runner is ${process.platform}: ` +
            "drift is reported, not enforced",
        );
      }

      let driftJson = "";
      let failed = false;
      try {
        driftJson = execFileSync(
          process.execPath,
          [join(ROOT, "scripts", "compare-demo-media.mjs"), ...driftArgs],
          { cwd: ROOT, encoding: "utf8" },
        );
      } catch (error) {
        driftJson = `${error.stdout ?? ""}`;
        failed = true;
      }
      report.drift = driftJson ? JSON.parse(driftJson) : null;
      report.driftEnforced = comparable;
      report.steps.push("drift-check");
      if (failed && comparable) {
        throw new Error(
          "the demo media no longer matches the current UI — see the report and the uploaded captures",
        );
      }
    }

    report.ok = true;
  } catch (error) {
    failure = error;
    report.error = error?.message ?? String(error);
  } finally {
    if (server && !options.keepServer) stopDevServer(server.child);
    writeReport(reportPath, report);
  }

  if (failure) {
    console.error(`[demo-nightly] FAILED: ${failure.message}`);
    process.exit(1);
  }
  log(`OK — media regenerated, GIF ${(report.gif.bytes / 1024).toFixed(0)} KiB within budget`);
}

main().catch((error) => {
  console.error("[demo-nightly] FAILED:", error?.message ?? error);
  process.exit(1);
});
