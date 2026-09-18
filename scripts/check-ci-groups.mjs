#!/usr/bin/env node
/**
 * scripts/check-ci-groups.mjs — ejecuta grupos de CI definidos en ci-groups.json
 *
 * Uso:
 *   node scripts/check-ci-groups.mjs                  # lista todos los grupos disponibles
 *   node scripts/check-ci-groups.mjs core-integrity    # ejecuta el grupo específico
 *   node scripts/check-ci-groups.mjs --list            # lista sin ejecutar
 *   node scripts/check-ci-groups.mjs --all             # ejecuta todos los grupos en orden
 *
 * Cada grupo se ejecuta de forma secuencial dentro del grupo,
 * y los grupos se ejecutan en paralelo cuando se usa --all.
 * Los resultados se resumen al final con tiempo por grupo.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const GROUPS_FILE = join(__dirname, "ci-groups.json");

function loadGroups() {
  if (!existsSync(GROUPS_FILE)) {
    console.error(`[check:ci-groups] No se encontró ci-groups.json en ${GROUPS_FILE}`);
    process.exit(1);
  }
  const data = JSON.parse(readFileSync(GROUPS_FILE, "utf8"));
  return data.groups;
}

function formatMs(ms) {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

function runGroup(group) {
  console.log(`\n${"═".repeat(60)}`);
  console.log(`📦 Grupo: ${group.label}`);
  console.log(`${"═".repeat(60)}`);
  console.log(`Propósito: ${group.purpose}`);
  console.log(`Tiempo estimado: ${formatMs(group.typical_time_ms)}`);
  console.log("");

  const rows = [];
  let failed = false;
  const t0 = Date.now();

  for (const cmd of group.commands) {
    const cmdT0 = Date.now();
    // Convertir check:nombre a npm run nombre
    // Convertir check:nombre a npm run nombre
    const result = spawnSync("npm", ["run", cmd.replace(/^check:/, "")], {
      cwd: process.cwd(),
      stdio: ["pipe", "pipe", "pipe"],
      encoding: "utf8",
      timeout: 120000,
    });
    const elapsed = Date.now() - cmdT0;
    const status = result.status === 0 ? "✅ PASS" : `❌ FAIL (${elapsed}ms)`;
    rows.push({ command: cmd, status, elapsed });
    if (result.status !== 0) failed = true;
    console.log(`  ${cmd.padEnd(35)} ${status}`);
    if (result.status !== 0 && result.stderr) {
      const errorLines = result.stderr.split("\n").slice(0, 5).join("\n");
      console.log(`  ${"─".repeat(50)}`);
      console.log(`  ${errorLines}`);
    }
    if (failed) break; // fail-fast por grupo
  }

  const totalMs = Date.now() - t0;
  const passed = rows.filter(r => r.status.startsWith("✅")).length;
  console.log(`\n  Resultado: ${passed}/${rows.length} passed en ${formatMs(totalMs)}`);
  console.log(`${"═".repeat(60)}\n`);
  return { name: group.name, failed, totalMs, passed, rows };
}

function listGroups(groups) {
  console.log("\n📋 Grupos de CI disponibles:\n");
  console.log(`${"Grupo".padEnd(25)} ${"Tiempo estimado".padEnd(15)} ${"Frecuencia fallo".padEnd(20)} ${"Descripción"}`);
  console.log("-".repeat(95));
  for (const g of groups) {
    const freq = g.fail_frequency === "high" ? "🔴 Alto" : g.fail_frequency === "medium" ? "🟡 Medio" : "🟢 Bajo";
    const label = g.label.padEnd(25).slice(0, 25);
    const time = formatMs(g.typical_time_ms).padEnd(15);
    const freqLabel = freq.padEnd(20);
    console.log(`  ${label} ${time} ${freqLabel} ${g.purpose}`);
  }
  console.log("");
  console.log("Uso:");
  console.log("  node scripts/check-ci-groups.mjs <nombre-grupo>   # Ejecutar grupo específico");
  console.log("  node scripts/check-ci-groups.mjs --list            # Solo listar");
  console.log("  node scripts/check-ci-groups.mjs --all             # Ejecutar todos los grupos");
  console.log("  node scripts/check-ci-groups.mjs --fast            # Solo grupos críticos (core + security)");
  console.log("");
}

function runAll(groups) {
  console.log("🚀 Ejecutando todos los grupos de CI...\n");
  const t0 = Date.now();
  const results = [];
  let overallFailed = false;

  for (const group of groups) {
    const result = runGroup(group);
    results.push(result);
    if (result.failed) overallFailed = true;
  }

  const totalMs = Date.now() - t0;
  console.log("\n" + "═".repeat(60));
  console.log("📊 RESUMEN GLOBAL");
  console.log("═".repeat(60));
  for (const r of results) {
    const icon = r.failed ? "❌" : "✅";
    console.log(`  ${icon} ${r.name.padEnd(30)} ${r.passed}/${r.rows.length}  ${formatMs(r.totalMs)}`);
  }
  console.log(`\n  Tiempo total: ${formatMs(totalMs)}`);
  console.log(`  Estado: ${overallFailed ? "❌ FALLÓ" : "✅ TODO PASS"}`);
  console.log("═".repeat(60) + "\n");

  process.exit(overallFailed ? 1 : 0);
}

function runFast(groups) {
  // Solo grupos críticos: core-integrity + security-environment
  const critical = groups.filter(g => g.name === "core-integrity" || g.name === "security-environment");
  console.log("⚡ Ejecutando grupo rápido (core-integrity + security-environment)...\n");
  const t0 = Date.now();
  let failed = false;
  for (const group of critical) {
    const result = runGroup(group);
    if (result.failed) failed = true;
  }
  console.log(`\n⏱️  Tiempo: ${formatMs(Date.now() - t0)}`);
  process.exit(failed ? 1 : 0);
}

// ── CLI ──────────────────────────────────────────────────────
const args = process.argv.slice(2);
const groups = loadGroups();

if (args.includes("--list")) {
  listGroups(groups);
} else if (args.includes("--all")) {
  runAll(groups);
} else if (args.includes("--fast")) {
  runFast(groups);
} else if (args.length > 0 && !args[0].startsWith("--")) {
  const groupName = args[0];
  const group = groups.find(g => g.name === groupName);
  if (!group) {
    console.error(`Grupo '${groupName}' no encontrado.`);
    listGroups(groups);
    process.exit(1);
  }
  const result = runGroup(group);
  process.exit(result.failed ? 1 : 0);
} else {
  listGroups(groups);
}
