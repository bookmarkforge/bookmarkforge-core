import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { TTSService as TTSClass } from "../../\.\./services/ai/TTSService";

const mockGetProviderInfo = vi.hoisted(() => vi.fn());
const mockGetApiKey = vi.hoisted(() => vi.fn().mockReturnValue(null));
vi.mock("../../\.\./services/ai/ProviderManager", () => ({
  aiManager: { getProviderInfo: mockGetProviderInfo, getApiKey: mockGetApiKey },
}));

vi.mock("../../\.\./services/ai/aiSession", () => ({
  fetchWithAiSession: async (
    request: (options: RequestInit) => Promise<Response>,
    options: RequestInit,
  ) => request(options),
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

const { TTSService } = await import("../../\.\./services/ai/TTSService");

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

    it("uses gemini when API key has AIza prefix (routes via backend)", async () => {
      mockGetApiKey.mockReturnValue("AIzaTest123");
      mockGetProviderInfo.mockReturnValue({ provider: "gemini" });

      (globalThis.fetch as any).mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          audioBase64: "data:audio/wav;base64,base64audio",
        }),
      });

      const result = await service.generateAudio("hello", "en", undefined, {
        isPrivate: false,
      });
      expect(result?.provider).toBe("gemini");
      expect(result?.url).toBe("data:audio/wav;base64,base64audio");
    });

    it("returns webspeech when gemini backend returns no audio", async () => {
      mockGetApiKey.mockReturnValue("AIzaTest123");
      mockGetProviderInfo.mockReturnValue({ provider: "gemini" });

      (globalThis.fetch as any).mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({}),
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
});
