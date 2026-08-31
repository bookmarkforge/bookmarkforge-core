#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";

export function validateRuntimeConfig(composeProd, composeStaging, dockerfile) {
  const errors = [];
  if (/AI_PROXY_REDIS_FAILURE_MODE:\s*fail-open/.test(composeProd)) errors.push("production Redis failure mode must not be fail-open");
  if (/AI_PROXY_REDIS_FAILURE_MODE:\s*fail-open/.test(composeStaging)) errors.push("staging Redis failure mode must not be fail-open");
  if (!/AI_PROXY_REDIS_URL:\s*\$\{[^}]+:-redis:\/\/redis:6379\/0\}/.test(composeProd)) errors.push("production must define a shared Redis URL fallback");
  if (!/AI_PROXY_REDIS_FAILURE_MODE:\s*\$\{[^}]+:-fail-closed\}/.test(composeProd)) errors.push("production Redis failure mode must default to fail-closed");
  if (/AI_SESSION_REQUIRE_LICENSE:\s*"0"/.test(composeProd)) errors.push("production sessions must require licenses");
  if (/IMAGE_TAG:-latest/.test(composeProd)) errors.push("production images must not default to latest");
  if (!/AI_SESSION_ORIGINS:\s*\$\{[^}]+:\?AI_SESSION_ORIGINS is required\}/.test(composeProd)) errors.push("production AI session origins must be required explicitly");
  if (!/TRUST_PROXY:\s*["']?1["']?/.test(composeProd)) errors.push("production must explicitly enable trusted proxy configuration");
  if (!/USER\s+node\b/.test(dockerfile)) errors.push("API image must run as non-root node user");
  if (!/FROM\s+nginx:[^\s]+/.test(dockerfile) || !/USER\s+bookmarkforge\b/.test(dockerfile)) errors.push("web image must run as non-root bookmarkforge user");
  // El patrón original `ports:\s*[\s\S]*?` podía saltarse a bloques
  // `command:` de otros servicios (p. ej. `ollama-pull` con `ollama pull
  // "..."`), produciendo falsos positivos. Se validan SOLO las líneas bajo
  // un bloque `ports:` real (dos espacios + clave de servicio + dos espacios
  // + `ports:`), y se normalizan CRLF para que `/m` funcione en Windows.
  // Validación por líneas (robusta a CRLF e indentación): localiza el primer
  // bloque `ports:` y comprueba que al menos una entrada ata loopback. Evita
  // el falso positivo del patrón `[\s\S]*?` con bloques `command:` de otros
  // servicios (p. ej. `ollama-pull` con `ollama pull "..."`).
  const stagingFlat = composeStaging.replace(/\r\n/g, "\n").split("\n");
  const portsLineIdx = stagingFlat.findIndex((line) => /^\s*ports:\s*$/.test(line));
  if (portsLineIdx === -1) {
    errors.push("staging ports must bind loopback");
  } else {  const indent = (stagingFlat[portsLineIdx].match(/^\s*/) ?? [""])[0].length;
  // El bloque termina en la primera línea no vacía sin guion con indentación
  // <= indent(ports). Los bindings (`- "..."`) quedan dentro del bloque
  // aunque estén menos indentados (fixtures laxo); las claves hijas de otros
  // servicios (p. ej. `command:`) cortan el bloque y no generan falsos
  // positivos.
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
  if (!/AI_SESSION_REQUIRE_LICENSE:\s*"0"/.test(composeStaging)) errors.push("staging must explicitly declare its test-only license policy");
  return { errors };
}

const files = ["docker-compose.prod.yml", "docker-compose.staging.yml", "Dockerfile"];
const values = files.map((file) => existsSync(file) ? readFileSync(file, "utf8") : "");
const result = validateRuntimeConfig(values[0], values[1], values[2]);
if (result.errors.length) { console.error("[validate-runtime-config] FAIL"); result.errors.forEach((error) => console.error(`- ${error}`)); process.exit(1); }
console.log("[validate-runtime-config] runtime configuration passed");
