/**
 * scripts/__tests__/check-blindeo.test.mjs
 *
 * Unit tests for the rollback-target web-validity gate (Punto 8) of
 * `scripts/check-blindeo.mjs`. Covers:
 *   (a) a healthy nginx.conf (proxy_pass with explicit port) → no violations
 *   (b) the exact broken pattern found in tags 84c7fe5/f5439ed
 *       (`proxy_pass http://bookmarkforge_api/api/...` without port) →
 *       flagged
 *   (c) multiple broken lines → all reported, none silently skipped
 *   (d) CRLF line endings → still detected (Windows checkout)
 *   (e) non-string input → empty (fail-safe, no throw)
 *   (f) selectRollbackTarget picks the penúltimo prod-* tag, ignoring
 *       non-prod tags and requiring >= 2
 *
 * Strategy: import the script via dynamic import with a `?v=` cache-buster
 * (same pattern as check-extension-csp.test.mjs). The script must stay
 * side-effect-free at import time (isMain guard), so only the exported pure
 * helpers are exercised here.
 */
import { describe, expect, test } from "vitest";
import { hasBookmarkforgeApiAlias } from "../check-blindeo.mjs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..");
const SCRIPT_PATH = join(REPO_ROOT, "scripts", "check-blindeo.mjs");

async function importGate(cacheBuster) {
  return import(pathToFileURL(SCRIPT_PATH).href + `?v=${cacheBuster}`);
}

/** nginx.conf sano — proxy_pass hacia el api SIEMPRE con :8787 explícito. */
const HEALTHY_NGINX = `server {
    listen 8080;

    location = /api/license/entitlement {
        proxy_pass http://bookmarkforge_api:8787/api/license/entitlement;
    }
    location = /health {
        proxy_pass http://bookmarkforge_api:8787/health;
    }
}`;

/** El patrón roto real — sin puerto (nginx resolvería a :80). */
const BROKEN_NGINX = `server {
    listen 8080;

    location = /api/license/entitlement {
        proxy_pass http://bookmarkforge_api/api/license/entitlement;
    }
}`;

describe("check-blindeo Punto 8 — rollback target con web válida", () => {
  test("(a) nginx.conf sano (proxy_pass con puerto) → sin violaciones", async () => {
    const mod = await importGate("a");
    expect(mod.findProxyPassWithoutPort(HEALTHY_NGINX)).toEqual([]);
  });

  test("(b) patrón roto real (sin puerto) → violación detectada", async () => {
    const mod = await importGate("b");
    const violations = mod.findProxyPassWithoutPort(BROKEN_NGINX);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("http://bookmarkforge_api/api/license/entitlement");
    expect(violations[0]).not.toMatch(/:\d+\/api/);
  });

  test("(c) múltiples líneas rotas → todas reportadas, ninguna omitida", async () => {
    const mod = await importGate("c");
    const mixed = [
      "proxy_pass http://bookmarkforge_api/api/license/entitlement;",
      "proxy_pass http://bookmarkforge_api:8787/health;", // sana
      "proxy_pass http://bookmarkforge_api/api/client-events;",
    ].join("\n");
    const violations = mod.findProxyPassWithoutPort(mixed);
    expect(violations).toHaveLength(2);
    for (const v of violations) expect(v).toContain("http://bookmarkforge_api/api");
  });

  test("(d) CRLF line endings → sigue detectando (checkout Windows)", async () => {
    const mod = await importGate("d");
    const brokenCrlf = BROKEN_NGINX.replace(/\n/g, "\r\n");
    expect(mod.findProxyPassWithoutPort(brokenCrlf)).toHaveLength(1);
  });

  test("(e) entrada no-string → [] sin lanzar (fail-safe)", async () => {
    const mod = await importGate("e");
    expect(mod.findProxyPassWithoutPort(undefined)).toEqual([]);
    expect(mod.findProxyPassWithoutPort(null)).toEqual([]);
    expect(mod.findProxyPassWithoutPort(42)).toEqual([]);
  });

  test("(f1) selectRollbackTarget elige el penúltimo tag prod-* y exige >= 2", async () => {
    const mod = await importGate("f1");
    const tags = ["prod-20260828-0205-18b254d", "prod-20260827-1455-84c7fe5", "prod-20260827-0231-f5439ed"];
    expect(mod.selectRollbackTarget(tags)).toBe("prod-20260827-1455-84c7fe5");

    // Ignora tags no-prod en el medio.
    expect(mod.selectRollbackTarget(["prod-a-1", "feature-x", "prod-b-2"])).toBe("prod-b-2");

    // Menos de 2 tags prod- → null (rollback imposible).
    expect(mod.selectRollbackTarget(["prod-only-1"])).toBeNull();
    expect(mod.selectRollbackTarget([])).toBeNull();
    expect(mod.selectRollbackTarget(["x", "y"])).toBeNull();
  });

  test("(f2) deduplica por sha: un re-deploy del mismo commit no degrada --auto", async () => {
    const mod = await importGate("f2");
    // Dos tags apuntando al mismo SHA (re-deploy) + uno previo distinto
    const tags = [
      "prod-20260828-0205-aabbcc0",  // actual (SHA aabbcc0)
      "prod-20260827-1455-aabbcc0",  // re-deploy del mismo SHA → dedup
      "prod-20260827-0231-dd11223",  // build previo distinto → TARGET
    ];
    expect(mod.selectRollbackTarget(tags)).toBe("prod-20260827-0231-dd11223");
  });

  test("(f3) todos los tags apuntan al mismo sha → null (rollback sería no-op)", async () => {
    const mod = await importGate("f3");
    const tags = [
      "prod-20260828-0205-aabbcc0",
      "prod-20260827-1455-aabbcc0",
      "prod-20260826-1200-aabbcc0",
    ];
    expect(mod.selectRollbackTarget(tags)).toBeNull();
  });

  test("(f4) dedupe case-insensitive: ABCDEF0 == abcdef0", async () => {
    const mod = await importGate("f4");
    const tags = [
      "prod-20260828-0205-AABBCCD",
      "prod-20260827-1455-aabbccd",
      "prod-20260827-0231-dd11223",
    ];
    // AABBCCD y aabbccd son el mismo SHA → dedup → TARGET = dd11223
    expect(mod.selectRollbackTarget(tags)).toBe("prod-20260827-0231-dd11223");
  });

  test("(f5) tags sin sha válido → tratados como builds distintos por nombre", async () => {
    const mod = await importGate("f5");
    const tags = [
      "prod-20260828-latest",
      "prod-20260827-latest",
      "prod-20260826-beta",
    ];
    // Sin SHA válidos → cada tag es distinto por nombre → TARGET = second
    expect(mod.selectRollbackTarget(tags)).toBe("prod-20260827-latest");
  });

  test("(g) guard isMain — importar NO ejecuta el checklist (sin process.exit)", async () => {
    // Si el guard fallara, importar el módulo llamaría process.exit(1) y
    // el worker de vitest moriría. Llegar aquí ya prueba el guard.
    const mod = await importGate("g");
    expect(typeof mod.findProxyPassWithoutPort).toBe("function");
    expect(typeof mod.selectRollbackTarget).toBe("function");
  });

  test("(h) bare semicolon (sin puerto ni path) → violación", async () => {
    const mod = await importGate("h");
    const violations = mod.findProxyPassWithoutPort(
      "proxy_pass http://bookmarkforge_api;",
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("bookmarkforge_api;");
  });

  test("(i) comentarios nginx → ignorados", async () => {
    const mod = await importGate("i");
    const violations = mod.findProxyPassWithoutPort(
      "# proxy_pass http://bookmarkforge_api (comentado)\n" +
      "proxy_pass http://bookmarkforge_api:8787/api/ok;",
    );
    expect(violations).toHaveLength(0);
  });

  test("(j) hasBookmarkforgeApiAlias: alias inline → true", () => {
    const compose = `services:\n  api:\n    networks:\n      default:\n        aliases: [bookmarkforge_api]`;
    expect(hasBookmarkforgeApiAlias(compose)).toBe(true);
  });

  test("(k) hasBookmarkforgeApiAlias: alias multi-line → true", () => {
    const compose = `services:\n  api:\n    networks:\n      default:\n        aliases:\n        - bookmarkforge_api`;
    expect(hasBookmarkforgeApiAlias(compose)).toBe(true);
  });

  test("(l) hasBookmarkforgeApiAlias: sin alias → false", () => {
    const compose = `services:\n  api:\n    image: bookmarkforge/api:latest`;
    expect(hasBookmarkforgeApiAlias(compose)).toBe(false);
  });

  test("(m) hasBookmarkforgeApiAlias: non-string → false", () => {
    expect(hasBookmarkforgeApiAlias(null)).toBe(false);
    expect(hasBookmarkforgeApiAlias(undefined)).toBe(false);
  });
});
