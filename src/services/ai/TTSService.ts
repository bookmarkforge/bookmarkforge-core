import { aiManager } from "./ProviderManager";
import { readBoundedResponseJson, cancelResponseBody } from "./utils";
import { logger } from "../../utils/logger";
import { firewalledFetch } from "../../utils/networkFirewall";
import { securityVault, SECURE_STORAGE_KEYS } from "../SecurityVault";
import { secureStorage } from "../SecureStorage";
import { downloadBlob } from "../../utils/download";
import { logRateLimited } from "../../utils/boundedLog";
import { fnv1aHash } from "../../utils/hash";
import { fetchWithTimeout } from "./utils";
import { toPlayableAudioDataUrl } from "../../utils/audioFormat";
import { decodeDataUrlToBytes } from "../../utils/defensive-base64";
import { GEMINI_API_BASE, AI_MODELS } from "../../constants/config";

// Supported languages mapping
const LANGUAGE_CODES: Record<string, string> = {
  ar: "ar-SA",
  bg: "bg-BG",
  cs: "cs-CZ",
  da: "da-DK",
  de: "de-DE",
  el: "el-GR",
  en: "en-US",
  es: "es-ES",
  fi: "fi-FI",
  fr: "fr-FR",
  he: "he-IL",
  hi: "hi-IN",
  hr: "hr-HR",
  hu: "hu-HU",
  id: "id-ID",
  it: "it-IT",
  ja: "ja-JP",
  ko: "ko-KR",
  nl: "nl-NL",
  no: "no-NO",
  pl: "pl-PL",
  pt: "pt-BR",
  ro: "ro-RO",
  ru: "ru-RU",
  sv: "sv-SE",
  th: "th-TH",
  tr: "tr-TR",
  uk: "uk-UA",
  vi: "vi-VN",
  zh: "zh-CN",
};

export interface VoiceSettings {
  rate: number;
  pitch: number;
  volume: number;
  voiceURI?: string;
  providerOverride?: "gemini" | "openai" | "webspeech" | "transformers";
}

interface AudioResult {
  url: string;
  provider: "gemini" | "openai" | "webspeech" | "transformers" | "cached";
  duration?: number;
  size?: number;
}

class AudioCache {
  private db: IDBDatabase | null = null;
  private readonly DB_NAME = "BookmarkForgeAudioCache";
  private readonly STORE_NAME = "audio";
  private readonly MAX_SIZE = 100;
  // Cached audio is a data URL, so 25 MiB of binary audio becomes roughly
  // 33 MiB of Base64 plus a small header. Keep the cache bound aligned with
  // the runtime audio limit instead of retaining legacy oversized entries.
  private readonly MAX_CACHE_BYTES = 35 * 1024 * 1024;
  private readonly ENTRY_TTL_MS = 24 * 60 * 60 * 1000;
  // Audio data is user-derived content. Keep the active-session cache in
  // memory only; the IndexedDB store below is used solely to purge legacy
  // plaintext entries and is never written by get/set.
  private seqCounter = 0;
  private memoryCache = new Map<string, {
    data: string;
    size: number;
    timestamp: number;
      seq: number;
    expiresAt: number;
    scope: string;
  }>();
  private cacheScope = this.newScope();
  private cacheGeneration = 0;
  private initPromise: Promise<void> | null = null;

  constructor() {
    const rotateScope = () => {
      // A cache entry is derived from vault content. Rotate the namespace and
      // wipe the old store on every vault transition so another vault cannot
      // replay the previous vault's audio.
      this.cacheGeneration++;
      this.cacheScope = this.newScope();
      this.memoryCache.clear();
      void this.clearStore(this.cacheGeneration);
    };
    securityVault.onLock(rotateScope);
    securityVault.onUnlock(rotateScope);
    // Best-effort migration cleanup: remove any plaintext audio left by older
    // versions immediately, including on a locked vault.
    void this.clearStore(this.cacheGeneration);
  }

  private newScope(): string {
    try {
      return crypto.randomUUID();
    } catch {
      return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }
  }

  async init(): Promise<void> {
    if (this.db) {return;}
    if (this.initPromise) {return this.initPromise;}

    let tracked: Promise<void>;
    const operation = new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(this.DB_NAME, 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        this.db.onversionchange = () => {
          this.db?.close();
          this.db = null;
        };
        resolve();
      };
      request.onupgradeneeded = (e) => {
        const db = (e.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(this.STORE_NAME)) {
          const store = db.createObjectStore(this.STORE_NAME, {
            keyPath: "key",
          });
          store.createIndex("timestamp", "timestamp", { unique: false });
        } else {
          const store = (e.target as IDBOpenDBRequest).transaction?.objectStore(this.STORE_NAME);
          if (store && !store.indexNames.contains("timestamp")) {
            store.createIndex("timestamp", "timestamp", { unique: false });
          }
        }
      };
    });
    // eslint-disable-next-line prefer-const -- declared separately so the finally callback can close over it
    tracked = operation.finally(() => {
      if (this.initPromise === tracked) {
        this.initPromise = null;
      }
    });
    this.initPromise = tracked;
    return tracked;
  }

  async get(text: string, lang: string): Promise<string | null> {
    const generation = this.cacheGeneration;
    const scope = this.cacheScope;
    const key = `${scope}:${lang}:${fnv1aHash(text.toLowerCase().trim())}`;
    const entry = this.memoryCache.get(key);
    if (!entry) {return null;}
    if (
      entry.expiresAt <= Date.now() ||
      generation !== this.cacheGeneration ||
      scope !== this.cacheScope
    ) {
      this.memoryCache.delete(key);
      return null;
    }
    return entry.data;
  }

  async set(text: string, lang: string, data: string): Promise<void> {
    if (data.length > this.MAX_CACHE_BYTES) {return;}
    const generation = this.cacheGeneration;
    const scope = this.cacheScope;
    const key = `${scope}:${lang}:${fnv1aHash(text.toLowerCase().trim())}`;
    if (generation !== this.cacheGeneration || scope !== this.cacheScope) {return;}
    const now = Date.now();
    this.memoryCache.set(key, {
      data,
      size: data.length,
      timestamp: now,
      expiresAt: now + this.ENTRY_TTL_MS,
      scope,
      seq: this.seqCounter++,
    });
    await this.pruneOldEntries();
  }

  async pruneOldEntries(): Promise<void> {
    const now = Date.now();
    const current = [...this.memoryCache.entries()]
      .filter(([, value]) =>
        value.scope === this.cacheScope && value.expiresAt > now,
      )
      .sort(([, a], [, b]) => b.timestamp - a.timestamp || b.seq - a.seq);
    let totalBytes = 0;
    for (const [index, [key, value]] of current.entries()) {
      if (
        totalBytes + value.size > this.MAX_CACHE_BYTES ||
        index >= this.MAX_SIZE
      ) {
        this.memoryCache.delete(key);
      } else {
        totalBytes += value.size;
      }
    }
    for (const [key, value] of this.memoryCache) {
      if (value.scope !== this.cacheScope || value.expiresAt <= now) {
        this.memoryCache.delete(key);
      }
    }
  }

  async clear(): Promise<void> {
    const generation = ++this.cacheGeneration;
    this.memoryCache.clear();
    await this.clearStore(generation);
  }

  private async clearStore(generation: number): Promise<void> {
    try {
      // Avoid yielding when the DB is already open so a rotation schedules its
      // clear transaction before a new-scope write can be created.
      if (!this.db) {await this.init();}
    } catch (_err) {
      return; // best-effort
    }
    if (generation !== this.cacheGeneration || !this.db) {return;}
    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) {return;}
        settled = true;
        resolve();
      };
      try {
        const tx = this.db!.transaction(this.STORE_NAME, "readwrite");
        const store = tx.objectStore(this.STORE_NAME);
        store.clear();
        // Clearing is complete only after the transaction commits. Waiting on
        // the request alone can report success before a late quota/abort event.
        tx.oncomplete = finish;
        tx.onerror = finish;
        tx.onabort = finish;
      } catch (_err) {
        finish();
      }
    });
  }
}

const audioCache = new AudioCache();
const MAX_TTS_AUDIO_BYTES = 25 * 1024 * 1024;

function createAbortError(message: string): Error {
  if (typeof DOMException === "function") {
    return new DOMException(message, "AbortError");
  }
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

function readBlobAsDataUrl(blob: Blob, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    let settled = false;
    const cleanup = () => {
      reader.onloadend = null;
      reader.onerror = null;
      reader.onabort = null;
      signal?.removeEventListener("abort", onAbort);
    };
    const fail = (error: unknown) => {
      if (settled) {return;}
      settled = true;
      cleanup();
      reject(error instanceof Error ? error : new Error(String(error)));
    };
    const onAbort = () => {
      try {reader.abort();} catch { /* INTENTIONAL SILENCE: the reader already finished. */ }
      fail(createAbortError("Audio encoding aborted"));
    };

    if (signal?.aborted) {
      fail(createAbortError("Audio encoding aborted"));
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
    reader.onloadend = () => {
      if (settled) {return;}
      if (typeof reader.result !== "string") {
        fail(new Error("Failed to encode audio"));
        return;
      }
      settled = true;
      cleanup();
      resolve(reader.result);
    };
    reader.onerror = () =>
      fail(reader.error ?? new Error("Failed to read audio"));
    reader.onabort = () => fail(createAbortError("Audio encoding aborted"));
    try {
      reader.readAsDataURL(blob);
    } catch (error) {
      fail(error);
    }
  });
}

async function readBoundedAudioBlob(
  response: Response,
  signal?: AbortSignal,
): Promise<Blob> {
  if (signal?.aborted) {throw createAbortError("Audio download aborted");}
  const contentLength = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_TTS_AUDIO_BYTES) {
    await cancelResponseBody(response);
    throw new Error("TTS audio exceeds the 25 MB limit");
  }

  const body = response.body;
  if (body && typeof body.getReader === "function") {
    let reader: ReadableStreamDefaultReader<Uint8Array>;
    try {
      reader = body.getReader() as ReadableStreamDefaultReader<Uint8Array>;
    } catch (error) {
      await cancelResponseBody(response);
      throw error;
    }
    const chunks: Uint8Array[] = [];
    let total = 0;
    let aborted = false;
    const onAbort = () => {
      aborted = true;
      void reader.cancel().catch(() => undefined);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (aborted || signal?.aborted) {
          throw createAbortError("Audio download aborted");
        }
        if (done) {break;}
        const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
        total += chunk.byteLength;
        if (total > MAX_TTS_AUDIO_BYTES) {
          try {await reader.cancel();} catch { /* INTENTIONAL SILENCE: preserve the primary limit error. */ }
          throw new Error("TTS audio exceeds the 25 MB limit");
        }
        chunks.push(chunk);
      }
    } catch (error) {
      if (aborted || signal?.aborted) {
        throw createAbortError("Audio download aborted");
      }
      throw error;
    } finally {
      signal?.removeEventListener("abort", onAbort);
      try {reader.releaseLock();} catch { /* INTENTIONAL SILENCE: the runtime already released the lock. */ }
    }
    return new Blob(chunks as BlobPart[]);
  }

  const blobPromise = response.blob();
  // Avoid an unhandled rejection when an abort wins the race against a
  // runtime's native blob() implementation.
  void blobPromise.catch(() => undefined);
  let removeAbortListener: (() => void) | undefined;
  const abortPromise = signal
    ? new Promise<never>((_, reject) => {
        const onAbort = () => {
          void cancelResponseBody(response).catch(() => undefined);
          reject(createAbortError("Audio download aborted"));
        };
        if (signal.aborted) {onAbort(); return;}
        signal.addEventListener("abort", onAbort, { once: true });
        removeAbortListener = () => signal.removeEventListener("abort", onAbort);
      })
    : null;
  try {
    const blob = abortPromise
      ? await Promise.race([blobPromise, abortPromise])
      : await blobPromise;
    if (blob.size > MAX_TTS_AUDIO_BYTES) {
      throw new Error("TTS audio exceeds the 25 MB limit");
    }
    return blob;
  } finally {
    removeAbortListener?.();
  }
}

function getGeminiApiHeaders(apiKey: string | null): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "x-goog-api-key": apiKey ?? "",
  };
}

export class TTSService {
  private currentUtterance: SpeechSynthesisUtterance | null = null;
  private isPaused = false;
  private isPlaying = false;
  private currentAudio: HTMLAudioElement | null = null;
  private playbackQueue: string[] = [];
  private currentChunkIndex = 0;
  private abortController: AbortController | null = null;

  private async getApiKey(): Promise<{
    key: string;
    provider: "openai" | "gemini" | "unknown";
  } | null> {
    const providerInfo = aiManager.getProviderInfo();
    let apiKey: string | null = null;
    try {
      apiKey = aiManager.getApiKey();
    } catch (e: unknown) {
      logger.warn("[TTS] getApiKey failed (vault may be locked)", {
        error: e instanceof Error ? e.message : String(e),
      });
    }

    // Fallback: decrypt from SecureStorage (replaces insecure localStorage)
    if (!apiKey && !securityVault.isLocked()) {
      try {
        apiKey = await securityVault.decryptSecret(SECURE_STORAGE_KEYS.API_KEY);
      } catch (e: unknown) {
        logger.warn("[TTS] decryptSecret failed", {
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    // Last resort: pending key from SecureStorage. Only usable once the vault
    // is unlocked, because it must be re-encrypted under the master key before
    // use. If the vault stays locked, we MUST NOT decrypt/use the plaintext
    // secret (it would persist in cleartext in IndexedDB otherwise).
    if (!apiKey && !securityVault.isLocked()) {
      try {
        const pending = await secureStorage.getSecret("pending_api_key");
        if (pending) {
          apiKey = pending;
          await securityVault.encryptSecret(apiKey, SECURE_STORAGE_KEYS.API_KEY);
          await secureStorage.deleteSecret("pending_api_key");
        }
      } catch (e: unknown) {
        logger.warn("[TTS] SecureStorage API key retrieval failed", {
          error: e instanceof Error ? e.message : String(e),
        });
      }
    } else if (!apiKey) {
      // Vault locked: deliberately refuse to use any plaintext pending key.
      try {
        const pending = await secureStorage.getSecret("pending_api_key");
        if (pending) {
          logger.warn(
            "[TTS] Vault locked; refusing to use plaintext pending_api_key",
          );
        }
      } catch (error) {
        // A locked vault has no usable pending key; preserve that fail-closed
        // behavior while keeping storage failures observable and bounded.
        logRateLimited(
          "warn",
          "tts-pending-key-locked-read",
          "Failed to inspect pending TTS API key while vault is locked",
          { error: error instanceof Error ? error.message : String(error) },
        );
      }
    }

    if (!apiKey) {return null;}
    if (apiKey.startsWith("sk-")) {return { key: apiKey, provider: "openai" };}
    if (apiKey.startsWith("AIza")) {return { key: apiKey, provider: "gemini" };}
    return {
      key: apiKey,
      provider: providerInfo.provider as "openai" | "gemini" | "unknown",
    };
  }

  getAvailableVoices(): SpeechSynthesisVoice[] {
    if (typeof window === "undefined" || !("speechSynthesis" in window))
      {return [];}
    return window.speechSynthesis.getVoices() || [];
  }

  getVoicesForLanguage(lang: string): SpeechSynthesisVoice[] {
    const langCode = LANGUAGE_CODES[lang] || "en-US";
    const shortLang = langCode.split("-")[0]!;
    return this.getAvailableVoices().filter((v) =>
      v.lang.startsWith(shortLang),
    );
  }

  isWebSpeechAvailable(): boolean {
    return typeof window !== "undefined" && "speechSynthesis" in window;
  }

  // --- 1. CHUNKING LOGIC ---
  private chunkText(text: string, maxLen = 1500): string[] {
    const chunks: string[] = [];
    const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
    let currentChunk = "";

    for (const sentence of sentences) {
      if (currentChunk.length + sentence.length < maxLen) {
        currentChunk += sentence + " ";
      } else {
        if (currentChunk) {chunks.push(currentChunk.trim());}
        currentChunk = sentence + " ";
      }
    }
    if (currentChunk) {chunks.push(currentChunk.trim());}
    return chunks.length ? chunks : [text];
  }

  // --- 2. OPENAI SUPPORT ---
  private async generateOpenAIAudio(
    text: string,
    apiKey: string,
    signal?: AbortSignal,
  ): Promise<string | null> {
    try {
      const response = await firewalledFetch(
        "https://api.openai.com/v1/audio/speech",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ model: "tts-1", input: text, voice: "alloy" }),
          signal,
        },
        "tts",
      );
      if (!response.ok) {
        await cancelResponseBody(response);
        return null;
      }
      const blob = await readBoundedAudioBlob(response, signal);
      return await readBlobAsDataUrl(blob, signal);
    } catch (e) {
      logger.error(
        "[TTS] OpenAI API Error:",
        e instanceof Error ? e.message : String(e),
      );
      return null;
    }
  }

  // --- GEMINI SUPPORT ---
  /**
   * Security: Calls the Gemini API directly instead of routing through
   * the eliminated proxy. The API key is passed via x-goog-api-key header.
   */
  private async generateGeminiAudio(
    text: string,
    lang: string,
    signal?: AbortSignal,
  ): Promise<string | null> {
    try {
      let apiKey: string | null = null;
      try { apiKey = aiManager.getApiKey(); } catch { /* best-effort */ }
      const model = AI_MODELS.GEMINI_EXP;
      const response = await fetchWithTimeout(
        `${GEMINI_API_BASE}/${model}:generateContent`,
        {
          method: "POST",
          headers: getGeminiApiHeaders(apiKey),
          body: JSON.stringify({
            contents: [{ parts: [{ text }] }],
            generationConfig: {
              speechConfig: {
                languageCode: lang,
                voiceConfig: {
                  voice: { name: "en-US-Standard-A" },
                },
              },
            },
          }),
          signal,
        },
      );
      if (!response.ok) {
        await cancelResponseBody(response);
        return null;
      }
      const data = await readBoundedResponseJson<{
        candidates?: Array<{
          content?: {
            parts?: Array<{ inlineData?: { data?: string; mimeType?: string } }>;
          };
        }>;
        error?: unknown;
      }>(response);
      if (data.error) {
        logger.error("[TTS] Gemini TTS error:", data.error);
        return null;
      }
      const candidates = data.candidates;
      if (!candidates || candidates.length === 0) {return null;}
      const parts = candidates[0]?.content?.parts;
      if (!parts || parts.length === 0) {return null;}
      const inlineData = parts[0]?.inlineData;
      const audioBase64 = inlineData?.data;
      if (typeof audioBase64 !== "string" || !audioBase64) {return null;}
      // Callers assign the result to an <audio> source and `generateOpenAIAudio`
      // already returns a data URL, so the two providers have to be
      // interchangeable. Gemini returns raw PCM (`audio/L16;codec=pcm;rate=…`),
      // which `audioFormat` wraps in a WAV container — labelling that sample
      // stream `audio/wav` was not enough, the browser needs the header.
      return toPlayableAudioDataUrl(audioBase64, inlineData?.mimeType);
    } catch (e) {
      logger.error(
        "[TTS] Gemini TTS error:",
        e instanceof Error ? e.message : String(e),
      );
      return null;
    }
  }

  // --- EXPERIMENTAL TRANSFORMERS.JS LOCAL TTS ---
  private async generateTransformersAudio(
    _text: string,
  ): Promise<string | null> {
    // Note: Implementation requires loading a 150MB+ ONNX model into WebWorker.
    // For now, this returns null and falls back to WebSpeech to save bandwidth.
    return null;
  }

  async generateAudio(
    text: string,
    lang: string = "en",
    settings?: VoiceSettings,
    opts?: { isPrivate?: boolean; signal?: AbortSignal },
  ): Promise<AudioResult | null> {
    if (!text || opts?.signal?.aborted) {return null;}

    // Audit #4 (privacy): never read or write the shared audio cache for
    // private content — a data-URL of a private document's speech would
    // otherwise persist in plaintext in IndexedDB.
    // Missing privacy metadata fails closed to the local/web-speech path.
    const isPrivate = opts?.isPrivate !== false;
    // The per-page scope is rotated on lock/unlock, so non-private audio can
    // still be cached while the app is on its lock screen without crossing a
    // vault boundary. Private content remains strictly cache-disabled.
    const cacheAllowed = !isPrivate;
    if (cacheAllowed) {
      const cached = await audioCache.get(text, lang);
      if (opts?.signal?.aborted) {return null;}
      if (cached) {return { url: cached, provider: "cached" };}
    }

    const apiInfo = await this.getApiKey();
    if (opts?.signal?.aborted) {return null;}
    let audioUrl: string | null = null;
    let provider: AudioResult["provider"] = "webspeech";

    if (settings?.providerOverride === "transformers") {
      audioUrl = await this.generateTransformersAudio(text);
      provider = "transformers";
    } else if (!isPrivate && apiInfo?.provider === "openai") {
      audioUrl = await this.generateOpenAIAudio(text, apiInfo.key, opts?.signal);
      provider = "openai";
    } else if (!isPrivate && apiInfo?.provider === "gemini") {
      audioUrl = await this.generateGeminiAudio(text, lang, opts?.signal);
      provider = "gemini";
    }

    if (audioUrl) {
      if (opts?.signal?.aborted) {return null;}
      if (cacheAllowed) {await audioCache.set(text, lang, audioUrl);}
      return { url: audioUrl, provider };
    }

    if (opts?.signal?.aborted) {return null;}
    return { url: "", provider: "webspeech" };
  }

  // --- 3. MEDIA SESSION API ---
  private setupMediaSession(text: string) {
    if ("mediaSession" in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: "BookmarkForge Reader",
        artist: "TTS Assistant",
        album: text.substring(0, 30) + "...",
      });
      navigator.mediaSession.setActionHandler("play", () => this.resume());
      navigator.mediaSession.setActionHandler("pause", () => this.pause());
      navigator.mediaSession.setActionHandler("stop", () => this.stop());
    }
  }

  // --- 4. REAL-TIME HIGHLIGHTING & PLAYBACK ---
  async speak(
    text: string,
    lang: string = "en",
    settings: VoiceSettings = { rate: 1, pitch: 1, volume: 1 },
    opts?: { isPrivate?: boolean },
  ): Promise<void> {
    if (!text) {return;}
    this.stop();
    const session = new AbortController();
    this.abortController = session;
    this.setupMediaSession(text);

    // Chunking for infinite reading
    this.playbackQueue = this.chunkText(text);
    this.currentChunkIndex = 0;
    this.isPlaying = true;

    await this.playNextChunk(lang, settings, opts, session);
  }

  private async playNextChunk(
    lang: string,
    settings: VoiceSettings,
    opts: { isPrivate?: boolean } | undefined,
    session?: AbortController,
  ) {
    const activeSession = session ?? this.abortController ?? new AbortController();
    if (!this.abortController) {this.abortController = activeSession;}
    if (activeSession !== this.abortController || activeSession.signal.aborted) {
      return;
    }
    if (this.currentChunkIndex >= this.playbackQueue.length) {
      this.isPlaying = false;
      return;
    }

    const chunkText = this.playbackQueue[this.currentChunkIndex]!;

    // Dispatch Highlighting Event
    window.dispatchEvent(
      new CustomEvent("tts-word-highlight", {
        detail: { chunkIndex: this.currentChunkIndex, text: chunkText },
      }),
    );

    const result = await this.generateAudio(
      chunkText,
      lang,
      settings,
      opts ? { ...opts, signal: activeSession.signal } : { signal: activeSession.signal },
    );
    if (activeSession !== this.abortController || activeSession.signal.aborted) {return;}

    if (result && result.provider !== "webspeech" && result.url) {
      const audio = new Audio(result.url);
      this.currentAudio = audio;
      audio.volume = settings.volume;
      audio.playbackRate = settings.rate;
      const isCurrentSession = () =>
        activeSession === this.abortController &&
        !activeSession.signal.aborted &&
        this.currentAudio === audio;
      const releaseAudio = () => {
        if (this.currentAudio === audio) {this.currentAudio = null;}
        audio.onended = null;
        audio.onerror = null;
      };

      audio.onended = () => {
        if (!isCurrentSession()) {return;}
        releaseAudio();
        this.currentChunkIndex++;
        void this.playNextChunk(lang, settings, opts, activeSession);
      };

      audio.onerror = () => {
        if (!isCurrentSession()) {return;}
        releaseAudio();
        this.speakWithWebSpeech(chunkText, lang, settings, activeSession, opts);
      };

      try {
        await audio.play();
      } catch (error) {
        if (!isCurrentSession()) {return;}
        releaseAudio();
        logger.warn("[TTS] Audio playback failed; falling back to WebSpeech", {
          error: error instanceof Error ? error.message : String(error),
        });
        this.speakWithWebSpeech(chunkText, lang, settings, activeSession, opts);
      }
    } else {
      this.speakWithWebSpeech(chunkText, lang, settings, session, opts);
    }
  }

  private speakWithWebSpeech(
    text: string,
    lang: string,
    settings: VoiceSettings,
    session?: AbortController,
    opts?: { isPrivate?: boolean },
  ): void {
    const activeSession = session ?? this.abortController ?? new AbortController();
    if (!this.abortController) {this.abortController = activeSession;}
    if (
      activeSession !== this.abortController ||
      activeSession.signal.aborted ||
      !this.isWebSpeechAvailable()
    ) {return;}

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = LANGUAGE_CODES[lang] || "en-US";
    utterance.rate = settings.rate;
    utterance.pitch = settings.pitch;
    utterance.volume = settings.volume;

    const voices = this.getVoicesForLanguage(lang);
    if (settings.voiceURI) {
      const v = this.getAvailableVoices().find(
        (v) => v.voiceURI === settings.voiceURI,
      );
      if (v) {utterance.voice = v;}
    } else if (voices.length > 0) {
      utterance.voice = voices[0] ?? null;
    }

    utterance.onend = () => {
      if (activeSession !== this.abortController || activeSession.signal.aborted) {return;}
      this.currentUtterance = null;
      this.currentChunkIndex++;
      void this.playNextChunk(lang, settings, opts, activeSession);
    };

    utterance.onerror = () => {
      if (activeSession !== this.abortController || activeSession.signal.aborted) {return;}
      this.currentUtterance = null;
      this.isPlaying = false;
    };

    this.currentUtterance = utterance;
    window.speechSynthesis.speak(utterance);
  }

  pause(): void {
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.isPaused = true;
    } else if (this.currentUtterance) {
      window.speechSynthesis.pause();
      this.isPaused = true;
    }
  }

  resume(): void {
    if (this.currentAudio) {
      this.currentAudio.play();
      this.isPaused = false;
    } else if (this.currentUtterance) {
      window.speechSynthesis.resume();
      this.isPaused = false;
    }
  }

  stop(): void {
    this.abortController?.abort();
    if (this.currentAudio) {
      const audio = this.currentAudio;
      this.currentAudio = null;
      audio.onended = null;
      audio.onerror = null;
      audio.pause();
    }
    if (this.currentUtterance) {
      const utterance = this.currentUtterance;
      this.currentUtterance = null;
      utterance.onend = null;
      utterance.onerror = null;
      window.speechSynthesis.cancel();
    }
    this.isPlaying = false;
    this.isPaused = false;
    this.playbackQueue = [];
    this.currentChunkIndex = 0;
  }

  async downloadAudio(
    text: string,
    lang: string = "en",
    settings: VoiceSettings = { rate: 1, pitch: 1, volume: 1 },
    opts?: { isPrivate?: boolean; signal?: AbortSignal },
  ): Promise<void> {
    const result = await this.generateAudio(text, lang, settings, opts);
    if (
      opts?.signal?.aborted ||
      !result ||
      result.provider === "webspeech" ||
      !result.url
    ) {return;}

    // Audit #4: OpenAI audio is a data: URL — resolve it directly (data:
    // needs no network/firewall check; firewalledFetch would reject it).
    let blob: Blob;
    if (result.url.startsWith("data:")) {
      // Data URLs are already local bytes; decode them without opening a
      // network request (and without bypassing the firewall wrapper).
      const comma = result.url.indexOf(",");
      if (comma < 0) {return;}
      const header = result.url.slice(5, comma);
      const payload = result.url.slice(comma + 1);
      const mime = header.split(";")[0] || "application/octet-stream";
      if (header.endsWith(";base64")) {
        // Shared defensive decoder: validates charset/padding/size before any
        // allocation and decodes in bounded chunks (no full-payload binary
        // string). Oversized or malformed cached URLs are rejected.
        const decoded = decodeDataUrlToBytes(result.url, MAX_TTS_AUDIO_BYTES);
        if (!decoded) {
          logger.warn("[TTS] Cached data URL is not valid Base64");
          return;
        }
        blob = new Blob([decoded.bytes.buffer as ArrayBuffer], { type: mime });
      } else {
        // Percent-encoding can expand input by up to 3x. Reject oversized
        // encoded payloads before decodeURIComponent allocates a large string.
        if (payload.length > MAX_TTS_AUDIO_BYTES * 3) {
          logger.warn("[TTS] Cached URI payload exceeds size limit");
          return;
        }
        let decoded: string;
        try {
          decoded = decodeURIComponent(payload);
        } catch {
          logger.warn("[TTS] Cached data URL is malformed");
          return;
        }
        const bytes = new TextEncoder().encode(decoded);
        if (bytes.byteLength > MAX_TTS_AUDIO_BYTES) {
          logger.warn("[TTS] Cached data URL exceeds size limit");
          return;
        }
        blob = new Blob([bytes], { type: mime });
      }
    } else {
      const response = await firewalledFetch(result.url, {
        signal: opts?.signal,
      });
      if (!response.ok) {
        await cancelResponseBody(response);
        return;
      }
      blob = await readBoundedAudioBlob(response, opts?.signal);
    }
    if (opts?.signal?.aborted) {return;}
    downloadBlob(blob, `bookmarkforge-tts-${lang}-${Date.now()}.wav`);
  }

  async clearCache(): Promise<void> {
    await audioCache.clear();
  }

  getPlaybackState(): { isPlaying: boolean; isPaused: boolean } {
    return { isPlaying: this.isPlaying, isPaused: this.isPaused };
  }
}

export const ttsService = new TTSService();
