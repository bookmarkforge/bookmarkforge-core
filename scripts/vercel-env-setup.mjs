#!/usr/bin/env node
/**
 * scripts/vercel-env-setup.mjs — provision the license-function env vars on
 * the Vercel project, non-interactively where possible.
 *
 * What it sets (Production environment):
 *   LICENSE_ALLOWED_ORIGINS             https://bookmarkforgeapp.com
 *   LICENSE_TRUST_PROXY                 1   (Vercel overwrites X-Forwarded-For)
 *   LICENSE_SIGNING_PRIVATE_KEY_PKCS8   contents of server/.license-signing-key.pkcs8
 *                                       (or $LICENSE_SIGNING_PRIVATE_KEY_FILE)
 *   WHOP_API_KEY                        from $WHOP_API_KEY or --whop-key=<key>
 *
 * Secrets go through `vercel env add --sensitive` so they cannot be read back
 * from the dashboard later. Values are piped over stdin — nothing is echoed.
 *
 * IMPORTANT: Vercel env vars apply to NEW deployments only. After this script
 * succeeds, trigger a redeploy (push to the production branch — Git
 * auto-deploy is enabled — or `vercel redeploy`) before verifying
 * /api/license/health.
 *
 * Usage:
 *   node scripts/vercel-env-setup.mjs
 *   WHOP_API_KEY=whop_... node scripts/vercel-env-setup.mjs
 *   node scripts/vercel-env-setup.mjs --whop-key=whop_...
 *   node scripts/vercel-env-setup.mjs --origin=https://staging.example.com
 *   node scripts/vercel-env-setup.mjs --dry-run   # print plan, touch nothing
 *
 * Prerequisites:
 *   vercel CLI on PATH (`npm i -g vercel`), `vercel login` done once, and the
 *   project linked (`vercel link`) — or .vercel/project.json already present.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import process from "node:process";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SIGNING_KEY_CANDIDATES = [
  process.env.LICENSE_SIGNING_PRIVATE_KEY_FILE,
  resolve(ROOT, "server", ".license-signing-key.pkcs8"),
].filter(Boolean);

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const argValue = (name) =>
  args.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
// apex 308-redirects to www, so the browser's Origin on /api/license/* is the
// www host; list both (the handler splits on commas/whitespace).
const PROD_ORIGIN =
  argValue("origin") ??
  "https://bookmarkforgeapp.com,https://www.bookmarkforgeapp.com";

function log(msg) {
  console.log(`[vercel-env] ${msg}`);
}
function fail(msg, hint) {
  console.error(`\n[vercel-env] FAIL: ${msg}`);
  if (hint) console.error(`[vercel-env] hint: ${hint}`);
  process.exit(1);
}

/** Windows needs shell:true to spawn .cmd shims (Node ≥18.20 EINVAL). */
const SPAWN_OPTS = { shell: process.platform === "win32" };

/** Resolve a runnable vercel binary (vercel / vercel.cmd on Windows). */
function vercelBin() {
  for (const candidate of ["vercel", "vercel.cmd"]) {
    const probe = spawnSync(candidate, ["--version"], {
      encoding: "utf8",
      ...SPAWN_OPTS,
    });
    if (!probe.error && probe.status === 0) return candidate;
  }
  return null;
}

function vercel(args_, { input, inherit = false } = {}) {
  const bin = vercelBin();
  if (!bin) fail("vercel CLI not found on PATH", "install it: npm i -g vercel");
  const result = spawnSync(bin, args_, {
    input,
    encoding: "utf8",
    stdio: inherit ? "inherit" : ["pipe", "pipe", "pipe"],
    ...SPAWN_OPTS,
  });
  if (result.error) fail(`failed to run vercel: ${result.error.message}`);
  return result;
}

/** `vercel env add` reads the value from stdin when not a TTY. */
function envAdd(name, environment, value, sensitive) {
  const extra = sensitive ? ["--sensitive"] : [];
  const result = vercel(["env", "add", name, environment, ...extra], {
    input: `${value}\n`,
  });
  if (result.status !== 0) {
    const out = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    if (/already exists/i.test(out)) {
      log(`${name}: already exists for ${environment} — replacing`);
      vercel(["env", "rm", name, environment, "--confirm-name", name], { inherit: false });
      return envAdd(name, environment, value, sensitive);
    }
    fail(`vercel env add ${name} failed`, out.trim().slice(0, 500));
  }
  log(`${name}: set for ${environment}${sensitive ? " (sensitive)" : ""}`);
}

function promptValue(question) {
  return new Promise((resolvePromise) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolvePromise(answer.trim());
    });
  });
}

async function main() {
  log("checking vercel CLI and auth…");
  const whoami = vercel(["whoami"]);
  if (whoami.status !== 0) {
    fail("not authenticated", "run: vercel login   (then re-run this script)");
  }
  log(`authenticated as ${(whoami.stdout ?? "").trim() || "?"}`);

  if (!existsSync(resolve(ROOT, ".vercel", "project.json"))) {
    if (DRY_RUN) {
      log("dry-run: .vercel/project.json missing — would run `vercel link` first");
    } else {
      log("project not linked — running `vercel link` (pick the BookmarkForge project)…");
      const link = vercel(["link"], { inherit: true });
      if (link.status !== 0) fail("vercel link failed");
    }
  }

  // ── Collect values ──────────────────────────────────────────────────
  const signingKeyPath = SIGNING_KEY_CANDIDATES.find((p) => existsSync(p));
  if (!signingKeyPath) {
    fail(
      "no license signing key found",
      "expected server/.license-signing-key.pkcs8 or $LICENSE_SIGNING_PRIVATE_KEY_FILE",
    );
  }
  const signingKey = readFileSync(signingKeyPath, "utf8").trim();
  if (!signingKey) fail(`signing key file is empty: ${signingKeyPath}`);

  let whopKey = argValue("whop-key") ?? process.env.WHOP_API_KEY ?? "";
  if (!whopKey && !DRY_RUN && process.stdin.isTTY) {
    whopKey = await promptValue(
      "Whop API key (whop_..., pasted once — Enter to skip): ",
    );
  }
  if (!whopKey && !DRY_RUN) {
    log("WHOP_API_KEY not provided — the other vars will be set; re-run with WHOP_API_KEY=... to add it");
  }

  const plan = [
    ["LICENSE_ALLOWED_ORIGINS", PROD_ORIGIN, false],
    ["LICENSE_TRUST_PROXY", "1", false],
    ["LICENSE_SIGNING_PRIVATE_KEY_PKCS8", signingKey, true],
    ...(whopKey ? [["WHOP_API_KEY", whopKey, true]] : []),
  ];

  log(`plan (${DRY_RUN ? "dry-run" : "apply"}) — environment: production`);
  for (const [name, value, sensitive] of plan) {
    const shown = sensitive ? `${String(value).slice(0, 8)}…(${String(value).length} chars)` : value;
    log(`  ${name} = ${shown}${sensitive ? " [sensitive]" : ""}`);
  }
  if (DRY_RUN) {
    log("dry-run complete — nothing was changed");
    return;
  }

  for (const [name, value, sensitive] of plan) {
    envAdd(name, "production", value, sensitive);
  }

  log("done. Env vars apply to NEW deployments only — trigger a redeploy");
  log("(push to the production branch, or: vercel redeploy), then verify:");
  log(`  curl ${PROD_ORIGIN}/api/license/health`);
}

main().catch((error) => {
  fail(`unexpected error: ${error instanceof Error ? error.message : error}`);
});
