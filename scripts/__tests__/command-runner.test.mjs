import { describe, expect, it } from "vitest";
import { captureCommand, runCommand, runCommandOk } from "../command-runner.mjs";

describe("command-runner", () => {
  it("passes arguments without shell interpretation", () => {
    const value = captureCommand(process.execPath, ["-e", "process.stdout.write(process.argv[1])", "$(not-a-command)"]);
    expect(value).toBe("$(not-a-command)");
  });

  it("returns non-zero status without throwing for failed commands", () => {
    expect(runCommand(process.execPath, ["-e", "process.exit(7)"])).toBe(7);
    expect(runCommandOk(process.execPath, ["-e", "process.exit(7)"])).toBe(false);
  });
});
