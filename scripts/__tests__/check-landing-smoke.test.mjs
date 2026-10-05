/**
 * scripts/__tests__/check-landing-smoke.test.mjs
 *
 * ADR-062's gate ships two halves, and this suite covers both without needing a
 * browser: the `_redirects` routing contract (driven over real HTTP against a
 * sandbox tree, including the `.gif`-served-as-HTML trap the ADR records), the
 * per-route judgements (navigation identity, critical resources, links), the
 * classifier counts the audit ledger publishes, and the environment failure
 * path when Chromium is absent.
 */
import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LANDING_LOCALES } from "../landing-registry.mjs";
import {
  ROUTES,
  RTL_CODES,
  SmokeEnvironmentError,
  allowedContentTypes,
  classifyCriticalResources,
  createStaticServer,
  expectedIdentity,
  extractInternalLinks,
  linkFindings,
  localPath,
  matchGlob,
  navigationFindings,
  parseRedirects,
  resolveRequest,
  resourceFindings,
  smokeRoutes,
} from "../check-landing-smoke.mjs";

const ROOT = process.cwd();

const REDIRECTS = `# SPA routing
/       /landing.html  200
/es     /es.html       200
/es/    /es.html       200
/app    /index.html    200
/old    /privacy-and-terms.html  301

/* 
  !/index.html
  !/*.js
  !/*.png
  /index.html 200
`;

/** A served tree with the shape `dist/` has (shell + landings + assets). */
function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), "landing-smoke-"));
  writeFileSync(join(dir, "index.html"), "<!DOCTYPE html><html lang=\"en\" dir=\"ltr\"><title>App</title></html>");
  writeFileSync(join(dir, "landing.html"), "<!DOCTYPE html><html lang=\"en\" dir=\"ltr\"><title>Landing</title></html>");
  writeFileSync(join(dir, "es.html"), "<!DOCTYPE html><html lang=\"es\" dir=\"ltr\"><title>Landing ES</title></html>");
  writeFileSync(join(dir, "app.js"), "console.log(1)\n");
  writeFileSync(join(dir, "retired.gif"), "\u0000GIF89a");
  writeFileSync(join(dir, "_redirects"), REDIRECTS);
  return dir;
}

/** Start the contract server on an ephemeral port and return a probe. */
async function withServer(dir, run) {
  const redirects = parseRedirects(readFileSync(join(dir, "_redirects"), "utf8"));
  const server = createStaticServer({ root: dir, redirects });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    return await run(base);
  } finally {
    server.close();
  }
}

describe("the 31 registry routes", () => {
  it("is the 30 landings plus the Pocket page", () => {
    expect(ROUTES).toHaveLength(31);
    expect(ROUTES.filter((entry) => entry.route.endsWith("/pocket-alternative"))).toEqual([
      { route: "/pocket-alternative", locale: "en" },
    ]);
    expect(ROUTES[0]).toEqual({ route: "/", locale: "en" });
    expect(new Set(ROUTES.map((entry) => entry.route)).size).toBe(31);
  });

  it("expects the translation's own lang/dir, RTL only where the generator is", () => {
    expect(RTL_CODES).toEqual(new Set(["ar", "he"]));
    expect(expectedIdentity("/es/")).toEqual({ locale: "es", dir: "ltr" });
    expect(expectedIdentity("/ar/")).toEqual({ locale: "ar", dir: "rtl" });
    expect(expectedIdentity("/he/")).toEqual({ locale: "he", dir: "rtl" });
    expect(expectedIdentity("/pocket-alternative")).toEqual({ locale: "en", dir: "ltr" });
    expect(expectedIdentity("/nowhere")).toBe(null);
  });
});

describe("_redirects parsing", () => {
  const redirects = parseRedirects(REDIRECTS);

  it("reads the 200 rewrites and the 301", () => {
    expect(redirects.rewrites).toContainEqual({ from: "/", to: "/landing.html", status: 200 });
    expect(redirects.rewrites).toContainEqual({ from: "/es", to: "/es.html", status: 200 });
    expect(redirects.rewrites).toContainEqual({
      from: "/old",
      to: "/privacy-and-terms.html",
      status: 301,
    });
  });

  it("attaches the exclusions and the SPA target to the splat", () => {
    expect(redirects.splat.exclusions).toEqual(["/index.html", "/*.js", "/*.png"]);
    expect(redirects.splat.to).toBe("/index.html");
    expect(redirects.splat.status).toBe(200);
  });

  it("matches Netlify-style globs, nesting included", () => {
    expect(matchGlob("/*.js", "/app.js")).toBe(true);
    expect(matchGlob("/*.js", "/deep/app.js")).toBe(true);
    expect(matchGlob("/*.js", "/app.json")).toBe(false);
    expect(matchGlob("/index.html", "/index.html")).toBe(true);
    expect(matchGlob("/index.html", "/index.htmlx")).toBe(false);
  });
});

describe("the routing contract as served", () => {
  it("resolves a rewrite, a direct file, the splat and the 404", () => {
    const dir = sandbox();
    const redirects = parseRedirects(REDIRECTS);
    const at = (pathname) => resolveRequest({ pathname, root: dir, redirects });
    expect(at("/")).toMatchObject({ kind: "file", status: 200 });
    expect(at("/")).not.toHaveProperty("fallback", true);
    expect(at("/es")).toMatchObject({ kind: "file" });
    expect(at("/es/")).toMatchObject({ kind: "file" });
    expect(at("/app.js")).toMatchObject({ kind: "file" });
    expect(at("/deep/app-route")).toMatchObject({ kind: "file", fallback: true });
    expect(at("/index.html")).toMatchObject({ kind: "file" });
    expect(at("/old")).toMatchObject({ kind: "redirect", status: 301 });
    expect(at("/missing.png")).toMatchObject({ kind: "missing" });
    // Not excluded from the splat, so it gets the shell — the ADR's .gif case.
    expect(at("/missing.css")).toMatchObject({ kind: "file", fallback: true });
  });

  it("serves over HTTP with the right status, type and exclusions", async () => {
    const dir = sandbox();
    await withServer(dir, async (base) => {
      const landing = await fetch(`${base}/`);
      expect(landing.status).toBe(200);
      expect(landing.headers.get("content-type")).toContain("text/html");
      expect(await landing.text()).toContain("Landing");

      const app = await fetch(`${base}/app`);
      expect(await app.text()).toContain("App");

      const listed = await fetch(`${base}/old`, { redirect: "manual" });
      expect(listed.status).toBe(301);
      expect(listed.headers.get("location")).toBe("/privacy-and-terms.html");

      const allowedAsset = await fetch(`${base}/app.js`);
      expect(allowedAsset.status).toBe(200);
      expect(allowedAsset.headers.get("content-type")).toContain("javascript");

      // Excluded from the splat: an absent asset is a 404, never the shell.
      expect((await fetch(`${base}/missing.js`)).status).toBe(404);
      expect((await fetch(`${base}/missing.png`)).status).toBe(404);
    });
  });

  it("reproduces the retired-GIF trap the ADR records", async () => {
    const dir = sandbox();
    await withServer(dir, async (base) => {
      // `.gif` is NOT excluded from the splat, so a retired GIF answers 200
      // with the shell's HTML: no 404, no console error, broken image.
      const response = await fetch(`${base}/retired-old.gif`);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/html");
      // Only the served type reveals it — which is what the gate checks.
      expect(
        resourceFindings({
          path: "/retired-old.gif",
          route: "/",
          status: response.status,
          bodyLength: 42,
          contentType: response.headers.get("content-type"),
        }).join("\n"),
      ).toMatch(/served as "text\/html", expected image\/gif/);
      // The real GIF on disk is served as a GIF and passes.
      expect(
        resourceFindings({
          path: "/retired.gif",
          route: "/",
          status: 200,
          bodyLength: 7,
          contentType: "image/gif",
        }),
      ).toEqual([]);
    });
  });

  it("refuses to serve a tree with no shell, with an actionable hint", async () => {
    const dir = mkdtempSync(join(tmpdir(), "landing-smoke-empty-"));
    const { startLocalServer } = await import("../check-landing-smoke.mjs");
    await expect(startLocalServer(dir)).rejects.toThrow(/run `npm run build:ci` first/);
    await expect(startLocalServer(dir)).rejects.toBeInstanceOf(SmokeEnvironmentError);
  });
});

describe("per-route judgements", () => {
  it("fails a wrong lang, a wrong dir and an empty title", () => {
    expect(navigationFindings({ route: "/ar/", status: 200, lang: "ar", dir: "rtl", title: "x" })).toEqual([]);
    expect(
      navigationFindings({ route: "/de/", status: 200, lang: "en", dir: "ltr", title: "x" }).join("\n"),
    ).toMatch(/declares lang="en", expected "de"/);
    expect(
      navigationFindings({ route: "/ar/", status: 200, lang: "ar", dir: "ltr", title: "x" }).join("\n"),
    ).toMatch(/declares dir="ltr", expected "rtl"/);
    expect(
      navigationFindings({ route: "/es/", status: 200, lang: "es", dir: "ltr", title: "  " }).join("\n"),
    ).toMatch(/empty <title>/);
    expect(
      navigationFindings({ route: "/es/", status: 404, lang: null, dir: null, title: "" }).join("\n"),
    ).toMatch(/answered HTTP 404, expected 200/);
  });

  it("judges a critical resource on status, body and served type", () => {
    expect(resourceFindings({ path: "/landing.css", route: "/", status: 200, bodyLength: 10, contentType: "text/css" })).toEqual([]);
    expect(
      resourceFindings({ path: "/landing.css", route: "/", status: 404, bodyLength: 0, contentType: "text/html" }).join("\n"),
    ).toMatch(/answered HTTP 404/);
    expect(
      resourceFindings({ path: "/landing.css", route: "/", status: 200, bodyLength: 0, contentType: "text/css" }).join("\n"),
    ).toMatch(/empty body/);
    expect(allowedContentTypes("/x.gif")).toEqual(["image/gif"]);
    expect(allowedContentTypes("/x.bmf")).toBe(null);
  });

  it("requires every same-origin link to answer 200", () => {
    expect(linkFindings({ path: "/es/", route: "/", status: 200 })).toEqual([]);
    expect(linkFindings({ path: "/es/", route: "/", status: 404 }).join("\n")).toMatch(
      /answered HTTP 404, expected 200/,
    );
  });

  it("keeps the query string but drops the fragment, and stays same-origin", () => {
    expect(localPath("/de/?lang=de", { page: "/" })).toBe("/de/?lang=de");
    expect(localPath("/de/#pricing", { page: "/" })).toBe("/de/");
    expect(localPath("https://elsewhere.example/x", { page: "/" })).toBe(null);
    expect(localPath("mailto:a@b.c", { page: "/" })).toBe(null);
    expect(localPath("#anchor", { page: "/" })).toBe(null);
  });
});

describe("the counts the audit ledger publishes", () => {
  const pageFiles = [
    ...LANDING_LOCALES.map((locale) => locale.file),
    "public/pocket-alternative.html",
  ];
  const pages = pageFiles.map((file) => readFileSync(join(ROOT, file), "utf8"));

  const resources = new Set();
  const links = new Set();
  for (const html of pages) {
    for (const resource of classifyCriticalResources(html)) resources.add(resource);
    for (const link of extractInternalLinks(html, { page: "/" })) links.add(link);
  }

  it("sees 15 critical resources across the 31 pages", () => {
    expect([...resources].sort()).toEqual([
      "/apple-touch-icon.png",
      "/brand-tokens.css",
      "/favicon.png",
      "/landing.css",
      "/landing.js",
      "/logo-64.png",
      "/manifest.json",
      "/og-image-de.png",
      "/og-image-es.png",
      "/og-image-fr.png",
      "/og-image-it.png",
      "/og-image-pricing.png",
      "/og-image-pt.png",
      "/og-image.png",
      "/pocket-alternative.css",
    ]);
  });

  it("sees 94 internal links across the 31 pages", () => {
    expect(links.size).toBe(94);
    expect(links.has("/pocket-alternative")).toBe(true);
    expect(links.has("/app")).toBe(true);
    expect(links.has("/?lang=en")).toBe(true);
  });
});

describe("the browser half", () => {
  /** The smallest Playwright-shaped browser that drives the loop. */
  function fakeBrowser({ html, gotoStatus = 200 }) {
    return {
      closed: false,
      async newContext() {
        return {
          async newPage() {
            return {
              handlers: {},
              on(event, handler) {
                this.handlers[event] = handler;
              },
              async route() {},
              async goto() {
                return { status: () => gotoStatus, text: async () => html };
              },
              async waitForLoadState() {},
              async getAttribute(_selector, name) {
                return name === "lang" ? "en" : "ltr";
              },
              async title() {
                return "Landing";
              },
              async close() {},
            };
          },
          async close() {},
        };
      },
      async close() {
        this.closed = true;
      },
    };
  }

  const PAGE = `<!DOCTYPE html><html lang="en" dir="ltr"><title>Landing</title>
    <link rel="stylesheet" href="/landing.css">
    <a href="/es/">ES</a>
    <a href="https://elsewhere.example/">away</a>
  </html>`;

  const fetchOk = async () => ({
    status: 200,
    headers: { get: () => "text/css" },
    arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
  });

  it("walks the routes and counts what it checked", async () => {
    const result = await smokeRoutes({
      baseUrl: "http://127.0.0.1:9",
      routes: [{ route: "/", locale: "en" }],
      launch: async () => fakeBrowser({ html: PAGE }),
      fetchImpl: fetchOk,
    });
    expect(result.failures).toEqual([]);
    expect(result.counts).toEqual({ routes: 1, resources: 1, links: 1 });
  });

  it("reports a broken link from the served surface", async () => {
    const result = await smokeRoutes({
      baseUrl: "http://127.0.0.1:9",
      routes: [{ route: "/", locale: "en" }],
      launch: async () => fakeBrowser({ html: PAGE }),
      fetchImpl: async (url) => ({
        status: url.includes("landing.css") ? 200 : 404,
        headers: { get: () => "text/html" },
        arrayBuffer: async () => new Uint8Array([1]).buffer,
      }),
    });
    expect(result.failures.join("\n")).toMatch(/link: \/es\/ \(linked from \/\) answered HTTP 404/);
  });

  it("turns a missing Chromium into an actionable environment error", async () => {
    await expect(
      smokeRoutes({
        baseUrl: "http://127.0.0.1:9",
        launch: async () => {
          throw new Error("browserType.launch: Executable doesn't exist");
        },
      }),
    ).rejects.toThrow(/npx playwright install chromium/);
    await expect(
      smokeRoutes({
        baseUrl: "http://127.0.0.1:9",
        launch: async () => {
          throw new Error("browserType.launch: Executable doesn't exist");
        },
      }),
    ).rejects.toBeInstanceOf(SmokeEnvironmentError);
  });
});
