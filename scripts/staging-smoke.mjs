#!/usr/bin/env node
/** Local-only staging smoke lifecycle. Uses synthetic credentials and always cleans up. */
import { spawn } from "node:child_process";

const projectName = process.env.COMPOSE_PROJECT_NAME ?? "bookmarkforge-staging";
const compose = ["compose", "-p", projectName, "-f", "docker-compose.staging.yml"];
const env = {
  ...process.env,
  COMPOSE_PROGRESS: process.env.COMPOSE_PROGRESS ?? "quiet",
  COMPOSE_BUILDKIT: process.env.COMPOSE_BUILDKIT ?? "1",
  HTTP_PORT: process.env.HTTP_PORT ?? "18080",
  COMPOSE_PROJECT_NAME: projectName,
  STAGING_LICENSE_SIGNING_KEY_FILE:
    process.env.STAGING_LICENSE_SIGNING_KEY_FILE ?? "./server/.license-signing-key.pkcs8",
};
const run = (args, options = {}) => new Promise((resolve, reject) => {
  const child = spawn("docker", args, { stdio: "inherit", env, shell: false, ...options });
  child.on("error", reject);
  child.on("exit", (code, signal) => {
    if (code === 0) resolve();
    else reject(new Error(`docker ${args.join(" ")} exited with ${code ?? signal}`));
  });
});

let started = false;
let stopping = false;
const cleanup = async () => {
  if (stopping) return;
  stopping = true;
  if (!started) return;
  try { await run([...compose, "down", "--remove-orphans", "--volumes"]); }
  catch (error) { console.error(`staging cleanup failed: ${error.message}`); }
};
process.on("SIGINT", async () => { await cleanup(); process.exit(130); });
process.on("SIGTERM", async () => { await cleanup(); process.exit(143); });

try {
  try {
    await run(["info"]);
  } catch (error) {
    throw new Error(`Docker daemon is unavailable; start Docker Desktop before staging smoke: ${error.message}`);
  }
  await run([...compose, "config"]);
  // Mark the stack as owned before starting: compose may create containers
  // and then fail part-way through an image build.
  started = true;
  await run([...compose, "up", "-d", "--build", "--force-recreate"]);
  const smoke = spawn(process.execPath, ["scripts/production-smoke.mjs"], {
    stdio: "inherit",
    env: { ...env, PROD_BASE_URL: `http://127.0.0.1:${env.HTTP_PORT}` },
  });
  await new Promise((resolve, reject) => {
    smoke.on("error", reject);
    smoke.on("exit", (code, signal) => code === 0
      ? resolve()
      : reject(new Error(`production-smoke exited with ${code ?? signal}`)));
  });
  console.log("staging production smoke passed");
} finally {
  await cleanup();
}
