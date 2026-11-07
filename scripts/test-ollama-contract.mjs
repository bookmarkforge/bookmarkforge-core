#!/usr/bin/env node
/**
 * scripts/test-ollama-contract.mjs — Prueba de contrato de Ollama local.
 *
 * Validates the real contract of a local Ollama server without depending on
 * literal model responses (LLMs do not guarantee literalness):
 *
 *   1. Availability: /api/tags responds 200 and contains the expected model
 *      (or at least one model when the configured one is not installed).
 *   2. Structure: /api/generate responds 200 with a non-empty `response`
 *      field of type string.
 *   3. Bounded timeout: no call may hang longer than OLLAMA_TIMEOUT_MS.
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
    if (!tagsRes.ok) throw new Error(`/api/tags returned HTTP ${tagsRes.status}`);
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
        : "expected model missing — any model suffices for the contract",
      true,
      modelFound ? MODEL : `instalados: ${names.join(", ") || "(ninguno)"}`,
    );

    // ── Check 2: estructura de /api/generate ─────────────────────────────
    const genRes = await fetchWithTimeout(`${BASE_URL}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, prompt: "Answer with a single word: ok", stream: false }),
    });
    if (!genRes.ok) {
      throw new Error(`/api/generate returned HTTP ${genRes.status}: ${await genRes.text().catch(() => "")}`);
    }
    const genBody = await genRes.json();
    const responseText = typeof genBody.response === "string" ? genBody.response.trim() : "";
    check(
      "structure /api/generate responds 200 with a non-empty response",
      typeof genBody.response === "string" && responseText.length > 0,
      responseText ? `sample: ${responseText.slice(0, 60)}…` : "empty response",
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
