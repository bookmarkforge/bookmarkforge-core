// @vitest-environment node
/**
 * scripts/__tests__/middleware-bundle.test.mjs
 *
 * functions/_middleware.js reaches the locale registry through a RELATIVE
 * specifier (`../scripts/landing-registry.mjs`). That is only valid because
 * Cloudflare compiles the whole functions/ folder into ONE self-contained ES
 * module Worker before deploying it (`wrangler pages functions build` — a
 * single esbuild invocation per deployment, minify off by default). If the
 * bundling ever changes shape — the import is externalised, the folder stops
 * being bundled, an entry becomes dynamic — the deployed worker fails at
 * import time and language negotiation dies at the edge. Every other
 * middleware test would stay green while that happens: they import the SOURCE
 * file, so they never touch the artifact production runs.
 *
 * This file therefore compiles the entry the way the runtime does (esbuild,
 * bundle, one ESM output, the runtime's resolution conditions) and then drives
 * the BUILT module: it must be self-contained, expose the Pages handler
 * contract, and negotiate exactly the registry's locale set. The negative path
 * is asserted too — a non-bundled compile must leave the relative specifier
 * behind and fail to load — so the guard cannot pass for the wrong reason.
 *
 * esbuild is the deployment bundler itself, present in the toolchain through
 * vite and tsx (single hoisted copy). If it ever stops resolving, this test
 * fails loudly, which is the signal to make it an explicit devDependency —
 * not a reason to skip the contract.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LOCALIZED_LANDING_CODES, PREF_LANGS } from "../landing-registry.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const ENTRY = join(ROOT, "functions", "_middleware.js");
const SITE = "https://bookmarkforgeapp.com";

/**
 * The build shape the deployment depends on. `conditions` mirrors the edge
 * runtime, so a dependency with a workerd/worker export condition resolves to
 * the implementation Cloudflare executes — the same resolution the deployed
 * bundle got. Node resolution is deliberately NOT used (`platform: "browser"`
 * + runtime conditions), because a bundle that only works under Node's
 * conditions is not the bundle that ships.
 */
const RUNTIME_BUILD = {
  entryPoints: [ENTRY],
  absWorkingDir: ROOT,
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  conditions: ["workerd", "worker", "browser"],
  minify: false, // wrangler's default: `--minify` is off
  write: false, // in-memory: this test never touches the working tree
  logLevel: "silent",
};

/** Compile the entry with the runtime's shape. Returns the single output. */
async function compileRuntimeBundle(overrides = {}) {
  const result = await build({ ...RUNTIME_BUILD, ...overrides });
  const outputs = result.outputFiles ?? [];
  if (outputs.length !== 1) {
    throw new Error(
      `expected exactly one bundled output module, got ${outputs.length}`,
    );
  }
  return outputs[0].text;
}

/**
 * Module specifiers the artifact still has to resolve when it loads. A
 * deployment bundle must have none: Pages loads it as a standalone module, so
 * any surviving specifier is a runtime failure waiting for the next request.
 */
export function unresolvedSpecifiers(code) {
  const found = [];
  for (const pattern of [
    /\bfrom\s*["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']/g,
    /\brequire\s*\(\s*["']([^"']+)["']/g,
  ]) {
    for (const match of code.matchAll(pattern)) {
      found.push(match[1]);
    }
  }
  return [...new Set(found)];
}

/** Set-Cookie values, whichever API this undici exposes. */
function setCookies(res) {
  if (typeof res.headers.getSetCookie === "function") {
    return res.headers.getSetCookie();
  }
  return (res.headers.get("set-cookie") ?? "").split(/,\s*(?=[^;=]+=)/);
}

function redirectPath(res) {
  const location = res.headers.get("location");
  return location === null ? null : new URL(location).pathname;
}

/** Landing path the registry says this code must reach. */
function landingFor(code) {
  return code === "en" ? "/" : `/${code}/`;
}

describe("Cloudflare Functions bundle — negotiation survives the build", () => {
  let dir;
  let code;
  let worker;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "bmf-functions-bundle-"));
    code = await compileRuntimeBundle();
  });

  afterAll(() => {
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  /**
   * Load the built module once, translating a load failure into the diagnosis
   * a maintainer needs. This is the production symptom — the edge loads the
   * deployed script as-is, so a surviving specifier is a hard load error, not
   * a downgrade — reported against the assertion that owns it instead of
   * collapsing the whole suite in beforeAll.
   */
  async function getWorker() {
    if (worker) {
      return worker;
    }
    const bundlePath = join(dir, "worker.mjs");
    writeFileSync(bundlePath, code, "utf8");
    try {
      worker = await import(pathToFileURL(bundlePath).href);
    } catch (error) {
      throw new Error(
        `the built bundle does not load (${error.message}). Surviving ` +
          `specifiers: [${unresolvedSpecifiers(code).join(", ") || "none"}] — ` +
          "the deployment pipeline must inline them (wrangler pages " +
          "functions build), otherwise the edge fails on every request.",
      );
    }
    return worker;
  }

  it("compiles functions/ into ONE self-contained ES module", () => {
    // Self-contained: nothing left for the edge to resolve at load time. This
    // is the assertion the whole file exists for — the relative registry
    // import must be INLINED, not left as a specifier.
    expect(unresolvedSpecifiers(code)).toEqual([]);
    // Single module, not a folder of chunks: Pages deploys one Worker script.
    expect(code).not.toMatch(/\bimport\s+\*/);
  });

  it("carries the registry's route table into the artifact", () => {
    // Provenance, not behaviour: if the bundle shipped a stale hand-inlined
    // copy (the shape this middleware once had — six locales while the
    // dropdown offered thirty), the newer routes would be missing here even
    // in a bundle that still negotiated the old set.
    for (const locale of LOCALIZED_LANDING_CODES) {
      expect(code, `bundle is missing the /${locale}/ route`).toContain(
        `/${locale}/`,
      );
    }
  });

  it("exposes the Pages handler contract", async () => {
    const built = await getWorker();
    expect(typeof built.onRequest).toBe("function");
  });

  it("negotiates every registry locale from the built worker", async () => {
    // The built artifact, not the source: same sweep as the source-level
    // middleware test, asserted against what production actually runs.
    const built = await getWorker();
    for (const locale of PREF_LANGS) {
      const expected = landingFor(locale);

      const byCookie = await built.onRequest({
        request: new Request(`${SITE}/`, {
          headers: { cookie: `bf_lang=${locale}` },
        }),
        next: () => new Response("next"),
      });
      if (locale === "en") {
        // "en" means "stop negotiating": the root landing, no bounce.
        expect(byCookie.status).toBe(200);
      } else {
        expect(byCookie.status).toBe(302);
        expect(redirectPath(byCookie)).toBe(expected);
      }

      const byHeader = await built.onRequest({
        request: new Request(`${SITE}/`, {
          headers: { "accept-language": `${locale}-XX,${locale};q=0.9,en;q=0.8` },
        }),
        next: () => new Response("next"),
      });
      expect(byHeader.status, `accept-language ${locale}`).toBe(
        locale === "en" ? 200 : 302,
      );
      if (locale !== "en") {
        expect(redirectPath(byHeader)).toBe(expected);
      }
    }
  });

  it("keeps the negotiated set exactly the registry's — no extras", async () => {
    // Codes chosen to be plausible neighbours the registry does NOT carry, so
    // a bundle with a hand-extended list fails here instead of silently
    // redirecting visitors to a landing that does not exist.
    const built = await getWorker();
    for (const locale of ["et", "la", "mk", "sq", "sr", "xx", "zz"]) {
      expect(PREF_LANGS).not.toContain(locale);
      const res = await built.onRequest({
        request: new Request(`${SITE}/`, {
          headers: { cookie: `bf_lang=${locale}` },
        }),
        next: () => new Response("next"),
      });
      expect(res.status, `unknown locale ${locale}`).toBe(200);
      expect(await res.text()).toBe("next");
    }
  });

  it("serves the persistent preference from the built worker", async () => {
    // The ?lang= path is the one that once 500'd on the edge (immutable
    // redirect headers, cloudflare/workers-sdk#5378): it builds its Response
    // by hand and appends two separate Set-Cookie headers, so it is worth
    // pinning on the artifact rather than only on the source.
    const built = await getWorker();
    const res = await built.onRequest({
      request: new Request(`${SITE}/?lang=ja`),
      next: () => new Response("next"),
    });
    expect(res.status).toBe(302);
    expect(redirectPath(res)).toBe("/ja/");
    const cookies = setCookies(res);
    expect(cookies).toHaveLength(2);
    const joined = cookies.join(" | ");
    expect(joined).toContain("bf_lang=ja;");
    expect(joined).toContain("nf_lang=ja;");
  });

  it("negative control: a non-bundled compile cannot be deployed", async () => {
    // Without bundling the registry import survives as a specifier and the
    // module does not even load — which is precisely the production failure
    // this guard exists to catch, so the detector is exercised for real.
    const unbundled = await compileRuntimeBundle({ bundle: false });
    expect(unresolvedSpecifiers(unbundled)).toContain(
      "../scripts/landing-registry.mjs",
    );

    const unbundledPath = join(dir, "worker-unbundled.mjs");
    writeFileSync(unbundledPath, unbundled, "utf8");
    await expect(import(pathToFileURL(unbundledPath).href)).rejects.toThrow();
  });
});
