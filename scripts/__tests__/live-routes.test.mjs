// @vitest-environment node
/**
 * scripts/__tests__/live-routes.test.mjs
 *
 * "The deployed host is judged by what it answers, and the gate fails when it
 * drifts." These tests pin the request matrix built from the app's own routes,
 * the response classifier, and — the part that matters most — that the gate
 * reports the two failures it exists to catch: a route answered with something
 * other than the shell, and a typo answered with a 200 instead of a real 404.
 *
 * The network is never touched: the CLI's requests are faked as a response map.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isPublicSurface, isShellPath, pathVariants, shellRoutes } from "../app-routes.mjs";
import {
  EXPECT,
  NOTFOUND_MARKER,
  PUBLIC_SURFACE_PATHS,
  SHELL_MARKER,
  UNKNOWN_PATHS,
  assessLiveResults,
  buildLiveMatrix,
  classifyResponse,
  validateBaseUrl,
} from "../live-routes-contract.mjs";

const ROOT = process.cwd();
const SHELL_BODY = `<!doctype html><div ${SHELL_MARKER}></div>`;
const LANDING_BODY = "<!doctype html><h1>Everything stays on your computer</h1>";
const NOTFOUND_BODY = `<!doctype html><title>${NOTFOUND_MARKER} | BookmarkForge</title>`;

/** A host that honours the contract, as a response map. */
function faithfulHost(cases) {
  const responses = new Map();
  for (const testCase of cases) {
    const body =
      testCase.expect === EXPECT.SHELL
        ? SHELL_BODY
        : testCase.expect === EXPECT.NOTFOUND
          ? NOTFOUND_BODY
          : LANDING_BODY;
    responses.set(testCase.path, { status: testCase.status, body });
  }
  return responses;
}

describe("response classification", () => {
  it("reads the shell from the React mount point", () => {
    expect(classifyResponse(200, SHELL_BODY)).toBe("shell");
  });

  it("reads the 404 document from its title", () => {
    expect(classifyResponse(404, NOTFOUND_BODY)).toBe("404-page");
    expect(classifyResponse(200, NOTFOUND_BODY)).toBe("404-page");
  });

  it("does not mistake a landing for the shell", () => {
    expect(classifyResponse(200, LANDING_BODY)).toBe("other");
  });

  it("keeps redirects and server errors out of the shell/404 verdicts", () => {
    expect(classifyResponse(301, SHELL_BODY)).toBe("other");
    expect(classifyResponse(500, NOTFOUND_BODY)).toBe("other");
  });

  it("tolerates a missing body", () => {
    expect(classifyResponse(200, undefined)).toBe("other");
    expect(classifyResponse(404, null)).toBe("other");
  });
});

describe("the request matrix comes from the app", () => {
  const cases = buildLiveMatrix();

  it("covers every client route and its trailing-slash twin as shell", () => {
    for (const route of shellRoutes()) {
      for (const variant of pathVariants(route)) {
        const testCase = cases.find((c) => c.path === variant);
        expect(testCase, variant).toBeDefined();
        expect(testCase.status).toBe(200);
        expect(testCase.expect).toBe(EXPECT.SHELL);
      }
    }
  });

  it("expects 200 without the shell for the public surface, and a real 404 for unknowns", () => {
    for (const path of PUBLIC_SURFACE_PATHS) {
      const testCase = cases.find((c) => c.path === path);
      expect(testCase?.status, path).toBe(200);
      expect(testCase?.expect, path).toBe(EXPECT.NOT_SHELL);
    }
    for (const path of UNKNOWN_PATHS) {
      const testCase = cases.find((c) => c.path === path);
      expect(testCase?.status, path).toBe(404);
      expect(testCase?.expect, path).toBe(EXPECT.NOTFOUND);
    }
  });

  it("keeps the two lists mutually exclusive and outside the shell surface", () => {
    // An unknown path that the app or a host served as the shell would make the
    // 404 assertion below meaningless; the lists must not overlap either.
    for (const path of UNKNOWN_PATHS) {
      expect(isShellPath(path), path).toBe(false);
      expect(isPublicSurface(path), path).toBe(false);
      expect(PUBLIC_SURFACE_PATHS, path).not.toContain(path);
    }
    for (const path of PUBLIC_SURFACE_PATHS) {
      expect(isShellPath(path), path).toBe(false);
    }
  });
});

describe("the gate can pass and can fail", () => {
  const cases = buildLiveMatrix();

  it("is green against a host that honours the contract", () => {
    const result = assessLiveResults(cases, faithfulHost(cases));
    expect(result.failures).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.checks).toBe(cases.length);
  });

  it("reports a route answered with something other than the shell", () => {
    const responses = faithfulHost(cases);
    responses.set("/settings", { status: 200, body: LANDING_BODY });
    const result = assessLiveResults(cases, responses);
    expect(result.failures.some((f) => f.includes("/settings") && f.includes("expected the SPA shell"))).toBe(true);
  });

  it("reports a soft 404: an unknown path answered with the landing and a 200", () => {
    const responses = faithfulHost(cases);
    responses.set("/no-such-page-lol", { status: 200, body: LANDING_BODY });
    const result = assessLiveResults(cases, responses);
    expect(result.failures.some((f) => f.includes("/no-such-page-lol") && f.includes("expected HTTP 404"))).toBe(true);
  });

  it("reports a 404 that does not carry the 404 document", () => {
    const responses = faithfulHost(cases);
    responses.set("/missing.js", { status: 404, body: "<h1>Not Found</h1>" });
    const result = assessLiveResults(cases, responses);
    expect(result.failures.some((f) => f.includes("/missing.js") && f.includes("404 document"))).toBe(true);
  });

  it("reports the public surface being answered by the shell", () => {
    const responses = faithfulHost(cases);
    responses.set("/", { status: 200, body: SHELL_BODY });
    const result = assessLiveResults(cases, responses);
    expect(result.failures.some((f) => f.includes("/") && f.includes("public surface"))).toBe(true);
  });

  it("reports a path with no response and a transport error", () => {
    const responses = faithfulHost(cases);
    responses.delete("/app");
    responses.set("/graph", { status: 0, body: "", error: "fetch failed" });
    const result = assessLiveResults(cases, responses);
    expect(result.failures.some((f) => f.includes("/app") && f.includes("no response"))).toBe(true);
    expect(result.failures.some((f) => f.includes("/graph") && f.includes("fetch failed"))).toBe(true);
  });

  it("fails every case when the host is unreachable", () => {
    const result = assessLiveResults(cases, new Map());
    expect(result.ok).toBe(false);
    expect(result.failures).toHaveLength(cases.length);
  });
});

describe("the base URL policy", () => {
  it("accepts a plain HTTPS origin", () => {
    expect(validateBaseUrl("https://staging.example.com")).toBe("https://staging.example.com");
    expect(validateBaseUrl("https://staging.example.com/")).toBe("https://staging.example.com");
  });

  it("rejects anything that would probe a different resource than the matrix", () => {
    for (const value of [
      "http://staging.example.com",
      "https://staging.example.com:8443",
      "https://user:pass@staging.example.com",
      "https://staging.example.com/?x=1",
      "https://staging.example.com/#frag",
      "https://staging.example.com/sub",
      "not-a-url",
      "",
    ]) {
      expect(validateBaseUrl(value), value).toBeNull();
    }
  });
});

describe("the markers match the shipped artifacts", () => {
  // dist/ only exists after a build; when it does, prove the markers this gate
  // keys on are really in the files the deploy serves.
  const appHtml = join(ROOT, "dist/app.html");
  const notFoundHtml = join(ROOT, "dist/404.html");

  it.runIf(existsSync(appHtml))("the shell marker is in dist/app.html, not in the landings", () => {
    expect(readFileSync(appHtml, "utf8")).toContain(SHELL_MARKER);
    for (const landing of ["dist/landing.html", "dist/es.html"]) {
      const path = join(ROOT, landing);
      if (existsSync(path)) expect(readFileSync(path, "utf8"), landing).not.toContain(SHELL_MARKER);
    }
  });

  it.runIf(existsSync(notFoundHtml))("the 404 marker is the title dist/404.html ships", () => {
    expect(readFileSync(notFoundHtml, "utf8")).toContain(NOTFOUND_MARKER);
  });
});
