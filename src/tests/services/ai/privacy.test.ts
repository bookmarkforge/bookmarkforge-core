import { describe, expect, test, vi } from "vitest";
import { generateWithPrivacy } from "../../../services/ai/privacy";
import type { AIRequestOptions } from "../../../services/ai/types";

const response = { text: "ok", provider: "ollama" };

describe("generateWithPrivacy", () => {
  test("forces a private source to the local-provider path", async () => {
    const generator = {
      generateText: vi.fn().mockResolvedValue(response),
    };
    const signal = new AbortController().signal;

    await generateWithPrivacy(
      generator,
      { isPrivate: true },
      "private content",
      undefined,
      { isPrivate: false, signal } as unknown as Omit<AIRequestOptions, "isPrivate">,
    );

    expect(generator.generateText).toHaveBeenCalledWith(
      "private content",
      undefined,
      { isPrivate: true, signal },
    );
  });

  test("fails closed when privacy metadata is missing at a runtime boundary", async () => {
    const generator = {
      generateText: vi.fn().mockResolvedValue(response),
    };

    await generateWithPrivacy(
      generator,
      {} as { isPrivate: boolean },
      "unclassified content",
    );

    expect(generator.generateText).toHaveBeenCalledWith(
      "unclassified content",
      undefined,
      { isPrivate: true },
    );
  });

  test("preserves non-privacy request options", async () => {
    const generator = {
      generateText: vi.fn().mockResolvedValue(response),
    };
    const signal = new AbortController().signal;

    await generateWithPrivacy(
      generator,
      { isPrivate: false },
      "public content",
      "system",
      { complexity: "simple", signal },
    );

    expect(generator.generateText).toHaveBeenCalledWith(
      "public content",
      "system",
      { complexity: "simple", signal, isPrivate: false },
    );
  });
});
