#!/usr/bin/env node
/**
 * Encode and verify the published WebM demo tour.
 *
 * Input  : the raw Playwright recording produced by scripts/capture-demo-tour.mjs
 * Output : docs/bookmarkforge-demo-tour.webm (the file the README links)
 *
 * There is no system ffmpeg on the maintainer machine, and installing one is
 * not a prerequisite for building a README asset. Playwright already ships a
 * minimal ffmpeg for its own video recording, so this script locates that
 * binary (a full PATH ffmpeg is preferred when installed) and refuses to run
 * when it cannot find one, rather than silently publishing something
 * unverified.
 *
 * Verification is not decoration: a re-encode can look fine in the encoder log
 * and still blur text or freeze on the first frame. Before the file is accepted
 * this script checks
 *
 *   1. structure  — the EBML header and `webm` DocType are really there;
 *   2. budget     — the file fits the byte budget for a README asset;
 *   3. fidelity   — sampled frames stay close to the recording they came from;
 *   4. playback   — Chromium decodes it, reports the real geometry/duration and
 *                   actually presents successive frames while playing.
 *
 * Usage:
 *   node scripts/build-demo-video.mjs
 *   node scripts/build-demo-video.mjs --input /tmp/raw.webm --out /tmp/tour.webm
 *   node scripts/build-demo-video.mjs --crf 34 --max-bytes 2000000
 *   node scripts/build-demo-video.mjs --skip-playback --skip-fidelity
 *   BMF_FFMPEG_PATH=/usr/bin/ffmpeg node scripts/build-demo-video.mjs
 */
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, posix, resolve, win32 } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { PNG } from "pngjs";
import { RAW_TOUR_PATH, TOUR_OUTPUT_PATH } from "./demo-tour-flow.mjs";

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested in scripts/__tests__/demo-video.test.mjs)
// ---------------------------------------------------------------------------

/**
 * Directories that may hold Playwright's bundled ffmpeg, most specific first.
 * Paths are built with the semantics of the requested platform, not of the host
 * running this code, so the search order is identical (and testable) anywhere.
 */
export function ffmpegSearchDirs({
  platform = process.platform,
  env = process.env,
  home = homedir(),
} = {}) {
  const path = platform === "win32" ? win32 : posix;
  const dirs = [];
  if (env.BMF_FFMPEG_PATH) dirs.push(path.dirname(path.resolve(env.BMF_FFMPEG_PATH)));
  if (env.PLAYWRIGHT_BROWSERS_PATH) dirs.push(path.resolve(env.PLAYWRIGHT_BROWSERS_PATH));

  if (platform === "win32") {
    if (env.LOCALAPPDATA) dirs.push(path.join(env.LOCALAPPDATA, "ms-playwright"));
  } else if (platform === "darwin") {
    dirs.push(path.join(home, "Library", "Caches", "ms-playwright"));
  } else {
    dirs.push(path.join(env.XDG_CACHE_HOME ?? path.join(home, ".cache"), "ms-playwright"));
  }
  return [...new Set(dirs)];
}

/** The executable inside an extracted `ffmpeg-<build>/` browser folder. */
export function ffmpegBinaryName(platform = process.platform) {
  return platform === "win32" ? "ffmpeg-win64.exe" : "ffmpeg-linux";
}

/** Encoders this build can actually use, best first. */
export function parseFfmpegEncoders(output) {
  const found = new Set();
  for (const line of output.split(/\r?\n/)) {
    // ` V....D libvpx-vp9  libvpx VP9` — capability flags column, then the name.
    // The legend lines (` V..... = Video`) are skipped by requiring a name
    // that starts with a letter.
    const match = /^\s*[A-Z.]{6}\s+([A-Za-z][\w.-]*)/.exec(line);
    if (match) found.add(match[1]);
  }
  return {
    hasVp9: found.has("libvpx-vp9"),
    hasVp8: found.has("libvpx") || found.has("vp8"),
    encoders: [...found],
  };
}

/**
 * Minimal WebM/Matroska probe: EBML magic, a `webm` DocType string inside the
 * header and a plausible size. Deliberately shallow — full parsing is the
 * browser's job and is covered by the playback check.
 */
export function probeWebm(buffer) {
  const problems = [];
  if (buffer.length < 64) problems.push("file is too small to be a WebM container");
  if (!(buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3)) {
    problems.push("missing EBML magic bytes (not a Matroska/WebM file)");
  } else if (buffer.subarray(0, Math.min(buffer.length, 4096)).indexOf("webm", 0, "latin1") === -1) {
    problems.push('EBML DocType "webm" not found in the container header');
  }
  return { ok: problems.length === 0, problems };
}

/**
 * Mean absolute error over the RGB channels of two equal-sized RGBA buffers.
 * Alpha is ignored: every frame here is fully opaque, and counting a constant
 * channel would only dilute the metric.
 */
export function meanAbsoluteError(frameA, frameB) {
  if (frameA.length !== frameB.length || frameA.length === 0 || frameA.length % 4 !== 0) {
    throw new Error("frames must be non-empty RGBA buffers of identical size");
  }
  let total = 0;
  let samples = 0;
  for (let i = 0; i < frameA.length; i += 4) {
    total +=
      Math.abs(frameA[i] - frameB[i]) +
      Math.abs(frameA[i + 1] - frameB[i + 1]) +
      Math.abs(frameA[i + 2] - frameB[i + 2]);
    samples += 3;
  }
  return total / samples;
}

/**
 * Draws a play badge (translucent disc + accent triangle) centred on a frame.
 *
 * GitHub cannot embed a committed video inside a README, so the asset is
 * advertised through a poster image that links to the file. A plain screenshot
 * gives no hint that it is clickable; the badge is what makes the link
 * discoverable, and drawing it here keeps the poster reproducible instead of
 * hand-edited in an image editor.
 */
export function drawPlayBadge(png, { accent = [37, 99, 235], discAlpha = 0.88 } = {}) {
  const { width, height } = png;
  const radius = Math.round(Math.min(width, height) * 0.11);
  const centreX = Math.round(width / 2);
  const centreY = Math.round(height / 2);
  const triangle = {
    baseX: centreX - radius * 0.3,
    apexX: centreX + radius * 0.52,
    halfBase: radius * 0.5,
  };

  const blend = (offset, colour, alpha) => {
    png.data[offset] = Math.round(png.data[offset] * (1 - alpha) + colour[0] * alpha);
    png.data[offset + 1] = Math.round(png.data[offset + 1] * (1 - alpha) + colour[1] * alpha);
    png.data[offset + 2] = Math.round(png.data[offset + 2] * (1 - alpha) + colour[2] * alpha);
    png.data[offset + 3] = 255;
  };

  for (let y = centreY - radius - 2; y <= centreY + radius + 2; y++) {
    for (let x = centreX - radius - 2; x <= centreX + radius + 2; x++) {
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      const distance = Math.hypot(x - centreX, y - centreY);
      if (distance > radius) continue;
      const offset = (width * y + x) << 2;
      // Feathered edge so the disc does not look aliased at 720p.
      const edge = Math.min(1, Math.max(0, radius - distance));
      blend(offset, [255, 255, 255], discAlpha * (0.35 + 0.65 * edge));
      const inTriangleX = x >= triangle.baseX && x <= triangle.apexX;
      if (!inTriangleX) continue;
      const progress = (x - triangle.baseX) / (triangle.apexX - triangle.baseX);
      const halfHeight = triangle.halfBase * (1 - progress);
      if (Math.abs(y - centreY) <= halfHeight) blend(offset, accent, 1);
    }
  }
  return png;
}

/** Compares measured bytes against the README media budget. */
export function checkBudget(bytes, maxBytes) {
  return {
    ok: bytes <= maxBytes,
    bytes,
    maxBytes,
    overBy: Math.max(0, bytes - maxBytes),
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const DEFAULTS = {
  input: resolve(RAW_TOUR_PATH),
  out: resolve(TOUR_OUTPUT_PATH),
  poster: resolve("docs/bookmarkforge-demo-tour-poster.png"),
  // Fraction of the tour used for the poster: 40% of the current asset lands on
  // the capture chapter, which shows the product doing something specific.
  posterAt: 0.4,
  width: 1280,
  height: 720,
  // Empirical starting points for a 1280x720 UI recording; docs/demo-media.md
  // records what the current asset actually measured.
  crf: 30,
  qmax: 50,
  maxBytes: 3_000_000,
  fidelitySamples: 4,
  maxMeanAbsoluteError: 6,
};

function parseArgs(argv) {
  const options = { ...DEFAULTS, skipPlayback: false, skipFidelity: false };
  for (let i = 2; i < argv.length; i++) {
    const flag = argv[i];
    const take = () => argv[++i];
    switch (flag) {
      case "--input":
        options.input = resolve(take());
        break;
      case "--out":
        options.out = resolve(take());
        break;
      case "--poster":
        options.poster = resolve(take());
        break;
      case "--no-poster":
        options.poster = null;
        break;
      case "--poster-at":
        options.posterAt = Number(take());
        break;
      case "--crf":
        options.crf = Number(take());
        break;
      case "--max-bytes":
        options.maxBytes = Number(take());
        break;
      case "--max-mae":
        options.maxMeanAbsoluteError = Number(take());
        break;
      case "--skip-playback":
        options.skipPlayback = true;
        break;
      case "--skip-fidelity":
        options.skipFidelity = true;
        break;
      default:
        throw new Error(`Unknown argument: ${flag}`);
    }
  }
  for (const key of ["crf", "maxBytes", "maxMeanAbsoluteError"]) {
    if (!Number.isFinite(options[key]) || options[key] <= 0) {
      throw new Error(`--${key} must be a positive number`);
    }
  }
  if (!Number.isFinite(options.posterAt) || options.posterAt < 0 || options.posterAt > 1) {
    throw new Error("--poster-at must be a fraction of the tour between 0 and 1");
  }
  return options;
}

function log(message) {
  console.error(`[demo-video] ${message}`);
}

// ---------------------------------------------------------------------------
// ffmpeg discovery and execution
// ---------------------------------------------------------------------------

function run(command, args) {
  try {
    return {
      ok: true,
      stdout: execFileSync(command, args, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        maxBuffer: 512 * 1024 * 1024,
      }),
      stderr: "",
    };
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    // ffmpeg reports stream metadata on stderr and exits non-zero when no
    // output file is requested; the text is still exactly what we need.
    return {
      ok: false,
      stdout: error?.stdout?.toString() ?? "",
      stderr: error?.stderr?.toString() ?? "",
    };
  }
}

export function findFfmpeg({ env = process.env, platform = process.platform } = {}) {
  const explicit = env.BMF_FFMPEG_PATH;
  if (explicit && existsSync(explicit)) return resolve(explicit);

  for (const dir of ffmpegSearchDirs({ platform, env })) {
    if (!existsSync(dir)) continue;
    const builds = readdirSync(dir)
      .filter((name) => name.startsWith("ffmpeg-"))
      .sort();
    for (const build of builds.reverse()) {
      const binary = join(dir, build, ffmpegBinaryName(platform));
      if (existsSync(binary)) return binary;
    }
  }

  // A full system ffmpeg is preferable when installed: it can encode VP9.
  for (const name of ["ffmpeg", "ffmpeg.exe"]) {
    if (run(name, ["-version"])) return name;
  }
  return null;
}

function ffmpeg({ command, args }) {
  const result = run(command, ["-hide_banner", "-loglevel", "error", "-y", ...args]);
  if (!result || !result.ok) {
    throw new Error(
      `ffmpeg failed: ${command} ${args.join(" ")}\n${result?.stderr ?? "binary not runnable"}`,
    );
  }
  return result;
}

/** Stream summary of a file, parsed from ffmpeg's stderr banner. */
export function probeMedia(command, file) {
  const result = run(command, ["-hide_banner", "-i", file]);
  const text = `${result?.stdout ?? ""}${result?.stderr ?? ""}`;
  const duration = /Duration:\s*(\d+):(\d+):(\d+\.\d+)/.exec(text);
  const videoLine = text.split(/\r?\n/).find((line) => line.includes("Video:")) ?? "";
  const dimensions = /(\d{2,5})x(\d{2,5})/.exec(videoLine);
  const fps = /,\s*([\d.]+)\s*fps/.exec(videoLine);
  return {
    durationSeconds: duration
      ? Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3])
      : null,
    codec: /Video:\s*([^,(]+)/.exec(videoLine)?.[1]?.trim() ?? null,
    width: dimensions ? Number(dimensions[1]) : null,
    height: dimensions ? Number(dimensions[2]) : null,
    fps: fps ? Number(fps[1]) : null,
  };
}

function encode({ command, options, encoder }) {
  const args = [
    "-i",
    options.input,
    "-vf",
    `scale=${options.width}:${options.height}:flags=lanczos`,
    "-an",
    "-c:v",
    encoder,
  ];
  if (encoder === "libvpx-vp9") {
    args.push("-crf", String(options.crf), "-b:v", "0", "-row-mt", "1");
  } else {
    // VP8 constant quality: `-b:v 0` selects quality mode, `-crf` caps the
    // quantizer, and `-deadline good` buys a smaller file than Playwright's
    // realtime recording preset at the same visual result.
    args.push(
      "-crf",
      String(options.crf),
      "-b:v",
      "0",
      "-qmin",
      "0",
      "-qmax",
      String(options.qmax),
      "-deadline",
      "good",
      "-cpu-used",
      "2",
      "-auto-alt-ref",
      "1",
    );
  }
  args.push(options.out);
  ffmpeg({ command, args });
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

/** Extracts exactly one frame to a PNG file. */
function extractFrame(command, file, atSeconds, outPath) {
  ffmpeg({
    command,
    args: ["-ss", atSeconds.toFixed(3), "-i", file, "-frames:v", "1", "-c:v", "png", outPath],
  });
  if (!existsSync(outPath)) throw new Error(`could not extract a poster frame at ${atSeconds}s`);
  return outPath;
}

/** Builds the clickable poster from a real frame of the published video. */
function buildPoster({ command, options, duration }) {
  const scratch = mkdtempSync(join(tmpdir(), "demo-video-poster-"));
  try {
    const at = Number((duration * options.posterAt).toFixed(3));
    const frame = extractFrame(command, options.out, at, join(scratch, "frame.png"));
    const png = PNG.sync.read(readFileSync(frame));
    if (png.width !== options.width || png.height !== options.height) {
      throw new Error(
        `poster frame is ${png.width}x${png.height}, expected ${options.width}x${options.height}`,
      );
    }
    drawPlayBadge(png);
    writeFileSync(options.poster, PNG.sync.write(png));
    return { path: options.poster, atSeconds: at, bytes: statSync(options.poster).size };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** Decodes up to `count` frames starting near `atSeconds` as RGBA buffers. */
function extractFrames(command, file, atSeconds, scratchDir, tag, count = 4) {
  const pattern = join(scratchDir, `${tag}-%02d.png`);
  const started = run(command, [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-ss",
    Math.max(0, atSeconds - 0.08).toFixed(3),
    "-i",
    file,
    "-frames:v",
    String(count),
    "-c:v",
    "png",
    "-f",
    "image2",
    pattern,
  ]);
  if (started && !started.ok && !existsSync(join(scratchDir, `${tag}-01.png`))) {
    return [];
  }
  const frames = [];
  for (let index = 1; index <= count; index++) {
    const candidate = join(scratchDir, `${tag}-${String(index).padStart(2, "0")}.png`);
    if (!existsSync(candidate)) break;
    frames.push(PNG.sync.read(readFileSync(candidate)).data);
  }
  return frames;
}

/**
 * Compares the encoded file against the recording it came from at several
 * timestamps. Each comparison takes the best match inside a small frame window,
 * so a one-frame seek difference cannot be mistaken for quality loss.
 */
function verifyFidelity({ command, input, output, samples, threshold, duration }) {
  const scratch = mkdtempSync(join(tmpdir(), "demo-video-fidelity-"));
  try {
    const results = [];
    let worst = 0;
    for (let i = 0; i < samples; i++) {
      const at = Number((duration * ((i + 0.5) / samples)).toFixed(3));
      const source = extractFrames(command, input, at, scratch, `src${i}`);
      const encoded = extractFrames(command, output, at, scratch, `enc${i}`);
      if (source.length === 0 || encoded.length === 0) {
        return { ok: false, reason: `could not decode frames at ${at}s`, results };
      }
      let best = Infinity;
      for (const a of source) {
        for (const b of encoded) {
          if (a.length !== b.length) continue;
          best = Math.min(best, meanAbsoluteError(a, b));
        }
      }
      worst = Math.max(worst, best);
      results.push({ atSeconds: at, meanAbsoluteError: Number(best.toFixed(3)) });
    }
    return {
      ok: worst <= threshold,
      worstMeanAbsoluteError: Number(worst.toFixed(3)),
      threshold,
      results,
    };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** Real Chromium decode: geometry, duration and successive presented frames. */
async function verifyPlayback({ file, expected }) {
  const { chromium } = await import("@playwright/test");
  const browser = await chromium.launch({
    headless: true,
    args: ["--allow-file-access-from-files", "--autoplay-policy=no-user-gesture-required"],
  });
  try {
    const page = await browser.newPage();
    // A file:// document cannot pull subresources from another origin, so the
    // tiny player shell is written next to the asset it inspects.
    const shell = resolve(dirname(file), `.demo-video-check-${process.pid}.html`);
    writeFileSync(
      shell,
      '<!doctype html><meta charset="utf-8"><title>playback check</title>' +
        '<body style="margin:0;background:#000">' +
        `<video id="v" src="${basename(file)}" muted playsinline></video></body>`,
    );
    try {
      await page.goto(pathToFileURL(shell).href);
      const metadata = await page.evaluate(
        () =>
          new Promise((done) => {
            const video = document.getElementById("v");
            const read = () => ({
              videoWidth: video.videoWidth,
              videoHeight: video.videoHeight,
              duration: video.duration,
              readyState: video.readyState,
            });
            if (video.readyState >= 1) return done(read());
            video.addEventListener("loadedmetadata", () => done(read()), { once: true });
            video.addEventListener("error", () => done({ error: "media error" }), { once: true });
            setTimeout(() => done({ error: "metadata timeout" }), 15_000);
          }),
      );
      if (metadata.error) {
        return { ok: false, problems: [`Chromium could not load the file: ${metadata.error}`] };
      }

      const played = await page.evaluate(async () => {
        const video = document.getElementById("v");
        const seen = [];
        const onFrame = (_now, meta) => {
          seen.push(Number(meta.mediaTime.toFixed(3)));
          if (seen.length < 5) video.requestVideoFrameCallback(onFrame);
        };
        video.requestVideoFrameCallback(onFrame);
        video.currentTime = 0;
        await video.play();
        await new Promise((done) => setTimeout(done, 3000));
        video.pause();
        return { seen, currentTime: video.currentTime };
      });

      const problems = [];
      const { videoWidth, videoHeight, duration } = metadata;
      if (videoWidth !== expected.width || videoHeight !== expected.height) {
        problems.push(
          `geometry ${videoWidth}x${videoHeight} != expected ${expected.width}x${expected.height}`,
        );
      }
      if (!(duration > 1)) problems.push(`duration ${duration}s is not a playable timeline`);
      if (played.currentTime <= 0) problems.push("playback never advanced");
      if (new Set(played.seen).size < 2) {
        problems.push("all presented frames share one mediaTime (frozen first frame)");
      }
      return {
        ok: problems.length === 0,
        problems,
        metadata,
        presentedMediaTimes: played.seen,
      };
    } finally {
      rmSync(shell, { force: true });
    }
  } finally {
    await browser.close();
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const options = parseArgs(process.argv);
  if (!existsSync(options.input)) {
    throw new Error(
      `raw recording not found at ${options.input}\n` +
        "Capture it first, with the dev server running:\n" +
        "  npm run demo:capture-tour -- --base-url http://127.0.0.1:5199",
    );
  }

  const command = findFfmpeg();
  if (!command) {
    throw new Error(
      "no ffmpeg available: set BMF_FFMPEG_PATH or install Playwright browsers " +
        "(npx playwright install chromium) so the bundled ffmpeg is present",
    );
  }
  log(`ffmpeg: ${command}`);
  log(`version: ${run(command, ["-version"])?.stdout?.split("\n")[0]?.trim() ?? command}`);

  const encoderListing = run(command, ["-encoders"]);
  const capability = parseFfmpegEncoders(
    `${encoderListing?.stdout ?? ""}${encoderListing?.stderr ?? ""}`,
  );
  const encoder = capability.hasVp9 ? "libvpx-vp9" : capability.hasVp8 ? "libvpx" : null;
  if (!encoder) {
    throw new Error(
      `this ffmpeg cannot encode VP8/VP9 WebM (found: ${capability.encoders.join(", ") || "none"})`,
    );
  }

  const source = probeMedia(command, options.input);
  log(`source: ${source.width}x${source.height} ${source.codec} ${source.durationSeconds}s`);

  log(`encoding with ${encoder} (crf ${options.crf})`);
  encode({ command, options, encoder });

  const bytes = statSync(options.out).size;
  const encoded = probeMedia(command, options.out);
  const structure = probeWebm(readFileSync(options.out));
  const budget = checkBudget(bytes, options.maxBytes);
  const report = {
    input: options.input,
    output: options.out,
    encoder,
    source,
    encoded,
    bytes,
    budget,
    structure,
  };

  if (!structure.ok) throw new Error(`structure check failed: ${structure.problems.join("; ")}`);
  if (!budget.ok) {
    throw new Error(
      `output is ${bytes} bytes, ${budget.overBy} over the ${options.maxBytes}-byte README ` +
        `budget; raise --crf (currently ${options.crf}) or lower the resolution`,
    );
  }

  if (!options.skipFidelity) {
    log("checking fidelity against the raw recording");
    report.fidelity = verifyFidelity({
      command,
      input: options.input,
      output: options.out,
      samples: options.fidelitySamples,
      threshold: options.maxMeanAbsoluteError,
      duration: encoded.durationSeconds ?? source.durationSeconds ?? 1,
    });
    if (!report.fidelity.ok) {
      throw new Error(
        `fidelity check failed (worst MAE ${report.fidelity.worstMeanAbsoluteError} > ` +
          `${options.maxMeanAbsoluteError}): the re-encode degrades the recording too much`,
      );
    }
  }

  if (options.poster) {
    log("building the README poster from a real frame");
    report.poster = buildPoster({
      command,
      options,
      duration: encoded.durationSeconds ?? source.durationSeconds ?? 1,
    });
  }

  if (!options.skipPlayback) {
    log("checking real playback in Chromium");
    report.playback = await verifyPlayback({
      file: options.out,
      expected: { width: options.width, height: options.height },
    });
    if (!report.playback.ok) {
      throw new Error(`playback check failed: ${report.playback.problems.join("; ")}`);
    }
  }

  console.log(JSON.stringify(report, null, 2));
  log(
    `OK: ${basename(options.out)} ${bytes} bytes, ${encoded.width}x${encoded.height}, ` +
      `${encoded.durationSeconds}s`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error("[demo-video] FAILED:", error?.message ?? error);
    process.exit(1);
  });
}
