// @vitest-environment node
/**
 * scripts/__tests__/spa-routes.test.mjs
 *
 * "Every client route is reachable on every host, the public pages stay public,
 * and an unknown path is a real 404."
 *
 * The app's routes live in src/components/app/AppRoutes.tsx (plus /capture,
 * resolved in App.tsx before the router mounts) and are root paths: /bookmarks,
 * /settings, /chat, /graph, /calendar, … Each of the four shipped hosts expresses
 * "serve this path from the app shell" in its own syntax, and they had drifted
 * apart in both directions at once:
 *
 *   - vercel.json rewired only /app and /capture, so a cold load or a bookmark
 *     to /settings was a 404 while the router happily declared it;
 *   - public/_redirects kept a `/*` splat that answered every typo with the
 *     marketing page and a 200 (and, when it matched first, swallowed /chat too);
 *   - netlify.toml had no /app route at all;
 *   - nginx fell back to the marketing index.html for every unknown path and had
 *     no /offline, /privacy or /terms route.
 *
 * check:spa-routes (scripts/check-spa-routes.mjs) is the gate; these tests pin
 * the logic, the fixtures that make it fail, and the real files.
 */
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  APP_SHELL,
  CAPTURE_ROUTE,
  HOST_PUBLIC_CLIENT_ROUTES,
  extractClientRoutes,
  isPublicSurface,
  isShellPath,
  pathVariants,
  readClientRoutes,
  shellRoutes,
} from "../app-routes.mjs";
import {
  HOST_FILES,
  REDIRECT_DYNAMIC_LIMIT,
  assessHostContracts,
  assessRedirectOrdering,
  isCatchAllSource,
  parseNginxShellPaths,
  parseRedirectRows,
  parseVercelShellPaths,
} from "../spa-route-contract.mjs";
import { LOCALIZED_LANDING_CODES } from "../landing-registry.mjs";
import { parseRedirects, resolveRequest } from "../check-landing-smoke.mjs";

const ROOT = process.cwd();
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");
const hostFiles = Object.fromEntries(
  Object.entries(HOST_FILES).map(([key, path]) => [key, existsSync(join(ROOT, path)) ? read(path) : null]),
);

describe("the route table comes from the app", () => {
  it("parses both spellings and ignores the router catch-all", () => {
    const routes = extractClientRoutes(`
      <Route path="/app" element={x} />
      <Route path={t("routeSettings", "/settings")} element={y} />
      <Route path={t("routeBookmarks", "/bookmarks")} element={z} />
      <Route path="*" element={<Navigate to="/app" />} />
    `);
    expect(routes).toEqual(["/app", "/bookmarks", "/settings"]);
    expect(routes).not.toContain("*");
  });

  it("reads the real AppRoutes.tsx without hand-typed lists", () => {
    const routes = readClientRoutes();
    expect(routes.length).toBeGreaterThan(15);
    for (const expected of ["/app", "/bookmarks", "/settings", "/chat", "/graph", "/timeline"]) {
      expect(routes, expected).toContain(expected);
    }
    // The client routes the hosts deliberately answer with a static page.
    expect(routes).toContain("/");
    expect(routes).toContain("/privacy");
    expect(routes).toContain("/terms");
  });

  it("adds /capture (declared in App.tsx, not in the router)", () => {
    expect(read("src/App.tsx")).toContain('path === "/capture"');
    expect(shellRoutes()).toContain(CAPTURE_ROUTE);
  });

  it("never treats a host-served public page as a shell route", () => {
    for (const route of HOST_PUBLIC_CLIENT_ROUTES) {
      expect(shellRoutes()).not.toContain(route);
    }
  });

  it("splits the public surface from the app surface", () => {
    for (const path of ["/", "/landing.html", "/es", "/es/", "/es/deep", "/privacy", "/terms", "/help", "/offline", "/pocket-alternative"]) {
      expect(isPublicSurface(path), path).toBe(true);
      expect(isShellPath(path), path).toBe(false);
    }
    for (const path of ["/app", "/capture", "/bookmarks", "/settings/"]) {
      expect(isPublicSurface(path), path).toBe(false);
      expect(isShellPath(path), path).toBe(true);
    }
    // Assets are files, not surface: a missing one must 404, never be the shell.
    expect(isPublicSurface("/assets/app-abc.js")).toBe(false);
    expect(isShellPath("/assets/app-abc.js")).toBe(false);
  });

  it("serves both the path and its trailing-slash twin", () => {
    expect(pathVariants("/settings")).toEqual(["/settings", "/settings/"]);
    expect(pathVariants("/")).toEqual(["/"]);
  });
});

describe("the gate can fail (fixtures)", () => {
  const base = {
    vercel: JSON.stringify({
      rewrites: shellRoutes().flatMap((r) => pathVariants(r).map((v) => ({ source: v, destination: APP_SHELL }))),
    }),
    redirects: shellRoutes().flatMap((r) => pathVariants(r).map((v) => `${v}  ${APP_SHELL}  200`)).join("\n"),
    netlify: shellRoutes()
      .flatMap((r) => pathVariants(r).map((v) => `[[redirects]]\n  from = "${v}"\n  to = "${APP_SHELL}"\n  status = 200\n`))
      .join(""),
    nginx: `location ~ ^/(?:${shellRoutes().map((r) => r.slice(1)).join("|")})/?$ {\n  try_files /app.html =404;\n}`,
  };

  it("passes on a faithful set of the four configs", () => {
    const result = assessHostContracts({ files: base });
    expect(result.failures).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("reports a route the host does not serve", () => {
    const result = assessHostContracts({
      files: { ...base, vercel: JSON.stringify({ rewrites: [{ source: "/app", destination: APP_SHELL }] }) },
    });
    expect(result.failures.some((f) => f.includes("/bookmarks") && f.includes("vercel.json"))).toBe(true);
  });

  it("reports a public page hidden behind the shell", () => {
    const result = assessHostContracts({
      files: {
        ...base,
        redirects: `${base.redirects}\n/es/*  ${APP_SHELL}  200\n`,
      },
    });
    expect(result.failures.some((f) => f.includes("/es"))).toBe(true);
  });

  it("reports a blanket fallback in every syntax", () => {
    const cases = [
      { vercel: JSON.stringify({ rewrites: [{ source: "/:path*", destination: APP_SHELL }] }) },
      { redirects: `/*\n  /index.html 200\n` },
      { netlify: `[[redirects]]\n  from = "/*"\n  to = "/index.html"\n  status = 200\n` },
      { nginx: `location / {\n  try_files $uri $uri/ /index.html;\n}` },
    ];
    for (const override of cases) {
      const result = assessHostContracts({ files: { ...base, ...override } });
      expect(
        result.failures.some((f) => f.includes("blanket fallback")),
        JSON.stringify(override),
      ).toBe(true);
    }
  });

  it("reports a config it cannot read at all", () => {
    for (const key of Object.keys(base)) {
      const result = assessHostContracts({ files: { ...base, [key]: null } });
      expect(result.failures.some((f) => f.includes(HOST_FILES[key]))).toBe(true);
    }
  });

  it("treats only root-level patterns as catch-alls", () => {
    expect(isCatchAllSource("/:path*")).toBe(true);
    expect(isCatchAllSource("/(.*)")).toBe(true);
    expect(isCatchAllSource("/app/:path*")).toBe(false);
  });
});

describe("the shipped configs satisfy the contract", () => {
  it("files exist", () => {
    for (const path of Object.values(HOST_FILES)) {
      expect(existsSync(join(ROOT, path)), path).toBe(true);
    }
  });

  it("all four serve every client route from the shell and none hides a public page", () => {
    const result = assessHostContracts({ files: hostFiles });
    expect(result.failures).toEqual([]);
    expect(result.checks).toBe(4);
  });

  it("vercel.json keeps its locale subtree and never a catch-all", () => {
    const parsed = parseVercelShellPaths(hostFiles.vercel);
    expect(parsed.catchAlls).toEqual([]);
    // The localized subtree is claimed by the locale rewrites, not by the app.
    expect(hostFiles.vercel).toContain('"/(ar|bg|cs|da|de|el|es|fi|fr|he|hi|hr|hu|id|it|ja|ko|nl|no|pl|pt|ro|ru|sv|th|tr|uk|vi|zh)/:path*"');
  });

  it("public/_redirects has no splat and no marketing fallback", () => {
    const { splats } = parseRedirectRows(hostFiles.redirects);
    expect(splats).toEqual([]);
    expect(hostFiles.redirects).not.toMatch(/^\/\*\s*$/m);
  });

  it("nginx serves the shell from a location regex and never falls back to a document", () => {
    const parsed = parseNginxShellPaths(hostFiles.nginx);
    expect(parsed.catchAlls).toEqual([]);
    expect([...parsed.shell].sort()).toEqual(shellRoutes().map((r) => r).sort());
    expect(hostFiles.nginx).toContain("try_files $uri $uri/ =404;");
  });

  it("every host serves /offline and the localized subtrees (parity the audit found missing)", () => {
    // /offline is where the app navigates when the network is gone; nginx and
    // _redirects never routed it, so the page 404'd (or served the marketing
    // page) while Vercel served it.
    expect(hostFiles.nginx).toContain("location = /offline {");
    expect(hostFiles.redirects).toMatch(/^\/offline\s+\/offline\.html\s+200$/m);
    expect(hostFiles.netlify).toMatch(/from = "\/offline"[\s\S]*?to = "\/offline\.html"/);
    expect(hostFiles.vercel).toContain('"/offline"');
    // /<lang>/<path> belongs to that locale's page (the SW navigation policy
    // denies those navigations to the shell).
    for (const code of LOCALIZED_LANDING_CODES) {
      expect(hostFiles.redirects, `_redirects ${code}`).toMatch(
        new RegExp(`^\\/${code}\\/\\*\\s+\\/${code}\\.html\\s+200$`, "m"),
      );
      expect(hostFiles.netlify, `netlify ${code}`).toContain(`from = "/${code}/*"`);
    }
    expect(hostFiles.nginx).toMatch(new RegExp(`location ~ \\^\\(${LOCALIZED_LANDING_CODES.join("|")}\\)/`));
    // …and the localized legal pages stay files, not the landing page.
    expect(hostFiles.nginx).toContain("(?!privacy-and-terms)");
  });

  it("nginx routes the legal URLs the app itself uses", () => {
    for (const route of ["/privacy", "/privacy/", "/terms", "/terms/"]) {
      expect(hostFiles.nginx, route).toMatch(
        new RegExp(`location = ${route.replace("/", "\\/")} \\{[^}]*privacy-and-terms\\.html`),
      );
    }
  });
});

describe("_redirects resolves like the edge (fixture root)", () => {
  // A miniature deployment: the shell, the 404 document and two public pages.
  const root = mkdtempSync(join(tmpdir(), "spa-routes-"));
  for (const file of ["app.html", "404.html", "landing.html", "es.html", "privacy-and-terms.html", "offline.html", "help.html"]) {
    writeFileSync(join(root, file), `<!doctype html><title>${file}</title>`);
  }
  const redirects = parseRedirects(hostFiles.redirects);
  const at = (pathname) => {
    const resolution = resolveRequest({ pathname, root, redirects });
    return resolution.kind === "file" ? resolution.file.split(/[\\/]/).pop() : null;
  };

  it("serves the shell for every client route, with and without the trailing slash", () => {
    for (const route of shellRoutes()) {
      for (const variant of pathVariants(route)) {
        expect(at(variant), variant).toBe("app.html");
      }
    }
  });

  it("serves the public pages and never the shell for them", () => {
    expect(at("/")).toBe("landing.html");
    expect(at("/es")).toBe("es.html");
    expect(at("/es/deep/path")).toBe("es.html");
    expect(at("/privacy")).toBe("privacy-and-terms.html");
    expect(at("/terms/")).toBe("privacy-and-terms.html");
    expect(at("/offline")).toBe("offline.html");
    expect(at("/help")).toBe("help.html");
  });

  it("resolves nothing for an unknown path — the 404 document answers (no splat)", () => {
    for (const path of ["/no-such-page-lol", "/no-such-page-lol/", "/missing.js", "/missing.css", "/missing.gif", "/wp-admin"]) {
      expect(at(path), path).toBeNull();
    }
  });

  it("answers the localized subtree with that locale's landing (pre-existing Vercel behaviour)", () => {
    // vercel.json already claimed /<lang>/<path>; the other three hosts now
    // match it, so a stale localized link (and the SW navigation policy, which
    // denies these to the app shell) lands on the locale's page.
    expect(at("/es/any/deep/link")).toBe("es.html");
    // The known cost of a subtree glob, unchanged from Vercel's behaviour: a
    // MISSING file under a locale prefix is answered with the landing page
    // rather than a 404. Nothing in the site references such a path (the
    // localized legal pages are real files and win the asset lookup), and the
    // root-level trap ADR-062 documents stays closed — /missing.gif above.
    expect(at("/es/typo.gif")).toBe("es.html");
  });
});

describe("the _redirects ordering contract (Cloudflare's parser)", () => {
  it("flags a static rule that sits after the first dynamic one", () => {
    const failures = assessRedirectOrdering(
      "/es/*  /es.html  200\n/settings  /app.html  200\n",
    );
    expect(failures.join(" ")).toContain("static rule(s) sit after the first dynamic rule");
  });

  it("accepts static rules first, splats last, and enforces the dynamic budget", () => {
    expect(assessRedirectOrdering("/settings  /app.html  200\n/es/*  /es.html  200\n")).toEqual(
      [],
    );
    const overBudget = [
      "/settings  /app.html  200",
      ...Array.from({ length: REDIRECT_DYNAMIC_LIMIT + 1 }, (_, i) => `/l${i}/*  /x 200`),
    ].join("\n");
    expect(assessRedirectOrdering(overBudget).join(" ")).toContain("dynamic rule(s)");
  });

  it("is green for the shipped file", () => {
    expect(assessRedirectOrdering(read("public/_redirects"))).toEqual([]);
    expect(assessHostContracts({ files: hostFiles }).ok).toBe(true);
  });
});
