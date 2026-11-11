import { describe, expect, it } from "vitest";
import {
  declaredApiEnvKeys,
  findOrphanEnvKeys,
  findStaleRetiredKeys,
  validateCompose,
} from "../validate-compose-config.mjs";

const PROD_OK = [
  "services:",
  "  web:",
  "    image: app:${IMAGE_TAG:?IMAGE_TAG is required}",
  "    mem_limit: ${WEB_MEM_LIMIT:-256m}",
  "    cpus: ${WEB_CPUS:-1.0}",
  "    pids_limit: 256",
  "    logging:",
  "      driver: json-file",
  "      options:",
  '        max-size: "10m"',
  "        max-file: \"3\"",
  "  api:",
  "    image: api:${IMAGE_TAG:?IMAGE_TAG is required}",
  "    read_only: true",
  "    tmpfs:",
  "      - /tmp",
  "    mem_limit: ${API_MEM_LIMIT:-512m}",
  "    cpus: ${API_CPUS:-1.0}",
  "    pids_limit: 256",
  "    logging:",
  "      driver: json-file",
  "      options:",
  '        max-size: "10m"',
  "    environment:",
  "      NODE_ENV: production",
  '      TRUST_PROXY: "1"',
  "",
].join("\n");

const STAGING_OK = [
  "services:",
  "  web:",
  '    ports: ["127.0.0.1:${HTTP_PORT:-18080}:8080"]',
  "  api:",
  "    environment:",
  "      NODE_ENV: staging",
  "",
].join("\n");

const READERS = "process.env.NODE_ENV; process.env.TRUST_PROXY;";

describe("validateCompose", () => {
  it("accepts the repository production security contract", () => {
    expect(validateCompose("docker-compose.prod.yml", PROD_OK).errors).toEqual([]);
  });

  it("accepts the repository staging security contract", () => {
    expect(validateCompose("docker-compose.staging.yml", STAGING_OK).errors).toEqual([]);
  });

  it("rejects mutable production image defaults", () => {
    const result = validateCompose(
      "docker-compose.prod.yml",
      PROD_OK.replace("${IMAGE_TAG:?IMAGE_TAG is required}", "${IMAGE_TAG:-latest}"),
    );
    expect(result.errors.some((error) => error.includes("mutable latest"))).toBe(true);
  });

  it("does not demand license config the signaling container never reads", () => {
    // `/api/license/*` is served by api/license/[action].ts (serverless), so a
    // production Compose file without AI_SESSION_ORIGINS / signing-key config
    // is correct, not a regression. Re-adding the requirement would force
    // variables this container cannot read.
    expect(validateCompose("docker-compose.prod.yml", PROD_OK).errors).toEqual([]);
    expect(validateCompose("docker-compose.staging.yml", STAGING_OK).errors).toEqual([]);
  });

  /**
   * The regression this gate exists for: retired configuration survived in both
   * Compose files for several commits. A compose file that names configuration
   * nothing reads must fail, not deploy a server that cannot read what it
   * configures.
   */
  it("rejects retired configuration whose only reader was removed", () => {
    for (const [file, source] of [
      ["docker-compose.prod.yml", PROD_OK],
      ["docker-compose.staging.yml", STAGING_OK],
    ]) {
      for (const [line, staleKey] of [
        ["AI_PROXY_REDIS_URL: redis://redis:6379/0", "AI_PROXY_"],
        ['AI_SESSION_REQUIRE_LICENSE: "0"', "AI_SESSION_REQUIRE_LICENSE"],
        ["GEMINI_API_KEY: ${GEMINI_API_KEY:?GEMINI_API_KEY is required}", "GEMINI_API_KEY"],
        [
          "GEMINI_API_BASE: https://generativelanguage.googleapis.com/v1beta/models",
          "GEMINI_API_BASE",
        ],
      ]) {
        const result = validateCompose(file, `${source}      ${line}\n`);
        expect(
          result.errors.some((error) => error.includes(staleKey)),
          `${file} should reject ${line}`,
        ).toBe(true);
      }
    }
  });

  it("rejects a bundled Redis service nothing reads", () => {
    const result = validateCompose(
      "docker-compose.prod.yml",
      `${PROD_OK}  redis:\n    image: redis:7-alpine\n`,
    );
    expect(result.errors.some((error) => error.includes("Redis service"))).toBe(true);
  });

  it("names every environment variable that lost its reader", () => {
    expect(findStaleRetiredKeys("AI_PROXY_X: 1\nGEMINI_API_KEY: k")).toEqual([
      "AI_PROXY_",
      "GEMINI_API_KEY",
    ]);
  });
});

describe("declared api environment", () => {
  it("reads only the api service's environment map", () => {
    expect(declaredApiEnvKeys(PROD_OK)).toEqual(["NODE_ENV", "TRUST_PROXY"]);
  });

  it("supports list-form entries so a rewrite cannot silently disable the gate", () => {
    const listForm = PROD_OK.replace(
      '    environment:\n      NODE_ENV: production\n      TRUST_PROXY: "1"',
      "    environment:\n      - NODE_ENV=production\n      - TRUST_PROXY=1",
    );
    expect(declaredApiEnvKeys(listForm)).toEqual(["NODE_ENV", "TRUST_PROXY"]);
  });

  it("finds the variables no reader mentions", () => {
    expect(findOrphanEnvKeys(["NODE_ENV", "READ_ONLY"], READERS)).toEqual(["READ_ONLY"]);
  });

  /**
   * P1-3 (review 2026-11-11): `READ_ONLY: "true"` sat in the production compose
   * with no reader in server/src, so the operator believed the container was
   * read-only while it was not. The inverted rule catches the next one: any api
   * variable the server never mentions fails the gate.
   */
  it("rejects an api variable nothing in the server sources reads (READ_ONLY)", () => {
    const withDeadFlag = PROD_OK.replace(
      '      TRUST_PROXY: "1"',
      '      TRUST_PROXY: "1"\n      READ_ONLY: "true"',
    );
    const result = validateCompose("docker-compose.prod.yml", withDeadFlag, {
      readerSource: READERS,
    });
    expect(result.errors.some((error) => error.includes("READ_ONLY"))).toBe(true);
  });

  it("accepts api variables the server sources name", () => {
    const result = validateCompose("docker-compose.prod.yml", PROD_OK, {
      readerSource: READERS,
    });
    expect(result.errors).toEqual([]);
  });
});

describe("production container hardening", () => {
  it("requires a read-only api rootfs", () => {
    const result = validateCompose(
      "docker-compose.prod.yml",
      PROD_OK.replace("    read_only: true\n", ""),
    );
    expect(result.errors.some((error) => error.includes("read_only: true"))).toBe(true);
  });

  it("requires a /tmp tmpfs alongside read_only", () => {
    const result = validateCompose(
      "docker-compose.prod.yml",
      PROD_OK.replace("    tmpfs:\n      - /tmp\n", ""),
    );
    expect(result.errors.some((error) => error.includes("/tmp as a tmpfs"))).toBe(true);
  });

  it("rejects a tmpfs mounted somewhere other than /tmp", () => {
    const result = validateCompose(
      "docker-compose.prod.yml",
      PROD_OK.replace("      - /tmp", "      - /run"),
    );
    expect(result.errors.some((error) => error.includes("/tmp as a tmpfs"))).toBe(true);
  });

  it("rejects a memory cap outside the 64m–2g range", () => {
    const result = validateCompose(
      "docker-compose.prod.yml",
      PROD_OK.replace("${API_MEM_LIMIT:-512m}", "${API_MEM_LIMIT:-8g}"),
    );
    expect(result.errors.some((error) => error.includes("mem_limit must stay within"))).toBe(true);
  });

  it("rejects a CPU cap outside 0.25–4", () => {
    const result = validateCompose(
      "docker-compose.prod.yml",
      PROD_OK.replace("${WEB_CPUS:-1.0}", "${WEB_CPUS:-16}"),
    );
    expect(result.errors.some((error) => error.includes("cpus must stay within"))).toBe(true);
  });

  it("rejects a PID cap outside 32–1024", () => {
    const result = validateCompose(
      "docker-compose.prod.yml",
      PROD_OK.replace("pids_limit: 256", "pids_limit: 100000"),
    );
    expect(result.errors.some((error) => error.includes("pids_limit must stay within"))).toBe(true);
  });

  it("requires memory, CPU, PID and log caps on both services", () => {
    const result = validateCompose(
      "docker-compose.prod.yml",
      PROD_OK.replace("    mem_limit: ${WEB_MEM_LIMIT:-256m}", "").replace(
        '        max-size: "10m"\n',
        "",
      ),
    );
    expect(result.errors.some((error) => error.includes("web service must cap memory"))).toBe(true);
    expect(result.errors.some((error) => error.includes("web service must bound its logs"))).toBe(
      true,
    );
  });
});
