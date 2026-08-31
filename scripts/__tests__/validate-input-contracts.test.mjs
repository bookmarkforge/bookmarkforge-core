import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { validateInputContracts } from "../validate-input-contracts.mjs";

describe("workflow input contracts", () => {
  it("accepts repository staging and rollback workflows", () => {
    const result = validateInputContracts(
      readFileSync(".github/workflows/staging-deploy.yml", "utf8"),
      readFileSync(".github/workflows/staging-rollback.yml", "utf8"),
      readFileSync(".github/workflows/staging-smoke.yml", "utf8"),
    );
    expect(result.errors).toEqual([]);
  });

  it("rejects staging URLs that allow arbitrary ports", () => {
    const result = validateInputContracts(
      "permissions:\n  contents: read",
      "workflow_dispatch:\npermissions:\n  contents: read\nenvironment: staging\nscripts/staging-rollback.mjs\nDEPLOY_COMPOSE_FILE: docker-compose.staging.yml\n[[ \"$tag\" =~ ^prod-[0-9]{8}-[0-9]{4}-[0-9a-fA-F]{7,40}$ ]]\ngit cat-file -t $tag\nstaging_url must not include a port",
      "permissions:\n  contents: read\nSTAGING_SMOKE_TOKEN\nsecrets:\n[[ \"$url\" == https://* ]]\nstaging_url must not include a port",
    );
    expect(result.errors).toEqual([]);
  });

  it("rejects an ambiguous admin diagnostic secret contract", () => {
    const result = validateInputContracts(
      "permissions:\n  contents: read",
      "permissions:\n  contents: read\nenvironment: staging\nscripts/staging-rollback.mjs\nworkflow_dispatch:\nDEPLOY_COMPOSE_FILE: docker-compose.staging.yml",
      "permissions:\n  contents: read\nSTAGING_SMOKE_TOKEN\nSTAGING_SMOKE_ADMIN_TOKEN: literal-token\nif: ${{ env.STAGING_SMOKE_ADMIN_TOKEN != '' }}\n",
    );
    expect(result.errors).toContain("staging-smoke.yml: admin diagnostic secret contract must remain explicit and opt-in");
  });

  it("rejects a rollback workflow without strict tag validation", () => {
    const result = validateInputContracts(
      "permissions:\n  contents: read",
      "workflow_dispatch:\npermissions:\n  contents: read\nenvironment: staging",
      "permissions:\n  contents: read",
    );
    expect(result.errors).toContain("staging-rollback.yml: strict annotated production tag format missing");
  });
});
