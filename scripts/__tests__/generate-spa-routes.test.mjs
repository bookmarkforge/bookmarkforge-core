// @vitest-environment node
/**
 * scripts/__tests__/generate-spa-routes.test.mjs
 *
 * The writer half of the SPA route contract. check:spa-routes proves the
 * SHIPPED configs agree with the app; these tests drive the generator itself in
 * a throwaway project root, because the writer is what drifted last: it
 * de-duplicated before stripping the trailing slash, so every rule shipped
 * twice and the `/settings/` twin was gone, and it rewrote whole files
 * CRLF -> LF.
 *
 * The expectation is the same fixture the contract tests build: every shell
 * route and its trailing-slash twin, one rule each, in app order.
 */
import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  APP_ROUTES_SOURCE,
  APP_SHELL,
  extractClientRoutes,
  pathVariants,
  shellRoutes,
} from "../app-routes.mjs";
import { HOST_FILES, assessHostContracts } from "../spa-route-contract.mjs";
import { renderNginxPolicy } from "../nginx-render.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCRIPT = join(ROOT, "scripts", "generate-spa-routes.mjs");
const OWNED = Object.values(HOST_FILES).filter((path) => path !== "public/nginx.conf");

/** A route table with a public page and the router catch-all in it. */
const FIXTURE_ROUTES = `
<Routes>
  <Route path="/" element={<Landing />} />
  <Route path="/vault" element={<Vault />} />
  <Route path="/privacy" element={<Legal />} />
  <Route path="*" element={<Navigate to="/" />} />
</Routes>
`;

/** What each host must end up saying: one rule per route and per twin. */
const expectedRules = (clientRoutes) => shellRoutes(clientRoutes).flatMap(pathVariants);

const shellSources = (vercel) =>
  JSON.parse(vercel).rewrites.filter((rule) => rule.destination === APP_SHELL).map((rule) => rule.source);

const shellRedirectRows = (text) =>
  text
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/))
    .filter(([, target, status]) => target === APP_SHELL && Number(status) === 200)
    .map(([source]) => source);

const shellNetlifyBlocks = (text) =>
  [...text.matchAll(/\[\[redirects\]\]\s+from = "([^"]+)"\s+to = "([^"]+)"\s+status = (\d+)/g)]
    .filter(([, , to, status]) => to === APP_SHELL && Number(status) === 200)
    .map(([, from]) => from);

/**
 * A throwaway project root: the route source the generator parses, plus the
 * three configs it owns, seeded with a stale shell rule, hand-written content
 * and CRLF endings — the way the repo ships them.
 */
function withWorkspace(appRoutes, fn) {
  const cwd = mkdtempSync(join(tmpdir(), "generate-spa-routes-"));
  const seeds = {
    "vercel.json": `${JSON.stringify(
      {
        buildCommand: "npm run build",
        rewrites: [
          { source: "/old-route", destination: APP_SHELL },
          { source: "/help", destination: "/help.html" },
        ],
      },
      null,
      2,
    )}\n`,
    "public/_redirects": [
      "# SPA routing — this header must survive",
      "/legacy-marketing /old.html 200",
      `/old-route ${APP_SHELL} 200`,
      "/es/* /es.html 200",
      "",
    ].join("\n"),
    "netlify.toml": [
      "[build]",
      '  publish = "dist"',
      "",
      "[[redirects]]",
      `  from = "/old-route"`,
      `  to = "${APP_SHELL}"`,
      "  status = 200",
      "",
      "[[redirects]]",
      '  from = "/es/*"',
      '  to = "/es.html"',
      "  status = 200",
      "",
    ].join("\n"),
  };
  mkdirSync(join(cwd, dirname(APP_ROUTES_SOURCE)), { recursive: true });
  mkdirSync(join(cwd, "public"), { recursive: true });
  writeFileSync(
    join(cwd, APP_ROUTES_SOURCE),
    appRoutes ?? readFileSync(join(ROOT, APP_ROUTES_SOURCE), "utf8"),
    "utf8",
  );
  for (const [path, body] of Object.entries(seeds)) {
    writeFileSync(join(cwd, path), body.replaceAll("\n", "\r\n"), "utf8");
  }
  try {
    return fn({
      run: () => spawnSync(process.execPath, [SCRIPT], { cwd, encoding: "utf8" }),
      read: (path) => readFileSync(join(cwd, path), "utf8"),
    });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

/** Run the generator once, failing the test with the script's own stderr. */
function generate({ run, read }) {
  const result = run();
  expect(result.status, result.stderr).toBe(0);
  return read;
}

describe("generate-spa-routes", () => {
  it("writes every shell route and its trailing-slash twin exactly once", () =>
    withWorkspace(undefined, (workspace) => {
      const read = generate(workspace);
      const expected = expectedRules(extractClientRoutes(readFileSync(join(ROOT, APP_ROUTES_SOURCE), "utf8")));
      expect(shellSources(read("vercel.json"))).toEqual(expected);
      expect(shellRedirectRows(read(HOST_FILES.redirects))).toEqual(expected);
      expect(shellNetlifyBlocks(read(HOST_FILES.netlify))).toEqual(expected);
    }));

  it("derives the rules from the route source it is given, never the public surface", () =>
    withWorkspace(FIXTURE_ROUTES, (workspace) => {
      const read = generate(workspace);
      expect(shellRedirectRows(read(HOST_FILES.redirects))).toEqual([
        "/capture",
        "/capture/",
        "/vault",
        "/vault/",
      ]);
    }));

  it("satisfies the contract the gate checks once its owner writes nginx", () =>
    withWorkspace(undefined, (workspace) => {
      const read = generate(workspace);
      const result = assessHostContracts({
        clientRoutes: shellRoutes(),
        files: {
          vercel: read(HOST_FILES.vercel),
          redirects: read(HOST_FILES.redirects),
          netlify: read(HOST_FILES.netlify),
          nginx: renderNginxPolicy(),
        },
      });
      expect(result.failures).toEqual([]);
    }));

  it("keeps the hand-written config, drops the stale rules and respects the ordering", () =>
    withWorkspace(undefined, (workspace) => {
      const read = generate(workspace);
      const redirects = read(HOST_FILES.redirects);
      expect(redirects).toContain("# SPA routing — this header must survive");
      expect(redirects).toContain("/legacy-marketing /old.html 200");
      expect(shellRedirectRows(redirects)).not.toContain("/old-route");
      const rows = redirects.split(/\r?\n/);
      expect(rows.findIndex((row) => row.startsWith("/capture "))).toBeLessThan(
        rows.findIndex((row) => row.startsWith("/es/*")),
      );
      expect(read(HOST_FILES.netlify)).toContain('publish = "dist"');
      const vercel = JSON.parse(read(HOST_FILES.vercel));
      expect(vercel.buildCommand).toBe("npm run build");
      expect(vercel.rewrites).toContainEqual({ source: "/help", destination: "/help.html" });
    }));

  it("writes each file back with its own line endings, twice in a row", () =>
    withWorkspace(undefined, (workspace) => {
      generate(workspace);
      const first = OWNED.map((path) => workspace.read(path));
      for (const text of first) {
        expect(text).toContain("\r\n");
        expect(text.replaceAll("\r\n", "")).not.toContain("\n");
      }
      expect(workspace.run().status).toBe(0);
      expect(OWNED.map((path) => workspace.read(path))).toEqual(first);
    }));
});
