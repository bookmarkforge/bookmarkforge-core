import { describe, test, expect } from "vitest";

import { assertNoContentLeak, LEAK_SENTINEL } from "./leakAssertions";

describe("assertNoContentLeak", () => {
  test("passes when no surface contains the secret", () => {
    expect(() =>
      assertNoContentLeak(
        LEAK_SENTINEL,
        { ok: true, count: 1 },
        new Error("plain unrelated message"),
        "no leak here",
        [1, 2, 3],
      ),
    ).not.toThrow();
  });

  test("fails when an Error message contains the secret", () => {
    const err = new Error(`Bad JSON at offset 7 near ${LEAK_SENTINEL}`);
    expect(() => assertNoContentLeak(LEAK_SENTINEL, err)).toThrow();
  });

  test("fails when a string surface contains the secret", () => {
    expect(() =>
      assertNoContentLeak(LEAK_SENTINEL, `prefix-${LEAK_SENTINEL}-suffix`),
    ).toThrow();
  });

  test("fails when a structured surface contains the secret", () => {
    const surface = {
      reason: "SyntaxError",
      fragment: `Unexpected token at "${LEAK_SENTINEL}"`,
    };
    expect(() => assertNoContentLeak(LEAK_SENTINEL, surface)).toThrow();
  });

  test("skips null and undefined surfaces", () => {
    expect(() =>
      assertNoContentLeak(LEAK_SENTINEL, null, undefined, "clean"),
    ).not.toThrow();
  });

  test("exposes a built-in sentinel that is unique enough not to clash with payloads", () => {
    // Sanity: the sentinel itself should not appear in normal UI text.
    expect(LEAK_SENTINEL).toMatch(/DO-NOT-LEAK-/);
  });
});
