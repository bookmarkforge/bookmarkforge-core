#!/usr/bin/env node
/**
 * scripts/check-spa-routes.mjs — the SPA route contract gate.
 *
 * The app's client routes only work if the host serves dist/app.html for them,
 * and the marketing/legal/help pages only stay reachable if the hosts do NOT.
 * Four configs in three syntaxes (vercel.json, public/_redirects, netlify.toml,
 * public/nginx.conf) each express that by hand, so this gate compares all four
 * with the routes the app actually declares (src/components/app/AppRoutes.tsx +
 * /capture) and with the public surface (scripts/app-routes.mjs).
 *
 * It is offline by contract (no build, no network): it reads the shipped files.
 * The logic lives in scripts/spa-route-contract.mjs so the unit test can drive
 * it with broken fixtures.
 *
 * Usage: node scripts/check-spa-routes.mjs [--quiet]
 * Exit 0 clean, 1 findings.
 */
import { readFileSync } from "node:fs";
import { HOST_FILES, assessHostContracts } from "./spa-route-contract.mjs";
import { APP_ROUTES_SOURCE, CAPTURE_ROUTE, readClientRoutes } from "./app-routes.mjs";

const quiet = process.argv.includes("--quiet");

function readIfPresent(path) {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

const files = Object.fromEntries(
  Object.entries(HOST_FILES).map(([key, path]) => [key, readIfPresent(path)]),
);
const clientRoutes = readClientRoutes();

const result = assessHostContracts({ files, clientRoutes });

if (!result.ok) {
  console.error(`[check-spa-routes] FAIL: ${result.failures.length} finding(s)`);
  for (const failure of result.failures) console.error(`  - ${failure}`);
  process.exit(1);
}

if (!quiet) {
  console.log(
    `[check-spa-routes] ok  ${clientRoutes.length} client routes parsed from ${APP_ROUTES_SOURCE} ` +
      `(${CAPTURE_ROUTE} included), all ${result.checks} host configs serve the shell for them ` +
      "and none serves it for the public surface",
  );
}
