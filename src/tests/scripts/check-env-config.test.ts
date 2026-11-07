/**
 * Unit + integration tests for scripts/check-env-config.mjs
 *
 * Unit: the pure functions `stripStringsAndComments`,
 * `scanDirectReadsInSource` and `runEnvConfigChecks` are exercised with
 * in-memory source fixtures. Integration: the CLI is spawned (a) against
 * the real repo (exit 0) and (b) against a temp-dir scaffold containing an
 * unregistered `process.env.X` direct read (exit 1).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  stripStringsAndComments,
  scanDirectReadsInSource,
  runEnvConfigChecks,
  runComposeEnvContract,
} from "../../../scripts/check-env-config.mjs";
import { runNpm } from "./run-npm";

// ─── Unit: pure functions ────────────────────────────────────────────

describe("scanDirectReadsInSource (unit)", () => {
  it("finds direct import.meta.env and process.env reads", () => {
    const src = [
      "const a = import.meta.env.VITE_API_URL;",
      "const b = process.env.NODE_ENV;",
      "const c = process.env?.VITE_DB_NAME;",
    ].join("\n");
    const found = scanDirectReadsInSource(src, "src/foo.ts");
    expect(found.get("VITE_API_URL")?.[0]).toEqual({ file: "src/foo.ts", line: 1 });
    expect(found.get("NODE_ENV")?.[0]).toEqual({ file: "src/foo.ts", line: 2 });
    expect(found.get("VITE_DB_NAME")?.[0]).toEqual({ file: "src/foo.ts", line: 3 });
  });

  it("ignores reads inside comments and string literals", () => {
    const src = [
      "// process.env.SECRET is a comment",
      "const docs = \"import.meta.env.VITE_EXAMPLE\";",
      "const ok = process.env.ALLOWED;",
    ].join("\n");
    const found = scanDirectReadsInSource(src, "src/bar.ts");
    expect(found.has("SECRET")).toBe(false);
    expect(found.has("VITE_EXAMPLE")).toBe(false);
    expect(found.get("ALLOWED")).toBeDefined();
  });

  it("neutralizes bracket-literal reads (stripped as strings — existing gate behavior)", () => {
    // `process.env['X']` / `process.env?.['X']` are treated as string
    // literals by the stripper, so they are NOT flagged. The registry
    // accessors use dynamic keys (`env[name]`), which never match anyway.
    const src = "const c = process.env?.['VITE_DB_NAME'];";
    const found = scanDirectReadsInSource(src, "src/foo.ts");
    expect(found.size).toBe(0);
  });

  it("ignores the sanctioned dynamic accessors", () => {
    const src = [
      "import { env, readDynamicEnv } from './env.config';",
      "const a = env.geminiApiKey;",
      "const b = readDynamicEnv('VITE_X');",
      "const c = import.meta.env;",
    ].join("\n");
    const found = scanDirectReadsInSource(src, "src/baz.ts");
    expect(found.size).toBe(0);
  });

  it("tracks line numbers after stripping", () => {
    const src = ["const x = 1;", "process.env.FOO;", "const y = 2;"].join("\n");
    const found = scanDirectReadsInSource(src, "src/line.ts");
    // The fixture guarantees FOO is found with a hit; `!` narrows the
    // map/index accesses without an optional chain.
    expect(found.get("FOO")![0]!.line!).toBe(2);
  });

  it("reports multiple hits per var", () => {
    const src = "process.env.FOO;\nprocess.env.FOO;";
    const found = scanDirectReadsInSource(src, "src/multi.ts");
    expect(found.get("FOO")).toHaveLength(2);
  });
});

describe("runEnvConfigChecks (unit)", () => {
  const found = new Map([
    ["VITE_GOOD", [{ file: "src/a.ts", line: 1 }]],
    ["VITE_UNREG", [{ file: "src/b.ts", line: 3 }]],
    ["VITE_BASELINED", [{ file: "src/c.ts", line: 5 }]],
  ]);

  it("reports only unregistered, unbaselined vars as violations", () => {
    const result = runEnvConfigChecks({
      allowed: new Set(["VITE_GOOD"]),
      found,
      baseline: new Map([["VITE_BASELINED", "test-only"]]),
    });
    expect(result.ok).toBe(false);
    expect(result.violations).toEqual(["src/b.ts:3  VITE_UNREG"]);
  });

  it("passes when everything is registered or baselined", () => {
    const result = runEnvConfigChecks({
      allowed: new Set(["VITE_GOOD", "VITE_UNREG"]),
      found,
      baseline: new Map([["VITE_BASELINED", "test-only"]]),
    });
    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it("flags stale baseline entries as warnings (not failures)", () => {
    const result = runEnvConfigChecks({
      allowed: new Set(["VITE_GOOD", "VITE_UNREG"]),
      found,
      baseline: new Map([
        ["VITE_BASELINED", "test-only"],
        ["VITE_GONE", "no longer read"],
      ]),
    });
    expect(result.ok).toBe(true);
    expect(result.stale).toEqual(["VITE_GONE"]);
  });
});

describe("runComposeEnvContract (unit)", () => {
  const COMPOSE = [
    "services:",
    "  web:",
    "    build:",
    "      args:",
    "        VITE_APP_VERSION: ${VITE_APP_VERSION:?VITE_APP_VERSION is required}",
    "  api:",
    "    environment:",
    "      CLIENT_EVENTS_CRITICAL_CLIENTS: ${CLIENT_EVENTS_CRITICAL_CLIENTS:?CLIENT_EVENTS_CRITICAL_CLIENTS is required}",
    "      CLIENT_EVENTS_WEBHOOK_URL: ${CLIENT_EVENTS_WEBHOOK_URL:-}",
    "      CLIENT_EVENTS_ADMIN_TOKEN: ${CLIENT_EVENTS_ADMIN_TOKEN:-}",
    "  redis:",
    "    entrypoint:",
    "      - 'exec redis-server --requirepass \"$${REDIS_PASSWORD}\"'",
  ].join("\n");

  it("flags required compose vars missing from .env.production", () => {
    const r = runComposeEnvContract({
      composeSource: COMPOSE,
      envProdSource: [
        "CLIENT_EVENTS_ADMIN_TOKEN=secret-token",
        "CLIENT_EVENTS_WEBHOOK_URL=https://hooks.example.com/x",
      ].join("\n"),
    });
    expect(r.ok).toBe(false);
    const all = r.violations.join("\n");
    expect(all).toContain("VITE_APP_VERSION");
    expect(all).toContain("CLIENT_EVENTS_CRITICAL_CLIENTS");
  });

  it("passes when all required vars are present and the webhook is https", () => {
    const r = runComposeEnvContract({
      composeSource: COMPOSE,
      envProdSource: [
        "VITE_APP_VERSION=1.0.0",
        "CLIENT_EVENTS_CRITICAL_CLIENTS=3",
        "CLIENT_EVENTS_ADMIN_TOKEN=super-secret-token",
        "CLIENT_EVENTS_WEBHOOK_URL=https://hooks.example.com/hook",
      ].join("\n"),
    });
    expect(r.ok).toBe(true);
    expect(r.violations).toEqual([]);
  });

  it("rejects a plaintext http webhook (fail-closed, matches the server)", () => {
    const r = runComposeEnvContract({
      composeSource: COMPOSE,
      envProdSource: [
        "VITE_APP_VERSION=1",
        "CLIENT_EVENTS_CRITICAL_CLIENTS=k",
        "CLIENT_EVENTS_WEBHOOK_URL=http://hooks.example.com/hook",
      ].join("\n"),
    });
    expect(r.ok).toBe(false);
    expect(r.violations.join("\n")).toContain("CLIENT_EVENTS_WEBHOOK_URL");
  });

  it("skips presence checks without .env.production (CI/dev)", () => {
    const r = runComposeEnvContract({ composeSource: COMPOSE, envProdSource: null });
    expect(r.ok).toBe(true);
    expect(r.violations).toEqual([]);
  });

  it("ignores shell-escaped $${...} and optional vars", () => {
    const r = runComposeEnvContract({
      composeSource: "x: $${NOT_A_VAR}\nok: ${OPTIONAL:-default}\n",
      envProdSource: "",
    });
    expect(r.ok).toBe(true);
    expect(r.violations).toEqual([]);
  });

  it("exempts deploy-injected vars (e.g. IMAGE_TAG) from the presence check", () => {
    // Deploy tooling (deploy-prod.mjs, rollback.mjs, staging-deploy.mjs)
    // injects IMAGE_TAG=<sha> per deploy; it must NOT live in .env.production
    // or every deploy would silently pin to one tag.
    const r = runComposeEnvContract({
      composeSource: "services:\n  web:\n    image: app:${IMAGE_TAG:?IMAGE_TAG is required}\n  api:\n    environment:\n      CLIENT_EVENTS_CRITICAL_CLIENTS: ${CLIENT_EVENTS_CRITICAL_CLIENTS:?required}\n",
      envProdSource: "CLIENT_EVENTS_CRITICAL_CLIENTS=3\n",
    });
    expect(r.ok).toBe(true);
    expect(r.violations).toEqual([]);
  });

  it("still flags other required vars while exempting deploy-injected ones", () => {
    const r = runComposeEnvContract({
      composeSource: "services:\n  web:\n    image: app:${IMAGE_TAG:?required}\n  api:\n    environment:\n      CLIENT_EVENTS_CRITICAL_CLIENTS: ${CLIENT_EVENTS_CRITICAL_CLIENTS:?required}\n",
      envProdSource: "",
    });
    expect(r.ok).toBe(false);
    expect(r.violations.join("\n")).toContain("CLIENT_EVENTS_CRITICAL_CLIENTS");
    expect(r.violations.join("\n")).not.toContain("IMAGE_TAG");
  });
});

// ─── Integration: CLI as a subprocess ────────────────────────────────

const CLI = join(process.cwd(), "scripts", "check-env-config.mjs");

function runCli(cwd: string): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync("node", [CLI], { cwd, encoding: "utf8" });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

describe("check-env-config.mjs CLI integration", () => {
  let dirtyDir: string;

  beforeAll(() => {
    dirtyDir = join(tmpdir(), `bmf-envconfig-dirty-${process.pid}`);
    rmSync(dirtyDir, { recursive: true, force: true });
    mkdirSync(join(dirtyDir, "src", "deep"), { recursive: true });
    mkdirSync(join(dirtyDir, "scripts"), { recursive: true });
    // A registry that allows only one var.
    writeFileSync(
      join(dirtyDir, "src", "env.config.ts"),
      [
        "export const ENV_REGISTRY = {",
        '  apiUrl: { envVar: "VITE_API_URL", parser: parseString },',
        "} as const;",
        "export function parseString(raw) { return raw; }",
      ].join("\n"),
    );
    // An empty baseline.
    writeFileSync(join(dirtyDir, "scripts", "env-direct-reads.baseline.json"), "{}\n");
    // A direct read that is NOT registered and NOT baselined.
    writeFileSync(
      join(dirtyDir, "src", "deep", "client.ts"),
      "const key = process.env.VITE_ROGUE_KEY;\n",
    );
  });

  afterAll(() => {
    rmSync(dirtyDir, { recursive: true, force: true });
  });

  it("exits 0 against the real repo", () => {
    const { status, stdout } = runCli(process.cwd());
    expect(status).toBe(0);
    expect(stdout).toContain("0 violations");
  });

  it("exits 1 against a scaffold with an unregistered read", () => {
    const { status, stderr } = runCli(dirtyDir);
    expect(status).toBe(1);
    expect(stderr).toContain("UNREGISTERED direct env reads");
    expect(stderr).toContain("src/deep/client.ts:1  VITE_ROGUE_KEY");
  });
});

describe("npm run check:env integration", () => {
  let npmDir: string;

  beforeAll(() => {
    npmDir = join(tmpdir(), `bmf-envconfig-npm-${process.pid}`);
    rmSync(npmDir, { recursive: true, force: true });
    mkdirSync(join(npmDir, "src", "deep"), { recursive: true });
    mkdirSync(join(npmDir, "scripts"), { recursive: true });
    // Mirror the real repo: package.json wires the documented npm script.
    writeFileSync(
      join(npmDir, "package.json"),
      JSON.stringify(
        { scripts: { "check:env": "node scripts/check-env-config.mjs" } },
        null,
        2,
      ) + "\n",
    );
    // A registry that allows only one var, an empty baseline, and a direct
    // read that is neither registered nor baselined.
    writeFileSync(
      join(npmDir, "src", "env.config.ts"),
      [
        "export const ENV_REGISTRY = {",
        '  apiUrl: { envVar: "VITE_API_URL", parser: parseString },',
        "} as const;",
        "export function parseString(raw) { return raw; }",
      ].join("\n"),
    );
    writeFileSync(
      join(npmDir, "scripts", "env-direct-reads.baseline.json"),
      "{}\n",
    );
    writeFileSync(
      join(npmDir, "src", "deep", "client.ts"),
      "const key = process.env.VITE_ROGUE_KEY;\n",
    );
    // The npm script resolves `node scripts/check-env-config.mjs` relative to cwd.
    copyFileSync(
      join(process.cwd(), "scripts", "check-env-config.mjs"),
      join(npmDir, "scripts", "check-env-config.mjs"),
    );
  });

  afterAll(() => {
    rmSync(npmDir, { recursive: true, force: true });
  });

  it("npm run check:env exits 0 against the real repo", () => {
    const { status, stdout } = runNpm(process.cwd(), "check:env");
    expect(status).toBe(0);
    expect(stdout).toContain("0 violations");
  });

  it("npm run check:env exits 1 against the unregistered-read scaffold", () => {
    const { status, stderr } = runNpm(npmDir, "check:env");
    expect(status).toBe(1);
    expect(stderr).toContain("UNREGISTERED direct env reads");
    expect(stderr).toContain("src/deep/client.ts:1  VITE_ROGUE_KEY");
  });
});
