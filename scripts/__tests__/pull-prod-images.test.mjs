import { describe, it, expect } from "vitest";
import {
  planPullTargets,
  validateRegistry,
  isPrimed,
} from "../pull-prod-images.mjs";

// Helpers to build lines of `docker images --format "{{.Repository}}:{{.Tag}}"`.
const web = (sha) => `bookmarkforge/web:${sha}`;
const api = (sha) => `bookmarkforge/api:${sha}`;

describe("validateRegistry", () => {
  it("acepta host y host:puerto, pero no rutas ni traversal", () => {
    expect(validateRegistry("registry.example.com")).toBe(true);
    expect(validateRegistry("registry.example.com:5000")).toBe(true);
    expect(validateRegistry("registry.example.com:65535")).toBe(true);
    expect(validateRegistry("registry.example.com/path")).toBe(false);
    expect(validateRegistry("registry..example.com")).toBe(false);
    expect(validateRegistry("registry.example.com\\path")).toBe(false);
    expect(validateRegistry("registry.example.com:0")).toBe(false);
    expect(validateRegistry("registry.example.com:65536")).toBe(false);
  });
});

describe("planPullTargets", () => {
  it("composes remote+local for web and api with a valid sha and registry", () => {
    const targets = planPullTargets("a1b2c3d", "registry.example.com:5000");
    expect(targets).toHaveLength(2);
    expect(targets[0]).toEqual({
      name: "web",
      remote: "registry.example.com:5000/bookmarkforge/web:a1b2c3d",
      local: "bookmarkforge/web:a1b2c3d",
    });
    expect(targets[1]).toEqual({
      name: "api",
      remote: "registry.example.com:5000/bookmarkforge/api:a1b2c3d",
      local: "bookmarkforge/api:a1b2c3d",
    });
  });

  it("normalises the trailing / of the registry", () => {
    const targets = planPullTargets("a1b2c3d", "reg.example.com:5000/");
    expect(targets[0].remote).toBe("reg.example.com:5000/bookmarkforge/web:a1b2c3d");
  });

  it("returns [] with an empty or malformed sha (nothing to prime)", () => {
    expect(planPullTargets("", "reg.example.com")).toEqual([]);
    expect(planPullTargets("not-hex", "reg.example.com")).toEqual([]);
    expect(planPullTargets("a1b2c", "reg.example.com")).toEqual([]); // <7 hex
    expect(planPullTargets("a1b2c3d".repeat(2), "reg.example.com")).toEqual([]); // >12 hex
  });

  it("returns [] with no registry configured, or a valid sha but no registry", () => {
    expect(planPullTargets("a1b2c3d", "")).toEqual([]);
    expect(planPullTargets("a1b2c3d", null)).toEqual([]);
    expect(planPullTargets("a1b2c3d", "   ")).toEqual([]);
  });

  it("accepts uppercase hex letters", () => {
    const targets = planPullTargets("ABCDEF7", "reg.example.com");
    expect(targets).toHaveLength(2);
    expect(targets[0].local).toBe("bookmarkforge/web:ABCDEF7");
  });
});

describe("isPrimed", () => {
  it("true only if web AND api are local for that sha", () => {
    const list = [web("a1b2c3d"), api("a1b2c3d")];
    expect(isPrimed("a1b2c3d", list)).toBe(true);
  });

  it("false if either of the two images for that sha is missing", () => {
    expect(isPrimed("a1b2c3d", [web("a1b2c3d")])).toBe(false); // falta api
    expect(isPrimed("a1b2c3d", [api("a1b2c3d")])).toBe(false); // falta web
    expect(isPrimed("a1b2c3d", [])).toBe(false);
  });

  it("is not confused by other tags (another sha, latest, another host)", () => {
    const list = [web("zz99999"), web("latest"), api("a1b2c3d")];
    // the requested sha's web is NOT there (only web:zz99999), api is → not primed
    expect(isPrimed("a1b2c3d", list)).toBe(false);
  });

  it("true regardless of listing order", () => {
    const list = [api("a1b2c3d"), "web/otro:tag", web("a1b2c3d")];
    expect(isPrimed("a1b2c3d", list)).toBe(true);
  });

  it("false with an empty/invalid sha or if the listing failed (non-array)", () => {
    expect(isPrimed("", [web("a"), api("a")])).toBe(false);
    expect(isPrimed("a1b2c3d", null)).toBe(false);
    expect(isPrimed("a1b2c3d", undefined)).toBe(false);
  });
});