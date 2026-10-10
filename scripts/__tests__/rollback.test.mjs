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
 *   1. extractSha        — el sha (último segmento del tag prod-*) se extrae
 *                          o se rechaza con exactitud (base para el ruteo).
 *   2. selectAutoTarget  — --auto elige el penúltimo build prod-* DISTINTO
 *                          por creatordate (dedupe por sha: re-deploys del
 *                          mismo commit no degradan --auto ni producen
 *                          rollbacks no-op).
 *   3. decideImagePath   — el ruteo imagen-vs-rebuild depende SOLO de la
 *                          presencia local de las imágenes por SHA.
 *
 * Ningún test ejecuta execSync/spawnSync: se importa el módulo (los efectos
 * de lado de la CLI están tras un guard isMain) y se llaman las funciones
 * puras exportadas.
 */

describe("guard isMain (importación sin efectos de lado)", () => {
  it("no ejecuta execSync ni comandos git al importar rollback.mjs", async () => {
    const originalArgv = process.argv;
    // pathToFileURL desde una ruta de filesystem (NO new URL relativo a
    // import.meta.url): en el entorno jsdom de vitest, import.meta.url se
    // reescribe a http://localhost/... y el loader ESM nativo rechaza http:.
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
      // changing the hand-maintained structure or truncating the 61 URLs.
      expect(readFileSync(join(root, "public/_headers"), "utf8")).toBe(expectedHeaders);
      expect(readFileSync(join(root, "public/sitemap.xml"), "utf8")).toBe(expectedSitemap);
      expect(expectedSitemap.match(/<loc>/g)).toHaveLength(61);
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

describe("extractSha (extracción del sha del tag)", () => {
  it("extrae el sha corto al final del tag", () => {
    expect(extractSha("prod-20260827-2128-84c7fe5")).toBe("84c7fe5");
  });

  it("acepta shas cortos y largos de 7-12 hex", () => {
    expect(extractSha("prod-20260827-10-ab12cd3")).toBe("ab12cd3");
    expect(extractSha("prod-2026-2-a1b2c3d4e5f6")).toBe("a1b2c3d4e5f6");
  });

  it("acepta letras hex mayúsculas y minúsculas hasta 12 chars", () => {
    expect(extractSha("prod-x-ABCDEF0")).toBe("ABCDEF0");
    expect(extractSha("prod-x-abcdef012345")).toBe("abcdef012345");
  });

  it("rechaza segmentos demasiado cortos/​largos (<7 o >12 hex) o no-hex", () => {
    expect(extractSha("prod-2028-123456")).toBe(""); // 6 hex < mínimo 7
    expect(extractSha("prod-2026")).toBe(""); // 4 hex < mínimo 7
    expect(extractSha("prod-x-123456789abcdef0")).toBe(""); // 16 hex > máximo 12
    expect(extractSha("prod-foo-bar")).toBe(""); // 'r' no es hex
  });

  it("devuelve '' para no-string o tags sin sha", () => {
    expect(extractSha("")).toBe("");
    expect(extractSha(null)).toBe("");
    expect(extractSha(undefined)).toBe("");
    expect(extractSha("prod-short")).toBe(""); // 'short' no es hex
  });
});

describe("selectAutoTarget (selección --auto)", () => {
  it("elige el penúltimo tag prod-* (último bueno)", () => {
    const tags = [
      "prod-20260827-2200-aaabbb1",
      "prod-20260827-2310-bbbbcc2",
      "prod-20260827-2359-ccccdd3",
    ];
    // Entra ordenado por creatordate desc; el penúltimo (índice 1) es el objetivo.
    expect(selectAutoTarget(tags)).toBe("prod-20260827-2310-bbbbcc2");
  });

  it("ignora tags que no tienen prefijo prod-", () => {
    const tags = ["v1.0.0", "prod-tag-1", "release-xyz", "prod-tag-2"];
    // Tras filtrar solo prod-*: [prod-tag-1, prod-tag-2] → penúltimo (idx 1) = prod-tag-2
    expect(selectAutoTarget(tags)).toBe("prod-tag-2");
  });

  it("devuelve null con menos de 2 tags prod-*", () => {
    expect(selectAutoTarget([])).toBeNull();
    expect(selectAutoTarget(["prod-solo-tag"])).toBeNull();
  });

  it("devuelve null cuando no hay tags o la lista es nullish", () => {
    expect(selectAutoTarget(null)).toBeNull();
    expect(selectAutoTarget(undefined)).toBeNull();
  });

  it("ignora entradas no-string del array", () => {
    const tags = ["prod-2028-aaa", null, "prod-2028-aaa2", 123];
    // Filtradas: [prod-2028-aaa, prod-2028-aaa2] → penúltimo = prod-2028-aaa2
    expect(selectAutoTarget(tags)).toBe("prod-2028-aaa2");
  });

  it("deduplica por sha: un re-deploy del mismo commit no degrada --auto (regresión bb21664)", () => {
    // Caso real del drill de rollback: 2 tags sobre el MISMO sha (bb21664).
    // Sin dedupe, tags[1] era el MISMO build que tags[0] → rollback no-op.
    // El destino correcto es el build anterior DISTINTO.
    const tags = [
      "prod-20260828-0100-aaabbb1",
      "prod-20260827-2200-aaabbb1", // mismo sha que el actual (re-deploy)
      "prod-20260827-1530-bbbbcc2",
    ];
    expect(selectAutoTarget(tags)).toBe("prod-20260827-1530-bbbbcc2");
  });

  it("conserva la primera aparición de cada sha (la más reciente por creatordate)", () => {
    const tags = [
      "prod-20260828-0100-aaabbb1",
      "prod-20260827-2200-bbbbcc2",
      "prod-20260827-1530-bbbbcc2", // duplicado antiguo del mismo build
      "prod-20260827-1200-ccccdd3",
    ];
    // Distintos: [aaabbb1, bbbbcc2@2200, ccccdd3] → penúltimo build = bbbbcc2@2200
    expect(selectAutoTarget(tags)).toBe("prod-20260827-2200-bbbbcc2");
  });

  it("devuelve null si TODOS los tags apuntan al mismo build (rollback sería no-op)", () => {
    const tags = [
      "prod-20260828-0100-aaabbb1",
      "prod-20260827-2200-aaabbb1",
      "prod-20260827-1530-aaabbb1",
    ];
    expect(selectAutoTarget(tags)).toBeNull();
  });

  it("el dedupe del sha es case-insensitive (ABCDEF0 == abcdef0)", () => {
    const tags = [
      "prod-20260828-0100-aaabbb1",
      "prod-20260827-2200-ABCDEF0",
      "prod-20260827-1530-abcdef0", // mismo build que el anterior, otra caja
      "prod-20260827-1200-bbbbcc2",
    ];
    // Distintos: [aaabbb1, ABCDEF0, bbbbcc2] → el duplicado por caja se omite
    expect(selectAutoTarget(tags)).toBe("prod-20260827-2200-ABCDEF0");
  });

  it("trata los tags sin sha válido como builds distintos por nombre", () => {
    const tags = ["prod-tag-1", "prod-tag-1", "prod-tag-2"];
    // "tag-1"/"tag-2" no son hex → dedupe por nombre → segundo nombre distinto
    expect(selectAutoTarget(tags)).toBe("prod-tag-2");
  });
});

describe("decideImagePath (ruteo imagen-vs-rebuild)", () => {
  const web = (sha) => `bookmarkforge/web:${sha}`;
  const api = (sha) => `bookmarkforge/api:${sha}`;

  it("routes to PATH A (image) cuando ambas imágenes por SHA existen", () => {
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

  it("rutea a rebuild cuando no hay ninguna imagen", () => {
    expect(decideImagePath("a1b2c3d", ["other/image:latest"])).toEqual({
      route: "rebuild",
      reason: "neither",
    });
  });

  it("con sha vacío/malformado SIEMPRE rutea a rebuild (sin intentar docker)", () => {
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

  it("es insensible al orden del listado de imágenes", () => {
    const list = ["unrelated:foo", api("a1b2c3d"), web("a1b2c3d")];
    expect(decideImagePath("a1b2c3d", list)).toEqual({ route: "image" });
  });

  it("es fail-closed con listado no-array (docker no disponible)", () => {
    expect(decideImagePath("a1b2c3d", null)).toEqual({
      route: "rebuild",
      reason: "neither",
    });
    expect(decideImagePath("a1b2c3d", undefined)).toEqual({
      route: "rebuild",
      reason: "neither",
    });
  });

  it("el sha solo empareja su propia imagen:web y api con ese mismo sha", () => {
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

  it("debe hacer pull solo de la imagen faltante (web presente, api ausente)", () => {
    expect(shouldPullFromRegistry("a1b2c3d", [web("a1b2c3d"), "x:y"], "registry.io:5000")).toEqual({
      shouldPull: true,
      missing: ["api"],
    });
  });

  it("no hace pull cuando solo api:sha existe y falta web:sha", () => {
    expect(shouldPullFromRegistry("a1b2c3d", [api("a1b2c3d"), "x:y"], "registry.io:5000")).toEqual({
      shouldPull: false,
      missing: [],
    });
  });

  it("NO debe hacer pull si ambas imágenes locales existen (local ya OK)", () => {
    const list = [web("a1b2c3d"), api("a1b2c3d")];
    expect(shouldPullFromRegistry("a1b2c3d", list, "registry.io:5000")).toEqual({
      shouldPull: false,
      missing: [],
    });
  });

  it("NO debe hacer pull si falta el registro (comportamiento original → rebuild)", () => {
    expect(shouldPullFromRegistry("a1b2c3d", ["other/x:latest"], "")).toEqual({
      shouldPull: false,
      missing: [],
    });
    expect(shouldPullFromRegistry("a1b2c3d", ["other/x:latest"], null)).toEqual({
      shouldPull: false,
      missing: [],
    });
  });

  it("NO debe hacer pull con sha vacío/malformado (rebuild fail-safe)", () => {
    expect(shouldPullFromRegistry("", ["x:y"], "registry.io:5000")).toEqual({
      shouldPull: false,
      missing: [],
    });
    expect(shouldPullFromRegistry("short", ["x:y"], "registry.io:5000")).toEqual({
      shouldPull: false,
      missing: [],
    });
  });

  it("con listado no-array y registro presente no hace pull sin web local", () => {
    expect(shouldPullFromRegistry("a1b2c3d", null, "registry.io:5000")).toEqual({
      shouldPull: false,
      missing: [],
    });
  });
});