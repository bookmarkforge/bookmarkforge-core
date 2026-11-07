/**
 * src/tests/translation/engineSelector.test.ts
 *
 * Entitlement policy: a Free user must never be upgraded to a local engine
 * silently, and a Pro run must never be silently downgraded to a paid cloud
 * call just because the device lacks WebGPU.
 */

import { describe, expect, it } from "vitest";
import {
  listAvailableEngines,
  localEngineBlocker,
  selectTranslationEngine,
} from "../../modules/translation/engines/engineSelector";
import type { TranslationCapabilities } from "../../modules/translation/types";

const capable: TranslationCapabilities = {
  webgpu: true,
  shaderF16: true,
  deviceMemoryGB: 8,
  hardwareConcurrency: 8,
  ollamaReachable: true,
  cloudConfigured: true,
};

const noGpu: TranslationCapabilities = {
  ...capable,
  webgpu: false,
  shaderF16: false,
};

const noLocalAtAll: TranslationCapabilities = {
  ...noGpu,
  ollamaReachable: false,
};

const langs = { sourceLocale: "en", targetLocale: "es" };

describe("selectTranslationEngine", () => {
  it("gives Pro the WebLLM engine first when the device can run it", () => {
    const selection = selectTranslationEngine({ isPro: true, capabilities: capable, ...langs });
    expect(selection.descriptor.id).toBe("webllm");
    expect(selection.fallback).toBe(false);
  });

  it("gives Free the cloud engine and never a local one", () => {
    const selection = selectTranslationEngine({ isPro: false, capabilities: capable, ...langs });
    expect(selection.descriptor.id).toBe("cloud");
    expect(selection.descriptor.isLocal).toBe(false);
  });

  it("fails closed when a Free user explicitly asks for a local engine", () => {
    expect(() =>
      selectTranslationEngine({
        isPro: false,
        preferred: "ollama",
        capabilities: capable,
        ...langs,
      }),
    ).toThrowError(/Pro license/);
    try {
      selectTranslationEngine({
        isPro: false,
        preferred: "webllm",
        capabilities: capable,
        ...langs,
      });
    } catch (error) {
      expect((error as { code?: string }).code).toBe("pro-required");
    }
  });

  it("falls back to Ollama when WebGPU is unavailable", () => {
    const selection = selectTranslationEngine({ isPro: true, capabilities: noGpu, ...langs });
    expect(selection.descriptor.id).toBe("ollama");
    expect(selection.warnings).toContain("webgpu-unavailable");
  });

  it("falls back to NLLB when neither WebGPU nor Ollama is available", () => {
    const selection = selectTranslationEngine({
      isPro: true,
      capabilities: noLocalAtAll,
      ...langs,
    });
    expect(selection.descriptor.id).toBe("nllb");
  });

  it("uses the cloud as a last resort for Pro only when nothing local can run", () => {
    const selection = selectTranslationEngine({
      isPro: true,
      capabilities: noLocalAtAll,
      sourceLocale: "en",
      // NLLB has no FLORES code for Klingon, so the local chain is exhausted.
      targetLocale: "tlh",
    });
    expect(selection.descriptor.id).toBe("cloud");
    expect(selection.fallback).toBe(true);
  });

  it("throws when nothing is usable at all", () => {
    expect(() =>
      selectTranslationEngine({
        isPro: false,
        capabilities: { ...capable, cloudConfigured: false },
        ...langs,
      }),
    ).toThrowError(/No cloud AI provider/);
  });

  it("rejects a specific engine whose device gate fails", () => {
    expect(() =>
      selectTranslationEngine({
        isPro: true,
        preferred: "webllm",
        capabilities: noGpu,
        ...langs,
      }),
    ).toThrowError(/webgpu-unavailable/);
  });
});

describe("localEngineBlocker", () => {
  it("reports the precise blocker in ladder order", () => {
    expect(localEngineBlocker("webllm", noGpu, "en", "es")).toBe("webgpu-unavailable");
    expect(
      localEngineBlocker("webllm", { ...capable, shaderF16: false }, "en", "es"),
    ).toBe("shader-f16-unsupported");
    expect(
      localEngineBlocker("webllm", { ...capable, deviceMemoryGB: 2 }, "en", "es"),
    ).toBe("insufficient-memory");
    expect(localEngineBlocker("ollama", noLocalAtAll, "en", "es")).toBe(
      "ollama-unreachable",
    );
    expect(localEngineBlocker("nllb", capable, "en", "tlh")).toBe(
      "unsupported-language-pair",
    );
    expect(localEngineBlocker("webllm", capable, "en", "es")).toBeNull();
  });
});

describe("listAvailableEngines", () => {
  it("marks every local engine as pro-required for Free users", () => {
    const engines = listAvailableEngines({ isPro: false, capabilities: capable, ...langs });
    const local = engines.filter((engine) => engine.isLocal);
    expect(local.length).toBe(3);
    for (const engine of local) {
      expect(engine.unavailableReason).toBe("pro-required");
    }
    expect(engines.find((engine) => engine.id === "cloud")?.unavailableReason).toBeUndefined();
  });

  it("reports capability blockers for Pro users", () => {
    const engines = listAvailableEngines({ isPro: true, capabilities: noLocalAtAll, ...langs });
    expect(engines.find((engine) => engine.id === "webllm")?.unavailableReason).toBe(
      "webgpu-unavailable",
    );
    expect(engines.find((engine) => engine.id === "ollama")?.unavailableReason).toBe(
      "ollama-unreachable",
    );
    expect(engines.find((engine) => engine.id === "nllb")?.unavailableReason).toBeUndefined();
  });
});
