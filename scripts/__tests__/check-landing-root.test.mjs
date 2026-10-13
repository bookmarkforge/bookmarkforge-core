// @vitest-environment node
/**
 * scripts/__tests__/check-landing-root.test.mjs
 *
 * check:landing-root exists because `/` answered with a different document
 * depending on the host: nginx, Cloudflare and Netlify rewrote it to the
 * generated `landing.html`, Vercel had no rule for `/` and served the stale
 * `dist/index.html` copy. No gate could see it, because each gate read the files
 * it owned and none compared the hosts with each other.
 *
 * A gate that only ever runs against the healthy tree proves nothing, so this
 * suite drives `assessLandingRoot` with the exact shapes that must fail:
 * a host with no rule for `/` (the original bug), a host serving another file,
 * two hosts serving different files, a temporary instead of permanent
 * retirement of /index.html, a duplicate copy back on disk, and an extra page
 * claiming the EN landing's canonical URL.
 */
import { describe, expect, it } from "vitest";
import {
  EN_LANDING_CANONICAL,
  EN_LANDING_SOURCE,
  ROOT_ROUTE,
  assessLandingRoot,
} from "../landing-root-contract.mjs";

const VERCEL = JSON.stringify({
  rewrites: [
    { source: "/", destination: "/landing.html" },
    { source: "/app", destination: "/app.html" },
  ],
  redirects: [{ source: "/index.html", destination: "/", permanent: true }],
});

const REDIRECTS = [
  "# landing rows",
  "/       /landing.html  200",
  "/index.html  /  301",
  "/es     /es.html       200",
].join("\n");

const NETLIFY = [
  '[[redirects]]\n  from = "/"\n  to = "/es/"\n  status = 302\n  conditions = { Language = ["es"] }',
  '[[redirects]]\n  from = "/"\n  to = "/landing.html"\n  status = 200',
  '[[redirects]]\n  from = "/index.html"\n  to = "/"\n  status = 301',
].join("\n\n");

const NGINX = [
  "server {",
  "    location = / {",
  '        if ($arg_lang ~* "^es$") { rewrite ^ /_lang/es last; }',
  "        rewrite ^ /landing.html last;",
  "    }",
  "",
  "    location = /index.html {",
  "        return 301 /;",
  "    }",
  "}",
].join("\n");

const HEALTHY_FILES = { vercel: VERCEL, redirects: REDIRECTS, netlify: NETLIFY, nginx: NGINX };

/** The healthy tree: the generated landing exists, nothing else does. */
const onlyLandingExists = (rel) => rel === EN_LANDING_SOURCE;

function assess({ files = HEALTHY_FILES, fileExists = onlyLandingExists, trackedHtml = [] } = {}) {
  return assessLandingRoot({
    files,
    fileExists,
    trackedHtml: [
      { file: EN_LANDING_SOURCE, content: `<link rel="canonical" href="${EN_LANDING_CANONICAL}">` },
      { file: "app.html", content: `<link rel="canonical" href="${EN_LANDING_CANONICAL}" />` },
      { file: "public/404.html", content: '<link rel="canonical" href="https://bookmarkforgeapp.com/404.html">' },
      ...trackedHtml,
    ],
  });
}

describe("healthy tree", () => {
  it("passes, judging all four host configs", () => {
    const result = assess();
    expect(result.failures).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.checks).toBe(4);
    expect(result.targets).toEqual({
      vercel: "landing.html",
      redirects: "landing.html",
      netlify: "landing.html",
      nginx: "landing.html",
    });
  });

  it("survives the language-negotiation rules (they are conditional)", () => {
    // netlify.toml's `from = "/"` 302 blocks carry a `conditions` table: the rule
    // that answers a plain GET of `/` is the 200 one the parser must pick.
    expect(assess().failures).toEqual([]);
  });
});

describe("a host that does not serve the EN landing at /", () => {
  it("catches Vercel with no rule for / (the original bug)", () => {
    const files = {
      ...HEALTHY_FILES,
      vercel: JSON.stringify({
        rewrites: [{ source: "/app", destination: "/app.html" }],
        redirects: [{ source: "/index.html", destination: "/", permanent: true }],
      }),
    };
    const result = assess({ files });
    expect(result.ok).toBe(false);
    expect(result.failures.join("\n")).toContain("vercel.json");
    expect(result.failures.join("\n")).toContain(ROOT_ROUTE);
  });

  it("catches a host serving another document", () => {
    const files = { ...HEALTHY_FILES, redirects: REDIRECTS.replace("/landing.html", "/old.html") };
    const result = assess({ files });
    expect(result.failures).toContain(
      `public/_redirects: ${ROOT_ROUTE} is served by old.html, not by landing.html (the generated EN landing)`,
    );
  });

  it("catches a host that redirects the canonical root away", () => {
    const files = { ...HEALTHY_FILES, nginx: NGINX.replace("rewrite ^ /landing.html last;", "return 302 /en/;") };
    const result = assess({ files });
    expect(result.failures.join("\n")).toContain("nothing answers /");
  });

  it("catches two hosts serving different documents", () => {
    const files = { ...HEALTHY_FILES, nginx: NGINX.replace("/landing.html", "/es.html") };
    const result = assess({ files });
    const joined = result.failures.join("\n");
    expect(joined).toContain("different documents per host");
    expect(joined).toContain("public/nginx.conf → es.html");
  });
});

describe("the retired /index.html URL", () => {
  it("catches a host that leaves it unretired", () => {
    const files = { ...HEALTHY_FILES, redirects: REDIRECTS.replace("/index.html  /  301\n", "") };
    const result = assess({ files });
    expect(result.failures.join("\n")).toContain("public/_redirects: /index.html is not retired");
  });

  it("catches a temporary redirect", () => {
    const files = { ...HEALTHY_FILES, vercel: VERCEL.replace('"permanent":true', '"permanent":false') };
    const result = assess({ files });
    expect(result.failures.join("\n")).toContain("permanent (301) redirect");
  });

  it("catches a retirement pointing somewhere else", () => {
    const files = { ...HEALTHY_FILES, netlify: NETLIFY.replace('from = "/index.html"\n  to = "/"', 'from = "/index.html"\n  to = "/help"') };
    const result = assess({ files });
    expect(result.failures.join("\n")).toContain("netlify.toml: /index.html must be a permanent (301) redirect to /");
  });
});

describe("the single generated source", () => {
  it("catches a duplicate copy back on disk", () => {
    const result = assess({ fileExists: (rel) => rel === EN_LANDING_SOURCE || rel === "public/index.html" });
    expect(result.ok).toBe(false);
    expect(result.failures.join("\n")).toContain("public/index.html: duplicate EN landing copy");
  });

  it("catches the generated landing going missing", () => {
    const result = assess({ fileExists: () => false });
    expect(result.failures.join("\n")).toContain(`${EN_LANDING_SOURCE}: missing`);
  });

  it("catches an extra page claiming the EN landing canonical", () => {
    const result = assess({
      trackedHtml: [
        { file: "public/landing-copy.html", content: `<link rel="canonical" href="${EN_LANDING_CANONICAL}">` },
      ],
    });
    expect(result.ok).toBe(false);
    expect(result.failures.join("\n")).toContain(
      `public/landing-copy.html: claims the EN landing canonical (${EN_LANDING_CANONICAL})`,
    );
  });

  it("allows the noindexed SPA shell to mirror that canonical", () => {
    expect(assess().failures).toEqual([]);
  });

  it("catches the registry and the generator disagreeing", () => {
    const result = assessLandingRoot({
      files: HEALTHY_FILES,
      fileExists: onlyLandingExists,
      landingSource: "public/other.html",
      generatorPath: EN_LANDING_SOURCE,
    });
    expect(result.failures.join("\n")).toContain("must be the generator's output");
  });
});

describe("unreadable hosts", () => {
  it("reports a missing config instead of passing silently", () => {
    const result = assess({ files: { ...HEALTHY_FILES, nginx: null } });
    expect(result.ok).toBe(false);
    expect(result.failures).toContain(
      "public/nginx.conf: missing (the root contract cannot be verified)",
    );
  });

  it("reports a malformed config instead of throwing", () => {
    const result = assess({ files: { ...HEALTHY_FILES, vercel: "{ not json" } });
    expect(result.ok).toBe(false);
    expect(result.failures.join("\n")).toContain("vercel.json: unreadable");
  });
});
