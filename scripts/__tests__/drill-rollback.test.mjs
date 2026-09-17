import { describe, expect, it } from "vitest";
import { findProxyPassWithoutPort } from "../check-blindeo.mjs";

/**
 * Tests for the rollback target web validation gate in drill-rollback.mjs.
 *
 * The drill now validates that the rollback target's nginx.conf has all
 * proxy_pass directives with explicit ports BEFORE executing the rollback.
 * This prevents rolling back to a tag whose web would serve permanent 502.
 */

describe("drill-rollback: rollback target web gate", () => {
  it("passes when all proxy_pass have explicit ports", () => {
    const nginx = `
      location = /api/license/entitlement {
          proxy_pass http://bookmarkforge_api:8787/api/license/entitlement;
      }
      location = /health {
          proxy_pass http://bookmarkforge_api:8787/health;
      }
      location = / {
          proxy_pass http://bookmarkforge_api:8787;
      }
    `;
    const violations = findProxyPassWithoutPort(nginx);
    expect(violations).toHaveLength(0);
  });

  it("fails when proxy_pass has no port", () => {
    const nginx = `
      location = /api/license/entitlement {
          proxy_pass http://bookmarkforge_api/api/license/entitlement;
      }
    `;
    const violations = findProxyPassWithoutPort(nginx);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0]).toContain("bookmarkforge_api/api");
  });

  it("fails when proxy_pass has no port and no path (bare semicolon)", () => {
    const nginx = `
      location = /api {
          proxy_pass http://bookmarkforge_api;
      }
    `;
    const violations = findProxyPassWithoutPort(nginx);
    expect(violations.length).toBeGreaterThan(0);
  });

  it("detects multiple violations", () => {
    const nginx = `
      proxy_pass http://bookmarkforge_api/api/a;
      proxy_pass http://bookmarkforge_api/api/b;
      proxy_pass http://bookmarkforge_api:8787/api/c;
    `;
    const violations = findProxyPassWithoutPort(nginx);
    expect(violations).toHaveLength(2);
  });

  it("ignores non-proxy_pass lines", () => {
    const nginx = `
      # proxy_pass http://bookmarkforge_api (commented out)
      set $upstream http://bookmarkforge_api:8787;
      proxy_pass http://bookmarkforge_api:8787/api/ok;
    `;
    const violations = findProxyPassWithoutPort(nginx);
    expect(violations).toHaveLength(0);
  });

  it("returns empty for empty or non-string input", () => {
    expect(findProxyPassWithoutPort("")).toHaveLength(0);
    expect(findProxyPassWithoutPort(null)).toHaveLength(0);
    expect(findProxyPassWithoutPort(undefined)).toHaveLength(0);
  });
});
