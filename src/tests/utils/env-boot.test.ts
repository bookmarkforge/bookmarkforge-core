import { describe, it, expect, vi } from "vitest";

// Pure typed re-export of the env registry flags. The test pins the contract:
// the four flags main.tsx branches on must always exist and mirror env.
import { envBoot, type EnvBootFlags } from "../../utils/env-boot";
import { env } from "../../env.config";

describe("env-boot", () => {
  it("exposes exactly the four boot flags", () => {
    expect(Object.keys(envBoot).sort()).toEqual([
      "bootStrict",
      "isDev",
      "isProd",
      "prefixStrict",
    ]);
  });

  it("mirrors the env registry values", () => {
    expect(envBoot.isDev).toBe(env.isDev);
    expect(envBoot.isProd).toBe(env.isProd);
    expect(envBoot.bootStrict).toBe(env.bootStrict);
    expect(envBoot.prefixStrict).toBe(env.prefixStrict);
  });

  it("is deeply frozen so boot policy cannot be mutated at runtime", () => {
    expect(Object.isFrozen(envBoot)).toBe(true);
    const record: EnvBootFlags = envBoot;
    expect(() => {
      (record as { isDev: boolean }).isDev = !envBoot.isDev;
    }).toThrow();
  });
});
