#!/usr/bin/env node
/**
 * scripts/check-live-routes.mjs — post-deploy route and 404 gate.
 *
 * Requests the matrix in scripts/live-routes-contract.mjs against a DEPLOYED
 * host and fails when the host does not honour the contract the four shipped
 * configs declare: every client route (and its trailing-slash twin) answers 200
 * with the SPA shell, the public surface answers 200 with its own page and never
 * the shell, and an unknown path is a real 404 carrying the 404 document.
 *
 * It is the counterpart of check:spa-routes. That gate is offline and proves the
 * configs are written correctly; this one proves the host executes them. Run it
 * after a deploy, against the URL that just went live:
 *
 *   node scripts/check-live-routes.mjs --base-url https://staging.example.com
 *   LIVE_ROUTES_URL=https://staging.example.com npm run check:live-routes
 *
 * Options:
 *   --base-url <url>   target origin (required unless LIVE_ROUTES_URL is set)
 *   --concurrency <n>  parallel requests (default 6)
 *   --json             machine-readable result on stdout
 *   --verbose          print every case, not only failures
 *
 * Exit 0 clean, 1 findings (or a bad/missing target).
 */
import {
  assessLiveResults,
  buildLiveMatrix,
  EXPECT,
  validateBaseUrl,
} from "./live-routes-contract.mjs";

function flag(argv, name) {
  const index = argv.indexOf(name);
  return index === -1 ? null : (argv[index + 1] ?? null);
}

const argv = process.argv.slice(2);
const asJson = argv.includes("--json");
const verbose = argv.includes("--verbose");
const concurrencyArg = Number.parseInt(flag(argv, "--concurrency") ?? "6", 10);
const concurrency = Number.isInteger(concurrencyArg) && concurrencyArg > 0 ? Math.min(concurrencyArg, 32) : 6;

const rawTarget = flag(argv, "--base-url") ?? process.env.LIVE_ROUTES_URL ?? "";
const baseUrl = validateBaseUrl(rawTarget);
if (!baseUrl) {
  console.error(
    "[check-live-routes] a deployed HTTPS origin is required: pass --base-url <url> " +
      "or set LIVE_ROUTES_URL (no credentials, port, query or fragment)",
  );
  process.exit(2);
}

const cases = buildLiveMatrix();

async function request(path) {
  const url = `${baseUrl}${path}`;
  try {
    const response = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(20_000),
      headers: { "user-agent": "bookmarkforge-live-routes-gate" },
    });
    const body =
      response.status === 200 || response.status === 404 ? await response.text() : "";
    return { path, status: response.status, body, location: response.headers.get("location") ?? "" };
  } catch (error) {
    return { path, status: 0, body: "", error: error?.message ?? String(error) };
  }
}

/** Bounded fan-out: enough to finish quickly, few enough to stay a polite client. */
async function probeAll(items) {
  const responses = new Map();
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      const response = await request(item.path);
      responses.set(item.path, response);
    }
  });
  await Promise.all(workers);
  return responses;
}

const responses = await probeAll(cases);
const result = assessLiveResults(cases, responses);
const host = new URL(baseUrl).host;

if (asJson) {
  console.log(
    JSON.stringify(
      { baseUrl, host, ok: result.ok, checks: result.checks, failures: result.failures },
      null,
      2,
    ),
  );
} else {
  if (verbose) {
    for (const testCase of cases) {
      const response = responses.get(testCase.path);
      const status = response?.error ? "ERR" : response?.status;
      console.log(`  ${testCase.path}  want ${testCase.status} ${testCase.expect}  got ${status}`);
    }
  }
  if (!result.ok) {
    console.error(`[check-live-routes] FAIL: ${result.failures.length} finding(s) on ${host}`);
    for (const failure of result.failures) console.error(`  - ${failure}`);
  } else {
    const shellCount = cases.filter((testCase) => testCase.expect === EXPECT.SHELL).length;
    console.log(
      `[check-live-routes] ok  ${result.checks} checks on ${host}: ` +
        `${shellCount} shell paths, ${cases.length - shellCount} public/unknown paths`,
    );
  }
}

process.exit(result.ok ? 0 : 1);
