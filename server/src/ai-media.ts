/**
 * BookmarkForge — AI media proxy (image generation + TTS).
 *
 * The browser calls these same-origin endpoints instead of hitting Google
 * directly: the upstream API key stays server-side and every request passes
 * the same authenticated session and admission policy as the text proxy.
 * Both endpoints are mounted in server/src/index.ts and reverse-proxied by nginx.
 *
 * Contracts (match the client callers):
 *   POST /api/services/ai/generate-tts   { text, lang? } → { audioBase64 }
 *   POST /api/services/ai/generate-image { prompt }      → { imageBase64 }
 *
 * Upstream contracts:
 *   - TTS: Gemini `:generateContent` with responseModalities ["AUDIO"];
 *     the audio base64 arrives in candidates[].content.parts[].inlineData.data.
 *   - Image: Imagen `:predict`; the bytes arrive in predictions[].bytesBase64.
 *
 * Model names are env-overridable (AI_TTS_MODEL / AI_IMAGE_MODEL) and are
 * validated against the same bounded pattern as the text proxy.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  assertProductionProxyConfig,
  clientIp,
  createRateLimiter,
  matchesAnyToken,
  readBearerToken,
  readBoundedInteger,
  readBody,
  sendJson,
  identityKey,
  type AiAccessPolicy,
} from "./ai-proxy";
import type { AiSessionManager } from "./ai-session";

const DEFAULT_GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const MEDIA_TIMEOUT_MS = 60_000;
const MAX_TTS_TEXT_CHARS = 10_000;
const MAX_IMAGE_PROMPT_CHARS = 20_000;
// Base64 is ~4/3 the binary size; these caps bound retained memory for the
// audio/image payloads the client already caps on its side.
const MAX_AUDIO_BASE64_CHARS = 16 * 1024 * 1024;
const MAX_IMAGE_BASE64_CHARS = 36 * 1024 * 1024;
// Leave 64 KiB of JSON-overhead headroom above the payload caps: a payload
// at its exact limit is still a valid response (the image handler already
// did this; applying the same margin to TTS so a 16 MiB clip is not rejected
// by the wrapper size check).
const MEDIA_MAX_RESPONSE_CHARS = MAX_IMAGE_BASE64_CHARS + 64 * 1024;
const TTS_MAX_RESPONSE_CHARS = MAX_AUDIO_BASE64_CHARS + 64 * 1024;
const MEDIA_RATE_LIMIT = 20;
const MEDIA_MODEL_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

export interface GeminiMediaOptions {
  apiKey?: string;
  apiBase?: string;
  fetchImpl?: typeof fetch;
  /** Compatibility token for isolated server-side handlers and tests. */
  authToken?: string;
  /** Compatibility tokens for isolated server-side handlers and tests. */
  authTokens?: string[];
  /** Coarse per-IP requests per minute. */
  rateLimit?: number;
  trustProxy?: boolean;
  /** Upstream TTS model (env: AI_TTS_MODEL). */
  ttsModel?: string;
  /** Upstream image model (env: AI_IMAGE_MODEL). */
  imageModel?: string;
  /** Same-origin session authenticator used by the real server. */
  sessionManager?: AiSessionManager;
  /** Shared text/media admission policy. */
  accessPolicy?: AiAccessPolicy;
}

function normalizeModel(raw: string | undefined, fallback: string): string {
  const value = (raw ?? "").trim().replace(/^models\//, "");
  return MEDIA_MODEL_PATTERN.test(value) ? value : fallback;
}

async function readBoundedUpstreamJson(
  response: Response,
  maxChars: number,
): Promise<Record<string, unknown> | null> {
  const length = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(length) && length > maxChars) return null;
  const text = await response.text();
  if (text.length > maxChars) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function createGeminiMediaHandler(options: GeminiMediaOptions = {}) {
  const apiKey = options.apiKey ?? process.env.GEMINI_API_KEY ?? process.env.GOOGLE_GEMINI_API_KEY ?? "";
  const apiBase = (options.apiBase ?? process.env.GEMINI_API_BASE ?? DEFAULT_GEMINI_API_BASE).replace(/\/+$/, "");
  const trustProxy = options.trustProxy ??
    (process.env.TRUST_PROXY === "1" || process.env.TRUST_PROXY === "true");
  const fetchImpl = options.fetchImpl ?? fetch;
  const ttsModel = normalizeModel(
    options.ttsModel ?? process.env.AI_TTS_MODEL,
    "gemini-2.5-flash-preview-tts",
  );
  const imageModel = normalizeModel(
    options.imageModel ?? process.env.AI_IMAGE_MODEL,
    "imagen-3.0-generate-002",
  );

  // Bearer support remains injectable for isolated server-side tests only;
  // the real router supplies a sessionManager and has no bearer configured.
  const configuredTokens = new Set<string>();
  for (const token of [options.authToken, ...(options.authTokens ?? [])]) {
    if (typeof token === "string" && token.length > 0) configuredTokens.add(token);
  }
  for (const token of (process.env.AI_PROXY_AUTH_TOKEN ?? "").split(",")) {
    if (token.trim()) configuredTokens.add(token.trim());
  }
  for (const token of (process.env.AI_PROXY_AUTH_TOKENS ?? "").split(",")) {
    if (token.trim()) configuredTokens.add(token.trim());
  }
  assertProductionProxyConfig(configuredTokens, apiBase);

  const allowIp = createRateLimiter({
    rateLimit: readBoundedInteger(
      options.rateLimit ?? process.env.AI_PROXY_IP_RATE_LIMIT,
      MEDIA_RATE_LIMIT,
      1,
      1_000_000,
    ),
  });

  return async function handleGeminiMedia(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const pathname = req.url ? new URL(req.url, "http://localhost").pathname : "";
    const isTts = pathname === "/api/services/ai/generate-tts";
    const isImage = pathname === "/api/services/ai/generate-image";
    if (!isTts && !isImage) {
      sendJson(res, 404, { error: { code: "NOT_FOUND", message: "not found" } });
      return;
    }
    if (req.method !== "POST") {
      sendJson(res, 405, { error: { code: "METHOD_NOT_ALLOWED", message: "method not allowed" } });
      return;
    }
    if (!apiKey || (!options.sessionManager && configuredTokens.size === 0)) {
      sendJson(res, 503, { error: { code: "NOT_CONFIGURED", message: "AI proxy is not configured" } });
      return;
    }
    const session = options.sessionManager ? await options.sessionManager.authenticate(req) : null;
    const token = session ? null : readBearerToken(req);
    if (!session && (!token || !matchesAnyToken(token, configuredTokens))) {
      sendJson(res, 401, { error: { code: "UNAUTHORIZED", message: "AI proxy authentication required" } });
      return;
    }
    const identity = session?.identity ?? identityKey(token!);
    if (!allowIp(clientIp(req, trustProxy))) {
      sendJson(res, 429, { error: { code: "RATE_LIMITED", message: "too many requests" } });
      return;
    }
    let isProbe = false;
    if (options.accessPolicy) {
      await options.accessPolicy.prepare(identity);
      const decision = options.accessPolicy.check(identity);
      if (!decision.allowed) {
        sendJson(res, decision.status, { error: { code: decision.code, message: decision.message } });
        return;
      }
      isProbe = decision.probe === true;
    }

    let rawBody: string;
    try {
      rawBody = await readBody(req);
    } catch (error) {
      options.accessPolicy?.releaseProbe(identity);
      sendJson(res, error instanceof Error && error.message === "body_too_large" ? 413 : 400, {
        error: { code: "INVALID_REQUEST", message: "request body is invalid or too large" },
      });
      return;
    }
    let input: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(rawBody);
      input = typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      options.accessPolicy?.releaseProbe(identity);
      sendJson(res, 400, { error: { code: "INVALID_REQUEST", message: "malformed JSON" } });
      return;
    }

    const ttsText = isTts ? (typeof input.text === "string" ? input.text : "") : "";
    const imagePrompt = isImage ? (typeof input.prompt === "string" ? input.prompt : "") : "";
    if (isTts && (ttsText.length === 0 || ttsText.length > MAX_TTS_TEXT_CHARS)) {
      options.accessPolicy?.releaseProbe(identity);
      sendJson(res, 400, {
        error: { code: "INVALID_REQUEST", message: "text is required and must be ≤ 10000 characters" },
      });
      return;
    }
    if (isImage && (imagePrompt.length === 0 || imagePrompt.length > MAX_IMAGE_PROMPT_CHARS)) {
      options.accessPolicy?.releaseProbe(identity);
      sendJson(res, 400, {
        error: { code: "INVALID_REQUEST", message: "prompt is required and must be ≤ 20000 characters" },
      });
      return;
    }

    if (options.accessPolicy) {
      try {
        if (!(await options.accessPolicy.reserveQuota(identity, isProbe))) {
          options.accessPolicy.releaseProbe(identity);
          sendJson(res, 429, { error: { code: "QUOTA_EXCEEDED", message: "daily quota exceeded" } });
          return;
        }
      } catch (error) {
        options.accessPolicy.releaseProbe(identity);
        if (options.accessPolicy.quotaFailureMode !== "fail-open") {
          sendJson(res, 503, { error: { code: "QUOTA_UNAVAILABLE", message: "AI quota service temporarily unavailable" } });
          return;
        }
        console.error("[ai-media] quota store unavailable; continuing in explicit fail-open mode", error instanceof Error ? error.message : String(error));
      }
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), MEDIA_TIMEOUT_MS);
    const onAborted = (): void => controller.abort();
    req.once("aborted", onAborted);
    try {
      if (isTts) {
        const text = ttsText;
        const lang =
          typeof input.lang === "string" && /^[A-Za-z-]{2,35}$/.test(input.lang)
            ? input.lang
            : undefined;
        const generationConfig: Record<string, unknown> = { responseModalities: ["AUDIO"] };
        if (lang) generationConfig.languageHint = lang;
        const upstream = await fetchImpl(
          `${apiBase}/${ttsModel}:generateContent`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
            body: JSON.stringify({
              contents: [{ role: "user", parts: [{ text }] }],
              generationConfig,
            }),
            signal: controller.signal,
          },
        );
        if (!upstream.ok) {
          options.accessPolicy?.recordFailure(identity);
          await upstream.body?.cancel();
          sendJson(res, upstream.status === 429 ? 429 : 502, {
            error: {
              code: upstream.status === 429 ? "RATE_LIMITED" : "UPSTREAM",
              message: "AI provider request failed",
            },
          });
          return;
        }
        const payload = await readBoundedUpstreamJson(upstream, TTS_MAX_RESPONSE_CHARS);
        const parts = (
          payload?.candidates as
            | Array<{ content?: { parts?: Array<{ inlineData?: { data?: unknown } }> } }>
            | undefined
        )?.flatMap((candidate) => candidate.content?.parts ?? []) ?? [];
        const inline = parts.find((part) => typeof part.inlineData?.data === "string");
        const audio = typeof inline?.inlineData?.data === "string" ? inline.inlineData.data : "";
        if (!audio || audio.length > MAX_AUDIO_BASE64_CHARS) {
          options.accessPolicy?.recordFailure(identity);
          sendJson(res, 502, { error: { code: "UPSTREAM", message: "AI provider returned no audio" } });
          return;
        }
        options.accessPolicy?.recordSuccess(identity);
        sendJson(res, 200, { audioBase64: audio });
        return;
      }

      // Image — Imagen predict contract.
      const prompt = imagePrompt;
      const upstream = await fetchImpl(
        `${apiBase}/${imageModel}:predict`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
          body: JSON.stringify({
            instances: [{ prompt }],
            parameters: { sampleCount: 1 },
          }),
          signal: controller.signal,
        },
      );
      if (!upstream.ok) {
        options.accessPolicy?.recordFailure(identity);
        await upstream.body?.cancel();
        sendJson(res, upstream.status === 429 ? 429 : 502, {
          error: {
            code: upstream.status === 429 ? "RATE_LIMITED" : "UPSTREAM",
            message: "AI provider request failed",
          },
        });
        return;
      }
      const payload = await readBoundedUpstreamJson(upstream, MEDIA_MAX_RESPONSE_CHARS);
      const predictions = Array.isArray(payload?.predictions)
        ? (payload.predictions as Array<Record<string, unknown>>)
        : [];
      const bytes = predictions.find((p) => typeof p.bytesBase64 === "string")?.bytesBase64;
      const image = typeof bytes === "string" ? bytes : "";
      if (!image || image.length > MAX_IMAGE_BASE64_CHARS) {
        options.accessPolicy?.recordFailure(identity);
        sendJson(res, 502, { error: { code: "UPSTREAM", message: "AI provider returned no image" } });
        return;
      }
      options.accessPolicy?.recordSuccess(identity);
      sendJson(res, 200, { imageBase64: image });
    } catch (error) {
      // A client disconnect aborts the controller too. It is not an upstream
      // failure: do not poison the breaker with user cancellations or a
      // response socket that has already been closed (same contract as the
      // proxy handler in ai-proxy.ts).
      const clientAborted =
        req.aborted || (controller.signal.aborted && (res.destroyed || !res.writable));
      if (!clientAborted) {
        options.accessPolicy?.recordFailure(identity);
      }
      if (!res.writableEnded && !res.destroyed && res.writable) {
        const status =
          error instanceof Error && error.name === "AbortError" && !clientAborted ? 504 : 502;
        sendJson(res, status, {
          error: { code: "UPSTREAM", message: "AI provider request failed" },
        });
      }
    } finally {
      clearTimeout(timeout);
      req.removeListener("aborted", onAborted);
      if (isProbe) options.accessPolicy?.releaseProbe(identity);
    }
  };
}
