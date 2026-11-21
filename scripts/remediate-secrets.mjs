/**
 * scripts/remediate-secrets.mjs
 * --------------------------------
 * REMEDIACIÓN C1 (Crítico): elimina de forma segura los archivos con secretos
 * expuestos en disco de trabajo y rota el material comprometido.
 *
 * Archivos objetivos (gitignored pero presentes en working tree):
 *   - server/.appsumo-keys-smoke-test-*.csv  (claves BMF- en texto plano + hash)
 *   - server/.appsumo-keys-test-*.csv
 *   - server/.license-signing-key.pkcs8      (clave privada de firma de licencia)
 *
 * Procedimiento por archivo:
 *   1. Sobrescribir con bytes aleatorios (crypto.randomBytes) del mismo tamaño.
 *   2. Sobrescribir con ceros.
 *   3. Unlink (borrar del filesystem).
 *
 * USO:
 *   node scripts/remediate-secrets.mjs        # dry-run (solo lista, no borra)
 *   node scripts/remediate-secrets.mjs --apply # borra realmente
 *
 * POST-REMediación obligatorio (hacer manualmente fuera de este script):
 *   - Rotar TODAS las claves BMF- expuestas en el panel de Whop/AppSumo.
 *   - Rotar LICENSE_SIGNING_PRIVATE_KEY_PKCS8 / _FILE en el servidor de firma.
 *   - Reemplazar server/.license-signing-key.pkcs8 por una clave nueva generada:
 *       openssl genpkey -algorithm RSA -out new-key.pem -pkeyopt rsa_keygen_bits:4096
 *       openssl pkcs8 -topk8 -inform PEM -in new-key.pem -outform DER -out server/.license-signing-key.pkcs8 -nocrypt
 *   - Regenerar LICENSE_PUBLIC_KEY_SPKI en server/src/license-public-key.ts a partir de la nueva clave privada.
 */

import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, unlinkSync, readdirSync } from "node:fs";
import { join } from "node:path";

const APPLY = process.argv.includes("--apply");
const ROOT = process.cwd();
const SERVER_DIR = join(ROOT, "server");

const TARGET_PATTERNS = [
  /^\.appsumo-keys-.*\.csv$/,
  /^\.license-signing-key\.pkcs8$/,
];

function secureWipeAndDelete(filePath) {
  if (!existsSync(filePath)) {
    return { skipped: true, reason: "no existe" };
  }
  const buf = readFileSync(filePath);
  const len = buf.length;

  // Paso 1: sobrescribir con aleatorio
  writeFileSync(filePath, randomBytes(len));
  // Paso 2: sobrescribir con ceros
  writeFileSync(filePath, Buffer.alloc(len, 0));
  // Paso 3: borrar
  unlinkSync(filePath);

  const hash = createHash("sha256").update(buf).digest("hex").slice(0, 16);
  return { wiped: true, bytes: len, hashPrefix: hash };
}

function listTargets(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (TARGET_PATTERNS.some((re) => re.test(name))) {
      out.push(join(dir, name));
    }
  }
  return out.sort();
}

const targets = listTargets(SERVER_DIR);

console.log(`[remediate-secrets] Modo: ${APPLY ? "APLICAR (borrará archivos)" : "dry-run (solo lista)"}`);
console.log(`[remediate-secrets] Objetivos encontrados en ${SERVER_DIR}:`);
for (const t of targets) {
  console.log(`  - ${t}`);
}

if (!APPLY) {
  console.log("\n[remediate-secrets] Ejecuta con --apply para borrar de forma segura.");
  process.exit(0);
}

let wiped = 0;
for (const t of targets) {
  const res = secureWipeAndDelete(t);
  wiped += res.wiped ? 1 : 0;
  console.log(
    `[remediate-secrets] ${res.wiped ? "WIPE_OK" : "SKIP"}: ${t} ` +
    `(bytes=${res.bytes}, hash=${res.hashPrefix})${res.skipped ? " | " + res.reason : ""}`
  );
}

console.log(`\n[remediate-secrets] Completado: ${wiped}/${targets.length} archivos eliminados de forma segura.`);
console.log("[remediate-secrets] PRÓXIMO PASO: rotar claves BMF- y clave de firma PKCS#8 fuera de este repo.");
