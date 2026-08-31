#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const targetTag = process.env.TARGET_TAG?.trim();
const composeFile = process.env.DEPLOY_COMPOSE_FILE || "docker-compose.staging.yml";

if (!targetTag || !/^prod-[0-9]{8}-[0-9]{4}-[0-9a-fA-F]{7,40}$/.test(targetTag) || targetTag.includes(":") || targetTag.includes("@")) {
  console.error("TARGET_TAG must match prod-YYYYMMDD-HHMM-<sha>");
  process.exit(1);
}
if (composeFile !== "docker-compose.staging.yml") {
  console.error("DEPLOY_COMPOSE_FILE must be docker-compose.staging.yml");
  process.exit(1);
}

const result = spawnSync("docker", ["compose", "-f", composeFile, "up", "-d", "--remove-orphans"], {
  stdio: "inherit",
  env: { ...process.env, IMAGE_TAG: targetTag, TARGET_TAG: targetTag, DEPLOY_COMPOSE_FILE: composeFile },
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
