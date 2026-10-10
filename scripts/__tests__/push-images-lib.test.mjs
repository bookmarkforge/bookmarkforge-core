import { describe, it, expect } from "vitest";
import {
  resolveRegistry,
  planPushTargets,
  pushImages,
} from "../push-images-lib.mjs";

describe("resolveRegistry", () => {
  it("acepta un host:port válido y normaliza el / final", () => {
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

  it("rechaza formato inválido (schemes, chars prohibidos)", () => {
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
  it("genera web + api con local y remote por sha", () => {
    const plan = planPushTargets("deadbeef", "reg.io:5000");
    expect(plan).toEqual([
      { name: "web", local: "bookmarkforge/web:deadbeef", remote: "reg.io:5000/bookmarkforge/web:deadbeef" },
      { name: "api", local: "bookmarkforge/api:deadbeef", remote: "reg.io:5000/bookmarkforge/api:deadbeef" },
    ]);
  });

  it("devuelve [] con sha inválido o sin registro", () => {
    expect(planPushTargets("", "reg.io")).toEqual([]);
    expect(planPushTargets("zz", "reg.io")).toEqual([]); // <7 hex
    expect(planPushTargets("deadbeef", "")).toEqual([]);
  });

  it("acepta hex mayúsculas", () => {
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
      runVisible: () => true, // unit: la visibilidad se prueba aparte
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

  it("aborta en 'tag' y deja de empujar si el primer tag falla", () => {
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
    expect(calls).toBe(1); // no empuja nada más
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

  it("fail-closed ante sha inválido", () => {
    const res = pushImages({
      sha: "zz",
      registry: "reg.io",
      run: () => 0,
      runVisible: () => true,
    });
    expect(res.ok).toBe(false);
    expect(res.step).toBe("config");
  });

  it("fail-closed ante registro inválido antes de ejecutar comandos", () => {
    const ran = [];
    const res = pushImages({ sha: "deadbeef", registry: "reg.io/path", run: (cmd) => { ran.push(cmd); return 0; }, runVisible: () => true });
    expect(res).toEqual({ ok: false, step: "config", remote: "<invalid configuration>" });
    expect(ran).toEqual([]);
  });

  it("verifica visibilidad de CADA imagen tras el push (manifest inspect)", () => {
    const run = () => 0; // push OK
    const llamadas = []; // qué remotes se inspeccionaron
    const runVisible = (remote) => {
      llamadas.push(remote);
      return true;
    };
    const res = pushImages({ sha: "deadbeef", registry: "reg.io:5000", run, runVisible });
    expect(res.ok).toBe(true);
    expect(llamadas).toEqual([
      "reg.io:5000/bookmarkforge/web:deadbeef",
      "reg.io:5000/bookmarkforge/api:deadbeef",
    ]);
  });

  it("FAIL step:'not-visible' si el push web no es consultable en el registro", () => {
    const llamadas = [];
    const runVisible = (remote) => {
      llamadas.push(remote);
      return llamadas.length < 1; // el PRIMER inspect (web) falla
    };
    const res = pushImages({ sha: "deadbeef", registry: "reg.io:5000", run: () => 0, runVisible });
    expect(res).toEqual({
      ok: false,
      step: "not-visible",
      remote: "reg.io:5000/bookmarkforge/web:deadbeef",
    });
    expect(llamadas).toHaveLength(1); // no sigue inspeccionando el api
  });

  it("no usa shell interpolation per tag/push né per l'inspect remoto", async () => {
    const source = await import("node:fs/promises").then(({ readFile }) => readFile("scripts/push-images-lib.mjs", "utf8"));
    expect(source).toContain('spawnSync("docker", ["buildx", "imagetools", "inspect", remoteRef]');
    expect(source).toContain('["docker", "tag", local, remote]');
    expect(source).toContain('["docker", "push", remote]');
    expect(source).not.toContain("execSync(`docker buildx imagetools inspect ${remoteRef}");
    expect(source).not.toContain("run(`docker tag ${local} ${remote}`)");
    expect(source).not.toContain("run(`docker push ${remote}`)");
  });

  it("FAIL step:'not-visible' si el push api no es visible (web sí)", () => {
    const runVisible = (remote) => remote.endsWith("/bookmarkforge/web:deadbeef");
    const res = pushImages({ sha: "deadbeef", registry: "reg.io:5000", run: () => 0, runVisible });
    expect(res).toEqual({
      ok: false,
      step: "not-visible",
      remote: "reg.io:5000/bookmarkforge/api:deadbeef",
    });
  });
});