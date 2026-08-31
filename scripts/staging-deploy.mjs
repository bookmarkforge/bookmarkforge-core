#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const imageTag = process.env.IMAGE_TAG?.trim();
const composeFile = process.env.DEPLOY_COMPOSE_FILE || "docker-compose.staging.yml";

if (!imageTag || !/^[A-Za-z0-9._/-]+$/.test(imageTag) || imageTag.includes(":") || imageTag.includes("@")) {
  console.error("IMAGE_TAG must be a non-empty tag without registry or digest syntax");
  process.exit(1);
}
if (composeFile !== "docker-compose.staging.yml") {
  console.error("DEPLOY_COMPOSE_FILE must be docker-compose.staging.yml");
  process.exit(1);
}

const result = spawnSync("docker", ["compose", "-f", composeFile, "up", "-d", "--remove-orphans"], {
  stdio: "inherit",
  env: { ...process.env, IMAGE_TAG: imageTag, DEPLOY_COMPOSE_FILE: composeFile },
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
