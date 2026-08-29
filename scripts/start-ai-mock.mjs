#!/usr/bin/env node
/**
 * scripts/start-ai-mock.mjs — Convenience wrapper for the HTTPS AI mock.
 *
 * Starts the Gemini-compatible mock server either:
 *   • As a Docker container on a specified network (default: bookmark4_prod)
 *   • As a standalone Node.js process
 *
 * Usage:
 *   node scripts/start-ai-mock.mjs                     # Docker mode (default)
 *   node scripts/start-ai-mock.mjs --standalone        # Node.js process
 *   node scripts/start-ai-mock.mjs --network my_net    # Custom Docker network
 *   node scripts/start-ai-mock.mjs --port 9443         # Custom port
 *   node scripts/start-ai-mock.mjs --stop              # Stop the mock container
 */
import { spawn, execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createConnection } from "node:net";

const ROOT = process.cwd();
const CONTAINER_NAME = "bmf-ai-mock-https";

// ── Arg parsing ──────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const standalone = args.includes("--standalone");
const stop = args.includes("--stop");
const networkIdx = args.indexOf("--network");
const portIdx = args.indexOf("--port");
const network = networkIdx !== -1 ? args[networkIdx + 1] : "bookmark4_prod";
const port = portIdx !== -1 ? Number(args[portIdx + 1]) : 8443;

// ── Load AI_MOCK_KEY from .env.production if not set ─────────────────────────
function loadMockKey() {
  if (process.env.AI_MOCK_KEY) return process.env.AI_MOCK_KEY;
  const envPath = join(ROOT, ".env.production");
  if (!existsSync(envPath)) return "ai-mock-key";
  const content = readFileSync(envPath, "utf8");
  const match = content.match(/^GEMINI_API_KEY=(.+)$/m);
  return match?.[1]?.trim() || "ai-mock-key";
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function log(msg) {
  console.log(`[ai-mock] ${msg}`);
}

function dockerOk(args) {
  try {
    return execSync(`docker ${args}`, { encoding: "utf8", stdio: "pipe" }).trim();
  } catch {
    return null;
  }
}

function checkPort(host, port, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    const socket = createConnection({ host, port }, () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(true);
    });
    socket.on("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

async function waitForHealth(host, port, maxWaitMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    if (await checkPort(host, port)) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

// ── Stop mode ────────────────────────────────────────────────────────────────
if (stop) {
  log("Stopping mock container...");
  dockerOk(`rm -f ${CONTAINER_NAME}`);
  log("Done.");
  process.exit(0);
}

// ── Docker mode ──────────────────────────────────────────────────────────────
if (!standalone) {
  if (!dockerOk("version --format {{.Server.Version}}")) {
    log("Docker not available — falling back to standalone mode");
  } else {
    // Ensure network exists
    if (!dockerOk(`network inspect ${network}`)) {
      log(`Creating Docker network: ${network}`);
      dockerOk(`network create ${network}`);
    }

    // Remove old container
    dockerOk(`rm -f ${CONTAINER_NAME}`);

    // Build the ai-mock image if needed
    const dockerfile = join(ROOT, "Dockerfile.ai-mock");
    if (!existsSync(dockerfile)) {
      log("ERROR: Dockerfile.ai-mock not found — cannot start Docker mock");
      process.exit(1);
    }

    log("Building ai-mock image...");
    execSync(`docker build -f Dockerfile.ai-mock -t bmf-ai-mock .`, {
      cwd: ROOT,
      stdio: "pipe",
    });

    // Start container
    log(`Starting HTTPS mock on port ${port}, network ${network}...`);
    const envKey = loadMockKey();
    execSync(
      `docker run -d --name ${CONTAINER_NAME} --network ${network} ` +
      `-e AI_MOCK_PORT=${port} -e AI_MOCK_KEY=${envKey} ` +
      `-p ${port}:${port} ` +
      `bmf-ai-mock`,
      { cwd: ROOT, stdio: "pipe" },
    );

    // Health check
    log("Waiting for health check...");
    const healthy = await waitForHealth("127.0.0.1", port, 15000);
    if (healthy) {
      log(`✅ HTTPS AI mock running on https://127.0.0.1:${port}`);
      log(`   Container: ${CONTAINER_NAME}`);
      log(`   Network:   ${network}`);
      log(`   Health:    https://127.0.0.1:${port}/health`);
      log(`   Stop:      node scripts/start-ai-mock.mjs --stop`);
    } else {
      log("❌ Health check failed — check container logs:");
      log(`   docker logs ${CONTAINER_NAME}`);
      process.exit(1);
    }
    process.exit(0);
  }
}

// ── Standalone mode ──────────────────────────────────────────────────────────
log(`Starting standalone HTTPS mock on port ${port}...`);
log(`   Key: ${loadMockKey()}`);
log(`   Health: https://127.0.0.1:${port}/health`);

const env = {
  ...process.env,
  AI_MOCK_PORT: String(port),
  AI_MOCK_KEY: loadMockKey(),
};

const child = spawn("node", [join(ROOT, "scripts/ai-mock-https.mjs")], {
  env,
  stdio: "inherit",
  cwd: ROOT,
});

child.on("error", (err) => {
  log(`Failed to start: ${err.message}`);
  process.exit(1);
});

// Graceful shutdown
process.on("SIGINT", () => {
  log("Shutting down...");
  child.kill("SIGTERM");
  process.exit(0);
});
process.on("SIGTERM", () => {
  child.kill("SIGTERM");
  process.exit(0);
});
