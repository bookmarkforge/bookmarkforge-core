import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { validateOperationalWorkflowText } from "../validate-operational-workflows.mjs";

describe("operational workflow validation", () => {
  it("accepts the repository staging deploy and rollback contracts", () => {
    const result = validateOperationalWorkflowText(
      readFileSync(".github/workflows/staging-deploy.yml", "utf8"),
      readFileSync(".github/workflows/staging-rollback.yml", "utf8"),
    );
    expect(result.errors).toEqual([]);
  });

  it("rejects dynamic secret-backed shell commands", () => {
    const result = validateOperationalWorkflowText(
      "permissions:\n  contents: read\nenvironment: staging\nscripts/staging-deploy.mjs\nSTAGING_DEPLOY_COMMAND: yes\nbash -c \"$STAGING_DEPLOY_COMMAND\"",
      "permissions:\n  contents: read\nenvironment: staging\nscripts/staging-rollback.mjs\nSTAGING_ROLLBACK_COMMAND: yes\nDEPLOY_COMPOSE_FILE: docker-compose.staging.yml\nworkflow_dispatch:",
    );
    expect(result.errors).toContain("staging workflows: dynamic secret-backed shell execution is forbidden");
  });

  it("requires cleanup after using a diagnostic token", () => {
    const result = validateOperationalWorkflowText(
      "permissions:\n  contents: read\nenvironment: staging\nscripts/staging-deploy.mjs",
      "permissions:\n  contents: read\nenvironment: staging\nscripts/staging-rollback.mjs\nDEPLOY_COMPOSE_FILE: docker-compose.staging.yml\nworkflow_dispatch:\nx-client-events-admin-token: $CLIENT_EVENTS_ADMIN_TOKEN",
    );
    expect(result.errors).toContain("staging workflows: diagnostic token must be unset after the request");
  });

  it("rejects step guards based on secret-derived environment state", () => {
    const result = validateOperationalWorkflowText(
      "permissions:\n  contents: read\nenvironment: staging\nscripts/staging-deploy.mjs",
      "permissions:\n  contents: read\nenvironment: staging\nscripts/staging-rollback.mjs\nDEPLOY_COMPOSE_FILE: docker-compose.staging.yml\nworkflow_dispatch:\nif: ${{ env.STAGING_SMOKE_ADMIN_TOKEN != '' }}",
    );
    expect(result.errors).toContain("staging workflows: secret-gated steps must test the secret expression directly");
  });

  it("requires admin secret forwarding for reusable smoke", () => {
    const result = validateOperationalWorkflowText(
      "permissions:\n  contents: read\nenvironment: staging\nscripts/staging-deploy.mjs\nuses: ./.github/workflows/staging-smoke.yml",
      "permissions:\n  contents: read\nenvironment: staging\nscripts/staging-rollback.mjs\nDEPLOY_COMPOSE_FILE: docker-compose.staging.yml\nworkflow_dispatch:",
    );
    expect(result.errors).toContain("staging-deploy.yml: reusable smoke secret forwarding missing");
  });

  it("requires an environment-backed client-events admin token", () => {
    const result = validateOperationalWorkflowText(
      "permissions:\n  contents: read\nenvironment: staging\nscripts/staging-deploy.mjs",
      "permissions:\n  contents: read\nenvironment: staging\nscripts/staging-rollback.mjs\nDEPLOY_COMPOSE_FILE: docker-compose.staging.yml\nworkflow_dispatch:\nx-client-events-admin-token: literal-token",
    );
    expect(result.errors).toContain("staging workflows: client-events admin token must be supplied through env");
  });

  it("rejects chained dependency and verification commands", () => {
    const result = validateOperationalWorkflowText(
      "permissions:\n  contents: read\nenvironment: staging\nscripts/staging-deploy.mjs",
      "permissions:\n  contents: read\nenvironment: staging\nscripts/staging-rollback.mjs\nDEPLOY_COMPOSE_FILE: docker-compose.staging.yml\nworkflow_dispatch:\nrun: npm ci && npm run check:staging-http",
    );
    expect(result.errors).toContain("staging workflows: chained dependency and verification commands are forbidden");
  });

  it("rejects duplicate checkout configuration blocks", () => {
    const result = validateOperationalWorkflowText(
      "permissions:\n  contents: read\nenvironment: staging\nscripts/staging-deploy.mjs",
      "permissions:\n  contents: read\nenvironment: staging\nscripts/staging-rollback.mjs\nDEPLOY_COMPOSE_FILE: docker-compose.staging.yml\nworkflow_dispatch:\n- uses: actions/checkout@v4\n  with:\n    persist-credentials: false\n  with:\n    fetch-depth: 0",
    );
    expect(result.errors).toContain("staging-rollback.yml: duplicate checkout configuration block");
  });

  it("rejects a staging workflow that references production env files", () => {
    const result = validateOperationalWorkflowText(
      "permissions:\n  contents: read\nenvironment: staging\nscripts/staging-deploy.mjs\n--env-file .env.production",
      "permissions:\n  contents: read\nenvironment: staging\nscripts/staging-rollback.mjs\nDEPLOY_COMPOSE_FILE: docker-compose.staging.yml\nworkflow_dispatch:",
    );
    expect(result.errors).toContain("staging-deploy.yml: production env file must not be used by staging workflow");
  });
});
