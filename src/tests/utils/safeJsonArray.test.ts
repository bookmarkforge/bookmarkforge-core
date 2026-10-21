import { describe, test, expect } from "vitest";

import {
  safeParseJsonArray,
  safeParseJsonObject,
} from "../../utils/safeJsonArray";
import { assertNoContentLeak } from "./leakAssertions";

describe("safeParseJsonArray", () => {
  test("returns no entries and no failure flag for null / undefined / empty", () => {
    expect(safeParseJsonArray(null)).toEqual({ entries: [], parseFailed: false });
    expect(safeParseJsonArray(undefined)).toEqual({
      entries: [],
      parseFailed: false,
    });
    expect(safeParseJsonArray("")).toEqual({ entries: [], parseFailed: false });
  });

  test("flags parseFailed and returns no entries when JSON is malformed", () => {
    // The raw text must not leak into the result or its parseFailed flag.
    const raw = '{"id":"x"';
    expect(safeParseJsonArray(raw)).toEqual({ entries: [], parseFailed: true });
  });

  test("flags parseFailed for non-array JSON (object / number / string)", () => {
    expect(safeParseJsonArray("{}")).toEqual({ entries: [], parseFailed: true });
    expect(safeParseJsonArray("42")).toEqual({ entries: [], parseFailed: true });
    expect(safeParseJsonArray('"hello"')).toEqual({
      entries: [],
      parseFailed: true,
    });
    expect(safeParseJsonArray("null")).toEqual({
      entries: [],
      parseFailed: true,
    });
  });

  test("filters out non-object entries (primitives, null, nested arrays)", () => {
    const raw = JSON.stringify([
      { id: "a" },
      null,
      42,
      "string",
      ["nested", "array"],
      { id: "b" },
    ]);
    const { entries, parseFailed } = safeParseJsonArray<{ id: string }>(raw);
    expect(parseFailed).toBe(false);
    expect(entries.map((e) => e.id)).toEqual(["a", "b"]);
  });

  test("preserves a valid JSON array of objects verbatim", () => {
    const raw = JSON.stringify([{ id: "a", value: 1 }, { id: "b", value: 2 }]);
    const result = safeParseJsonArray<{ id: string; value: number }>(raw);
    expect(result.parseFailed).toBe(false);
    expect(result.entries).toEqual([
      { id: "a", value: 1 },
      { id: "b", value: 2 },
    ]);
  });

  test("does not leak the raw payload into the return value on parse failure", () => {
    // Regression: a hostile or truncated blob must not leak via the
    // returned object. The contract is `{ entries: [], parseFailed: true }`
    // and nothing else.
    const raw = '{"secret":"very-private-token-DO-NOT-LEAK-9f4b"';
    const result = safeParseJsonArray(raw);
    assertNoContentLeak("very-private-token-DO-NOT-LEAK-9f4b", result);
  });
});

describe("safeParseJsonObject", () => {
  test("returns no value and no failure for null / undefined / empty", () => {
    expect(safeParseJsonObject(null)).toEqual({
      value: null,
      parseFailed: false,
    });
    expect(safeParseJsonObject(undefined)).toEqual({
      value: null,
      parseFailed: false,
    });
    expect(safeParseJsonObject("")).toEqual({
      value: null,
      parseFailed: false,
    });
  });

  test("flags parseFailed and returns no value for malformed JSON", () => {
    expect(safeParseJsonObject('{"a":1')).toEqual({
      value: null,
      parseFailed: true,
    });
  });

  test("flags parseFailed when JSON is not a plain object", () => {
    expect(safeParseJsonObject("[]")).toEqual({
      value: null,
      parseFailed: true,
    });
    expect(safeParseJsonObject("42")).toEqual({
      value: null,
      parseFailed: true,
    });
    expect(safeParseJsonObject('"hello"')).toEqual({
      value: null,
      parseFailed: true,
    });
    expect(safeParseJsonObject("null")).toEqual({
      value: null,
      parseFailed: true,
    });
  });

  test("returns the parsed object for a valid plain object", () => {
    const result = safeParseJsonObject<{ a: number; b: string }>(
      '{"a":1,"b":"x"}',
    );
    expect(result.parseFailed).toBe(false);
    expect(result.value).toEqual({ a: 1, b: "x" });
  });

  test("does not leak the raw payload into the return value on parse failure", () => {
    const raw = '{"secret":"very-private-token-DO-NOT-LEAK-9f4b"';
    const result = safeParseJsonObject(raw);
    assertNoContentLeak("very-private-token-DO-NOT-LEAK-9f4b", result);
  });
});
