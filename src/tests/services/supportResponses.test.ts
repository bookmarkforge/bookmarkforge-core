import { describe, it, expect, beforeEach } from "vitest";
import {
  getInitialSupportMessages,
  getSupportResponse,
} from "../../utils/supportResponses";
import { STORAGE_KEYS } from "../../constants/storage-keys";

const KEY = STORAGE_KEYS.BMF_SUPPORT_HISTORY;

describe("getSupportResponse", () => {
  it("matches greetings on token boundaries ('hi' must not match 'this')", () => {
    expect(getSupportResponse("hi there")).toBe("app_supportChatHi");
    expect(getSupportResponse("Hola!")).toBe("app_supportChatHi");
    expect(getSupportResponse("hey")).toBe("app_supportChatHi");
    expect(getSupportResponse("this is broken")).not.toBe(
      "app_supportChatHi",
    );
    expect(getSupportResponse("this is broken")).toBe(
      "app_supportChatTroubleshoot",
    );
  });

  it("normalizes accents before matching (contraseña → contrasena)", () => {
    expect(getSupportResponse("olvidé mi contraseña")).toBe(
      "app_supportChatVault",
    );
  });

  it("routes refund intent before license keywords", () => {
    // "refund my pro license" contains both refund and license terms; the
    // refund branch must win.
    expect(getSupportResponse("I want a refund for my pro license")).toBe(
      "app_supportChatRefund",
    );
  });

  it("routes GDPR/data-deletion requests to privacy", () => {
    expect(getSupportResponse("how do I delete my data?")).toBe(
      "app_supportChatPrivacy",
    );
    expect(getSupportResponse("GDPR right to be forgotten")).toBe(
      "app_supportChatPrivacy",
    );
  });

  it("is case-insensitive and matches multi-word phrases", () => {
    expect(getSupportResponse("HOW DO I EXPORT A BACKUP?")).toBe(
      "app_supportChatBackup",
    );
  });

  it("falls back to the default response for unmatched queries", () => {
    expect(getSupportResponse("xyzzy plugh")).toBe("app_supportChatDefault");
    expect(getSupportResponse("")).toBe("app_supportChatDefault");
  });
});

describe("getInitialSupportMessages", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns the welcome message when nothing is stored", () => {
    const msgs = getInitialSupportMessages();
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({
      role: "assistant",
      content: "app_supportChatWelcome",
      isTranslationKey: true,
    });
  });

  it("returns valid persisted history", () => {
    const history = [
      { role: "user", content: "hi" },
      { role: "assistant", content: "app_supportChatHi", isTranslationKey: true },
    ];
    localStorage.setItem(KEY, JSON.stringify(history));
    expect(getInitialSupportMessages()).toEqual(history);
  });

  it("filters malformed entries and keeps valid ones", () => {
    localStorage.setItem(
      KEY,
      JSON.stringify([
        { role: "user", content: "ok" },
        { role: "robot", content: "bad role" },
        { role: "assistant" }, // missing content
        "not-an-object",
        null,
      ]),
    );
    expect(getInitialSupportMessages()).toEqual([
      { role: "user", content: "ok" },
    ]);
  });

  it("falls back to welcome on corrupted JSON, non-arrays and all-invalid entries", () => {
    localStorage.setItem(KEY, "{not json");
    expect(getInitialSupportMessages()[0]?.content).toBe(
      "app_supportChatWelcome",
    );

    localStorage.setItem(KEY, JSON.stringify({ role: "user" }));
    expect(getInitialSupportMessages()[0]?.content).toBe(
      "app_supportChatWelcome",
    );

    localStorage.setItem(KEY, JSON.stringify([{ role: "user" }]));
    expect(getInitialSupportMessages()[0]?.content).toBe(
      "app_supportChatWelcome",
    );
  });
});
