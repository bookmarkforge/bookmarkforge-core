import { describe, it, expect } from "vitest";
import {
  DEFAULT_PCM_STREAM_PARAMS,
  base64ToBytes,
  buildWavHeader,
  bytesToBase64,
  isPcmAudioMimeType,
  isPlayableAudioMimeType,
  parsePcmStreamParams,
  pcmBase64ToWavDataUrl,
  toPlayableAudioDataUrl,
} from "../../utils/audioFormat";

/**
 * Decode a data URL WITHOUT the module's own helpers — the assertions below
 * have to be able to disagree with the implementation, so they read the bytes
 * through a raw `atob` and a `DataView` of their own.
 */
function decodeDataUrl(dataUrl: string): {
  mimeType: string;
  bytes: Uint8Array;
} {
  const comma = dataUrl.indexOf(",");
  const meta = dataUrl.slice("data:".length, comma);
  const [mimeType, encoding] = meta.split(";");
  expect(encoding).toBe("base64");
  const binary = atob(dataUrl.slice(comma + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return { mimeType: mimeType!, bytes };
}

/** Read a chunk id / four-character tag as ASCII. */
function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

/** The 44-byte header fields, named after the RIFF specification. */
function readWavHeader(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    riffChunkId: ascii(bytes, 0, 4),
    riffChunkSize: view.getUint32(4, true),
    format: ascii(bytes, 8, 4),
    fmtChunkId: ascii(bytes, 12, 4),
    fmtChunkSize: view.getUint32(16, true),
    audioFormat: view.getUint16(20, true),
    channels: view.getUint16(22, true),
    sampleRate: view.getUint32(24, true),
    byteRate: view.getUint32(28, true),
    blockAlign: view.getUint16(32, true),
    bitsPerSample: view.getUint16(34, true),
    dataChunkId: ascii(bytes, 36, 4),
    dataChunkSize: view.getUint32(40, true),
  };
}

/** Encode bytes to base64 for building fixtures. */
function bytesToBase64Fixture(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

describe("buildWavHeader", () => {
  it("writes the canonical RIFF/WAVE layout for 24 kHz mono 16-bit PCM", () => {
    const header = buildWavHeader(0);
    expect(header.length).toBe(44);
    expect(readWavHeader(header)).toEqual({
      riffChunkId: "RIFF",
      riffChunkSize: 36, // 44-byte header + 0 data bytes, minus the 8 size/id bytes
      format: "WAVE",
      fmtChunkId: "fmt ",
      fmtChunkSize: 16,
      audioFormat: 1, // PCM, not a compressed codec
      channels: 1,
      sampleRate: 24000,
      byteRate: 48000, // 24000 Hz × 1 channel × 2 bytes
      blockAlign: 2,
      bitsPerSample: 16,
      dataChunkId: "data",
      dataChunkSize: 0,
    });
  });

  it("sizes the RIFF chunk as header + payload", () => {
    expect(readWavHeader(buildWavHeader(1000)).riffChunkSize).toBe(1036);
    expect(readWavHeader(buildWavHeader(1000)).dataChunkSize).toBe(1000);
  });

  it("derives byteRate and blockAlign from the stream parameters", () => {
    const header = buildWavHeader(480, {
      sampleRate: 48000,
      channels: 2,
      bitsPerSample: 16,
    });
    const fields = readWavHeader(header);
    expect(fields.sampleRate).toBe(48000);
    expect(fields.channels).toBe(2);
    expect(fields.blockAlign).toBe(4);
    expect(fields.byteRate).toBe(192000);
  });

  it("handles 8-bit samples, where blockAlign is one byte per channel", () => {
    const fields = readWavHeader(
      buildWavHeader(120, { sampleRate: 8000, channels: 1, bitsPerSample: 8 }),
    );
    expect(fields.bitsPerSample).toBe(8);
    expect(fields.blockAlign).toBe(1);
    expect(fields.byteRate).toBe(8000);
  });

  it("pads an odd-sized payload and counts the pad in the RIFF size only", () => {
    const fields = readWavHeader(buildWavHeader(5));
    // RIFF chunks are word-aligned: 44 + 5 data + 1 pad, minus the 8-byte prefix.
    expect(fields.riffChunkSize).toBe(42);
    // The `data` chunk keeps its true length — decoders read exactly this many
    // bytes and treat the pad as alignment, not as audio.
    expect(fields.dataChunkSize).toBe(5);
  });

  it("defaults to the documented Gemini stream when given no parameters", () => {
    expect(readWavHeader(buildWavHeader(2))).toMatchObject({
      sampleRate: DEFAULT_PCM_STREAM_PARAMS.sampleRate,
      channels: DEFAULT_PCM_STREAM_PARAMS.channels,
      bitsPerSample: DEFAULT_PCM_STREAM_PARAMS.bitsPerSample,
    });
  });

  it("rejects a byte length that cannot be a WAV payload", () => {
    expect(() => buildWavHeader(-1)).toThrow(/Invalid PCM byte length/);
    expect(() => buildWavHeader(Number.NaN)).toThrow(/Invalid PCM byte length/);
  });
});

describe("parsePcmStreamParams", () => {
  it("reads the rate Gemini declares alongside audio/L16", () => {
    expect(parsePcmStreamParams("audio/L16;codec=pcm;rate=24000")).toEqual({
      sampleRate: 24000,
      channels: 1,
      bitsPerSample: 16,
    });
  });

  it("accepts sampledRate spelled as sampleRate and a quoted value", () => {
    expect(
      parsePcmStreamParams("audio/L16;sampleRate=44100;channels=2").sampleRate,
    ).toBe(44100);
    expect(parsePcmStreamParams('audio/pcm;rate="16000"').sampleRate).toBe(
      16000,
    );
  });

  it("derives the sample width from the L16/L24/L8 mime subtype", () => {
    expect(parsePcmStreamParams("audio/L8;rate=8000").bitsPerSample).toBe(8);
    expect(parsePcmStreamParams("audio/L16;rate=8000").bitsPerSample).toBe(16);
    expect(parsePcmStreamParams("audio/L24;rate=8000").bitsPerSample).toBe(24);
  });

  it("prefers an explicit bits parameter over the mime subtype", () => {
    expect(
      parsePcmStreamParams("audio/L16;bitsPerSample=24;rate=48000")
        .bitsPerSample,
    ).toBe(24);
  });

  it("falls back to the 24 kHz mono 16-bit default field by field", () => {
    expect(parsePcmStreamParams(undefined)).toEqual(DEFAULT_PCM_STREAM_PARAMS);
    expect(parsePcmStreamParams("audio/L16")).toEqual(
      DEFAULT_PCM_STREAM_PARAMS,
    );
  });

  it("rejects impossible values instead of emitting a corrupt header", () => {
    expect(parsePcmStreamParams("audio/L16;rate=0").sampleRate).toBe(24000);
    expect(parsePcmStreamParams("audio/L16;rate=9999999").sampleRate).toBe(
      24000,
    );
    expect(parsePcmStreamParams("audio/L16;channels=99").channels).toBe(1);
    expect(parsePcmStreamParams("audio/L16;bits=13").bitsPerSample).toBe(16);
  });
});

describe("mime type classification", () => {
  it("recognizes the raw-PCM labels Gemini uses", () => {
    expect(isPcmAudioMimeType("audio/L16;codec=pcm;rate=24000")).toBe(true);
    expect(isPcmAudioMimeType("audio/l16")).toBe(true);
    expect(isPcmAudioMimeType("audio/pcm")).toBe(true);
    expect(isPcmAudioMimeType("audio/L24;rate=48000")).toBe(true);
  });

  it("does not mistake a real container for raw PCM", () => {
    expect(isPcmAudioMimeType("audio/wav")).toBe(false);
    expect(isPcmAudioMimeType("audio/mpeg")).toBe(false);
    expect(isPcmAudioMimeType("audio/webm;codecs=opus")).toBe(false);
    expect(isPcmAudioMimeType(undefined)).toBe(false);
  });

  it("lists the containers a browser can play unaided", () => {
    expect(isPlayableAudioMimeType("audio/wav")).toBe(true);
    expect(isPlayableAudioMimeType("audio/mpeg")).toBe(true);
    expect(isPlayableAudioMimeType("audio/L16;rate=24000")).toBe(false);
  });
});

describe("base64 helpers", () => {
  it("round-trips arbitrary bytes", () => {
    const bytes = Uint8Array.from([0, 1, 127, 128, 254, 255]);
    expect(Array.from(base64ToBytes(bytesToBase64(bytes)))).toEqual(
      Array.from(bytes),
    );
  });

  it("round-trips a payload larger than one encoder chunk", () => {
    // 0x8000 is the chunk size the encoder uses; go past it so a missing chunk
    // loop (which would throw RangeError on String.fromCharCode) is caught.
    const bytes = new Uint8Array(0x8000 + 1234);
    for (let i = 0; i < bytes.length; i += 1) {bytes[i] = i % 251;}
    const decoded = base64ToBytes(bytesToBase64(bytes));
    expect(decoded.length).toBe(bytes.length);
    expect(decoded[0x8000]).toBe(bytes[0x8000]);
    expect(decoded[decoded.length - 1]).toBe(bytes[bytes.length - 1]);
  });

  it("tolerates whitespace but rejects a payload it cannot decode", () => {
    const bytes = Uint8Array.from([1, 2, 3]);
    const encoded = bytesToBase64(bytes);
    const wrapped = `${encoded.slice(0, 2)}\n  ${encoded.slice(2)}`;
    expect(Array.from(base64ToBytes(wrapped))).toEqual([1, 2, 3]);
    expect(() => base64ToBytes("not base64!!")).toThrow(/Invalid base64/);
    expect(() => base64ToBytes("   ")).toThrow(/Empty audio payload|Invalid base64/);
  });
});

describe("pcmBase64ToWavDataUrl", () => {
  it("prepends the header and keeps every PCM byte intact", () => {
    const pcm = Uint8Array.from([10, 20, 30, 40, 50, 60]);
    const url = pcmBase64ToWavDataUrl(
      bytesToBase64Fixture(pcm),
      "audio/L16;codec=pcm;rate=24000",
    );
    const { mimeType, bytes } = decodeDataUrl(url);

    expect(mimeType).toBe("audio/wav");
    expect(bytes.length).toBe(44 + pcm.length);
    expect(Array.from(bytes.subarray(44))).toEqual(Array.from(pcm));
    expect(readWavHeader(bytes)).toMatchObject({
      riffChunkId: "RIFF",
      format: "WAVE",
      dataChunkId: "data",
      sampleRate: 24000,
      channels: 1,
      bitsPerSample: 16,
      dataChunkSize: pcm.length,
      riffChunkSize: 36 + pcm.length,
    });
  });

  it("pads the payload so its length stays even across the whole file", () => {
    const url = pcmBase64ToWavDataUrl(
      bytesToBase64Fixture(Uint8Array.from([1, 2, 3, 4, 5])),
      "audio/L8;rate=8000",
    );
    const { bytes } = decodeDataUrl(url);
    expect(bytes.length).toBe(44 + 5 + 1);
    expect(bytes[bytes.length - 1]).toBe(0);
    expect(readWavHeader(bytes).dataChunkSize).toBe(5);
  });

  it("honours the stream parameters declared in the mime type", () => {
    const url = pcmBase64ToWavDataUrl(
      bytesToBase64Fixture(new Uint8Array(200)),
      "audio/L16;rate=48000;channels=2",
    );
    expect(readWavHeader(decodeDataUrl(url).bytes)).toMatchObject({
      sampleRate: 48000,
      channels: 2,
      blockAlign: 4,
      byteRate: 192000,
    });
  });
});

describe("toPlayableAudioDataUrl", () => {
  it("converts a raw-PCM payload into a WAV container", () => {
    const pcm = Uint8Array.from([7, 7, 7, 7]);
    const url = toPlayableAudioDataUrl(
      bytesToBase64Fixture(pcm),
      "audio/L16;codec=pcm;rate=24000",
    );
    const { mimeType, bytes } = decodeDataUrl(url);
    expect(mimeType).toBe("audio/wav");
    expect(ascii(bytes, 0, 4)).toBe("RIFF");
    expect(Array.from(bytes.subarray(44))).toEqual([7, 7, 7, 7]);
  });

  it("passes an existing data URL through untouched", () => {
    const already = "data:audio/mpeg;base64,QUJD";
    expect(toPlayableAudioDataUrl(already, "audio/L16;rate=24000")).toBe(
      already,
    );
  });

  it("labels a container the browser can play with its own mime type", () => {
    expect(toPlayableAudioDataUrl("QUJD", "audio/mpeg")).toBe(
      "data:audio/mpeg;base64,QUJD",
    );
    // No header is added: an mp3 payload must stay byte-identical.
    expect(toPlayableAudioDataUrl("QUJD", "audio/ogg;codecs=opus")).toBe(
      "data:audio/ogg;base64,QUJD",
    );
  });

  it("keeps the bytes and the audio/wav fallback when no mime type is given", () => {
    expect(toPlayableAudioDataUrl("QUJD")).toBe(
      "data:audio/wav;base64,QUJD",
    );
    expect(toPlayableAudioDataUrl("QUJD", "application/octet-stream")).toBe(
      "data:audio/wav;base64,QUJD",
    );
  });

  it("refuses an empty payload instead of emitting a silent data URL", () => {
    expect(() => toPlayableAudioDataUrl("")).toThrow(/Empty audio payload/);
  });
});
