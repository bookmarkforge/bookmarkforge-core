import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const source = readFileSync("server/src/ai-session.ts", "utf8");

describe("AI session production origin policy", () => {
  it("fails closed when production has no explicit origin allow-list", () => {
    expect(source).toContain('process.env.NODE_ENV === "production"');
    expect(source).toContain("AI_SESSION_ORIGINS is required in production");
  });
});
