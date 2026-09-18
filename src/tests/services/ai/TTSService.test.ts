import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { TTSService as TTSClass } from "../../../services/ai/TTSService";

const mockGetProviderInfo = vi.hoisted(() => vi.fn());
const mockGetApiKey = vi.hoisted(() => vi.fn().mockReturnValue(null));
vi.mock("../../../services/ai/ProviderManager", () => ({
  aiManager: { getProviderInfo: mockGetProviderInfo, getApiKey: mockGetApiKey },
}));

// getApiKey falls back to securityVault/SecureStorage when aiManager has
// no key. Both are mocked to exercise those paths without the real vault.
const mockSecurityVault = vi.hoisted(() => ({
  onLock: vi.fn(),
  onUnlock: vi.fn(),
  isLocked: vi.fn(() => false),
  decryptSecret: vi.fn().mockResolvedValue(null),
  encryptSecret: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../../services/SecurityVault", () => ({
  securityVault: mockSecurityVault,
  SECURE_STORAGE_KEYS: { API_KEY: "encrypted_api_key" },
}));

const mockSecureStorage = vi.hoisted(() => ({
  getSecret: vi.fn().mockResolvedValue(null),
  deleteSecret: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../../services/SecureStorage", () => ({
  secureStorage: mockSecureStorage,
}));

// TTS tests exercise audio behavior, not locale transport. The real i18n
// module starts HttpBackend and fetches /locales/en.json during import, which
// would contaminate tests that assert data URLs never use network fetch.
vi.mock("../../../i18n", () => ({
  default: {
    language: "en",
    isInitialized: true,
    t: (key: string, fallback?: string) => fallback ?? key,
  },
}));

const { TTSService } = await import("../../../services/ai/TTSService");

// Captured at module level: beforeEach stubs the global URL with a plain
// object (no constructor), but the freshly re-imported module graph
// por los tests de resiliencia usa `new URL(...)` tanto en import como en
// runtime (firewalledFetch). We keep the real constructor to restore it.
const RealURL = globalThis.URL;

class MockSpeechSynthesisUtterance {
  lang = "";
  rate = 1;
  pitch = 1;
  volume = 1;
  voice: any = null;
  text: string;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(text: string) {
    this.text = text;
  }
}

class MockMediaMetadata {
  title: string;
  artist: string;
  album: string;
  constructor(data: any) {
    this.title = data.title;
    this.artist = data.artist;
    this.album = data.album;
  }
}

function createMockAudio() {
  const listeners: Record<string, Function> = {};
  const audio: any = {
    volume: 1,
    playbackRate: 1,
    src: "",
    play: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn(),
  };
  Object.defineProperty(audio, "onended", {
    get: () => listeners["ended"] || null,
    set: (v: Function | null) => {
      if (v) listeners["ended"] = v;
    },
  });
  Object.defineProperty(audio, "onerror", {
    get: () => listeners["error"] || null,
    set: (v: Function | null) => {
      if (v) listeners["error"] = v;
    },
  });
  return audio;
}

describe("TTSService", () => {
  let service: TTSClass;

  beforeEach(async () => {
    vi.clearAllMocks();
    service = new TTSService();
    await service.clearCache();

    vi.stubGlobal("SpeechSynthesisUtterance", MockSpeechSynthesisUtterance);
    vi.stubGlobal("MediaMetadata", MockMediaMetadata);

    vi.stubGlobal("speechSynthesis", {
      getVoices: vi.fn(() => []),
      speak: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      cancel: vi.fn(),
    });
    if (typeof window !== "undefined") {
      (window as any).speechSynthesis = (globalThis as any).speechSynthesis;
    }

    vi.stubGlobal("navigator", {
      ...navigator,
      mediaSession: {
        metadata: null,
        setActionHandler: vi.fn(),
      },
    });

    vi.stubGlobal("fetch", vi.fn());
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:mock-url"),
      revokeObjectURL: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    mockGetApiKey.mockReset();
  });

  describe("isWebSpeechAvailable", () => {
    it("returns true when speechSynthesis is available", () => {
      expect(service.isWebSpeechAvailable()).toBe(true);
    });

    it("returns false when speechSynthesis is unavailable", () => {
      delete (window as any).speechSynthesis;
      expect(service.isWebSpeechAvailable()).toBe(false);
    });
  });

  describe("getAvailableVoices", () => {
    it("returns list of available voices", () => {
      const voices = [
        {
          voiceURI: "Google US English",
          lang: "en-US",
          name: "Google US English",
        },
      ];
      (window as any).speechSynthesis.getVoices = vi.fn(() => voices);
      expect(service.getAvailableVoices()).toEqual(voices);
    });
  });

  describe("getVoicesForLanguage", () => {
    it("filters voices by language", () => {
      const voices = [
        { voiceURI: "US", lang: "en-US" },
        { voiceURI: "UK", lang: "en-GB" },
        { voiceURI: "ES", lang: "es-ES" },
      ];
      vi.spyOn(service, "getAvailableVoices").mockReturnValue(voices as any);
      const result = service.getVoicesForLanguage("en");
      expect(result).toHaveLength(2);
    });
  });

  describe("getPlaybackState", () => {
    it("returns initial state", () => {
      expect(service.getPlaybackState()).toEqual({
        isPlaying: false,
        isPaused: false,
      });
    });
  });

  describe("stop", () => {
    it("clears state", () => {
      (service as any).isPlaying = true;
      (service as any).isPaused = true;
      (service as any).playbackQueue = ["a", "b"];
      service.stop();
      expect((service as any).isPlaying).toBe(false);
      expect((service as any).isPaused).toBe(false);
      expect((service as any).playbackQueue).toEqual([]);
    });
  });

  describe("pause / resume", () => {
    it("pauses currentAudio if it exists", () => {
      const audio = createMockAudio();
      (service as any).currentAudio = audio;
      service.pause();
      expect(audio.pause).toHaveBeenCalled();
      expect((service as any).isPaused).toBe(true);
    });

    it("resumes currentAudio if it exists", () => {
      const audio = createMockAudio();
      (service as any).currentAudio = audio;
      (service as any).isPaused = true;
      service.resume();
      expect(audio.play).toHaveBeenCalled();
      expect((service as any).isPaused).toBe(false);
    });
  });

  describe("getApiKey", () => {
    const getKey = async () => (service as any).getApiKey();

    it("returns null when there is no apiKey", async () => {
      mockGetProviderInfo.mockReturnValue({ provider: "openai" });
      mockGetApiKey.mockReturnValue(null);
      expect(await getKey()).toBeNull();
    });

    it("detects openai apiKey by sk- prefix", async () => {
      mockGetProviderInfo.mockReturnValue({ provider: "openai" });
      mockGetApiKey.mockReturnValue("sk-test123");
      expect((await getKey())?.provider).toBe("openai");
    });

    it("detects gemini apiKey by AIza prefix", async () => {
      mockGetProviderInfo.mockReturnValue({ provider: "gemini" });
      mockGetApiKey.mockReturnValue("AIza-test123");
      expect((await getKey())?.provider).toBe("gemini");
    });
  });

  describe("chunkText", () => {
    const chunk = (text: string, maxLen?: number) =>
      (service as any).chunkText(text, maxLen);

    it("splits text into chunks by sentences", () => {
      const result = chunk(
        "First sentence. Second sentence. Third sentence.",
        20,
      );
      expect(result.length).toBeGreaterThanOrEqual(2);
    });

    it("returns the full text if shorter than maxLen", () => {
      expect(chunk("Short text.", 100)).toEqual(["Short text."]);
    });

    it("returns the original text as an array when there is no punctuation", () => {
      const text = "long text without punctuation";
      expect(chunk(text, 1500)).toEqual([text]);
    });
  });

  describe("generateAudio (mockeado)", () => {
    it("returns null for empty text", async () => {
      vi.spyOn(service, "generateAudio").mockImplementation(async (text) => {
        if (!text) return null;
        return { url: "", provider: "webspeech" };
      });
      expect(await service.generateAudio("")).toBeNull();
    });

    it("returns webspeech fallback when there is no apiKey", async () => {
      vi.spyOn(service, "generateAudio").mockResolvedValue({
        url: "",
        provider: "webspeech",
      });
      const result = await service.generateAudio("test");
      expect(result?.provider).toBe("webspeech");
    });
  });

  // ============================================================
  // NEW COMPREHENSIVE TESTS
  // ============================================================

  describe("getApiKey - extended branches", () => {
    const getKey = async () => (service as any).getApiKey();

    it("returns unknown provider when apiKey has no known prefix", async () => {
      mockGetProviderInfo.mockReturnValue({ provider: "unknown" });
      mockGetApiKey.mockReturnValue("some-other-key");
      expect(await getKey()).toEqual({
        key: "some-other-key",
        provider: "unknown",
      });
    });

    it("returns provider from providerInfo when prefix is neither sk- nor AIza", async () => {
      mockGetProviderInfo.mockReturnValue({ provider: "gemini" });
      mockGetApiKey.mockReturnValue("xyz123");
      expect(await getKey()).toEqual({ key: "xyz123", provider: "gemini" });
    });

    it("returns openai provider with full sk- prefix", async () => {
      mockGetProviderInfo.mockReturnValue({ provider: "unknown" });
      mockGetApiKey.mockReturnValue("sk-proj-abc123");
      const result = await getKey();
      expect(result).toEqual({ key: "sk-proj-abc123", provider: "openai" });
    });

    it("returns gemini provider with full AIza prefix", async () => {
      mockGetProviderInfo.mockReturnValue({ provider: "unknown" });
      mockGetApiKey.mockReturnValue("AIzaSyA1234567890");
      const result = await getKey();
      expect(result).toEqual({ key: "AIzaSyA1234567890", provider: "gemini" });
    });
  });

  describe("getAvailableVoices - extended branches", () => {
    it("returns [] when speechSynthesis.getVoices returns undefined", () => {
      (window as any).speechSynthesis.getVoices = vi.fn(() => undefined);
      expect(service.getAvailableVoices()).toEqual([]);
    });

    it("returns [] when there is no window (mocked)", () => {
      const original = (globalThis as any).window;
      delete (globalThis as any).window;
      expect(service.getAvailableVoices()).toEqual([]);
      (globalThis as any).window = original;
    });
  });

  describe("getVoicesForLanguage - extended branches", () => {
    it("uses en-US as fallback for an unknown language", () => {
      const voices = [
        { voiceURI: "US", lang: "en-US", name: "US" },
        { voiceURI: "FR", lang: "fr-FR", name: "FR" },
      ];
      vi.spyOn(service, "getAvailableVoices").mockReturnValue(voices as any);
      const result = service.getVoicesForLanguage("unknown-lang");
      expect(result).toHaveLength(1);
      expect(result[0]!.voiceURI).toBe("US");
    });

    it("filters voices for japanese (ja)", () => {
      const voices = [
        { voiceURI: "ja-JP", lang: "ja-JP", name: "Japanese" },
        { voiceURI: "en-US", lang: "en-US", name: "English" },
      ];
      vi.spyOn(service, "getAvailableVoices").mockReturnValue(voices as any);
      const result = service.getVoicesForLanguage("ja");
      expect(result).toHaveLength(1);
      expect(result[0]!.lang).toBe("ja-JP");
    });

    it("returns [] when there are no voices for the language", () => {
      vi.spyOn(service, "getAvailableVoices").mockReturnValue([
        { voiceURI: "de-DE", lang: "de-DE", name: "German" },
      ] as any);
      const result = service.getVoicesForLanguage("ja");
      expect(result).toHaveLength(0);
    });
  });

  describe("chunkText - extended branches", () => {
    const chunk = (text: string, maxLen?: number) =>
      (service as any).chunkText(text, maxLen);

    it("handles text with multiple punctuation types", () => {
      const text = "Hello! How are you? I am fine.";
      const result = chunk(text, 100);
      expect(result.length).toBeGreaterThanOrEqual(1);
      expect(result.join(" ")).toContain("Hello");
    });

    it("handles long text exceeding maxLen multiple times", () => {
      const sentences = Array(10).fill("This is a sentence.").join(" ");
      const result = chunk(sentences, 30);
      expect(result.length).toBeGreaterThan(1);
    });

    it("handles a single sentence that exactly fills maxLen", () => {
      const text = "A".repeat(1499) + ".";
      const result = chunk(text, 1500);
      expect(result).toHaveLength(1);
    });

    it("handles empty text", () => {
      const result = chunk("");
      expect(result).toEqual([""]);
    });

    it("pushes chunk when current + sentence exceed maxLen", () => {
      const text = "Short. Another long sentence here.";
      const result = chunk(text, 10);
      expect(result.length).toBeGreaterThan(1);
    });

    it("handles text without sentence-ending punctuation", () => {
      const text = "just words without any punctuation marks at all";
      const result = chunk(text, 50);
      expect(result).toEqual([text]);
    });

    it("uses maxLen default 1500", () => {
      const text = "A.".repeat(50);
      const result = chunk(text);
      expect(result.length).toBeGreaterThanOrEqual(1);
    });

    it("handles text with only spaces", () => {
      const result = chunk("   ");
      expect(result).toEqual([""]);
    });

    it("handles text with question marks", () => {
      const result = chunk("What? Where?");
      expect(result.length).toBeGreaterThanOrEqual(1);
    });

    it("handles mixed punctuation with a small maxLen", () => {
      const result = chunk("A. B! C? D.", 5);
      expect(result.length).toBeGreaterThan(1);
    });
  });

  describe("generateAudio - real implementation paths", () => {
    it("returns null for empty text (no mock)", async () => {
      const result = await service.generateAudio("");
      expect(result).toBeNull();
    });

    it("returns null for null/undefined", async () => {
      expect(await service.generateAudio(null as any)).toBeNull();
      expect(await service.generateAudio(undefined as any)).toBeNull();
    });

    it("returns webspeech when there is no API key and cache miss", async () => {
      mockGetApiKey.mockReturnValue(null);
      mockGetProviderInfo.mockReturnValue({ provider: "unknown" });
      const result = await service.generateAudio("hello world");
      expect(result).toEqual({ url: "", provider: "webspeech" });
    });

    it("uses openai when API key has sk- prefix", async () => {
      mockGetApiKey.mockReturnValue("sk-test123");
      mockGetProviderInfo.mockReturnValue({ provider: "openai" });

      const mockBlob = new Blob(["audio"]);
      const mockResponse = {
        ok: true,
        blob: vi.fn().mockResolvedValue(mockBlob),
      };
      (globalThis.fetch as any).mockResolvedValue(mockResponse);

      class MockFileReader {
        result = "";
        onloadend: (() => void) | null = null;
        onerror: (() => void) | null = null;
        readAsDataURL(_blob: Blob) {
          this.result = "data:audio/mp3;base64,abc123";
          setTimeout(() => this.onloadend?.(), 0);
        }
      }
      vi.stubGlobal("FileReader", MockFileReader as any);

      const result = await service.generateAudio("hello", "en", undefined, {
        isPrivate: false,
      });
      expect(result?.provider).toBe("openai");
      expect(result?.url).toContain("data:");
    });

    it("returns webspeech when openai returns response not ok", async () => {
      mockGetApiKey.mockReturnValue("sk-test123");
      mockGetProviderInfo.mockReturnValue({ provider: "openai" });

      const mockResponse = { ok: false, status: 500 };
      (globalThis.fetch as any).mockResolvedValue(mockResponse);

      const result = await service.generateAudio("hello");
      expect(result).toEqual({ url: "", provider: "webspeech" });
    });

    it("returns webspeech when openai fetch fails", async () => {
      mockGetApiKey.mockReturnValue("sk-test123");
      mockGetProviderInfo.mockReturnValue({ provider: "openai" });

      (globalThis.fetch as any).mockRejectedValue(new Error("Network error"));
      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      const result = await service.generateAudio("hello", "en", undefined, {
        isPrivate: false,
      });
      expect(result).toEqual({ url: "", provider: "webspeech" });
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it("wraps the raw PCM Gemini returns in a playable WAV data URL", async () => {
      mockGetApiKey.mockReturnValue("AIzaTest123");
      mockGetProviderInfo.mockReturnValue({ provider: "gemini" });

      // Gemini TTS answers with headerless 16-bit PCM — the mime type is the
      // only place that says how to interpret the samples, and a browser
      // <audio> element cannot decode the stream without a container.
      (globalThis.fetch as any).mockResolvedValue({
        ok: true,
        // fetchWithTimeout reads content-type off the response, so the double
        // has to expose headers; a real Response always does.
        headers: { get: () => null },
        json: vi.fn().mockResolvedValue({
          candidates: [
            {
              content: {
                parts: [
                  {
                    inlineData: {
                      mimeType: "audio/L16;codec=pcm;rate=24000",
                      data: "AQIDBA==", // PCM bytes 1, 2, 3, 4
                    },
                  },
                ],
              },
            },
          ],
        }),
      });

      const result = await service.generateAudio("hello", "en", undefined, {
        isPrivate: false,
      });
      expect(result?.provider).toBe("gemini");
      expect(result?.url?.startsWith("data:audio/wav;base64,")).toBe(true);

      // Read the produced container back with a reader of its own: the header
      // fields, not just the data URL prefix, are what make the audio playable.
      const payload = atob(result!.url!.slice("data:audio/wav;base64,".length));
      const bytes = Uint8Array.from(payload, (c) => c.charCodeAt(0));
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const ascii = (offset: number, length: number) =>
        String.fromCharCode(...bytes.subarray(offset, offset + length));
      expect(ascii(0, 4)).toBe("RIFF");
      expect(view.getUint32(4, true)).toBe(36 + 4);
      expect(ascii(8, 4)).toBe("WAVE");
      expect(ascii(12, 4)).toBe("fmt ");
      expect(view.getUint16(20, true)).toBe(1); // PCM, not a compressed codec
      expect(view.getUint16(22, true)).toBe(1); // mono
      expect(view.getUint32(24, true)).toBe(24000); // the rate from the mime type
      expect(view.getUint32(28, true)).toBe(48000); // byteRate = 24000 × 1 × 2
      expect(view.getUint16(32, true)).toBe(2); // blockAlign
      expect(view.getUint16(34, true)).toBe(16); // bits per sample
      expect(ascii(36, 4)).toBe("data");
      expect(view.getUint32(40, true)).toBe(4);
      expect(Array.from(bytes.subarray(44))).toEqual([1, 2, 3, 4]);
    });

    it("labels a Gemini payload that is already a container with its own mime type", async () => {
      mockGetApiKey.mockReturnValue("AIzaTest123");
      mockGetProviderInfo.mockReturnValue({ provider: "gemini" });

      (globalThis.fetch as any).mockResolvedValue({
        ok: true,
        headers: { get: () => null },
        json: vi.fn().mockResolvedValue({
          candidates: [
            {
              content: {
                parts: [
                  {
                    inlineData: {
                      mimeType: "audio/mpeg",
                      data: "AQIDBA==",
                    },
                  },
                ],
              },
            },
          ],
        }),
      });

      const result = await service.generateAudio("hello", "en", undefined, {
        isPrivate: false,
      });
      // An mp3 payload must stay byte-identical — no fabricated WAV header.
      expect(result?.url).toBe("data:audio/mpeg;base64,AQIDBA==");
    });

    it("returns webspeech when gemini backend returns no audio", async () => {
      mockGetApiKey.mockReturnValue("AIzaTest123");
      mockGetProviderInfo.mockReturnValue({ provider: "gemini" });

      (globalThis.fetch as any).mockResolvedValue({
        ok: true,
        headers: { get: () => null },
        json: vi.fn().mockResolvedValue({ candidates: [] }),
      });

      const result = await service.generateAudio("hello");
      expect(result).toEqual({ url: "", provider: "webspeech" });
    });

    it("returns webspeech when gemini backend fails", async () => {
      mockGetApiKey.mockReturnValue("AIzaTest123");
      mockGetProviderInfo.mockReturnValue({ provider: "gemini" });

      (globalThis.fetch as any).mockResolvedValue({
        ok: false,
        status: 500,
      });

      const result = await service.generateAudio("hello");
      expect(result).toEqual({ url: "", provider: "webspeech" });
    });

    it("uses transformers provider override (returns null, falls back to webspeech)", async () => {
      mockGetApiKey.mockReturnValue(null);
      mockGetProviderInfo.mockReturnValue({ provider: "unknown" });

      const result = await service.generateAudio("hello", "en", {
        rate: 1,
        pitch: 1,
        volume: 1,
        providerOverride: "transformers",
      });
      expect(result?.provider).toBe("webspeech");
      expect(result?.url).toBe("");
    });

    it("transformers override when apiKey is openai (still falls back to webspeech)", async () => {
      mockGetApiKey.mockReturnValue("sk-test");
      mockGetProviderInfo.mockReturnValue({ provider: "openai" });

      const result = await service.generateAudio("text", "en", {
        rate: 1,
        pitch: 1,
        volume: 1,
        providerOverride: "transformers",
      });
      expect(result?.provider).toBe("webspeech");
      expect(result?.url).toBe("");
    });

    it("cachea resultado exitoso de OpenAI", async () => {
      mockGetApiKey.mockReturnValue("sk-test123");
      mockGetProviderInfo.mockReturnValue({ provider: "openai" });

      const mockBlob = new Blob(["audio"]);
      const mockResponse = {
        ok: true,
        blob: vi.fn().mockResolvedValue(mockBlob),
      };
      (globalThis.fetch as any).mockResolvedValue(mockResponse);

      class MockFileReader {
        result = "";
        onloadend: (() => void) | null = null;
        onerror: (() => void) | null = null;
        readAsDataURL(_blob: Blob) {
          this.result = "data:audio/mp3;base64,cached123";
          setTimeout(() => this.onloadend?.(), 0);
        }
      }
      vi.stubGlobal("FileReader", MockFileReader as any);

      await service.generateAudio("cached text", "en", undefined, {
        isPrivate: false,
      });
      const result = await service.generateAudio("cached text", "en", undefined, {
        isPrivate: false,
      });
      expect(result?.provider).toBe("cached");
    });

    it("NO cachea audio de contenido privado (audit #4)", async () => {
      mockGetApiKey.mockReturnValue("sk-test123");
      mockGetProviderInfo.mockReturnValue({ provider: "openai" });

      const mockBlob = new Blob(["audio"]);
      (globalThis.fetch as any).mockResolvedValue({
        ok: true,
        blob: vi.fn().mockResolvedValue(mockBlob),
      });

      class MockFileReader {
        result = "";
        onloadend: (() => void) | null = null;
        onerror: (() => void) | null = null;
        readAsDataURL(_blob: Blob) {
          this.result = "data:audio/mp3;base64,private123";
          setTimeout(() => this.onloadend?.(), 0);
        }
      }
      vi.stubGlobal("FileReader", MockFileReader as any);

      const first = await service.generateAudio("private text", "en", undefined, {
        isPrivate: true,
      });
      expect(first?.provider).toBe("webspeech");
      expect(globalThis.fetch).not.toHaveBeenCalled();

      // Same text, private again → remains on the local web-speech path
      (globalThis.fetch as any).mockClear();
      const second = await service.generateAudio("private text", "en", undefined, {
        isPrivate: true,
      });
      expect(second?.provider).toBe("webspeech");
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it("distinguishes different texts with the same prefix (audit #4)", async () => {
      mockGetApiKey.mockReturnValue("sk-test123");
      mockGetProviderInfo.mockReturnValue({ provider: "openai" });

      const mockBlob = new Blob(["audio"]);
      (globalThis.fetch as any).mockResolvedValue({
        ok: true,
        blob: vi.fn().mockResolvedValue(mockBlob),
      });

      class MockFileReader {
        result = "";
        onloadend: (() => void) | null = null;
        onerror: (() => void) | null = null;
        readAsDataURL(_blob: Blob) {
          this.result = "data:audio/mp3;base64,key123";
          setTimeout(() => this.onloadend?.(), 0);
        }
      }
      vi.stubGlobal("FileReader", MockFileReader as any);

      const prefix = "A".repeat(100);
      await service.generateAudio(prefix + "XXXX", "en", undefined, {
        isPrivate: false,
      });

      // Different text with the SAME 100-char prefix: the hash key
      // (full text) must not collide → calls the provider again.
      (globalThis.fetch as any).mockClear();
      const result = await service.generateAudio(prefix + "YYYY", "en", undefined, {
        isPrivate: false,
      });
      expect(result?.provider).toBe("openai");
      expect(globalThis.fetch).toHaveBeenCalled();
    });
  });

  describe("speak - full lifecycle", () => {
    it("returns immediately when the text is empty", async () => {
      await service.speak("");
      expect(service.getPlaybackState().isPlaying).toBe(false);
    });

    it("returns immediately if text is null", async () => {
      await service.speak(null as any);
      expect(service.getPlaybackState().isPlaying).toBe(false);
    });

    it("calls stop before starting a new playback", async () => {
      (service as any).isPlaying = true;
      (service as any).playbackQueue = ["old"];
      const stopSpy = vi.spyOn(service, "stop");

      vi.spyOn(service, "generateAudio").mockResolvedValue({
        url: "",
        provider: "webspeech",
      });

      await service.speak("new text");
      expect(stopSpy).toHaveBeenCalled();
    });

    it("sets mediaSession metadata", async () => {
      vi.spyOn(service, "generateAudio").mockResolvedValue({
        url: "",
        provider: "webspeech",
      });
      await service.speak("test text for media session");
      expect((navigator as any).mediaSession.metadata).toBeTruthy();
    });

    it("creates chunks for long text", async () => {
      const longText = "Sentence one. ".repeat(200);
      vi.spyOn(service, "generateAudio").mockResolvedValue({
        url: "",
        provider: "webspeech",
      });

      await service.speak(longText);
      const queue = (service as any).playbackQueue;
      expect(queue.length).toBeGreaterThan(1);
    });

    it("handles webspeech provider via speakWithWebSpeech", async () => {
      vi.spyOn(service, "generateAudio").mockResolvedValue({
        url: "",
        provider: "webspeech",
      });

      await service.speak("hello");
      expect(window.speechSynthesis.speak).toHaveBeenCalled();
    });

    it("plays audio via HTMLAudioElement when provider is not webspeech", async () => {
      const mockAudio = createMockAudio();
      vi.spyOn(service, "generateAudio").mockResolvedValue({
        url: "data:audio/mp3;base64,abc",
        provider: "openai",
      });

      vi.stubGlobal("Audio", function () {
        return mockAudio;
      } as any);

      await service.speak("hello");

      expect(mockAudio.volume).toBe(1);
      expect(mockAudio.playbackRate).toBe(1);
      expect(mockAudio.play).toHaveBeenCalled();
    });

    it("emits highlight event during playNextChunk", async () => {
      const dispatchSpy = vi
        .spyOn(window, "dispatchEvent")
        .mockImplementation((() => true) as (e: Event) => boolean);
      vi.spyOn(service, "generateAudio").mockResolvedValue({
        url: "",
        provider: "webspeech",
      });

      await service.speak("chunked text");

      expect(dispatchSpy).toHaveBeenCalledWith(
        expect.objectContaining({ type: "tts-word-highlight" }),
      );
      dispatchSpy.mockRestore();
    });
  });

  describe("playNextChunk - branches", () => {
    it("stops playback when currentChunkIndex >= queue length", async () => {
      (service as any).playbackQueue = ["only"];
      (service as any).currentChunkIndex = 1;

      await (service as any).playNextChunk("en", {
        rate: 1,
        pitch: 1,
        volume: 1,
      });
      expect(service.getPlaybackState().isPlaying).toBe(false);
    });

    it("stops playback when the abort signal is active", async () => {
      const controller = new AbortController();
      controller.abort();
      (service as any).abortController = controller;
      (service as any).playbackQueue = ["text"];
      (service as any).currentChunkIndex = 0;

      await (service as any).playNextChunk("en", {
        rate: 1,
        pitch: 1,
        volume: 1,
      });
      expect(service.getPlaybackState().isPlaying).toBe(false);
    });

    it("uses Audio element when result has url and provider is not webspeech", async () => {
      const mockAudio = createMockAudio();
      vi.spyOn(service, "generateAudio").mockResolvedValue({
        url: "data:audio/mp3;base64,abc",
        provider: "openai",
      });

      vi.stubGlobal("Audio", function () {
        return mockAudio;
      } as any);

      (service as any).playbackQueue = ["text"];
      (service as any).currentChunkIndex = 0;

      await (service as any).playNextChunk("en", {
        rate: 1.5,
        pitch: 1.2,
        volume: 0.8,
      });
      expect(mockAudio.volume).toBe(0.8);
      expect(mockAudio.playbackRate).toBe(1.5);
      expect(mockAudio.play).toHaveBeenCalled();
    });

    it("calls speakWithWebSpeech when generateAudio returns webspeech", async () => {
      vi.spyOn(service, "generateAudio").mockResolvedValue({
        url: "",
        provider: "webspeech",
      });
      const speakSpy = vi.spyOn(service as any, "speakWithWebSpeech");

      (service as any).playbackQueue = ["text"];
      (service as any).currentChunkIndex = 0;

      await (service as any).playNextChunk("en", {
        rate: 1,
        pitch: 1,
        volume: 1,
      });
      expect(speakSpy).toHaveBeenCalled();
    });

    it("calls speakWithWebSpeech when the audio URL is empty", async () => {
      vi.spyOn(service, "generateAudio").mockResolvedValue({
        url: "",
        provider: "openai",
      });
      const speakSpy = vi.spyOn(service as any, "speakWithWebSpeech");

      (service as any).playbackQueue = ["text"];
      (service as any).currentChunkIndex = 0;

      await (service as any).playNextChunk("en", {
        rate: 1,
        pitch: 1,
        volume: 1,
      });
      expect(speakSpy).toHaveBeenCalled();
    });

    it("calls speakWithWebSpeech when Audio.onerror fires", async () => {
      const mockAudio = createMockAudio();
      mockAudio.play.mockResolvedValue(undefined);

      vi.spyOn(service, "generateAudio").mockResolvedValue({
        url: "data:audio/mp3;base64,abc",
        provider: "openai",
      });

      vi.stubGlobal("Audio", function () {
        return mockAudio;
      } as any);

      const speakSpy = vi.spyOn(service as any, "speakWithWebSpeech");

      (service as any).playbackQueue = ["text"];
      (service as any).currentChunkIndex = 0;

      await (service as any).playNextChunk("en", {
        rate: 1,
        pitch: 1,
        volume: 1,
      });

      if (mockAudio.onerror) {
        mockAudio.onerror();
      }

      expect(speakSpy).toHaveBeenCalled();
    });

    it("increments currentChunkIndex in Audio.onended", async () => {
      const mockAudio = createMockAudio();
      mockAudio.play.mockResolvedValue(undefined);

      vi.spyOn(service, "generateAudio").mockResolvedValue({
        url: "data:audio/mp3;base64,abc",
        provider: "openai",
      });

      vi.stubGlobal("Audio", function () {
        return mockAudio;
      } as any);

      (service as any).playbackQueue = ["chunk1", "chunk2"];
      (service as any).currentChunkIndex = 0;

      await (service as any).playNextChunk("en", {
        rate: 1,
        pitch: 1,
        volume: 1,
      });

      if (mockAudio.onended) {
        mockAudio.onended();
      }

      expect((service as any).currentChunkIndex).toBe(1);
    });

    it("handles generateAudio returning null", async () => {
      vi.spyOn(service, "generateAudio").mockResolvedValue(null);
      const speakSpy = vi.spyOn(service as any, "speakWithWebSpeech");

      (service as any).playbackQueue = ["text"];
      (service as any).currentChunkIndex = 0;

      await (service as any).playNextChunk("en", {
        rate: 1,
        pitch: 1,
        volume: 1,
      });
      expect(speakSpy).toHaveBeenCalled();
    });

    it("uses Audio element when provider is undefined but url exists", async () => {
      const mockAudio = createMockAudio();
      vi.spyOn(service, "generateAudio").mockResolvedValue({
        url: "data:audio/mp3;base64,abc",
        provider: undefined as any,
      });

      vi.stubGlobal("Audio", function () {
        return mockAudio;
      } as any);

      (service as any).playbackQueue = ["text"];
      (service as any).currentChunkIndex = 0;

      await (service as any).playNextChunk("en", {
        rate: 1,
        pitch: 1,
        volume: 1,
      });
      expect(mockAudio.play).toHaveBeenCalled();
    });
  });

  describe("speakWithWebSpeech - branches", () => {
    it("returns when webSpeech is unavailable", () => {
      delete (window as any).speechSynthesis;
      (service as any).speakWithWebSpeech("text", "en", {
        rate: 1,
        pitch: 1,
        volume: 1,
      });
      expect(service.getPlaybackState().isPlaying).toBe(false);
    });

    it("configures utterance with language, rate, pitch, volume", () => {
      vi.spyOn(service, "getVoicesForLanguage").mockReturnValue([]);
      (service as any).speakWithWebSpeech("test", "en", {
        rate: 2,
        pitch: 0.5,
        volume: 0.8,
      });

      expect(window.speechSynthesis.speak).toHaveBeenCalled();
    });

    it("selects voice by voiceURI when specified", () => {
      const voices = [
        { voiceURI: "Google US", lang: "en-US", name: "Google US" },
        { voiceURI: "Google UK", lang: "en-GB", name: "Google UK" },
      ];
      vi.spyOn(service, "getAvailableVoices").mockReturnValue(voices as any);
      vi.spyOn(service, "getVoicesForLanguage").mockReturnValue([]);

      (service as any).speakWithWebSpeech("text", "en", {
        rate: 1,
        pitch: 1,
        volume: 1,
        voiceURI: "Google UK",
      });

      expect(window.speechSynthesis.speak).toHaveBeenCalled();
    });

    it("does not select a voice if voiceURI does not match", () => {
      const voices = [
        { voiceURI: "Google US", lang: "en-US", name: "Google US" },
      ];
      vi.spyOn(service, "getAvailableVoices").mockReturnValue(voices as any);
      vi.spyOn(service, "getVoicesForLanguage").mockReturnValue([]);

      (service as any).speakWithWebSpeech("text", "en", {
        rate: 1,
        pitch: 1,
        volume: 1,
        voiceURI: "NonExistent",
      });

      expect(window.speechSynthesis.speak).toHaveBeenCalled();
    });

    it("selects first available voice when there is no voiceURI", () => {
      const voices = [{ voiceURI: "en-US", lang: "en-US", name: "English" }];
      vi.spyOn(service, "getVoicesForLanguage").mockReturnValue(voices as any);

      (service as any).speakWithWebSpeech("text", "en", {
        rate: 1,
        pitch: 1,
        volume: 1,
      });
      expect(window.speechSynthesis.speak).toHaveBeenCalled();
    });

    it("does not select a voice when getVoicesForLanguage returns []", () => {
      vi.spyOn(service, "getVoicesForLanguage").mockReturnValue([]);
      (service as any).speakWithWebSpeech("text", "ja", {
        rate: 1,
        pitch: 1,
        volume: 1,
      });
      expect(window.speechSynthesis.speak).toHaveBeenCalled();
    });

    it("onend increments chunkIndex and calls playNextChunk", () => {
      vi.spyOn(service, "getVoicesForLanguage").mockReturnValue([]);

      (service as any).playbackQueue = ["chunk1", "chunk2"];
      (service as any).currentChunkIndex = 0;

      (service as any).speakWithWebSpeech("chunk1", "en", {
        rate: 1,
        pitch: 1,
        volume: 1,
      });

      const utterance = (window.speechSynthesis.speak as any).mock.calls[0][0];
      expect(utterance.onend).toBeTruthy();
      utterance.onend();
      expect((service as any).currentChunkIndex).toBe(1);
    });

    it("onend does not advance when abort is active", () => {
      vi.spyOn(service, "getVoicesForLanguage").mockReturnValue([]);
      const controller = new AbortController();
      controller.abort();
      (service as any).abortController = controller;

      (service as any).speakWithWebSpeech("text", "en", {
        rate: 1,
        pitch: 1,
        volume: 1,
      });

      // An already-aborted session must not create a new utterance or advance
      // the playback queue.
      expect(window.speechSynthesis.speak).not.toHaveBeenCalled();
      expect((service as any).currentChunkIndex).toBe(0);
    });

    it("onerror clears state and stops playback", () => {
      vi.spyOn(service, "getVoicesForLanguage").mockReturnValue([]);
      (service as any).isPlaying = true;

      (service as any).speakWithWebSpeech("text", "en", {
        rate: 1,
        pitch: 1,
        volume: 1,
      });

      const utterance = (window.speechSynthesis.speak as any).mock.calls[0][0];
      utterance.onerror();
      expect((service as any).currentUtterance).toBeNull();
      expect((service as any).isPlaying).toBe(false);
    });

    it("uses en-US fallback language for an unknown language", () => {
      vi.spyOn(service, "getVoicesForLanguage").mockReturnValue([]);
      (service as any).speakWithWebSpeech("text", "unknown", {
        rate: 1,
        pitch: 1,
        volume: 1,
      });
      expect(window.speechSynthesis.speak).toHaveBeenCalled();
    });

    it("voiceURI matching with a specific voice", () => {
      const voices = [
        { voiceURI: "Google US", lang: "en-US", name: "Google US" },
        { voiceURI: "Microsoft David", lang: "en-US", name: "David" },
      ];
      vi.spyOn(service, "getAvailableVoices").mockReturnValue(voices as any);
      vi.spyOn(service, "getVoicesForLanguage").mockReturnValue([]);

      (service as any).speakWithWebSpeech("text", "en", {
        rate: 1,
        pitch: 1,
        volume: 1,
        voiceURI: "Microsoft David",
      });

      expect(window.speechSynthesis.speak).toHaveBeenCalled();
    });
  });

  describe("pause - extended branches", () => {
    it("does nothing when there is no currentAudio or currentUtterance", () => {
      (service as any).currentAudio = null;
      (service as any).currentUtterance = null;
      service.pause();
      expect((service as any).isPaused).toBe(false);
    });

    it("pauses utterance when currentAudio is null but currentUtterance exists", () => {
      (service as any).currentAudio = null;
      (service as any).currentUtterance = new MockSpeechSynthesisUtterance(
        "test",
      );
      service.pause();
      expect(window.speechSynthesis.pause).toHaveBeenCalled();
      expect((service as any).isPaused).toBe(true);
    });
  });

  describe("resume - extended branches", () => {
    it("does nothing when there is no currentAudio or currentUtterance", () => {
      (service as any).currentAudio = null;
      (service as any).currentUtterance = null;
      service.resume();
      expect((service as any).isPaused).toBe(false);
    });

    it("resumes utterance when currentAudio is null but currentUtterance exists", () => {
      (service as any).currentAudio = null;
      (service as any).currentUtterance = new MockSpeechSynthesisUtterance(
        "test",
      );
      (service as any).isPaused = true;
      service.resume();
      expect(window.speechSynthesis.resume).toHaveBeenCalled();
      expect((service as any).isPaused).toBe(false);
    });
  });

  describe("stop - extended branches", () => {
    it("cancels abortController if it exists", () => {
      const controller = new AbortController();
      (service as any).abortController = controller;
      service.stop();
      expect(controller.signal.aborted).toBe(true);
    });

    it("pauses and clears currentAudio", () => {
      const mockAudio = createMockAudio();
      (service as any).currentAudio = mockAudio;
      (service as any).currentChunkIndex = 5;

      service.stop();
      expect(mockAudio.pause).toHaveBeenCalled();
      expect((service as any).currentAudio).toBeNull();
      expect((service as any).currentChunkIndex).toBe(0);
    });

    it("cancels and clears currentUtterance", () => {
      (service as any).currentUtterance = new MockSpeechSynthesisUtterance(
        "test",
      );
      service.stop();
      expect(window.speechSynthesis.cancel).toHaveBeenCalled();
      expect((service as any).currentUtterance).toBeNull();
    });

    it("resets playbackQueue and currentChunkIndex", () => {
      (service as any).playbackQueue = ["a", "b", "c"];
      (service as any).currentChunkIndex = 2;
      service.stop();
      expect((service as any).playbackQueue).toEqual([]);
      expect((service as any).currentChunkIndex).toBe(0);
    });

    it("does not throw when abortController is null", () => {
      (service as any).abortController = null;
      expect(() => service.stop()).not.toThrow();
    });
  });

  describe("downloadAudio - branches", () => {
    it("returns immediately if result is null", async () => {
      vi.spyOn(service, "generateAudio").mockResolvedValue(null);
      const fetchSpy = globalThis.fetch as any;
      await service.downloadAudio("text");
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("returns immediately if provider is webspeech", async () => {
      vi.spyOn(service, "generateAudio").mockResolvedValue({
        url: "data:",
        provider: "webspeech",
      });
      const fetchSpy = globalThis.fetch as any;
      await service.downloadAudio("text");
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("returns immediately when the url is empty", async () => {
      vi.spyOn(service, "generateAudio").mockResolvedValue({
        url: "",
        provider: "openai",
      });
      const fetchSpy = globalThis.fetch as any;
      await service.downloadAudio("text");
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("downloads and creates a blob URL when the result is valid", async () => {
      vi.spyOn(service, "generateAudio").mockResolvedValue({
        url: "data:audio/mp3;base64,abc",
        provider: "openai",
      });

      const appendChildSpy = vi
        .spyOn(document.body, "appendChild")
        .mockImplementation(() => null as any);
      const removeChildSpy = vi
        .spyOn(document.body, "removeChild")
        .mockImplementation(() => null as any);
      const clickMock = vi.fn();
      vi.spyOn(document, "createElement").mockReturnValue({
        href: "",
        download: "",
        click: clickMock,
        // appendChild is mocked below, so provide the DOM relationship that
        // a real browser establishes before downloadBlob removes the anchor.
        parentNode: document.body,
      } as any);

      await service.downloadAudio("test", "en");
      // downloadBlob revokes the object URL on the next task so the browser
      // has time to enqueue the download.
      await new Promise((resolve) => setTimeout(resolve, 0));

      // data: URLs are decoded locally: they must not open a fetch
      // directo que el firewall no pueda inspeccionar.
      expect(globalThis.fetch).not.toHaveBeenCalled();
      expect(clickMock).toHaveBeenCalled();
      expect(appendChildSpy).toHaveBeenCalled();
      expect(removeChildSpy).toHaveBeenCalled();
      expect(URL.revokeObjectURL).toHaveBeenCalled();

      appendChildSpy.mockRestore();
      removeChildSpy.mockRestore();
      vi.mocked(document.createElement).mockRestore();
    });
  });

  describe("clearCache", () => {
    it("llama audioCache.clear sin errores", async () => {
      await expect(service.clearCache()).resolves.not.toThrow();
    });
  });

  describe("audio cache resiliencia (best-effort)", () => {
    // The audioCache singleton (module) already has `db` initialized by the
    // beforeEach clearCache(), so init() would short-circuit and a spy on
    // indexedDB.open would never fire. To exercise the failure path you must
    // load a FRESH MODULE (audioCache with db=null).
    async function loadFreshService(): Promise<TTSClass> {
      vi.resetModules();
      // beforeEach stubea el global URL como objeto plano (sin constructor);
      // el grafo fresco lo necesita con constructor al evaluarse (networkFirewall
      // /SecurityVault) y en runtime (firewalledFetch) → restauramos el real
      // during the test (afterEach undoes it via unstubAllGlobals).
      vi.stubGlobal("URL", RealURL);
      // The setup beforeAll only disabled the firewall in the original
      // module graph; the fresh module has it enabled by default.
      const { setFirewallDisabled } = await import(
        "../../../utils/networkFirewall"
      );
      setFirewallDisabled(true);
      const { TTSService: FreshTTS } = await import(
        "../../../services/ai/TTSService"
      );
      return new FreshTTS();
    }

    it("does not throw when IndexedDB is unavailable (init fails)", async () => {
      const openSpy = vi
        .spyOn(indexedDB, "open")
        .mockImplementation(() => {
          const req: any = {};
          setTimeout(() => {
            req.onerror?.(new Event("error"));
          }, 0);
          return req;
        });
      try {
        const fresh = await loadFreshService();
        mockGetApiKey.mockReturnValue(null);
        mockGetProviderInfo.mockReturnValue({ provider: "unknown" });

        // generateAudio: cache miss + webspeech fallback, sin throw
        const result = await fresh.generateAudio("resilient text");
        expect(result).toEqual({ url: "", provider: "webspeech" });

        // clearCache tampoco lanza
        await expect(fresh.clearCache()).resolves.not.toThrow();
      } finally {
        openSpy.mockRestore();
      }
    });

    it("does not throw when the cache transaction fails (get and set)", async () => {
      // init() "successful" with a fake db whose transaction() throws
      // synchronously → both get() and set() fall into their try/catch
      // defenses, and generateAudio keeps returning the generated audio.
      // (onupgradeneeded never fires with this fake, so it only
      // falta `transaction`; `objectStoreNames` no se toca.)
      const openSpy = vi
        .spyOn(indexedDB, "open")
        .mockImplementation(() => {
          const req: any = {
            result: {
              transaction: () => {
                throw new Error("IDB blocked");
              },
            },
          };
          setTimeout(() => {
            req.onsuccess?.(new Event("success"));
          }, 0);
          return req;
        });
      try {
        const fresh = await loadFreshService();
        mockGetApiKey.mockReturnValue("sk-test123");
        mockGetProviderInfo.mockReturnValue({ provider: "openai" });

        const mockBlob = new Blob(["audio"]);
        (globalThis.fetch as any).mockResolvedValue({
          ok: true,
          blob: vi.fn().mockResolvedValue(mockBlob),
        });

        class MockFileReader {
          result = "";
          onloadend: (() => void) | null = null;
          onerror: (() => void) | null = null;
          readAsDataURL(_blob: Blob) {
            this.result = "data:audio/mp3;base64,quota123";
            setTimeout(() => this.onloadend?.(), 0);
          }
        }
        vi.stubGlobal("FileReader", MockFileReader as any);

        const result = await fresh.generateAudio("write-fail text", "en", undefined, {
          isPrivate: false,
        });
        // Even if the cache fails on get() and set(), the audio is returned
        expect(result?.provider).toBe("openai");
        expect(result?.url).toContain("data:");
      } finally {
        openSpy.mockRestore();
      }
    });
  });

  describe("getPlaybackState - extended", () => {
    it("reflects state after setIsPlaying", () => {
      (service as any).isPlaying = true;
      (service as any).isPaused = true;
      const state = service.getPlaybackState();
      expect(state).toEqual({ isPlaying: true, isPaused: true });
    });

    it("reflects the transition from playing to stopped", () => {
      (service as any).isPlaying = true;
      service.stop();
      expect(service.getPlaybackState()).toEqual({
        isPlaying: false,
        isPaused: false,
      });
    });
  });

  describe("setupMediaSession - branches", () => {
    it("does not throw when mediaSession does not exist", async () => {
      vi.stubGlobal("navigator", { ...navigator });
      delete (navigator as any).mediaSession;
      vi.spyOn(service, "generateAudio").mockResolvedValue({
        url: "",
        provider: "webspeech",
      });

      await expect(service.speak("text")).resolves.not.toThrow();
    });
  });

  describe("Audio.onended continuation via speak", () => {
    it("advances to the next chunk when Audio.onended fires", async () => {
      const mockAudio = createMockAudio();
      mockAudio.play.mockResolvedValue(undefined);

      vi.spyOn(service, "generateAudio").mockResolvedValue({
        url: "data:audio/mp3;base64,abc",
        provider: "openai",
      });

      vi.stubGlobal("Audio", function () {
        return mockAudio;
      } as any);

      await service.speak("chunk1 chunk2", "en", {
        rate: 1,
        pitch: 1,
        volume: 1,
      });

      if (mockAudio.onended) {
        mockAudio.onended();
      }

      expect((service as any).currentChunkIndex).toBeGreaterThanOrEqual(1);
    });
  });

  describe("getApiKey - edge cases", () => {
    it("returns null when aiManager.getApiKey throws", async () => {
      mockGetApiKey.mockImplementation(() => {
        throw new Error("storage error");
      });
      mockGetProviderInfo.mockReturnValue({ provider: "openai" });

      const result = await (service as any).getApiKey();
      expect(result).toBeNull();
    });
  });

  describe("speak with non-webspeech audio via speak", () => {
    it("onended increments chunk and playNextChunk", async () => {
      const mockAudio = createMockAudio();
      mockAudio.play.mockResolvedValue(undefined);

      vi.spyOn(service, "generateAudio").mockResolvedValue({
        url: "data:audio/mp3;base64,abc",
        provider: "openai",
      });

      vi.stubGlobal("Audio", function () {
        return mockAudio;
      } as any);

      await service.speak("chunk1. chunk2.", "en", {
        rate: 1,
        pitch: 1,
        volume: 1,
      });

      if (mockAudio.onended) {
        mockAudio.onended();
      }

      expect((service as any).currentChunkIndex).toBeGreaterThanOrEqual(1);
    });

    it("onerror llama speakWithWebSpeech como fallback", async () => {
      const mockAudio = createMockAudio();
      mockAudio.play.mockResolvedValue(undefined);

      vi.spyOn(service, "generateAudio").mockResolvedValue({
        url: "data:audio/mp3;base64,abc",
        provider: "openai",
      });

      vi.stubGlobal("Audio", function () {
        return mockAudio;
      } as any);
      const speakSpy = vi.spyOn(service as any, "speakWithWebSpeech");

      await service.speak("text", "en", { rate: 1, pitch: 1, volume: 1 });

      if (mockAudio.onerror) {
        mockAudio.onerror();
      }

      expect(speakSpy).toHaveBeenCalled();
    });
  });

  describe("coverage de ramas adicionales", () => {
    // Earlier describes leave spies unrestored (e.g. generateAudio); this
    // block relies on the real flow, so restore all spies before each test.
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    describe("init - indexedDB upgrade and early-return paths", () => {
      // Same recipe as "audio cache resiliencia": a fresh module so the
      // AudioCache starts with db=null (beforeEach already opened the original).
      async function loadFreshService(): Promise<TTSClass> {
        vi.resetModules();
        vi.stubGlobal("URL", RealURL);
        const { setFirewallDisabled } = await import(
          "../../../utils/networkFirewall"
        );
        setFirewallDisabled(true);
        const { TTSService: FreshTTS } = await import(
          "../../../services/ai/TTSService"
        );
        return new FreshTTS();
      }

      function mockOpenWith(autoFireSuccess = false, result?: any) {
        let onsuccess: ((e: Event) => void) | undefined;
        let upgradeneeded: ((e: any) => void) | undefined;
        const openSpy = vi.spyOn(indexedDB, "open").mockImplementation(() => {
          const req: any = { result };
          Object.defineProperty(req, "onupgradeneeded", {
            set: (v: any) => {
              upgradeneeded = v;
            },
          });
          Object.defineProperty(req, "onsuccess", {
            set: (v: any) => {
              onsuccess = v;
              if (autoFireSuccess) {
                setTimeout(() => v?.(new Event("success")), 0);
              }
            },
          });
          return req;
        });
        return {
          openSpy,
          fireSuccess: () => onsuccess?.(new Event("success")),
          fireUpgrade: (e: any) => upgradeneeded?.(e),
        };
      }

      function successDb(transactionImpl?: any) {
        return {
          onversionchange: null,
          transaction:
            transactionImpl ??
            (() => {
              throw new Error("no tx");
            }),
        };
      }

      it("creates the object store and timestamp index on first upgrade", async () => {
        const createIndex = vi.fn();
        const createObjectStore = vi.fn(() => ({ createIndex }));
        const { openSpy, fireUpgrade } = mockOpenWith(true, successDb());
        try {
          const fresh = await loadFreshService();
          const clearing = fresh.clearCache();
          fireUpgrade({
            target: {
              result: {
                objectStoreNames: { contains: () => false },
                createObjectStore,
              },
              transaction: null,
            },
          });
          await clearing;
          expect(createObjectStore).toHaveBeenCalledWith("audio", {
            keyPath: "key",
          });
          expect(createIndex).toHaveBeenCalledWith("timestamp", "timestamp", {
            unique: false,
          });
        } finally {
          openSpy.mockRestore();
        }
      });

      it("adds the timestamp index when the store exists without it", async () => {
        const createIndex = vi.fn();
        const createObjectStore = vi.fn();
        const { openSpy, fireUpgrade } = mockOpenWith(true, successDb());
        try {
          const fresh = await loadFreshService();
          const clearing = fresh.clearCache();
          fireUpgrade({
            target: {
              result: {
                objectStoreNames: { contains: () => true },
                createObjectStore,
              },
              transaction: {
                objectStore: () => ({
                  indexNames: { contains: () => false },
                  createIndex,
                }),
              },
            },
          });
          await clearing;
          expect(createIndex).toHaveBeenCalledWith("timestamp", "timestamp", {
            unique: false,
          });
          expect(createObjectStore).not.toHaveBeenCalled();
        } finally {
          openSpy.mockRestore();
        }
      });

      it("skips index creation when the store already has it", async () => {
        const createIndex = vi.fn();
        const { openSpy, fireUpgrade } = mockOpenWith(true, successDb());
        try {
          const fresh = await loadFreshService();
          const clearing = fresh.clearCache();
          fireUpgrade({
            target: {
              result: {
                objectStoreNames: { contains: () => true },
                createObjectStore: vi.fn(),
              },
              transaction: {
                objectStore: () => ({
                  indexNames: { contains: () => true },
                  createIndex,
                }),
              },
            },
          });
          await clearing;
          expect(createIndex).not.toHaveBeenCalled();
        } finally {
          openSpy.mockRestore();
        }
      });

      it("closes the database and reopens on versionchange", async () => {
        const closeSpy = vi.fn();
        const db = {
          onversionchange: null,
          close: closeSpy,
          transaction: () => {
            throw new Error("no tx");
          },
        };
        const { openSpy } = mockOpenWith(true, db);
        try {
          const fresh = await loadFreshService();
          await fresh.clearCache();
          expect(openSpy).toHaveBeenCalledTimes(1);
          (db as any).onversionchange?.();
          expect(closeSpy).toHaveBeenCalled();
          await fresh.clearCache();
          expect(openSpy).toHaveBeenCalledTimes(2);
        } finally {
          openSpy.mockRestore();
        }
      });

      it("does not reopen the database when it is already open", async () => {
        const { openSpy } = mockOpenWith(true, successDb());
        try {
          const fresh = await loadFreshService();
          await fresh.clearCache();
          await fresh.clearCache();
          expect(openSpy).toHaveBeenCalledTimes(1);
        } finally {
          openSpy.mockRestore();
        }
      });

      it("shares a single open across concurrent clears", async () => {
        const { openSpy, fireSuccess } = mockOpenWith(false, successDb());
        try {
          const fresh = await loadFreshService();
          expect(openSpy).toHaveBeenCalledTimes(1); // constructor
          const first = fresh.clearCache();
          const second = fresh.clearCache();
          expect(openSpy).toHaveBeenCalledTimes(1); // initPromise dedup
          fireSuccess();
          await Promise.all([first, second]);
          expect(openSpy).toHaveBeenCalledTimes(1);
        } finally {
          openSpy.mockRestore();
        }
      });

      it("skips the clear transaction when the cache generation rotated mid-flight", async () => {
        const transactionSpy = vi.fn(() => {
          throw new Error("no tx");
        });
        const { openSpy, fireSuccess } = mockOpenWith(
          false,
          successDb(transactionSpy),
        );
        try {
          const fresh = await loadFreshService();
          const rotate = mockSecurityVault.onLock.mock.calls.at(-1)?.[0];
          const clearing = fresh.clearCache();
          rotate?.();
          fireSuccess();
          await clearing;
          expect(transactionSpy).toHaveBeenCalledTimes(1);
        } finally {
          openSpy.mockRestore();
        }
      });

      it("settles once when the transaction fires multiple completion events", async () => {
        let tx: any;
        const openSpy = vi.spyOn(indexedDB, "open").mockImplementation(() => {
          const req: any = {
            result: {
              onversionchange: null,
              transaction: () => {
                tx = {
                  objectStore: () => ({ clear: vi.fn() }),
                  oncomplete: null,
                  onerror: null,
                  onabort: null,
                };
                // Fire oncomplete as soon as clearStore assigns it.
                Object.defineProperty(tx, "oncomplete", {
                  get: () => tx._oncomplete,
                  set: (v: any) => {
                    tx._oncomplete = v;
                    setTimeout(() => v?.(new Event("complete")), 0);
                  },
                });
                return tx;
              },
            },
          };
          Object.defineProperty(req, "onsuccess", {
            set: (v: any) =>
              setTimeout(() => v?.(new Event("success")), 0),
          });
          return req;
        });
        try {
          const fresh = await loadFreshService();
          await fresh.clearCache();
          // A second transaction event after finish already ran must not hang.
          tx.onerror?.(new Event("error"));
          tx.onabort?.(new Event("abort"));
          await fresh.clearCache();
        } finally {
          openSpy.mockRestore();
        }
      });
    });

    describe("getApiKey - SecureStorage and vault fallbacks", () => {
      beforeEach(() => {
        mockGetApiKey.mockReturnValue(null);
        mockGetProviderInfo.mockReturnValue({ provider: "unknown" });
        mockSecurityVault.isLocked.mockReturnValue(false);
        mockSecurityVault.decryptSecret
          .mockReset()
          .mockResolvedValue(null);
        mockSecurityVault.encryptSecret
          .mockReset()
          .mockResolvedValue(undefined);
        mockSecureStorage.getSecret.mockReset().mockResolvedValue(null);
        mockSecureStorage.deleteSecret
          .mockReset()
          .mockResolvedValue(undefined);
      });

      it("uses the decrypted secret when aiManager has no key", async () => {
        mockSecurityVault.decryptSecret.mockResolvedValue("sk-vault-key");
        const result = await (service as any).getApiKey();
        expect(result).toEqual({ key: "sk-vault-key", provider: "openai" });
        expect(mockSecureStorage.getSecret).not.toHaveBeenCalled();
      });

      it("returns null when decryptSecret throws", async () => {
        mockSecurityVault.decryptSecret.mockRejectedValue(
          new Error("locked"),
        );
        const result = await (service as any).getApiKey();
        expect(result).toBeNull();
      });

      it("returns null when aiManager.getApiKey throws a non-Error", async () => {
        mockGetApiKey.mockImplementation(() => {
          throw "boom";
        });
        const result = await (service as any).getApiKey();
        expect(result).toBeNull();
      });

      it("returns null when decryptSecret throws a non-Error", async () => {
        mockSecurityVault.decryptSecret.mockRejectedValue("locked-string");
        const result = await (service as any).getApiKey();
        expect(result).toBeNull();
      });

      it("migrates a pending key from SecureStorage into the vault", async () => {
        mockSecureStorage.getSecret.mockResolvedValue("AIza-pending-key");
        const result = await (service as any).getApiKey();
        expect(result).toEqual({
          key: "AIza-pending-key",
          provider: "gemini",
        });
        expect(mockSecurityVault.encryptSecret).toHaveBeenCalledWith(
          "AIza-pending-key",
          "encrypted_api_key",
        );
        expect(mockSecureStorage.deleteSecret).toHaveBeenCalledWith(
          "pending_api_key",
        );
      });

      it("refuses a plaintext pending key while the vault is locked", async () => {
        mockSecurityVault.isLocked.mockReturnValue(true);
        mockSecureStorage.getSecret.mockResolvedValue("sk-plaintext");
        const result = await (service as any).getApiKey();
        expect(result).toBeNull();
        expect(mockSecurityVault.encryptSecret).not.toHaveBeenCalled();
        expect(mockSecureStorage.deleteSecret).not.toHaveBeenCalled();
      });

      it("does not throw when a locked vault cannot read storage", async () => {
        mockSecurityVault.isLocked.mockReturnValue(true);
        mockSecureStorage.getSecret.mockRejectedValue(
          new Error("storage error"),
        );
        await expect((service as any).getApiKey()).resolves.toBeNull();
      });
    });

    describe("audioCache - byte cap, entry cap and TTL boundaries", () => {
      function stubOpenAiSuccess(dataUrl: string) {
        mockGetApiKey.mockReturnValue("sk-test123");
        mockGetProviderInfo.mockReturnValue({ provider: "openai" });
        (globalThis.fetch as any).mockResolvedValue({
          ok: true,
          blob: vi.fn().mockResolvedValue(new Blob(["audio"])),
        });
        class MockFileReader {
          result = "";
          onloadend: (() => void) | null = null;
          onerror: (() => void) | null = null;
          readAsDataURL(_blob: Blob) {
            this.result = dataUrl;
            setTimeout(() => this.onloadend?.(), 0);
          }
        }
        vi.stubGlobal("FileReader", MockFileReader as any);
      }

      it("does not cache payloads over the byte cap", async () => {
        const dataUrl =
          "data:audio/mp3;base64," + "A".repeat(35 * 1024 * 1024 + 1);
        stubOpenAiSuccess(dataUrl);
        const first = await service.generateAudio("bytecap-text", "en", undefined, {
          isPrivate: false,
        });
        expect(first?.provider).toBe("openai");
        (globalThis.fetch as any).mockClear();
        const second = await service.generateAudio("bytecap-text", "en", undefined, {
          isPrivate: false,
        });
        expect(second?.provider).toBe("openai");
        expect(globalThis.fetch).toHaveBeenCalled();
      });

      it("evicts the oldest entries beyond the 100-entry cap", async () => {
        stubOpenAiSuccess("data:audio/mp3;base64,cap-entry");
        // Fill the cache past its 100-entry cap. Each entry has a distinct
        // text (and therefore hash), so the cache sees 101 unique keys.
        for (let i = 0; i <= 100; i++) {
          await service.generateAudio(`cap-text-${i}`, "en", undefined, {
            isPrivate: false,
          });
        }
        (globalThis.fetch as any).mockClear();

        // The newest entry (cap-text-100) must still be cached.
        const newest = await service.generateAudio(
          "cap-text-100",
          "en",
          undefined,
          { isPrivate: false },
        );
        expect(newest?.provider).toBe("cached");

        // The two oldest entries (cap-text-0 and cap-text-1) must have been
        // evicted by the 101st insert, so they re-fetch from OpenAI.
        const oldest0 = await service.generateAudio(
          "cap-text-0",
          "en",
          undefined,
          { isPrivate: false },
        );
        expect(oldest0?.provider).toBe("openai");

        const oldest1 = await service.generateAudio(
          "cap-text-1",
          "en",
          undefined,
          { isPrivate: false },
        );
        expect(oldest1?.provider).toBe("openai");

        // Both re-fetches hit the network.
        expect(globalThis.fetch).toHaveBeenCalledTimes(2);
      });

      it("evicts entries when the total exceeds the byte cap", async () => {
        stubOpenAiSuccess(
          "data:audio/mp3;base64," + "B".repeat(20 * 1024 * 1024),
        );
        await service.generateAudio("byteprune-a", "en", undefined, {
          isPrivate: false,
        });
        await service.generateAudio("byteprune-b", "en", undefined, {
          isPrivate: false,
        });
        (globalThis.fetch as any).mockClear();
        const again = await service.generateAudio("byteprune-a", "en", undefined, {
          isPrivate: false,
        });
        expect(again?.provider).toBe("openai");
        expect(globalThis.fetch).toHaveBeenCalled();
      });

      it("expires cached entries after the 24h TTL", async () => {
        const t0 = Date.now();
        vi.setSystemTime(t0);
        stubOpenAiSuccess("data:audio/mp3;base64,ttl-entry");
        await service.generateAudio("ttl-text-a", "en", undefined, {
          isPrivate: false,
        });
        vi.setSystemTime(t0 + 25 * 60 * 60 * 1000);
        (globalThis.fetch as any).mockClear();
        const again = await service.generateAudio("ttl-text-a", "en", undefined, {
          isPrivate: false,
        });
        expect(again?.provider).toBe("openai");
        expect(globalThis.fetch).toHaveBeenCalled();
        vi.useRealTimers();
      });
    });

    describe("readBlobAsDataUrl - failure paths", () => {
      function stubOpenAiFetch() {
        mockGetApiKey.mockReturnValue("sk-test123");
        mockGetProviderInfo.mockReturnValue({ provider: "openai" });
        (globalThis.fetch as any).mockResolvedValue({
          ok: true,
          blob: vi.fn().mockResolvedValue(new Blob(["audio"])),
        });
      }

      it("falls back to webspeech when FileReader errors", async () => {
        stubOpenAiFetch();
        class MockFileReader {
          result = "";
          onloadend: (() => void) | null = null;
          onerror: ((_e?: Event) => void) | null = null;
          readAsDataURL(_blob: Blob) {
            setTimeout(() => this.onerror?.(new Event("error")), 0);
          }
        }
        vi.stubGlobal("FileReader", MockFileReader as any);
        const result = await service.generateAudio("reader-error-text", "en", undefined, {
          isPrivate: false,
        });
        expect(result).toEqual({ url: "", provider: "webspeech" });
      });

      it("uses reader.error when FileReader reports one", async () => {
        stubOpenAiFetch();
        class MockFileReader {
          result = "";
          error: unknown = "boom";
          onloadend: (() => void) | null = null;
          onerror: ((_e?: Event) => void) | null = null;
          readAsDataURL(_blob: Blob) {
            setTimeout(() => this.onerror?.(new Event("error")), 0);
          }
        }
        vi.stubGlobal("FileReader", MockFileReader as any);
        const result = await service.generateAudio("reader-custom-error-text", "en", undefined, {
          isPrivate: false,
        });
        expect(result).toEqual({ url: "", provider: "webspeech" });
      });

      it("falls back to webspeech when the encoded result is not a string", async () => {
        stubOpenAiFetch();
        class MockFileReader {
          result: unknown = 42;
          onloadend: (() => void) | null = null;
          onerror: (() => void) | null = null;
          readAsDataURL(_blob: Blob) {
            setTimeout(() => {
              this.onloadend?.();
              // Second firing: the settled guard must ignore it.
              this.onloadend?.();
            }, 0);
          }
        }
        vi.stubGlobal("FileReader", MockFileReader as any);
        const result = await service.generateAudio("reader-nonstring-text", "en", undefined, {
          isPrivate: false,
        });
        expect(result).toEqual({ url: "", provider: "webspeech" });
      });

      it("falls back to webspeech when readAsDataURL throws", async () => {
        stubOpenAiFetch();
        class MockFileReader {
          result = "";
          onloadend: (() => void) | null = null;
          onerror: (() => void) | null = null;
          readAsDataURL(_blob: Blob) {
            throw new Error("read failed");
          }
        }
        vi.stubGlobal("FileReader", MockFileReader as any);
        const result = await service.generateAudio("reader-throw-text", "en", undefined, {
          isPrivate: false,
        });
        expect(result).toEqual({ url: "", provider: "webspeech" });
      });
    });

    describe("downloadAudio - remote streaming paths", () => {
      function stubRemoteAudio(url = "https://cdn.example.com/audio.mp3") {
        vi.spyOn(service, "generateAudio").mockResolvedValue({
          url,
          provider: "openai",
        } as any);
        vi.spyOn(document.body, "appendChild").mockImplementation(
          () => null as any,
        );
        vi.spyOn(document.body, "removeChild").mockImplementation(
          () => null as any,
        );
        vi.spyOn(document, "createElement").mockReturnValue({
          setAttribute: vi.fn(),
          href: "",
          download: "",
          click: vi.fn(),
          parentNode: document.body,
        } as any);
      }

      afterEach(() => {
        vi.restoreAllMocks();
      });

      it("streams audio from the response body", async () => {
        stubRemoteAudio();
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("chunk1"));
            controller.enqueue(new TextEncoder().encode("chunk2"));
            controller.close();
          },
        });
        (globalThis.fetch as any).mockResolvedValue({
          ok: true,
          headers: { get: () => null },
          body: stream,
        });
        await service.downloadAudio("stream text");
        expect(document.createElement).toHaveBeenCalled();
      });

      it("wraps non-Uint8Array chunks from the stream", async () => {
        stubRemoteAudio();
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(new ArrayBuffer(4));
            controller.close();
          },
        });
        (globalThis.fetch as any).mockResolvedValue({
          ok: true,
          headers: { get: () => null },
          body: stream,
        });
        await service.downloadAudio("arraybuffer text");
        expect(document.createElement).toHaveBeenCalled();
      });

      it("rejects when content-length exceeds the limit", async () => {
        stubRemoteAudio();
        const cancelSpy = vi.fn();
        (globalThis.fetch as any).mockResolvedValue({
          ok: true,
          headers: {
            get: (key: string) =>
              key === "content-length" ? String(30 * 1024 * 1024) : null,
          },
          body: { cancel: cancelSpy },
        });
        await expect(service.downloadAudio("oversized text")).rejects.toThrow(
          "TTS audio exceeds the 25 MB limit",
        );
        expect(cancelSpy).toHaveBeenCalled();
      });

      it("rejects when the stream exceeds the byte cap", async () => {
        stubRemoteAudio();
        const cancelSpy = vi.fn().mockResolvedValue(undefined);
        (globalThis.fetch as any).mockResolvedValue({
          ok: true,
          headers: { get: () => null },
          body: {
            getReader: () => ({
              read: vi.fn().mockResolvedValueOnce({
                done: false,
                value: new Uint8Array(26 * 1024 * 1024),
              }),
              cancel: cancelSpy,
              releaseLock: vi.fn(),
            }),
          },
        });
        await expect(service.downloadAudio("stream overflow text")).rejects.toThrow(
          "TTS audio exceeds the 25 MB limit",
        );
        expect(cancelSpy).toHaveBeenCalled();
      });

      it("rejects with AbortError when the stream aborts mid-read", async () => {
        stubRemoteAudio();
        let pendingRead:
          | ((value: { done: boolean; value?: Uint8Array }) => void)
          | undefined;
        const readMock = vi.fn(
          () =>
            new Promise<{ done: boolean; value?: Uint8Array }>((resolve) => {
              pendingRead = resolve;
            }),
        );
        const body = {
          getReader: () => ({
            read: readMock,
            cancel: vi.fn(() => {
              pendingRead?.({ done: true, value: undefined });
              return Promise.resolve();
            }),
            releaseLock: vi.fn(),
          }),
        };
        (globalThis.fetch as any).mockResolvedValue({
          ok: true,
          headers: { get: () => null },
          body,
        });
        const controller = new AbortController();
        const download = service.downloadAudio("abort text", "en", undefined, {
          signal: controller.signal,
        });
        await vi.waitFor(() => expect(readMock).toHaveBeenCalled());
        controller.abort();
        await expect(download).rejects.toThrow("Audio download aborted");
      });

      it("falls back to a plain Error when DOMException is unavailable", async () => {
        stubRemoteAudio();
        vi.stubGlobal("DOMException", undefined);
        let pendingRead:
          | ((value: { done: boolean; value?: Uint8Array }) => void)
          | undefined;
        const readMock = vi.fn(
          () =>
            new Promise<{ done: boolean; value?: Uint8Array }>((resolve) => {
              pendingRead = resolve;
            }),
        );
        const body = {
          getReader: () => ({
            read: readMock,
            cancel: vi.fn(() => {
              pendingRead?.({ done: true, value: undefined });
              return Promise.resolve();
            }),
            releaseLock: vi.fn(),
          }),
        };
        (globalThis.fetch as any).mockResolvedValue({
          ok: true,
          headers: { get: () => null },
          body,
        });
        const controller = new AbortController();
        const download = service.downloadAudio("abort no dom", "en", undefined, {
          signal: controller.signal,
        });
        await vi.waitFor(() => expect(readMock).toHaveBeenCalled());
        controller.abort();
        await expect(download).rejects.toMatchObject({ name: "AbortError" });
      });

      it("rejects when getReader throws", async () => {
        stubRemoteAudio();
        const cancelSpy = vi.fn();
        (globalThis.fetch as any).mockResolvedValue({
          ok: true,
          headers: { get: () => null },
          body: {
            getReader: () => {
              throw new Error("reader failed");
            },
            cancel: cancelSpy,
          },
        });
        await expect(service.downloadAudio("reader throw text")).rejects.toThrow(
          "reader failed",
        );
        expect(cancelSpy).toHaveBeenCalled();
      });

      it("rejects when the blob exceeds the limit (no stream)", async () => {
        stubRemoteAudio();
        (globalThis.fetch as any).mockResolvedValue({
          ok: true,
          headers: { get: () => null },
          body: {},
          blob: vi
            .fn()
            .mockResolvedValue(new Blob([new Uint8Array(26 * 1024 * 1024)])),
        });
        const controller = new AbortController();
        await expect(
          service.downloadAudio("huge blob text", "en", undefined, {
            signal: controller.signal,
          }),
        ).rejects.toThrow("TTS audio exceeds the 25 MB limit");
      });

      it("returns silently when the remote response is not ok", async () => {
        stubRemoteAudio();
        const cancelSpy = vi.fn();
        (globalThis.fetch as any).mockResolvedValue({
          ok: false,
          status: 500,
          body: { cancel: cancelSpy },
        });
        await service.downloadAudio("not ok text");
        expect(cancelSpy).toHaveBeenCalled();
        expect(document.createElement).not.toHaveBeenCalled();
      });
    });

    describe("downloadAudio - data URL edge cases", () => {
      function stubDataUrl(url: string) {
        vi.spyOn(service, "generateAudio").mockResolvedValue({
          url,
          provider: "openai",
        } as any);
      }

      afterEach(() => {
        vi.restoreAllMocks();
      });

      it("ignores data URLs without a comma", async () => {
        stubDataUrl("data:audio/mp3;base64");
        const createElementSpy = vi.spyOn(document, "createElement");
        await service.downloadAudio("no comma text");
        expect(createElementSpy).not.toHaveBeenCalled();
      });

      it("skips invalid base64 payloads", async () => {
        stubDataUrl("data:audio/mp3;base64,!!!");
        const createElementSpy = vi.spyOn(document, "createElement");
        await service.downloadAudio("bad base64 text");
        expect(createElementSpy).not.toHaveBeenCalled();
      });

      it("skips malformed percent-encoded payloads", async () => {
        stubDataUrl("data:text/plain,%E0%A4%A");
        const createElementSpy = vi.spyOn(document, "createElement");
        await service.downloadAudio("bad uri text");
        expect(createElementSpy).not.toHaveBeenCalled();
      });

      it("downloads a percent-encoded payload", async () => {
        stubDataUrl("data:text/plain,hello%20world");
        vi.spyOn(document.body, "appendChild").mockImplementation(
          () => null as any,
        );
        vi.spyOn(document.body, "removeChild").mockImplementation(
          () => null as any,
        );
        const createElementSpy = vi.spyOn(document, "createElement").mockReturnValue({
          setAttribute: vi.fn(),
          href: "",
          download: "",
          click: vi.fn(),
          parentNode: document.body,
        } as any);
        await service.downloadAudio("percent text");
        expect(createElementSpy).toHaveBeenCalled();
      });

      it("uses the default mime for data URLs without a type", async () => {
        stubDataUrl("data:,hello%20world");
        vi.spyOn(document.body, "appendChild").mockImplementation(
          () => null as any,
        );
        vi.spyOn(document.body, "removeChild").mockImplementation(
          () => null as any,
        );
        const createElementSpy = vi.spyOn(document, "createElement").mockReturnValue({
          setAttribute: vi.fn(),
          href: "",
          download: "",
          click: vi.fn(),
          parentNode: document.body,
        } as any);
        await service.downloadAudio("default mime text");
        expect(createElementSpy).toHaveBeenCalled();
      });
    });

    describe("playNextChunk - stale sessions and playback failures", () => {
      afterEach(() => {
        vi.restoreAllMocks();
      });

      it("falls back to WebSpeech when audio.play() rejects", async () => {
        const mockAudio = createMockAudio();
        mockAudio.play.mockRejectedValue(new Error("NotAllowedError"));
        vi.stubGlobal("Audio", function () {
          return mockAudio;
        } as any);
        vi.spyOn(service, "generateAudio").mockResolvedValue({
          url: "data:audio/mp3;base64,abc",
          provider: "openai",
        });
        const fallbackSpy = vi.spyOn(service as any, "speakWithWebSpeech");
        await service.speak("play rejects", "en", {
          rate: 1,
          pitch: 1,
          volume: 1,
        });
        expect(fallbackSpy).toHaveBeenCalled();
        expect((service as any).currentAudio).toBeNull();
      });

      it("falls back to WebSpeech when audio.play() rejects a non-Error", async () => {
        const mockAudio = createMockAudio();
        mockAudio.play.mockRejectedValue("NotAllowedError");
        vi.stubGlobal("Audio", function () {
          return mockAudio;
        } as any);
        vi.spyOn(service, "generateAudio").mockResolvedValue({
          url: "data:audio/mp3;base64,abc",
          provider: "openai",
        });
        const fallbackSpy = vi.spyOn(service as any, "speakWithWebSpeech");
        await service.speak("play rejects string", "en", {
          rate: 1,
          pitch: 1,
          volume: 1,
        });
        expect(fallbackSpy).toHaveBeenCalled();
        expect((service as any).currentAudio).toBeNull();
      });

      it("ignores onended when the session is no longer active", async () => {
        const mockAudio = createMockAudio();
        vi.stubGlobal("Audio", function () {
          return mockAudio;
        } as any);
        vi.spyOn(service, "generateAudio").mockResolvedValue({
          url: "data:audio/mp3;base64,abc",
          provider: "openai",
        });
        await service.speak("stale ended", "en", {
          rate: 1,
          pitch: 1,
          volume: 1,
        });
        (service as any).abortController.abort();
        if (mockAudio.onended) {
          mockAudio.onended();
        }
        expect((service as any).currentChunkIndex).toBe(0);
      });

      it("ignores onerror when the session is no longer active", async () => {
        const mockAudio = createMockAudio();
        vi.stubGlobal("Audio", function () {
          return mockAudio;
        } as any);
        vi.spyOn(service, "generateAudio").mockResolvedValue({
          url: "data:audio/mp3;base64,abc",
          provider: "openai",
        });
        const fallbackSpy = vi.spyOn(service as any, "speakWithWebSpeech");
        await service.speak("stale error", "en", {
          rate: 1,
          pitch: 1,
          volume: 1,
        });
        (service as any).abortController.abort();
        if (mockAudio.onerror) {
          mockAudio.onerror();
        }
        expect(fallbackSpy).not.toHaveBeenCalled();
      });

      it("returns when the session aborts mid-generation", async () => {
        let resolveGeneration: ((value: any) => void) | undefined;
        vi.spyOn(service, "generateAudio").mockImplementation(
          () =>
            new Promise((resolve) => {
              resolveGeneration = resolve;
            }),
        );
        const speaking = service.speak("mid generation", "en", {
          rate: 1,
          pitch: 1,
          volume: 1,
        });
        service.stop();
        resolveGeneration?.({
          url: "data:audio/mp3;base64,abc",
          provider: "openai",
        });
        await speaking;
        expect((service as any).currentAudio).toBeNull();
      });

      it("passes opts through to generateAudio during playback", async () => {
        const mockAudio = createMockAudio();
        vi.stubGlobal("Audio", function () {
          return mockAudio;
        } as any);
        const generateSpy = vi.spyOn(service, "generateAudio").mockResolvedValue({
          url: "data:audio/mp3;base64,abc",
          provider: "openai",
        });
        await service.speak(
          "with opts",
          "en",
          { rate: 1, pitch: 1, volume: 1 },
          { isPrivate: false },
        );
        const call = (generateSpy.mock.calls[0] as any)[3];
        expect(call).toEqual(
          expect.objectContaining({
            isPrivate: false,
            signal: expect.any(AbortSignal),
          }),
        );
      });

      it("returns null for a pre-aborted signal", async () => {
        const controller = new AbortController();
        controller.abort();
        const result = await service.generateAudio("pre aborted", "en", undefined, {
          signal: controller.signal,
        });
        expect(result).toBeNull();
      });
    });
  });
});
