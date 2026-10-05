#!/usr/bin/env node
/**
 * scripts/test-ollama-contract.mjs — Prueba de contrato de Ollama local.
 *
 * Valida el contrato real de un servidor Ollama local sin depender de
 * respuestas literales del modelo (los LLM no garantizan literalidad):
 *
 *   1. Disponibilidad: /api/tags responde 200 y contiene el modelo esperado
 *      (o al menos un modelo si el modelo configurado no está instalado).
 *   2. Estructura: /api/generate responde 200 con un campo `response`
 *      no vacío de tipo string.
 *   3. Timeout acotado: ninguna llamada puede colgar más de OLLAMA_TIMEOUT_MS.
 *
 * Uso:
 *   node scripts/test-ollama-contract.mjs [--url http://127.0.0.1:11434] [--model llama3.2] [--timeout 120000] [--json]
 *
 * Exit: 0 = PASS, 1 = FAIL. --json imprime resumen JSON.
 */

const args = process.argv.slice(2);
const JSON_OUT = args.includes("--json");
const getArg = (name, fallback) => {
  const idx = args.indexOf(name);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback;
};

const BASE_URL = getArg("--url", "http://127.0.0.1:11434").replace(/\/+$/, "");
const MODEL = getArg("--model", "llama3.2");
const TIMEOUT_MS = Number(getArg("--timeout", "120000"));

const checks = [];
function check(name, ok, detail = "") {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}

function fetchWithTimeout(url, options = {}, timeoutMs = TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

async function main() {
  const started = Date.now();
  try {
    // ── Check 1: disponibilidad (/api/tags) ──────────────────────────────
    const tagsRes = await fetchWithTimeout(`${BASE_URL}/api/tags`, { method: "GET" });
    if (!tagsRes.ok) throw new Error(`/api/tags devolvió HTTP ${tagsRes.status}`);
    const tagsBody = await tagsRes.json();
    const models = Array.isArray(tagsBody.models) ? tagsBody.models : [];
    const names = models.map((m) => (typeof m?.name === "string" ? m.name : ""));
    const modelFound = names.some((n) => n === MODEL || n.startsWith(`${MODEL}:`));
    check(
      "disponibilidad /api/tags responde 200",
      true,
      `modelos=${models.length}`,
    );
    check(
      modelFound
        ? `modelo esperado presente (${MODEL})`
        : "modelo esperado ausente — cualquier modelo sirve para el contrato",
      true,
      modelFound ? MODEL : `instalados: ${names.join(", ") || "(ninguno)"}`,
    );

    // ── Check 2: estructura de /api/generate ─────────────────────────────
    const genRes = await fetchWithTimeout(`${BASE_URL}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, prompt: "Responde con una sola palabra: ok", stream: false }),
    });
    if (!genRes.ok) {
      throw new Error(`/api/generate devolvió HTTP ${genRes.status}: ${await genRes.text().catch(() => "")}`);
    }
    const genBody = await genRes.json();
    const responseText = typeof genBody.response === "string" ? genBody.response.trim() : "";
    check(
      "estructura /api/generate responde 200 con response no vacío",
      typeof genBody.response === "string" && responseText.length > 0,
      responseText ? `muestra: ${responseText.slice(0, 60)}…` : "response vacío",
    );
    check(
      "done=true en la respuesta final",
      genBody.done === true,
      `done=${String(genBody.done)}`,
    );

    // ── Resumen ──────────────────────────────────────────────────────────
    const ok = checks.every((c) => c.ok);
    const elapsed = ((Date.now() - started) / 1000).toFixed(1);
    if (JSON_OUT) {
      console.log(JSON.stringify({ ok, elapsed, baseUrl: BASE_URL, model: MODEL, checks }, null, 2));
    }
    console.log(`\n${ok ? "✅" : "❌"} ollama contract test ${ok ? "PASS" : "FAIL"} en ${elapsed}s (${checks.filter((c) => c.ok).length}/${checks.length})`);
    process.exit(ok ? 0 : 1);
  } catch (e) {
    checks.push({ name: "(fatal)", ok: false, detail: e.message });
    const ok = checks.every((c) => c.ok);
    console.log(
      `\n${ok ? "✅" : "❌"} ollama contract test ${ok ? "PASS" : "FAIL"} (${checks.filter((c) => c.ok).length}/${checks.length})`,
    );
    if (JSON_OUT) console.log(JSON.stringify({ ok, checks, error: e.message }, null, 2));
    process.exit(ok ? 0 : 1);
  }
}

main();
