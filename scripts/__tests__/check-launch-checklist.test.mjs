import { describe, expect, it } from "vitest";
import {
  hasBlockerFailures,
  REQUIRED_RULESET_CHECKS,
  verifyContracts,
  verifyDastDisabled,
  verifyDrill,
  verifyEnvGates,
  verifyErrorReporting,
  verifyExtensions,
  verifyLoadTest,
  verifyPreflightScripts,
  verifyProdConfig,
  verifyRopa,
  verifyRuleset,
  verifySast,
  verifySloRpoRto,
  verifyZapFailLevels,
} from "../check-launch-checklist.mjs";

describe("verifyRuleset", () => {
  const validRuleset = {
    rules: [
      {
        type: "required_status_checks",
        parameters: { required_status_checks: REQUIRED_RULESET_CHECKS.map((context) => ({ context })) },
      },
    ],
  };

  it("passes when all required checks are present", () => {
    expect(verifyRuleset(validRuleset).ok).toBe(true);
  });

  it("fails when a required check is missing", () => {
    const parsed = {
      rules: [
        {
          type: "required_status_checks",
          parameters: {
            required_status_checks: [{ context: "Playwright E2E" }],
          },
        },
      ],
    };
    const result = verifyRuleset(parsed);
    expect(result.ok).toBe(false);
    expect(result.note).toContain("CodeQL analysis");
  });

  it("fails when the ruleset is missing or invalid", () => {
    expect(verifyRuleset(null).ok).toBe(false);
    expect(verifyRuleset("not json").ok).toBe(false);
  });

  it("rejects export-only fields that would break the API payload", () => {
    const withSource = { ...validRuleset, source: "main" };
    const result = verifyRuleset(withSource);
    expect(result.ok).toBe(false);
    expect(result.note).toContain("source");
    expect(verifyRuleset({ ...validRuleset, id: 42, source_type: "Repository" }).ok).toBe(false);
  });
});

describe("verifySloRpoRto", () => {
  it("passes when baselines are documented", () => {
    const text = "## SLOs\nRPO: 24 h\nRTO: 24 h\n99.9%\n";
    expect(verifySloRpoRto(text).ok).toBe(true);
  });

  it("fails on partial documentation", () => {
    expect(verifySloRpoRto("RPO: 24 h").ok).toBe(false);
    expect(verifySloRpoRto(null).ok).toBe(false);
  });
});

describe("verifySast", () => {
  it("passes when the workflow and gate exist", () => {
    const workflow = "name: SAST\njobs:\n  codeql:\n    name: CodeQL analysis\n  semgrep:\n    name: Semgrep analysis\n";
    expect(verifySast(workflow, true).ok).toBe(true);
  });

  it("fails when either piece is missing", () => {
    expect(verifySast(null, true).ok).toBe(false);
    expect(verifySast("name: SAST", false).ok).toBe(false);
  });
});

describe("verifyErrorReporting", () => {
  const reporter =
    "beforeSend\nCONSENT_ERROR_REPORTING\ninitRemoteErrorReporting\nsentry.init";
  // ADR-030: consent delegation moved into ConsentService; the reporter gates
  // remotely via isPurposeConsented("sentry").
  const modernReporter =
    'beforeSend\nisPurposeConsented("sentry")\ninitRemoteErrorReporting\nsentry.init';

  it("passes with the dependency and the sanitized opt-in reporter", () => {
    expect(
      verifyErrorReporting({ dependencies: { "@sentry/browser": "10" } }, reporter).ok,
    ).toBe(true);
  });

  it("passes with the modern ConsentService delegation (legacy marker dropped)", () => {
    expect(
      verifyErrorReporting(
        { dependencies: { "@sentry/browser": "10" } },
        modernReporter,
      ).ok,
    ).toBe(true);
  });

  it("fails without the dependency", () => {
    expect(verifyErrorReporting({ dependencies: { react: "19" } }, reporter).ok).toBe(false);
  });

  it("fails without the reporter module, sanitizer or consent gate", () => {
    expect(
      verifyErrorReporting({ dependencies: { "@sentry/browser": "10" } }, null).ok,
    ).toBe(false);
    expect(
      verifyErrorReporting({ dependencies: { "@sentry/browser": "10" } }, "no beforeSend").ok,
    ).toBe(false);
    expect(
      verifyErrorReporting({ dependencies: { "@sentry/browser": "10" } }, "beforeSend only").ok,
    ).toBe(false);
    expect(
      verifyErrorReporting(
        { dependencies: { "@sentry/browser": "10" } },
        "beforeSend\ninitRemoteErrorReporting\nsentry.init",
      ).ok,
    ).toBe(false);
  });
});

describe("verifyLoadTest", () => {
  const FULL = "join room relay signal p95 percentile BUDGETS saturation /health responde 200";

  it("passes with script file and full coverage", () => {
    expect(verifyLoadTest({ scripts: { "test:load": "node x" } }, true, FULL).ok).toBe(true);
  });

  it("fails when the script file is missing", () => {
    expect(verifyLoadTest({ scripts: { "test:load": "node x" } }, false, FULL).ok).toBe(false);
  });

  it("fails without a load script in package.json", () => {
    expect(verifyLoadTest({ scripts: { test: "vitest" } }, true, FULL).ok).toBe(false);
  });

  it("fails on partial coverage (signaling + budgets but no saturation/liveness)", () => {
    expect(verifyLoadTest({ scripts: { "test:load": "node x" } }, true, "join relay signal p95 BUDGETS").ok).toBe(false);
  });

  it("fails on partial coverage (signaling only, no budgets)", () => {
    expect(verifyLoadTest({ scripts: { "test:load": "node x" } }, true, "join relay").ok).toBe(false);
  });
});

describe("verifyContracts", () => {
  it("passes when an OpenAPI/Swagger spec header is detected", () => {
    expect(verifyContracts(["# API", "openapi: 3.1.0"]).ok).toBe(true);
    expect(verifyContracts(["swagger: '2.0'"]).ok).toBe(true);
  });

  it("fails without a real spec", () => {
    expect(verifyContracts(["# API", "endpoints"]).ok).toBe(false);
    expect(verifyContracts(["Sin Swagger/OpenAPI, compensado con pruebas de contrato"]).ok).toBe(false);
  });
});

describe("verifyDrill", () => {
  it("passes when the drill script exists", () => {
    expect(verifyDrill({ scripts: { "drill:backup-restore": "node x" } }, true).ok).toBe(true);
  });

  it("fails without it", () => {
    expect(verifyDrill({ scripts: {} }, true).ok).toBe(false);
    expect(verifyDrill({ scripts: { "drill:backup-restore": "node x" } }, false).ok).toBe(false);
  });
});

describe("verifyExtensions", () => {
  it("passes when both manifests exist", () => {
    expect(verifyExtensions(true).ok).toBe(true);
  });

  it("fails otherwise", () => {
    expect(verifyExtensions(false).ok).toBe(false);
  });
});

describe("verifyEnvGates", () => {
  it("passes when all config gates exist", () => {
    const pkg = {
      scripts: {
        "check:http-config": "x",
        "check:compose-config": "x",
        "check:runtime-config": "x",
        "check:docker-context": "x",
      },
    };
    expect(verifyEnvGates(pkg).ok).toBe(true);
  });

  it("fails when a gate is missing", () => {
    const pkg = { scripts: { "check:http-config": "x" } };
    const result = verifyEnvGates(pkg);
    expect(result.ok).toBe(false);
    expect(result.note).toContain("check:runtime-config");
  });
});

describe("verifyDastDisabled", () => {
  it("passes while the authenticated steps are disabled", () => {
    const text = "      - name: Prepare and validate authenticated ZAP context\n        if: ${{ false }}\n";
    expect(verifyDastDisabled(text).ok).toBe(true);
  });

  it("fails when they are not disabled", () => {
    expect(verifyDastDisabled("      - name: Run authenticated scan\n").ok).toBe(false);
    expect(verifyDastDisabled(null).ok).toBe(false);
  });
});

describe("verifyProdConfig", () => {
  it("passes when the required config is documented", () => {
    const text = [
      "NODE_ENV=production",
      "AI_SESSION_ORIGINS=https://a",
      "ENFORCE_SIGNAL_HMAC=1",
      "LICENSE_SIGNING_PRIVATE_KEY_FILE montado como secreto",
    ].join("\n");
    expect(verifyProdConfig(text).ok).toBe(true);
  });

  it("fails on partial documentation", () => {
    expect(verifyProdConfig("NODE_ENV=production").ok).toBe(false);
  });

  it("no longer accepts retired subsystem variables as required config", () => {
    // Retired flags have no reader: documenting them must not satisfy (or be
    // needed for) this item.
    const text = "NODE_ENV=production\nAI_SESSION_REQUIRE_LICENSE=1\nAI_SESSION_ORIGINS=https://a\nENFORCE_SIGNAL_HMAC=1\n";
    expect(verifyProdConfig(text).ok).toBe(false);
  });
});

describe("verifyPreflightScripts", () => {
  it("passes when the preflight scripts exist", () => {
    const pkg = {
      scripts: {
        "typecheck:prod": "x",
        lint: "x",
        test: "x",
        "build:ci": "x",
        check: "x",
        "check:security-internal": "x",
        "check:secrets-in-commit": "x",
        "check:audit": "x",
        // ADR-058: the release preflight must own the gate that refuses to
        // prepare a release against an unconfirmed repository target.
        "check:release-target": "x",
      },
    };
    expect(verifyPreflightScripts(pkg).ok).toBe(true);
  });

  it("requires the release-target gate in the release preflight", () => {
    // Every other preflight script present, the gate absent: the release
    // preflight must still fail and name it.
    const withoutGate = {
      scripts: {
        "typecheck:prod": "x",
        lint: "x",
        test: "x",
        "build:ci": "x",
        check: "x",
        "check:security-internal": "x",
        "check:secrets-in-commit": "x",
        "check:audit": "x",
      },
    };
    const result = verifyPreflightScripts(withoutGate);

    expect(result.ok).toBe(false);
    expect(result.note).toContain("check:release-target");
  });

  it("fails when a script is missing", () => {
    const result = verifyPreflightScripts({ scripts: { lint: "x" } });
    expect(result.ok).toBe(false);
    expect(result.note).toContain("build:ci");
  });
});

describe("verifyRopa", () => {
  it("passes when the ROPA exists without pending fields", () => {
    const text = "# ROPA\n- Responsable: BookmarkForge\n- Contacto: correo\n";
    expect(verifyRopa(text).ok).toBe(true);
  });

  it("fails while COMPLETAR fields remain", () => {
    const text = "# ROPA\n- Nombre: ⚠ COMPLETAR\n- Sede: ⚠ COMPLETAR\n";
    const result = verifyRopa(text);
    expect(result.ok).toBe(false);
    expect(result.note).toContain("2");
  });

  it("fails when the file is missing", () => {
    expect(verifyRopa(null).ok).toBe(false);
  });
});

describe("verifyZapFailLevels", () => {
  it("passes when High and Critical block", () => {
    expect(verifyZapFailLevels("FAIL_LEVELS=High,Critical\n").ok).toBe(true);
  });

  it("fails otherwise", () => {
    expect(verifyZapFailLevels("FAIL_LEVELS=Medium\n").ok).toBe(false);
    expect(verifyZapFailLevels(null).ok).toBe(false);
  });
});

describe("hasBlockerFailures", () => {
  it("detects failing blocker items", () => {
    const results = [
      { section: "blocker", ok: false },
      { section: "post", ok: false },
      { section: "blocker", ok: true },
    ];
    expect(hasBlockerFailures(results)).toBe(true);
  });

  it("ignores manual and non-blocker failures", () => {
    const results = [
      { section: "blocker", ok: null },
      { section: "p1", ok: false },
    ];
    expect(hasBlockerFailures(results)).toBe(false);
  });
});
