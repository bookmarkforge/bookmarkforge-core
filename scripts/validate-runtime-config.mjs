#!/usr/bin/env node
/**
 * scripts/validate-runtime-config.mjs — runtime/deployment invariants that span
 * the Compose files and the Dockerfile.
 *
 * Scope note: retired provider credentials and upstream configuration have no
 * reader. What remains to validate is the licensing surface (the only HTTP
 * surface that takes a browser origin), the non-root hardening of both images,
 * the staging loopback policy and — via the same stale-configuration guard the
 * Compose gate uses — that neither file reintroduces configuration nothing reads.
 */
import { existsSync, readFileSync } from "node:fs";
import { findStaleRetiredKeys } from "./validate-compose-config.mjs";

export function validateRuntimeConfig(composeProd, composeStaging, dockerfile) {
  const errors = [];

  for (const [name, source] of [
    ["docker-compose.prod.yml", composeProd],
    ["docker-compose.staging.yml", composeStaging],
  ]) {
    for (const key of findStaleRetiredKeys(source)) {
      errors.push(`${name}: ${key} is configured but no code reads it`);
    }
    if (/^ {2}redis:/m.test(source)) {
      errors.push(`${name}: must not bundle a Redis service — nothing reads its state any more`);
    }
  }

  if (/IMAGE_TAG:-latest/.test(composeProd)) errors.push("production images must not default to latest");
  if (!/AI_SESSION_ORIGINS:\s*\$\{[^}]+:\?AI_SESSION_ORIGINS is required\}/.test(composeProd)) errors.push("production license-endpoint origins must be required explicitly");
  if (!/TRUST_PROXY:\s*["']?1["']?/.test(composeProd)) errors.push("production must explicitly enable trusted proxy configuration");
  if (!/LICENSE_SIGNING_PRIVATE_KEY_FILE:/.test(composeProd)) errors.push("production api must load the signing key from a file");

  if (!/USER\s+node\b/.test(dockerfile)) errors.push("API image must run as non-root node user");
  if (!/FROM\s+nginx:[^\s]+/.test(dockerfile) || !/USER\s+bookmarkforge\b/.test(dockerfile)) errors.push("web image must run as non-root bookmarkforge user");

  // El patrón original `ports:\s*[\s\S]*?` podía saltarse a bloques
  // `command:` de otros servicios (p. ej. un `docker compose run` con una URL
  // entrecomillada), produciendo falsos positivos. Se validan SOLO las líneas
  // bajo un bloque `ports:` real (dos espacios + clave de servicio + dos
  // espacios + `ports:`), normalizando CRLF para que `/m` funcione en Windows.
  // Validación por líneas (robusta a CRLF e indentación laxa).
  const stagingFlat = composeStaging.replace(/\r\n/g, "\n").split("\n");
  const portsLineIdx = stagingFlat.findIndex((line) => /^\s*ports:\s*$/.test(line));
  if (portsLineIdx === -1) {
    errors.push("staging ports must bind loopback");
  } else {
    const indent = (stagingFlat[portsLineIdx].match(/^\s*/) ?? [""])[0].length;
    // El bloque termina en la primera línea no vacía sin guion con indentación
    // <= indent(ports). Los bindings (`- "..."`) quedan dentro del bloque
    // aunque estén menos indentados (fixtures laxos); las claves hijas de otros
    // servicios cortan el bloque y no generan falsos positivos.
    const bindings = [];
    for (let i = portsLineIdx + 1; i < stagingFlat.length; i++) {
      const line = stagingFlat[i];
      if (line.trim().length === 0) continue;
      const lineIndent = (line.match(/^\s*/) ?? [""])[0].length;
      if (/^\s*-\s*"/.test(line)) {
        bindings.push(line);
      } else if (lineIndent <= indent) {
        break;
      }
    }
    if (!bindings.some((line) => /"127\.0\.0\.1:/.test(line))) {
      errors.push("staging ports must bind loopback");
    }
  }

  if (!/NODE_ENV:\s*staging/.test(composeStaging)) errors.push("staging must declare NODE_ENV=staging");

  return { errors };
}

const files = ["docker-compose.prod.yml", "docker-compose.staging.yml", "Dockerfile"];
const values = files.map((file) => (existsSync(file) ? readFileSync(file, "utf8") : ""));
const result = validateRuntimeConfig(values[0], values[1], values[2]);
if (result.errors.length) {
  console.error("[validate-runtime-config] FAIL");
  result.errors.forEach((error) => console.error(`- ${error}`));
  process.exit(1);
}
console.log("[validate-runtime-config] runtime configuration passed");
