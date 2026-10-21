/**
 * Tests for database.ts — internal error-classification functions.
 *
 * walkErrorChain: walks an error's .cause chain and produces normalized
 *   frames. Supports Error, string, plain object, circular references,
 *   and depth limit.
 * classifyDbError: classifies frames by .code (DB1, DB3-DB9).
 * redactKeyMaterial: redacts sensitive material in error messages.
 *
 * These functions are PURE: they depend on neither RxDB, IndexedDB, nor mocks.
 */
import { describe, it, expect } from "vitest";

import {
  walkErrorChain,
  classifyDbError,
  redactKeyMaterial,
  type ErrorFrame,
} from "../../db/database";

// ====================================================================
// walkErrorChain
// ====================================================================

describe("walkErrorChain", () => {
  // ── Error simple sin .cause ──
  it("returns one frame for a plain Error with no cause", () => {
    const err = new Error("simple message");
    const frames = walkErrorChain(err);
    expect(frames).toHaveLength(1);
    expect(frames[0]!.message).toBe("simple message");
    expect(frames[0]!.name!).toBe("Error");
    expect(frames[0]!.code).toBeUndefined();
  });

  // ── Error + .cause cadena anidada ──
  it("walks the cause chain for nested Errors", () => {
    const inner = new Error("inner error");
    const outer = new Error("outer error", { cause: inner });
    const frames = walkErrorChain(outer);
    expect(frames).toHaveLength(2);
    expect(frames[0]!.message).toBe("outer error");
    expect(frames[0]!.name!).toBe("Error");
    expect(frames[1]!.message).toBe("inner error");
    expect(frames[1]!.name!).toBe("Error");
  });

  // ── Circular cause chain ──
  it("detects circular cause chains and inserts [circular cause chain]", () => {
    const err = new Error("root");
    (err as any).cause = err; // self-referential
    const frames = walkErrorChain(err);
    // First frame: root. Second frame: circular detection
    expect(frames).toHaveLength(2);
    expect(frames[0]!.message).toBe("root");
    expect(frames[1]!.message).toBe("[circular cause chain]");
    expect(frames[1]!.name!).toBe("Circular");
  });

  // ── String thrown ──
  it("handles a string thrown value", () => {
    const frames = walkErrorChain("string error");
    expect(frames).toHaveLength(1);
    expect(frames[0]!.message).toBe("string error");
    expect(frames[0]!.code).toBeUndefined();
    expect(frames[0]!.name).toBeUndefined();
  });

  // ── Objeto plano con .code y .cause ──
  it("handles plain objects with .code and .cause", () => {
    const innerCause = { message: "inner cause", code: "DB3" };
    const obj = {
      message: "object error",
      code: "DB1",
      name: "CustomObj",
      cause: innerCause,
    };
    const frames = walkErrorChain(obj);
    expect(frames).toHaveLength(2);
    expect(frames[0]!.message).toBe("object error");
    expect(frames[0]!.code!).toBe("DB1");
    expect(frames[0]!.name!).toBe("CustomObj");
    expect(frames[1]!.message).toBe("inner cause");
    expect(frames[1]!.code!).toBe("DB3");
  });

  // ── Number/boolean as thrown value ──
  it("handles number and boolean thrown values", () => {
    const numFrames = walkErrorChain(42);
    expect(numFrames).toHaveLength(1);
    expect(numFrames[0]!.message).toBe("42");

    const boolFrames = walkErrorChain(true);
    expect(boolFrames).toHaveLength(1);
    expect(boolFrames[0]!.message).toBe("true");
  });

  // ── Error con .code (simula RxDB DB1) ──
  it("preserves .code from Error instances", () => {
    const err = new Error("storage failed");
    (err as any).code = "DB1";
    const frames = walkErrorChain(err);
    expect(frames[0]!.code!).toBe("DB1");
    expect(frames[0]!.message).toBe("storage failed");
  });

  // ── null/undefined ──
  it("returns empty array for null or undefined input", () => {
    expect(walkErrorChain(null)).toHaveLength(0);
    expect(walkErrorChain(undefined)).toHaveLength(0);
  });

  // ── Error sin .message ──
  it("handles Error with empty message", () => {
    const err = new Error("");
    const frames = walkErrorChain(err);
    expect(frames).toHaveLength(1);
    expect(frames[0]!.message).toBe("");
  });

  // ── Error con .cause = undefined → break ──
  it("breaks when .cause is undefined", () => {
    const err = new Error("only");
    (err as any).cause = undefined;
    const frames = walkErrorChain(err);
    expect(frames).toHaveLength(1);
    expect(frames[0]!.message).toBe("only");
  });
});

// ====================================================================
// classifyDbError
// ====================================================================

describe("classifyDbError", () => {
  it("returns WRONG_PASSWORD for a frame with code DB1", () => {
    const frames: ErrorFrame[] = [{ message: "err", code: "DB1" }];
    expect(classifyDbError(frames)).toBe("WRONG_PASSWORD");
  });

  it("returns INACCESSIBLE for a frame with code DB3", () => {
    const frames: ErrorFrame[] = [{ message: "err", code: "DB3" }];
    expect(classifyDbError(frames)).toBe("INACCESSIBLE");
  });

  it("returns INACCESSIBLE for any code DB3 through DB9", () => {
    expect(classifyDbError([{ message: "", code: "DB3" }])).toBe(
      "INACCESSIBLE",
    );
    expect(classifyDbError([{ message: "", code: "DB5" }])).toBe(
      "INACCESSIBLE",
    );
    expect(classifyDbError([{ message: "", code: "DB9" }])).toBe(
      "INACCESSIBLE",
    );
  });

  it("returns UNKNOWN for unrecognized codes", () => {
    const frames: ErrorFrame[] = [{ message: "err", code: "DB99" }];
    expect(classifyDbError(frames)).toBe("UNKNOWN");
  });

  it("skips frames without a .code and continues scanning", () => {
    const frames: ErrorFrame[] = [
      { message: "no code" },
      { message: "has code", code: "DB1" },
    ];
    expect(classifyDbError(frames)).toBe("WRONG_PASSWORD");
  });

  it("returns UNKNOWN for empty frames array", () => {
    expect(classifyDbError([])).toBe("UNKNOWN");
  });

  it("returns UNKNOWN when no frame has a recognized code", () => {
    const frames: ErrorFrame[] = [
      { message: "a", code: "ERR1" },
      { message: "b", code: "ERR2" },
    ];
    expect(classifyDbError(frames)).toBe("UNKNOWN");
  });
});

// ====================================================================
// redactKeyMaterial
// ====================================================================

describe("redactKeyMaterial", () => {
  it("redacts keyword-anchored material (password=...)", () => {
    const input =
      'password=AIzaSyDabcdefghijklmnopqrstuvwxyzABCDEFG1234567890abc';
    const result = redactKeyMaterial(input);
    expect(result).toContain("password=[REDACTED]");
    expect(result).not.toContain("AIzaSyD");
  });

  it("redacts keyword-anchored material (key: ...)", () => {
    const input = "The derived key: abcdefghijklmnopqrstuvwxyz1234567890abcdef";
    const result = redactKeyMaterial(input);
    expect(result).toContain("key=[REDACTED]");
  });

  it("redacts standalone long runs >= 40 chars", () => {
    const input = "abc123def456ghi789jkl012mno345pqr678stu901vwx234yz0";
    expect(input.length).toBeGreaterThanOrEqual(40);
    const result = redactKeyMaterial(input);
    expect(result).toBe("[REDACTED]");
  });

  it("does NOT redact short runs < 40 chars", () => {
    const input = "short-run-abcdef1234";
    const result = redactKeyMaterial(input);
    expect(result).toBe(input);
  });

  it("truncates output exceeding maxLen with ellipsis", () => {
    const maxLen = 50;
    // Words with spaces: no 40+ char run, so the redactor must NOT
    // collapse this input to [REDACTED] before truncation kicks in.
    const input = "The quick brown fox jumps over the lazy dog. ".repeat(3);
    const result = redactKeyMaterial(input, maxLen);
    expect(result.length).toBe(maxLen + 1); // 50 chars + '…' (1 char)
    expect(result.endsWith("…")).toBe(true);
  });

  it("does NOT truncate output within maxLen", () => {
    const input = "short message no key material";
    const result = redactKeyMaterial(input);
    expect(result).toBe(input);
  });

  it("handles empty string", () => {
    expect(redactKeyMaterial("")).toBe("");
  });

  it("handles strings without any key material", () => {
    const input = "normal error message without secrets";
    const result = redactKeyMaterial(input);
    expect(result).toBe(input);
  });
});
