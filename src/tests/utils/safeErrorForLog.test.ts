import { describe, test, expect } from "vitest";

import { safeErrorForLog } from "../../utils/safeErrorForLog";
import { LEAK_SENTINEL } from "./leakAssertions";

describe("safeErrorForLog", () => {
  test("preserves name and message for a normal short Error", () => {
    const err = new Error("Rate limit exceeded");
    expect(safeErrorForLog(err)).toEqual({
      name: "Error",
      message: "Rate limit exceeded",
    });
  });

  test("truncates messages longer than the cap with a tail marker", () => {
    const long = "x".repeat(500);
    const err = new Error(long);
    const projected = safeErrorForLog(err);
    expect(projected.message.length).toBeLessThanOrEqual(220);
    expect(projected.message).toContain("+300");
  });

  test("handles non-Error throws (string, number, undefined)", () => {
    expect(safeErrorForLog("boom")).toEqual({
      name: "NonErrorThrown",
      message: "boom",
    });
    expect(safeErrorForLog(42)).toEqual({
      name: "NonErrorThrown",
      message: "42",
    });
    expect(safeErrorForLog(undefined)).toEqual({
      name: "NonErrorThrown",
      message: "undefined",
    });
  });

  test("does not include the stack in the result", () => {
    const err = new Error("with stack");
    err.stack = "Error: with stack\n    at frame (file:///app.js:1:1)";
    const projected = safeErrorForLog(err);
    expect(JSON.stringify(projected)).not.toContain("app.js");
  });

  test("bounds the leak surface for messages containing a user payload", () => {
    // The helper cannot detect what is sensitive inside a message. Its
    // guarantee is that the leak surface stays bounded: truncation caps the
    // blast radius of any accidental or hostile embedding of payload.
    const longWithSecret = `${"x".repeat(300)} ${LEAK_SENTINEL} ${"y".repeat(300)}`;
    const err = new Error(longWithSecret);
    const projected = safeErrorForLog(err);
    expect(projected.message.length).toBeLessThanOrEqual(220);
    expect(projected.name).toBe("Error");
    expect(projected).not.toHaveProperty("stack");
  });
});
