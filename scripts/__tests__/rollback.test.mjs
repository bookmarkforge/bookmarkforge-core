import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { describe, it, expect } from "vitest";
import {
  extractSha,
  selectAutoTarget,
  decideImagePath,
  shouldPullFromRegistry,
  validateRollbackTargetTag,
  validateRollbackBaseUrl,
  runNginxRenderWrite,
} from "../rollback.mjs";

/**
 * Unit tests for the pure decision logic of scripts/rollback.mjs.
 *
 * These cover the three invariants that drive the <1min rollback without
 * touching git or docker:
 *
 *   1. extractSha        — the sha (last segment of the prod-* tag) is extracted
 *                          or rejected exactly (basis for the routing).
 *   2. selectAutoTarget  — --auto picks the second-to-last DISTINCT prod-* build
 *                          by creatordate (dedupe by sha: re-deploys of the
 *                          same commit neither degrade --auto nor produce
 *                          no-op rollbacks).
 *   3. decideImagePath   — image-vs-rebuild routing depends ONLY on the
 *                          local presence of the per-SHA images.
 *
 * No test runs execSync/spawnSync: the module is imported (the CLI side
 * effects sit behind an isMain guard) and the exported pure functions
 * are called.
 */

describe("isMain guard (import without side effects)", () => {
  it("does not run execSync or git commands when importing rollback.mjs", async () => {
    const originalArgv = process.argv;
    // pathToFileURL from a filesystem path (NOT new URL relative to
    // import.meta.url): in vitest's jsdom environment import.meta.url is
    // rewritten to http://localhost/... and the native ESM loader rejects http:.
    const rollbackUrl = pathToFileURL(resolve(process.cwd(), "scripts", "rollback.mjs"));
    const originalExecPath = process.execPath;
    Object.defineProperty(process, "execPath", { configurable: true, value: originalExecPath });
    process.argv = [process.execPath, rollbackUrl.pathname];
    try {
      await import(rollbackUrl.href);
      expect(process.argv[1]).toBe(rollbackUrl.pathname);
    } finally {
      process.argv = originalArgv;
    }
  });
});

async function sourceForRollback() {
  return import("node:fs/promises").then(({ readFile }) => readFile("scripts/rollback.mjs", "utf8"));
}

describe("rollback nginx recovery integration", () => {
  it("invokes nginx-render --write without corrupting _headers or sitemap.xml", () => {
    const root = mkdtempSync(join(tmpdir(), "bmf-rollback-nginx-"));
    const targets = [
      "public/nginx.conf",
      "public/_headers",
      "netlify.toml",
      "vercel.json",
      "public/sitemap.xml",
      "public/robots.txt",
      "public/404.html",
      "public/privacy-and-terms.html",
      ...["es", "fr", "de", "pt", "it"].map((lang) => `public/${lang}/privacy-and-terms.html`),
      "public/manifest.json",
      "extension/background.js",
      "extension/popup.js",
      "extension/popup.html",
      "extension/manifest.json",
      "extension/manifest-firefox.json",
      "extension/PRIVACY.md",
    ];
    try {
      mkdirSync(join(root, "scripts"), { recursive: true });
      mkdirSync(join(root, "public"), { recursive: true });
      mkdirSync(join(root, "extension"), { recursive: true });
      for (const rel of targets) {
        const destination = join(root, rel);
        mkdirSync(resolve(destination, ".."), { recursive: true });
        copyFileSync(join(process.cwd(), rel), destination);
      }
      copyFileSync("scripts/nginx-render.mjs", join(root, "scripts/nginx-render.mjs"));
      copyFileSync("scripts/csp-config.js", join(root, "scripts/csp-config.js"));
      copyFileSync("scripts/landing-registry.mjs", join(root, "scripts/landing-registry.mjs"));
      // The renderer derives the app-route location from the app's own route
      // table (scripts/app-routes.mjs -> AppRoutes.tsx): copy both, or the
      // renderer cannot load at all in the scaffold.
      copyFileSync("scripts/app-routes.mjs", join(root, "scripts", "app-routes.mjs"));
      mkdirSync(join(root, "src", "components", "app"), { recursive: true });
      copyFileSync(
        join("src", "components", "app", "AppRoutes.tsx"),
        join(root, "src", "components", "app", "AppRoutes.tsx"),
      );
      // nginx-render derives the app-route location from the app's OWN route
      // table (scripts/app-routes.mjs parses AppRoutes.tsx), so the fixture
      // tree needs both — exactly like the locale registry above. Without
      // them the renderer cannot reproduce the committed nginx.conf.
      copyFileSync("scripts/app-routes.mjs", join(root, "scripts", "app-routes.mjs"));
      mkdirSync(join(root, "src", "components", "app"), { recursive: true });
      copyFileSync(
        "src/components/app/AppRoutes.tsx",
        join(root, "src", "components", "app", "AppRoutes.tsx"),
      );

      const expectedHeaders = readFileSync(join(root, "public/_headers"), "utf8");
      const expectedSitemap = readFileSync(join(root, "public/sitemap.xml"), "utf8");
      // Simulate stale deployment-domain values before the rollback recovery
      // path invokes the real renderer command.
      writeFileSync(
        join(root, "public/_headers"),
        expectedHeaders
          .replaceAll("https://bookmarkforgeapp.com/csp-report", "https://stale.example/csp-report")
          .replaceAll("wss://signal.bookmarkforgeapp.com", "wss://signal.stale.example"),
      );
      writeFileSync(
        join(root, "public/sitemap.xml"),
        expectedSitemap.replaceAll("bookmarkforgeapp.com", "stale.example"),
      );

      const result = runNginxRenderWrite({ cwd: root });
      expect(result).toBeDefined();
      // The surgical renderers must restore the canonical values without
      // changing the hand-maintained structure or truncating the shipped
      // URLs. The sitemap's URL count is the public surface's: 43 locations
      // (30 landings + 6 reviewed legal pages + pocket + 6 comparison pages),
      // after the 24 unreviewed legal pages were retired and redirected
      // (ADR-070).
      expect(readFileSync(join(root, "public/_headers"), "utf8")).toBe(expectedHeaders);
      expect(readFileSync(join(root, "public/sitemap.xml"), "utf8")).toBe(expectedSitemap);
      expect(expectedSitemap.match(/<loc>/g)).toHaveLength(43);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("rollback input validation", () => {
  it("uses argument arrays for tag inspection instead of shell interpolation", async () => {
    const source = await sourceForRollback();
    expect(source).toContain('spawnSync("git", ["cat-file", "-t", `refs/tags/${targetTag}`]');
    expect(source).toContain('spawnSync("git", ["ls-tree", "-r", `refs/tags/${targetTag}`, "--name-only"]');
    expect(source).not.toContain('execSync(`git cat-file -t ${targetTag}`');
    expect(source).not.toContain('execSync(`docker manifest inspect ${remote}`');
    expect(source).not.toContain('execSync(`docker pull ${remote}`');
    expect(source).not.toContain('run(`docker tag ${remote} ${local}`');
    expect(source).toContain('import { runCommand, runCommandOk } from "./command-runner.mjs";');
    expect(source).not.toContain('execSync(`git ls-tree -r ${targetTag}');
  });

  it("accepts only annotated production tag names", () => {
    expect(validateRollbackTargetTag("prod-20260827-2128-84c7fe5")).toBe(true);
    expect(validateRollbackTargetTag("prod-20260827-2128-latest")).toBe(false);
    expect(validateRollbackTargetTag("refs/tags/prod-20260827-2128-84c7fe5")).toBe(false);
  });

  it("accepts HTTPS URLs and local HTTP only", () => {
    expect(validateRollbackBaseUrl("https://staging.example.test")).toBe(true);
    expect(validateRollbackBaseUrl("http://127.0.0.1:8080")).toBe(true);
    expect(validateRollbackBaseUrl("http://staging.example.test")).toBe(false);
    expect(validateRollbackBaseUrl("not-a-url")).toBe(false);
    expect(validateRollbackBaseUrl("http://127.0.0.1:8080?token=secret")).toBe(false);
    expect(validateRollbackBaseUrl("https://staging.example.test:8443")).toBe(false);
    expect(validateRollbackBaseUrl("https://user:pass@staging.example.test")).toBe(false);
  });
});

describe("extractSha (extracting the sha from the tag)", () => {
  it("extracts the short sha at the end of the tag", () => {
    expect(extractSha("prod-20260827-2128-84c7fe5")).toBe("84c7fe5");
  });

  it("acepta shas cortos y largos de 7-12 hex", () => {
    expect(extractSha("prod-20260827-10-ab12cd3")).toBe("ab12cd3");
    expect(extractSha("prod-2026-2-a1b2c3d4e5f6")).toBe("a1b2c3d4e5f6");
  });

  it("accepts uppercase and lowercase hex letters up to 12 chars", () => {
    expect(extractSha("prod-x-ABCDEF0")).toBe("ABCDEF0");
    expect(extractSha("prod-x-abcdef012345")).toBe("abcdef012345");
  });

  it("rechaza segmentos demasiado cortos/​largos (<7 o >12 hex) o no-hex", () => {
    expect(extractSha("prod-2028-123456")).toBe(""); // 6 hex < 7 minimum
    expect(extractSha("prod-2026")).toBe(""); // 4 hex < 7 minimum
    expect(extractSha("prod-x-123456789abcdef0")).toBe(""); // 16 hex > 12 maximum
    expect(extractSha("prod-foo-bar")).toBe(""); // 'r' no es hex
  });

  it("returns '' for non-strings or tags without a sha", () => {
    expect(extractSha("")).toBe("");
    expect(extractSha(null)).toBe("");
    expect(extractSha(undefined)).toBe("");
    expect(extractSha("prod-short")).toBe(""); // 'short' no es hex
  });
});

describe("selectAutoTarget (--auto selection)", () => {
  it("picks the second-to-last prod-* tag (the last good one)", () => {
    const tags = [
      "prod-20260827-2200-aaabbb1",
      "prod-20260827-2310-bbbbcc2",
      "prod-20260827-2359-ccccdd3",
    ];
    // Comes in ordered by creatordate desc; the second-to-last (index 1) is the target.
    expect(selectAutoTarget(tags)).toBe("prod-20260827-2310-bbbbcc2");
  });

  it("ignores tags without the prod- prefix", () => {
    const tags = ["v1.0.0", "prod-tag-1", "release-xyz", "prod-tag-2"];
    // After filtering prod-* only: [prod-tag-1, prod-tag-2] → second-to-last (idx 1) = prod-tag-2
    expect(selectAutoTarget(tags)).toBe("prod-tag-2");
  });

  it("returns null with fewer than 2 prod-* tags", () => {
    expect(selectAutoTarget([])).toBeNull();
    expect(selectAutoTarget(["prod-solo-tag"])).toBeNull();
  });

  it("returns null when there are no tags or the list is nullish", () => {
    expect(selectAutoTarget(null)).toBeNull();
    expect(selectAutoTarget(undefined)).toBeNull();
  });

  it("ignores non-string entries in the array", () => {
    const tags = ["prod-2028-aaa", null, "prod-2028-aaa2", 123];
    // Filtered: [prod-2028-aaa, prod-2028-aaa2] → second-to-last = prod-2028-aaa2
    expect(selectAutoTarget(tags)).toBe("prod-2028-aaa2");
  });

  it("dedupes by sha: a re-deploy of the same commit does not degrade --auto (regression bb21664)", () => {
    // Real case from the rollback drill: 2 tags on the SAME sha (bb21664).
    // Without dedupe, tags[1] was the SAME build as tags[0] → no-op rollback.
    // The correct target is the previous DISTINCT build.
    const tags = [
      "prod-20260828-0100-aaabbb1",
      "prod-20260827-2200-aaabbb1", // same sha as the current one (re-deploy)
      "prod-20260827-1530-bbbbcc2",
    ];
    expect(selectAutoTarget(tags)).toBe("prod-20260827-1530-bbbbcc2");
  });

  it("keeps the first occurrence of each sha (the most recent by creatordate)", () => {
    const tags = [
      "prod-20260828-0100-aaabbb1",
      "prod-20260827-2200-bbbbcc2",
      "prod-20260827-1530-bbbbcc2", // older duplicate of the same build
      "prod-20260827-1200-ccccdd3",
    ];
    // Distinct: [aaabbb1, bbbbcc2@2200, ccccdd3] → second-to-last build = bbbbcc2@2200
    expect(selectAutoTarget(tags)).toBe("prod-20260827-2200-bbbbcc2");
  });

  it("returns null if ALL tags point to the same build (the rollback would be a no-op)", () => {
    const tags = [
      "prod-20260828-0100-aaabbb1",
      "prod-20260827-2200-aaabbb1",
      "prod-20260827-1530-aaabbb1",
    ];
    expect(selectAutoTarget(tags)).toBeNull();
  });

  it("sha dedupe is case-insensitive (ABCDEF0 == abcdef0)", () => {
    const tags = [
      "prod-20260828-0100-aaabbb1",
      "prod-20260827-2200-ABCDEF0",
      "prod-20260827-1530-abcdef0", // same build as the previous one, different case
      "prod-20260827-1200-bbbbcc2",
    ];
    // Distinct: [aaabbb1, ABCDEF0, bbbbcc2] → the case-only duplicate is skipped
    expect(selectAutoTarget(tags)).toBe("prod-20260827-2200-ABCDEF0");
  });

  it("treats tags without a valid sha as distinct builds by name", () => {
    const tags = ["prod-tag-1", "prod-tag-1", "prod-tag-2"];
    // "tag-1"/"tag-2" are not hex → dedupe by name → second distinct name
    expect(selectAutoTarget(tags)).toBe("prod-tag-2");
  });
});

describe("decideImagePath (ruteo imagen-vs-rebuild)", () => {
  const web = (sha) => `bookmarkforge/web:${sha}`;
  const api = (sha) => `bookmarkforge/api:${sha}`;

  it("routes to PATH A (image) when both per-SHA images exist", () => {
    const list = [web("a1b2c3d"), api("a1b2c3d"), "other/image:latest"];
    expect(decideImagePath("a1b2c3d", list)).toEqual({ route: "image" });
  });

  it("rutea a rebuild cuando falta web", () => {
    const list = [api("a1b2c3d"), "other/image:latest"];
    expect(decideImagePath("a1b2c3d", list)).toEqual({
      route: "rebuild",
      reason: "api-only",
    });
  });

  it("rutea a rebuild cuando falta api", () => {
    const list = [web("a1b2c3d"), "other/image:latest"];
    expect(decideImagePath("a1b2c3d", list)).toEqual({
      route: "rebuild",
      reason: "web-only",
    });
  });

  it("routes to rebuild when no image exists", () => {
    expect(decideImagePath("a1b2c3d", ["other/image:latest"])).toEqual({
      route: "rebuild",
      reason: "neither",
    });
  });

  it("with an empty/malformed sha it ALWAYS routes to rebuild (without trying docker)", () => {
    expect(decideImagePath("", [web("x"), api("x")])).toEqual({
      route: "rebuild",
      reason: "invalid-sha",
    });
    expect(decideImagePath("not-hex", [web("x"), api("x")])).toEqual({
      route: "rebuild",
      reason: "invalid-sha",
    });
    expect(decideImagePath("short", [web("short"), api("short")])).toEqual({
      route: "rebuild",
      reason: "invalid-sha",
    }); // 'short' no es hex
  });

  it("is insensitive to the order of the image listing", () => {
    const list = ["unrelated:foo", api("a1b2c3d"), web("a1b2c3d")];
    expect(decideImagePath("a1b2c3d", list)).toEqual({ route: "image" });
  });

  it("fails closed with a non-array listing (docker unavailable)", () => {
    expect(decideImagePath("a1b2c3d", null)).toEqual({
      route: "rebuild",
      reason: "neither",
    });
    expect(decideImagePath("a1b2c3d", undefined)).toEqual({
      route: "rebuild",
      reason: "neither",
    });
  });

  it("a sha only matches its own image:web and api with that same sha", () => {
    // web:ab12cd3 presente, api:ab12cd3 ausente (solo existe api:ab12cd4)
    // → imagen web presente, imagen api ausente → web-only (rebuild).
    const list = [web("ab12cd3"), api("ab12cd4")];
    expect(decideImagePath("ab12cd3", list)).toEqual({
      route: "rebuild",
      reason: "web-only",
    });
  });
});

describe("shouldPullFromRegistry (remote api priming to complete PATH A)", () => {
  const web = (sha) => `bookmarkforge/web:${sha}`;
  const api = (sha) => `bookmarkforge/api:${sha}`;

  it("no hace pull cuando falta web:sha, aunque haya registro", () => {
    expect(shouldPullFromRegistry("a1b2c3d", ["other/x:latest"], "registry.io:5000")).toEqual({
      shouldPull: false,
      missing: [],
    });
  });

  it("should pull only the missing image (web present, api missing)", () => {
    expect(shouldPullFromRegistry("a1b2c3d", [web("a1b2c3d"), "x:y"], "registry.io:5000")).toEqual({
      shouldPull: true,
      missing: ["api"],
    });
  });

  it("does not pull when only api:sha exists and web:sha is missing", () => {
    expect(shouldPullFromRegistry("a1b2c3d", [api("a1b2c3d"), "x:y"], "registry.io:5000")).toEqual({
      shouldPull: false,
      missing: [],
    });
  });

  it("must NOT pull if both local images exist (local already OK)", () => {
    const list = [web("a1b2c3d"), api("a1b2c3d")];
    expect(shouldPullFromRegistry("a1b2c3d", list, "registry.io:5000")).toEqual({
      shouldPull: false,
      missing: [],
    });
  });

  it("must NOT pull if the registry entry is missing (original behaviour → rebuild)", () => {
    expect(shouldPullFromRegistry("a1b2c3d", ["other/x:latest"], "")).toEqual({
      shouldPull: false,
      missing: [],
    });
    expect(shouldPullFromRegistry("a1b2c3d", ["other/x:latest"], null)).toEqual({
      shouldPull: false,
      missing: [],
    });
  });

  it("must NOT pull with an empty/malformed sha (rebuild fail-safe)", () => {
    expect(shouldPullFromRegistry("", ["x:y"], "registry.io:5000")).toEqual({
      shouldPull: false,
      missing: [],
    });
    expect(shouldPullFromRegistry("short", ["x:y"], "registry.io:5000")).toEqual({
      shouldPull: false,
      missing: [],
    });
  });

  it("with a non-array listing and a present entry it does not pull without local web", () => {
    expect(shouldPullFromRegistry("a1b2c3d", null, "registry.io:5000")).toEqual({
      shouldPull: false,
      missing: [],
    });
  });
});