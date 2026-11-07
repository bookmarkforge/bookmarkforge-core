import { describe, it, expect } from "vitest";
import {
  resolveRegistry,
  planPushTargets,
  pushImages,
} from "../push-images-lib.mjs";

describe("resolveRegistry", () => {
  it("accepts a valid host:port and normalises the trailing /", () => {
    const r = resolveRegistry("registry.example.com:5000/", { push: true, dryRun: false });
    expect(r).toEqual({ ok: true, registry: "registry.example.com:5000" });
  });

  it("fail-closed: sin registro y sin dry-run → { ok:false, reason:'missing' }", () => {
    expect(resolveRegistry("", { push: true, dryRun: false })).toEqual({
      ok: false,
      reason: "missing",
    });
    expect(resolveRegistry(undefined, { push: true, dryRun: false })).toEqual({
      ok: false,
      reason: "missing",
    });
    expect(resolveRegistry("   ", { push: true, dryRun: false })).toEqual({
      ok: false,
      reason: "missing",
    });
  });

  it("rejects invalid formats (schemes, forbidden chars)", () => {
    expect(resolveRegistry("http://evil", { push: true, dryRun: false })).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(resolveRegistry("a b", { push: true, dryRun: false })).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(resolveRegistry("registry..example.com", { push: true, dryRun: false })).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(resolveRegistry("registry.example.com/path", { push: true, dryRun: false })).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(resolveRegistry("registry.example.com:0", { push: true, dryRun: false })).toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it("--dry-run sin registro simula registry.example.com (no falla)", () => {
    expect(resolveRegistry("", { push: true, dryRun: true })).toEqual({
      ok: true,
      registry: "registry.example.com",
      simulated: true,
    });
  });
});

describe("planPushTargets", () => {
  it("builds web + api with local and remote per sha", () => {
    const plan = planPushTargets("deadbeef", "reg.io:5000");
    expect(plan).toEqual([
      { name: "web", local: "bookmarkforge/web:deadbeef", remote: "reg.io:5000/bookmarkforge/web:deadbeef" },
      { name: "api", local: "bookmarkforge/api:deadbeef", remote: "reg.io:5000/bookmarkforge/api:deadbeef" },
    ]);
  });

  it("returns [] with an invalid sha or no registry", () => {
    expect(planPushTargets("", "reg.io")).toEqual([]);
    expect(planPushTargets("zz", "reg.io")).toEqual([]); // <7 hex
    expect(planPushTargets("deadbeef", "")).toEqual([]);
  });

  it("accepts uppercase hex", () => {
    const plan = planPushTargets("DEADBEE", "reg.io");
    expect(plan[0].remote).toBe("reg.io/bookmarkforge/web:DEADBEE");
  });
});

describe("pushImages", () => {
  it("hace retag + push de web y api (4 comandos, argv separati) y devuelve pushed", () => {
    const ran = [];
    const run = (cmd, _o) => {
      ran.push(cmd);
      return 0;
    };
    const res = pushImages({
      sha: "deadbeef",
      registry: "reg.io:5000",
      run,
      runVisible: () => true, // unit: visibility is covered separately
    });
    expect(res).toEqual({
      ok: true,
      pushed: [
        "reg.io:5000/bookmarkforge/web:deadbeef",
        "reg.io:5000/bookmarkforge/api:deadbeef",
      ],
    });
    expect(ran).toEqual([
      ["docker", "tag", "bookmarkforge/web:deadbeef", "reg.io:5000/bookmarkforge/web:deadbeef"],
      ["docker", "push", "reg.io:5000/bookmarkforge/web:deadbeef"],
      ["docker", "tag", "bookmarkforge/api:deadbeef", "reg.io:5000/bookmarkforge/api:deadbeef"],
      ["docker", "push", "reg.io:5000/bookmarkforge/api:deadbeef"],
    ]);
  });

  it("aborts on 'tag' and stops pushing if the first tag fails", () => {
    let calls = 0;
    const run = () => {
      calls += 1;
      return calls === 1 ? 1 : 0; // primer comando (tag web) falla
    };
    const res = pushImages({
      sha: "deadbeef",
      registry: "reg.io:5000",
      run,
      runVisible: () => true,
    });
    expect(res).toEqual({ ok: false, step: "tag", remote: "reg.io:5000/bookmarkforge/web:deadbeef" });
    expect(calls).toBe(1); // does not push anything else
  });

  it("aborta en 'push' si el push web falla", () => {
    const outcomes = [0, 1, 0, 0];
    let i = 0;
    const run = () => outcomes[i++];
    const res = pushImages({
      sha: "deadbeef",
      registry: "reg.io:5000",
      run,
      runVisible: () => true,
    });
    expect(res.step).toBe("push");
    expect(res.remote).toBe("reg.io:5000/bookmarkforge/web:deadbeef");
  });

  it("fails closed on an invalid sha", () => {
    const res = pushImages({
      sha: "zz",
      registry: "reg.io",
      run: () => 0,
      runVisible: () => true,
    });
    expect(res.ok).toBe(false);
    expect(res.step).toBe("config");
  });

  it("fails closed on an invalid registry before running commands", () => {
    const ran = [];
    const res = pushImages({ sha: "deadbeef", registry: "reg.io/path", run: (cmd) => { ran.push(cmd); return 0; }, runVisible: () => true });
    expect(res).toEqual({ ok: false, step: "config", remote: "<invalid configuration>" });
    expect(ran).toEqual([]);
  });

  it("verifies the visibility of EACH image after the push (manifest inspect)", () => {
    const run = () => 0; // push OK
    const inspected = []; // which remotes were inspected
    const runVisible = (remote) => {
      inspected.push(remote);
      return true;
    };
    const res = pushImages({ sha: "deadbeef", registry: "reg.io:5000", run, runVisible });
    expect(res.ok).toBe(true);
    expect(inspected).toEqual([
      "reg.io:5000/bookmarkforge/web:deadbeef",
      "reg.io:5000/bookmarkforge/api:deadbeef",
    ]);
  });

  it("FAIL step:'not-visible' if the web push is not queryable in the registry", () => {
    const inspected = [];
    const runVisible = (remote) => {
      inspected.push(remote);
      return inspected.length < 1; // the FIRST inspect (web) fails
    };
    const res = pushImages({ sha: "deadbeef", registry: "reg.io:5000", run: () => 0, runVisible });
    expect(res).toEqual({
      ok: false,
      step: "not-visible",
      remote: "reg.io:5000/bookmarkforge/web:deadbeef",
    });
    expect(inspected).toHaveLength(1); // does not go on to inspect the api
  });

  it("does not shell-interpolate per tag/push nor for the remote inspect", async () => {
    const source = await import("node:fs/promises").then(({ readFile }) => readFile("scripts/push-images-lib.mjs", "utf8"));
    expect(source).toContain('spawnSync("docker", ["buildx", "imagetools", "inspect", remoteRef]');
    expect(source).toContain('["docker", "tag", local, remote]');
    expect(source).toContain('["docker", "push", remote]');
    expect(source).not.toContain("execSync(`docker buildx imagetools inspect ${remoteRef}");
    expect(source).not.toContain("run(`docker tag ${local} ${remote}`)");
    expect(source).not.toContain("run(`docker push ${remote}`)");
  });

  it("FAIL step:'not-visible' if the api push is not visible (web is)", () => {
    const runVisible = (remote) => remote.endsWith("/bookmarkforge/web:deadbeef");
    const res = pushImages({ sha: "deadbeef", registry: "reg.io:5000", run: () => 0, runVisible });
    expect(res).toEqual({
      ok: false,
      step: "not-visible",
      remote: "reg.io:5000/bookmarkforge/api:deadbeef",
    });
  });
});