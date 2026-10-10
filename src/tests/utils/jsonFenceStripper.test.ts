import { describe, it, expect } from "vitest";
import { stripJsonFence, parseFencedJson } from "../../utils/jsonFenceStripper";

describe("stripJsonFence", () => {
  it("pasa JSON limpio sin cambios", () => {
    expect(stripJsonFence('{"key":"value"}')).toBe('{"key":"value"}');
  });

  it("strippea fence ```json con newline", () => {
    expect(stripJsonFence('```json\n{"key":"value"}\n```')).toBe(
      '{"key":"value"}',
    );
  });

  it("strippea fence ``` sin language tag", () => {
    expect(stripJsonFence('```\n{"key":"value"}\n```')).toBe(
      '{"key":"value"}',
    );
  });

  it("strips fence with uppercase (```JSON)", () => {
    expect(stripJsonFence('```JSON\n{"key":"value"}\n```')).toBe(
      '{"key":"value"}',
    );
  });

  it("strips fence with whitespace after backticks (``` json)", () => {
    expect(stripJsonFence('``` json\n{"key":"value"}\n```')).toBe(
      '{"key":"value"}',
    );
  });

  it("strippea fence sin newline final", () => {
    expect(stripJsonFence('```json\n{"key":"value"}```')).toBe(
      '{"key":"value"}',
    );
  });

  it("handles JSON array with fence", () => {
    expect(stripJsonFence('```json\n[1,2,3]\n```')).toBe("[1,2,3]");
  });

  it("handles multiline JSON with fence", () => {
    const input = '```json\n{\n  "a": 1,\n  "b": 2\n}\n```';
    expect(stripJsonFence(input)).toBe('{\n  "a": 1,\n  "b": 2\n}');
  });

  it("does not strip text containing loose backticks in the middle", () => {
    const input = 'Some text with `backticks` inside';
    expect(stripJsonFence(input)).toBe(input);
  });

  it("handles empty string", () => {
    expect(stripJsonFence("")).toBe("");
  });

  it("handles whitespace only", () => {
    expect(stripJsonFence("   ")).toBe("");
  });

  it("strippea fence con espacios alrededor", () => {
    expect(stripJsonFence('  ```json\n{"x":1}\n```  ')).toBe('{"x":1}');
  });

  it("handles a block with content that includes backticks", () => {
    // Content as markdown code inside the block
    const input = '```json\n{"code": "`backtick`"}\n```';
    expect(stripJsonFence(input)).toBe('{"code": "`backtick`"}');
  });
});

describe("parseFencedJson", () => {
  it("parses fenced JSON", () => {
    expect(parseFencedJson('```json\n[1,2,3]\n```')).toEqual([1, 2, 3]);
  });

  it("parses fenced JSON with whitespace after backticks", () => {
    expect(parseFencedJson('``` json\n{"a": 1}\n```')).toEqual({ a: 1 });
  });

  it("parses clean JSON without fences", () => {
    expect(parseFencedJson('{"ok": true}')).toEqual({ ok: true });
  });

  it("throws a content-free error for malformed JSON", () => {
    const secret = "sk-proj-SUPERSECRETVALUE123456";
    let thrown: Error | null = null;
    try {
      parseFencedJson(`{"leak": "${secret}" not valid`);
    } catch (e) {
      thrown = e as Error;
    }
    expect(thrown).not.toBeNull();
    expect(thrown!.message).not.toContain(secret);
    expect(thrown!.message).toBe("AI response was not valid JSON");
  });

  it("rejects oversized input before parsing", () => {
    const oversized = `{"a": "${"x".repeat(300 * 1024)}"}`;
    expect(() => parseFencedJson(oversized, 256 * 1024)).toThrow(
      "AI response exceeds the configured size limit",
    );
  });

  it("accepts input at or under the configured limit", () => {
    expect(parseFencedJson('{"ok": true}', 32)).toEqual({ ok: true });
  });
});
