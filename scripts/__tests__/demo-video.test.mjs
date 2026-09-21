/**
 * Unit tests for the README demo-media tooling.
 *
 * These cover the decisions the builder makes before it touches a byte of
 * video: which ffmpeg it is allowed to use, which encoders that build really
 * exposes, whether a file is structurally a WebM, whether a re-encode stayed
 * close enough to its source, and whether the byte budget holds. All of them
 * are pure functions so the test never needs a browser, a server or a GPU.
 */
import { posix, win32 } from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkBudget,
  drawPlayBadge,
  ffmpegBinaryName,
  ffmpegSearchDirs,
  meanAbsoluteError,
  parseFfmpegEncoders,
  probeWebm,
} from "../build-demo-video.mjs";
import { parseDemoArgs } from "../demo-tour-flow.mjs";

/** A tiny but structurally real WebM header: EBML magic + `webm` DocType. */
function webmHeader({ pad = 0, docType = "webm" } = {}) {
  const body = Buffer.concat([
    Buffer.from([0x1a, 0x45, 0xdf, 0xa3]),
    Buffer.from(`\x42\x86\x81\x01DocType${docType}`, "latin1"),
    Buffer.alloc(pad, 0x00),
  ]);
  return body;
}

describe("ffmpeg discovery", () => {
  it("uses the win32 Playwright browser cache from LOCALAPPDATA", () => {
    const dirs = ffmpegSearchDirs({
      platform: "win32",
      env: { LOCALAPPDATA: "C:\\Users\\demo\\AppData\\Local" },
      home: "C:\\Users\\demo",
    });
    expect(dirs).toEqual([win32.join("C:\\Users\\demo\\AppData\\Local", "ms-playwright")]);
  });

  it("honours an explicit binary and an explicit browsers path first", () => {
    const dirs = ffmpegSearchDirs({
      platform: "linux",
      env: {
        BMF_FFMPEG_PATH: "/opt/tools/ffmpeg",
        PLAYWRIGHT_BROWSERS_PATH: "/srv/pw-browsers",
        XDG_CACHE_HOME: "/srv/cache",
      },
      home: "/home/ci",
    });
    expect(dirs.slice(0, 3)).toEqual(["/opt/tools", "/srv/pw-browsers", "/srv/cache/ms-playwright"]);
  });

  it("falls back to the macOS and Linux cache locations", () => {
    expect(ffmpegSearchDirs({ platform: "darwin", env: {}, home: "/Users/ci" })).toEqual([
      posix.join("/Users/ci", "Library", "Caches", "ms-playwright"),
    ]);
    expect(ffmpegSearchDirs({ platform: "linux", env: {}, home: "/home/ci" }).at(-1)).toBe(
      posix.join("/home/ci", ".cache", "ms-playwright"),
    );
  });

  it("never repeats a directory", () => {
    const dirs = ffmpegSearchDirs({
      platform: "linux",
      env: { XDG_CACHE_HOME: "/cache" },
      home: "/cache/../cache",
    });
    expect(new Set(dirs).size).toBe(dirs.length);
  });

  it("names the bundled binary per platform", () => {
    expect(ffmpegBinaryName("win32")).toBe("ffmpeg-win64.exe");
    expect(ffmpegBinaryName("linux")).toBe("ffmpeg-linux");
    expect(ffmpegBinaryName("darwin")).toBe("ffmpeg-linux");
  });
});

describe("encoder capability parsing", () => {
  const listing = [
    "Encoders:",
    " V..... = Video",
    " A..... = Audio",
    " -----",
    " V....D libvpx               libvpx VP8 (codec vp8)",
    " V....D png                  PNG (Portable Network Graphics) image",
    " A....D aac                  AAC (Advanced Audio Coding)",
  ].join("\n");

  it("detects the VP8-only build Playwright ships", () => {
    const capability = parseFfmpegEncoders(listing);
    expect(capability.hasVp8).toBe(true);
    expect(capability.hasVp9).toBe(false);
    expect(capability.encoders).toContain("libvpx");
  });

  it("prefers VP9 when a full ffmpeg provides it", () => {
    const capability = parseFfmpegEncoders(`${listing}\n V....D libvpx-vp9 libvpx VP9`);
    expect(capability.hasVp9).toBe(true);
  });

  it("does not mistake legend lines or unrelated encoders for VP8", () => {
    const capability = parseFfmpegEncoders(
      ["Encoders:", " V..... = Video", " A....D aac AAC", " V....D mjpeg Motion JPEG"].join("\n"),
    );
    expect(capability.hasVp8).toBe(false);
    expect(capability.hasVp9).toBe(false);
  });
});

describe("WebM structure probe", () => {
  it("accepts a container header carrying the webm DocType", () => {
    expect(probeWebm(webmHeader({ pad: 128 }))).toEqual({ ok: true, problems: [] });
  });

  it("rejects a file that is not Matroska/WebM", () => {
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(256)]);
    const result = probeWebm(png);
    expect(result.ok).toBe(false);
    expect(result.problems.join(" ")).toMatch(/EBML magic/);
  });

  it("rejects a truncated or headerless file", () => {
    expect(probeWebm(Buffer.alloc(8)).ok).toBe(false);
    expect(probeWebm(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])).ok).toBe(false);
  });

  it("rejects an EBML file whose DocType is not webm", () => {
    // The literal "webm" no longer appears anywhere in the header window.
    const result = probeWebm(webmHeader({ pad: 256, docType: "matroska+garbage" }));
    expect(result.ok).toBe(false);
    expect(result.problems.join(" ")).toMatch(/DocType/);
  });
});

describe("fidelity metric", () => {
  const frame = (...rgba) => Buffer.from(rgba);

  it("is zero for identical frames", () => {
    const a = frame(10, 20, 30, 255, 200, 100, 50, 255);
    expect(meanAbsoluteError(a, a)).toBe(0);
  });

  it("averages the RGB channels and ignores alpha", () => {
    const a = frame(0, 0, 0, 0, 0, 0, 0, 0);
    // Alpha differs by 255 but must not change the metric; one channel of one
    // pixel differs by 30, averaged over 2 pixels x 3 channels = 5.
    const b = frame(30, 0, 0, 255, 0, 0, 0, 0);
    expect(meanAbsoluteError(a, b)).toBe(5);
  });

  it("refuses buffers that cannot be compared", () => {
    expect(() => meanAbsoluteError(frame(1, 2, 3, 4), frame(1, 2, 3))).toThrow(/identical size/);
    expect(() => meanAbsoluteError(Buffer.alloc(0), Buffer.alloc(0))).toThrow(/non-empty/);
  });
});

describe("poster play badge", () => {
  const blankFrame = (width, height) => {
    const png = { width, height, data: Buffer.alloc(width * height * 4) };
    for (let i = 3; i < png.data.length; i += 4) png.data[i] = 255; // opaque black
    return png;
  };
  const pixelAt = (png, x, y) => {
    const offset = (png.width * y + x) << 2;
    return [...png.data.subarray(offset, offset + 4)];
  };

  it("paints the accent triangle at the centre of the frame", () => {
    const png = drawPlayBadge(blankFrame(200, 120));
    expect(pixelAt(png, 100, 60)).toEqual([37, 99, 235, 255]);
  });

  it("leaves the rest of the frame untouched", () => {
    const png = drawPlayBadge(blankFrame(200, 120));
    expect(pixelAt(png, 0, 0)).toEqual([0, 0, 0, 255]);
    expect(pixelAt(png, 199, 119)).toEqual([0, 0, 0, 255]);
    expect(pixelAt(png, 100, 2)).toEqual([0, 0, 0, 255]);
  });

  it("draws a visible translucent disc around the triangle", () => {
    const png = drawPlayBadge(blankFrame(200, 120));
    const radius = Math.round(Math.min(200, 120) * 0.11);
    const discOnly = pixelAt(png, 100 - Math.round(radius * 0.7), 60);
    // Lifted off black by the white disc, but not the solid accent colour.
    expect(discOnly[0]).toBeGreaterThan(150);
    expect(discOnly[0]).toBeLessThan(255);
    expect(discOnly[0]).toBe(discOnly[1]);
    expect(discOnly[1]).toBe(discOnly[2]);
  });

  it("returns the same image object so it can be chained", () => {
    const png = blankFrame(64, 64);
    expect(drawPlayBadge(png)).toBe(png);
  });
});

describe("byte budget", () => {
  it("passes at or below the limit and reports the overshoot above it", () => {
    expect(checkBudget(1_000, 2_000)).toMatchObject({ ok: true, overBy: 0 });
    expect(checkBudget(2_000, 2_000).ok).toBe(true);
    expect(checkBudget(2_500, 2_000)).toMatchObject({ ok: false, overBy: 500 });
  });
});

describe("shared tour arguments", () => {
  it("defaults to the local dev server and desktop viewport", () => {
    expect(parseDemoArgs(["node", "script.mjs"])).toEqual({
      baseUrl: "http://127.0.0.1:5173",
      mobile: false,
    });
  });

  it("accepts an explicit base url and the mobile flag", () => {
    expect(parseDemoArgs(["node", "s.mjs", "--base-url", "https://demo.local", "--mobile"])).toEqual(
      { baseUrl: "https://demo.local", mobile: true },
    );
  });

  it("rejects a relative base url and unknown flags", () => {
    expect(() => parseDemoArgs(["node", "s.mjs", "--base-url", "localhost:5199"])).toThrow(
      /absolute http\(s\) URL/,
    );
    expect(() => parseDemoArgs(["node", "s.mjs", "--turbo"])).toThrow(/Unknown argument/);
  });
});
