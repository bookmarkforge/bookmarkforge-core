/**
 * src/utils/audioFormat.ts — wrap provider audio bytes so an `<audio>` element
 * can actually decode them.
 *
 * Why this exists: the TTS providers do not agree on a wire format. OpenAI
 * returns a container the browser already understands (mp3), while Gemini's TTS
 * models return *raw* linear PCM — `inlineData.mimeType` looks like
 * `audio/L16;codec=pcm;rate=24000` and `inlineData.data` is the bare sample
 * stream, with no header saying where the samples start, how many channels
 * there are or how fast they play. Handing those bytes to `<audio src=...>`
 * fails to decode. This module adds the missing container (a 44-byte RIFF/WAVE
 * header for linear PCM) and returns a data URL, which is the shape every TTS
 * call site consumes.
 *
 * Scope: conversion is attempted only when the mime type *declares* raw PCM.
 * Anything else is passed through untouched — relabelling bytes we do not
 * understand cannot make them playable, and a wrong header would turn audio the
 * browser could have sniffed into a corrupt file.
 *
 * Everything here is pure and synchronous: no DOM, no network, deterministic
 * output for a given input, so the byte layout can be asserted directly in
 * tests.
 */

/** Parameters of a raw PCM stream, as declared by an audio mime type. */
interface PcmStreamParams {
  sampleRate: number;
  /** Interleaved channel count. */
  channels: number;
  /** Bits per sample, per channel (L16 → 16). */
  bitsPerSample: number;
}

/**
 * Gemini's TTS models document `audio/L16;codec=pcm;rate=24000`: 16-bit
 * little-endian mono at 24 kHz. Applied per-field whenever the mime type omits
 * a parameter or declares one outside a sane range.
 */
export const DEFAULT_PCM_STREAM_PARAMS: PcmStreamParams = {
  sampleRate: 24000,
  channels: 1,
  bitsPerSample: 16,
};

/** Bytes of the canonical RIFF/WAVE header with a 16-byte `fmt ` chunk. */
const WAV_HEADER_BYTES = 44;
/** PCM format tag in the `fmt ` chunk (as opposed to a compressed codec). */
const WAV_FORMAT_PCM = 1;
/** `btoa`/`atob` argument limits: build strings in bounded slices. */
const BASE64_CHUNK_BYTES = 0x8000;
const MAX_SAMPLE_RATE = 384_000;
const MAX_CHANNELS = 8;
const SUPPORTED_BITS_PER_SAMPLE = [8, 16, 24, 32];

/**
 * Matches the mime types that announce linear PCM rather than a container:
 * `audio/L16`, `audio/pcm`, `audio/linear`, plus the `codec=pcm` parameter
 * Gemini sends alongside `audio/L16`.
 */
const PCM_MIME_PATTERN = /(?:^|[/;=])(?:l(?:8|16|24|32)|pcm|linear)(?:$|[/;=])/;

/** Containers a browser `<audio>` element decodes without any help. */
const PLAYABLE_AUDIO_MIME_TYPES = new Set([
  "audio/wav",
  "audio/wave",
  "audio/x-wav",
  "audio/mpeg",
  "audio/mp3",
  "audio/ogg",
  "audio/opus",
  "audio/webm",
  "audio/mp4",
  "audio/m4a",
  "audio/x-m4a",
  "audio/aac",
  "audio/flac",
]);

/** Lowercase the type and drop any `;param=value` tail. */
function normalizeMimeType(mimeType: string | undefined): string {
  const [type] = (mimeType ?? "").split(";");
  return (type ?? "").trim().toLowerCase();
}

/** Read a numeric mime parameter, e.g. `rate=24000`. */
function readMimeParameter(
  mimeType: string,
  name: string,
): number | undefined {
  const match = new RegExp(
    `(?:^|[;,])\\s*${name}\\s*=\\s*"?([0-9]+)"?`,
  ).exec(mimeType.toLowerCase());
  if (!match) {return undefined;}
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : undefined;
}

/** Bits per sample implied by an `L8`/`L16`/`L24`/`L32` mime type. */
function readBitsFromMimeType(mimeType: string): number | undefined {
  const match = /(?:^|[/;=])l(8|16|24|32)(?:$|[/;=])/.exec(
    mimeType.toLowerCase(),
  );
  return match ? Number(match[1]) : undefined;
}

/** Clamp a parsed parameter to a supported value, falling back to the default. */
function resolveSampleRate(value: number | undefined): number {
  if (value === undefined || value <= 0 || value > MAX_SAMPLE_RATE) {
    return DEFAULT_PCM_STREAM_PARAMS.sampleRate;
  }
  return Math.floor(value);
}

function resolveChannels(value: number | undefined): number {
  if (value === undefined || value <= 0 || value > MAX_CHANNELS) {
    return DEFAULT_PCM_STREAM_PARAMS.channels;
  }
  return Math.floor(value);
}

function resolveBitsPerSample(value: number | undefined): number {
  if (value === undefined || !SUPPORTED_BITS_PER_SAMPLE.includes(value)) {
    return DEFAULT_PCM_STREAM_PARAMS.bitsPerSample;
  }
  return value;
}

/** True when the mime type declares a raw linear-PCM stream. */
export function isPcmAudioMimeType(mimeType?: string): boolean {
  if (!mimeType) {return false;}
  return PCM_MIME_PATTERN.test(mimeType.toLowerCase());
}

/** True when the mime type names a container the browser can play as-is. */
export function isPlayableAudioMimeType(mimeType?: string): boolean {
  return PLAYABLE_AUDIO_MIME_TYPES.has(normalizeMimeType(mimeType));
}

/**
 * Resolve the stream parameters a mime type declares, filling every gap with
 * the documented Gemini defaults and rejecting impossible values.
 */
export function parsePcmStreamParams(mimeType?: string): PcmStreamParams {
  const raw = mimeType ?? "";
  const bitsPerSample = resolveBitsPerSample(
    readMimeParameter(raw, "bitspersample") ??
      readMimeParameter(raw, "bits") ??
      readBitsFromMimeType(raw),
  );
  return {
    sampleRate: resolveSampleRate(
      readMimeParameter(raw, "rate") ?? readMimeParameter(raw, "samplerate"),
    ),
    channels: resolveChannels(readMimeParameter(raw, "channels")),
    bitsPerSample,
  };
}

/** Write 4 ASCII bytes (chunk ids are always 4 characters). */
function writeAscii(
  target: Uint8Array,
  offset: number,
  text: string,
): void {
  for (let i = 0; i < text.length; i += 1) {
    target[offset + i] = text.charCodeAt(i);
  }
}

/**
 * Build the canonical 44-byte RIFF/WAVE header for a PCM payload of
 * `dataByteLength` bytes.
 *
 * Layout (all multi-byte fields little-endian):
 *   `RIFF` | riffSize | `WAVE` | `fmt ` | 16 | format | channels | sampleRate |
 *   byteRate | blockAlign | bitsPerSample | `data` | dataByteLength
 *
 * RIFF requires every chunk to be word-aligned, so an odd-sized payload gets a
 * trailing pad byte that counts towards `riffSize` but NOT towards the `data`
 * chunk size — the split the spec asks for and the one decoders expect.
 */
export function buildWavHeader(
  dataByteLength: number,
  params: PcmStreamParams = DEFAULT_PCM_STREAM_PARAMS,
): Uint8Array {
  if (!Number.isFinite(dataByteLength) || dataByteLength < 0) {
    throw new Error("Invalid PCM byte length for a WAV header");
  }
  const dataLength = Math.floor(dataByteLength);
  const { sampleRate, channels, bitsPerSample } = params;
  const blockAlign = (channels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const padding = dataLength % 2;

  const header = new Uint8Array(WAV_HEADER_BYTES);
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength);

  writeAscii(header, 0, "RIFF");
  view.setUint32(4, WAV_HEADER_BYTES - 8 + dataLength + padding, true);
  writeAscii(header, 8, "WAVE");

  writeAscii(header, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, WAV_FORMAT_PCM, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);

  writeAscii(header, 36, "data");
  view.setUint32(40, dataLength, true);

  return header;
}

/**
 * Decode standard base64 into bytes. Whitespace is tolerated (providers wrap
 * long payloads); anything else throws, because a payload we cannot decode is a
 * payload we must not hand to the audio element.
 */
export function base64ToBytes(base64: string): Uint8Array {
  const compact = base64.replace(/\s+/g, "");
  if (compact.length === 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) {
    throw new Error("Invalid base64 audio payload");
  }
  const binary = atob(compact);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** Encode bytes as base64 without exceeding the argument limit of `btoa`. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += BASE64_CHUNK_BYTES) {
    const slice = bytes.subarray(offset, offset + BASE64_CHUNK_BYTES);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

/**
 * Wrap a base64 PCM payload in a WAV container and return it as a data URL.
 * The mime type supplies the stream parameters (`audio/L16;rate=24000`).
 */
export function pcmBase64ToWavDataUrl(
  base64: string,
  mimeType?: string,
): string {
  const pcm = base64ToBytes(base64);
  const params = parsePcmStreamParams(mimeType);
  const header = buildWavHeader(pcm.length, params);
  const wav = new Uint8Array(header.length + pcm.length + (pcm.length % 2));
  wav.set(header, 0);
  wav.set(pcm, header.length);
  return `data:audio/wav;base64,${bytesToBase64(wav)}`;
}

/**
 * Normalize a provider audio payload into something an `<audio>` element can
 * play.
 *
 * - Already a data URL → returned untouched (idempotent).
 * - A raw-PCM mime type → converted into a WAV data URL.
 * - Any other audio container → labelled as itself.
 * - A missing or non-audio label → kept as `audio/wav` (the historical
 *   behaviour): the bytes are left alone so the browser's own container
 *   sniffing still has a chance, which a fabricated header would destroy.
 */
export function toPlayableAudioDataUrl(
  base64: string,
  mimeType?: string,
): string {
  if (typeof base64 !== "string" || base64.length === 0) {
    throw new Error("Empty audio payload");
  }
  if (base64.startsWith("data:")) {return base64;}
  if (isPcmAudioMimeType(mimeType)) {
    return pcmBase64ToWavDataUrl(base64, mimeType);
  }
  const mime = normalizeMimeType(mimeType);
  const label = mime.startsWith("audio/") ? mime : "audio/wav";
  return `data:${label};base64,${base64}`;
}
