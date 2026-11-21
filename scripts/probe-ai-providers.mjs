#!/usr/bin/env node
/**
 * scripts/probe-ai-providers.mjs — live compatibility probe for AI providers.
 *
 * Detects the two failure classes that previously broke Gemini silently:
 *  1. API key FORMAT drift — keys whose prefix no longer matches the known
 *     patterns (e.g. the new `AQ.` Google AI Studio keys) are flagged BEFORE
 *     the app's vault validator or the provider API rejects them.
 *  2. Model retirement — the configured default model is checked against the
 *     provider's live model list, catching HTTP 404 "model is no longer
 *     available" before users hit it.
 *
 * Reads keys from environment variables only — it never touches the app
 * vault. Usage:
 *
 *   GEMINI_API_KEY=... OPENAI_API_KEY=... node scripts/probe-ai-providers.mjs
 *   GEMINI_API_KEY=... node scripts/probe-ai-providers.mjs --deep
 *   npm run probe:ai
 *
 * `--deep` additionally sends a minimal 1-token generation request per
 * provider, verifying end-to-end that the payload shape the app sends is
 * still accepted (catches "Unknown name"-style format drift that the
 * models-list probe cannot see). Costs ~1 token per configured provider.
 *
 * Exit code: 0 when every configured provider is healthy, 1 otherwise —
 * safe to wire into CI or a scheduled check.
 */

const TIMEOUT_MS = 15_000;

/** Key-format expectations per provider. `prefixes` are the known-good
 *  startsWith() values; `pattern` is the fallback charset check mirroring
 *  VaultIntegration.validateApiKeyFormat. */
const PROVIDERS = [
  {
    id: "gemini",
    envVars: ["GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY"],
    prefixes: ["AIza", "AQ."],
    pattern: /^[a-zA-Z0-9_.-]+$/,
    // Default model the app ships (src/constants/config.ts AI_MODELS).
    defaultModel: "gemini-3.1-flash-lite",
    modelsUrl: "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000",
    headers: (key) => ({ "x-goog-api-key": key }),
    modelName: (m) => (m.name ?? "").replace(/^models\//, ""),
    // Minimal generateContent call — the exact envelope GeminiProvider sends.
    deepRequest: (key, model) => ({
      url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      init: {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": key,
        },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: "hi" }] }],
          generationConfig: { maxOutputTokens: 1 },
        }),
      },
    }),
  },
  {
    id: "openai",
    envVars: ["OPENAI_API_KEY"],
    prefixes: ["sk-"],
    pattern: /^[a-zA-Z0-9_.-]+$/,
    defaultModel: "gpt-4o-mini",
    modelsUrl: "https://api.openai.com/v1/models",
    headers: (key) => ({ Authorization: `Bearer ${key}` }),
    modelName: (m) => m.id ?? "",
    deepRequest: (key, model) => ({
      url: "https://api.openai.com/v1/chat/completions",
      init: {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: "hi" }],
          max_tokens: 1,
        }),
      },
    }),
  },
  {
    id: "anthropic",
    envVars: ["ANTHROPIC_API_KEY"],
    prefixes: ["sk-ant-"],
    pattern: /^[a-zA-Z0-9_.-]+$/,
    defaultModel: "claude-3-5-sonnet-latest",
    modelsUrl: "https://api.anthropic.com/v1/models?limit=1000",
    headers: (key) => ({
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    }),
    modelName: (m) => m.id ?? "",
    deepRequest: (key, model) => ({
      url: "https://api.anthropic.com/v1/messages",
      init: {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          max_tokens: 1,
          messages: [{ role: "user", content: "hi" }],
        }),
      },
    }),
  },
  {
    id: "groq",
    envVars: ["GROQ_API_KEY"],
    prefixes: ["gsk_"],
    pattern: /^[a-zA-Z0-9_.-]+$/,
    defaultModel: "llama-3.3-70b-versatile",
    modelsUrl: "https://api.groq.com/openai/v1/models",
    headers: (key) => ({ Authorization: `Bearer ${key}` }),
    modelName: (m) => m.id ?? "",
    deepRequest: (key, model) => ({
      url: "https://api.groq.com/openai/v1/chat/completions",
      init: {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: "hi" }],
          max_tokens: 1,
        }),
      },
    }),
  },
];

function resolveKey(provider) {
  for (const name of provider.envVars) {
    const value = process.env[name]?.trim();
    if (value) {return { name, value };}
  }
  return null;
}

/** Mirrors VaultIntegration.validateApiKeyFormat — returns a verdict string. */
function checkKeyFormat(provider, key) {
  if (key.length < 10) {return "FAIL too short";}
  if (provider.prefixes.some((p) => key.startsWith(p))) {
    return "ok (known prefix)";
  }
  if (provider.pattern.test(key)) {
    return "WARN unrecognized prefix (new format?) — app validator will accept it, provider may reject";
  }
  return "FAIL invalid characters for any known provider format";
}

async function probe(provider, key) {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(provider.modelsUrl, {
      headers: provider.headers(key),
      signal: controller.signal,
    });
    const latencyMs = Date.now() - started;
    if (!res.ok) {
      const body = (await res.text()).slice(0, 300);
      return {
        status: `FAIL HTTP ${res.status}`,
        latencyMs,
        detail: body,
        models: null,
      };
    }
    const json = await res.json();
    const models = (json.models ?? json.data ?? [])
      .map(provider.modelName)
      .filter(Boolean);
    return { status: "ok", latencyMs, models, detail: null };
  } catch (err) {
    return {
      status: `FAIL ${err?.name === "AbortError" ? "timeout" : "network"}`,
      latencyMs: Date.now() - started,
      detail: String(err?.message ?? err).slice(0, 200),
      models: null,
    };
  } finally {
    clearTimeout(timer);
  }
}

const DEEP = process.argv.includes("--deep");

/**
 * Minimal 1-token generation request — verifies the payload envelope the
 * app sends is still accepted upstream (payload-format drift detection).
 */
async function deepProbe(provider, key, model) {
  if (!provider.deepRequest) {return { status: "n/a" }};
  const { url, init } = provider.deepRequest(key, model);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const body = await res.text();
    if (res.ok) {return { status: "ok" };}
    if (
      res.status === 400 &&
      /unknown|unrecognized|invalid json payload/i.test(body)
    ) {
      return { status: "FAIL payload format drift", detail: body.slice(0, 120) };
    }
    if (res.status === 404) {
      return { status: "FAIL model unavailable", detail: body.slice(0, 120) };
    }
    return { status: `FAIL HTTP ${res.status}`, detail: body.slice(0, 120) };
  } catch (err) {
    return {
      status: `FAIL ${err?.name === "AbortError" ? "timeout" : "network"}`,
      detail: String(err?.message ?? err).slice(0, 120),
    };
  } finally {
    clearTimeout(timer);
  }
}

const rows = [];
let failures = 0;
let warnings = 0;

console.log(`AI provider compatibility probe${DEEP ? " (--deep)" : ""}\n`);

for (const provider of PROVIDERS) {
  const resolved = resolveKey(provider);
  if (!resolved) {
    rows.push({ provider: provider.id, key: "-", format: "-", result: "SKIP (no env key)", model: "-" });
    continue;
  }

  const format = checkKeyFormat(provider, resolved.value);
  if (format.startsWith("FAIL")) {failures++;}
  if (format.startsWith("WARN")) {warnings++;}

  const { status, latencyMs, models, detail } = await probe(provider, resolved.value);
  if (status !== "ok") {failures++;}

  let modelStatus = "-";
  if (status === "ok" && models) {
    // NOTE: for Gemini the models list is filtered by the key's tier; the
    // default-model check below verifies presence. generateContent support
    // is enforced at request time by GeminiProvider's fallback chain.
    if (models.includes(provider.defaultModel)) {
      modelStatus = `ok (${provider.defaultModel} available)`;
    } else {
      modelStatus = `FAIL default model '${provider.defaultModel}' NOT in live list (${models.length} models)`;
      failures++;
    }
  } else if (detail) {
    modelStatus = detail.replace(/\s+/g, " ").slice(0, 80);
  }

  let payloadStatus = "-";
  if (DEEP) {
    if (status === "ok" && modelStatus.startsWith("ok")) {
      const deep = await deepProbe(provider, resolved.value, provider.defaultModel);
      payloadStatus = deep.status;
      if (payloadStatus !== "ok" && payloadStatus !== "n/a") {
        failures++;
        payloadStatus += deep.detail ? ` — ${deep.detail}` : "";
      }
    } else {
      payloadStatus = "skipped (models check failed)";
    }
  }

  rows.push({
    provider: provider.id,
    key: `${resolved.name} (${resolved.value.slice(0, 6)}…${resolved.value.slice(-4)})`,
    format,
    result: `${status} ${latencyMs}ms`,
    model: modelStatus,
    payload: payloadStatus,
  });
}

const widths = {
  provider: Math.max(...rows.map((r) => r.provider.length), 8),
  key: Math.max(...rows.map((r) => r.key.length), 3),
  format: Math.max(...rows.map((r) => r.format.length), 6),
  result: Math.max(...rows.map((r) => r.result.length), 6),
  model: Math.max(...rows.map((r) => r.model.length), 10),
  payload: Math.max(...rows.map((r) => (r.payload ?? "-").length), 7),
};

const line = (r) =>
  [
    r.provider.padEnd(widths.provider),
    r.key.padEnd(widths.key),
    r.format.padEnd(widths.format),
    r.result.padEnd(widths.result),
    r.model.padEnd(widths.model),
    DEEP ? (r.payload ?? "-") : "",
  ].join("  ");

console.log(
  [
    "PROVIDER".padEnd(widths.provider),
    "KEY".padEnd(widths.key),
    "FORMAT".padEnd(widths.format),
    "RESULT".padEnd(widths.result),
    "MODEL CHECK".padEnd(widths.model),
    ...(DEEP ? ["PAYLOAD (--deep)"] : []),
  ].join("  "),
);
console.log("-".repeat(100));
for (const r of rows) {console.log(line(r));}
console.log("");

if (warnings > 0) {
  console.log(`${warnings} warning(s): key format unrecognized — verify against the provider's current docs.`);
}
if (failures > 0) {
  console.log(`${failures} failure(s) detected. If a key format changed upstream, update VaultIntegration.validateApiKeyFormat and detectProvider().`);
  process.exit(1);
}
console.log("All configured providers OK.");
