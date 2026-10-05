import { describe, it, expect } from "vitest";
import {
  isSafeIceString,
  MAX_ICE_URL_LENGTH,
  MAX_ICE_CREDENTIAL_LENGTH,
} from "../../services/sync/signaling";

// ── isSafeIceString ────────────────────────────────────────────────────

describe("isSafeIceString", () => {
  it("accepts a valid stun URL", () => {
    expect(isSafeIceString("stun:stun.l.google.com:19302", MAX_ICE_URL_LENGTH)).toBe(true);
  });

  it("accepts a valid turns URL", () => {
    expect(isSafeIceString("turns:turn.example.com:5349", MAX_ICE_URL_LENGTH)).toBe(true);
  });

  it("accepts a valid turn URL with port", () => {
    expect(isSafeIceString("turn:turn.example.com:3478", MAX_ICE_URL_LENGTH)).toBe(true);
  });

  it("rejects non-string values", () => {
    expect(isSafeIceString(undefined, MAX_ICE_URL_LENGTH)).toBe(false);
    expect(isSafeIceString(null, MAX_ICE_URL_LENGTH)).toBe(false);
    expect(isSafeIceString(42, MAX_ICE_URL_LENGTH)).toBe(false);
    expect(isSafeIceString(true, MAX_ICE_URL_LENGTH)).toBe(false);
    expect(isSafeIceString({}, MAX_ICE_URL_LENGTH)).toBe(false);
  });

  it("rejects empty string", () => {
    expect(isSafeIceString("", MAX_ICE_URL_LENGTH)).toBe(false);
  });

  it("rejects string exceeding maxLength", () => {
    const longString = "a".repeat(MAX_ICE_URL_LENGTH + 1);
    expect(isSafeIceString(longString, MAX_ICE_URL_LENGTH)).toBe(false);
  });

  it("accepts string at exactly maxLength", () => {
    const exactString = "a".repeat(MAX_ICE_URL_LENGTH);
    expect(isSafeIceString(exactString, MAX_ICE_URL_LENGTH)).toBe(true);
  });

  it("rejects strings with control characters (U+0000-U+001F)", () => {
    expect(isSafeIceString("stun:host\u0000com", MAX_ICE_URL_LENGTH)).toBe(false);
    expect(isSafeIceString("stun:host\ncom", MAX_ICE_URL_LENGTH)).toBe(false);
    expect(isSafeIceString("stun:host\tcom", MAX_ICE_URL_LENGTH)).toBe(false);
    expect(isSafeIceString("stun:host\u001fcom", MAX_ICE_URL_LENGTH)).toBe(false);
  });

  it("rejects strings with DEL character (U+007F)", () => {
    expect(isSafeIceString("stun:host\u007fcom", MAX_ICE_URL_LENGTH)).toBe(false);
  });

  it("rejects strings with C1 control characters (U+0080-U+009F)", () => {
    expect(isSafeIceString("stun:host\u0080com", MAX_ICE_URL_LENGTH)).toBe(false);
    expect(isSafeIceString("stun:host\u009fcom", MAX_ICE_URL_LENGTH)).toBe(false);
  });

  it("accepts URLs with valid special characters", () => {
    expect(isSafeIceString("stun:stun.l.google.com:19302?transport=udp", MAX_ICE_URL_LENGTH)).toBe(true);
    expect(isSafeIceString("turn:user@turn.example.com:3478", MAX_ICE_URL_LENGTH)).toBe(true);
  });

  it("works with MAX_ICE_CREDENTIAL_LENGTH limit", () => {
    const credential = "a".repeat(MAX_ICE_CREDENTIAL_LENGTH);
    expect(isSafeIceString(credential, MAX_ICE_CREDENTIAL_LENGTH)).toBe(true);

    const tooLong = "a".repeat(MAX_ICE_CREDENTIAL_LENGTH + 1);
    expect(isSafeIceString(tooLong, MAX_ICE_CREDENTIAL_LENGTH)).toBe(false);
  });

  it("rejects unicode characters in control range above U+009F", () => {
    // Characters above U+009F are NOT control characters — they should be accepted
    expect(isSafeIceString("stun:host\u00A0com", MAX_ICE_URL_LENGTH)).toBe(true);
    expect(isSafeIceString("stun:host\uFFFDcom", MAX_ICE_URL_LENGTH)).toBe(true);
  });
});

// ── MAX constants ──────────────────────────────────────────────────────

describe("signaling constants", () => {
  it("MAX_ICE_URL_LENGTH is at least 1024", () => {
    expect(MAX_ICE_URL_LENGTH).toBeGreaterThanOrEqual(1024);
  });

  it("MAX_ICE_CREDENTIAL_LENGTH is at least 512", () => {
    expect(MAX_ICE_CREDENTIAL_LENGTH).toBeGreaterThanOrEqual(512);
  });
});
