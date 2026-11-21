// Coverage anchor for `MemoryPipeline` concurrency branches: when the
// pipeline is already running (isRunning=true) and a counter crosses
// the threshold, the next call must set `pendingScenarioBuild` /
// `pendingPersonaRegeneration` instead of recursing into
// `buildScenarios` / `regeneratePersona`. These short-circuit branches
// sit at:
//
//   MemoryPipeline.ts:67   if (this.isRunning) {
//   MemoryPipeline.ts:68     this.pendingScenarioBuild = true;
//   MemoryPipeline.ts:69     return;
//   MemoryPipeline.ts:70   }
//   MemoryPipeline.ts:79   if (this.isRunning) {
//   MemoryPipeline.ts:80     this.pendingPersonaRegeneration = true;
//   MemoryPipeline.ts:81     return;
//   MemoryPipeline.ts:82   }
//
// They were uncovered because the existing 45-test suite never exercises
// the "counter crosses threshold while a previous run is still in
// flight" condition. This file forces it by pinning `isRunning = true`
// and triggering the counter thresholds, while spying the deeper
// runners to assert they were NOT called.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { memoryPipeline } from "../../memory/MemoryPipeline";
import { DEFAULT_PIPELINE_CONFIG } from "../../memory/MemoryTypes";

beforeEach(() => {
  // Reset pipeline state to defaults before each test.
  (memoryPipeline as unknown as { reset: () => void }).reset();
  (memoryPipeline as unknown as { config: typeof DEFAULT_PIPELINE_CONFIG }).config = {
    ...DEFAULT_PIPELINE_CONFIG,
  };
  (memoryPipeline as unknown as { isRunning: boolean }).isRunning = false;
});

afterEach(() => {
  // Always settle the running flag back to false so cross-test state
  // does not leak through vi.fn reentrancy.
  (memoryPipeline as unknown as { isRunning: boolean }).isRunning = false;
});

describe("MemoryPipeline — concurrency gating", () => {
  it("atomCounter crossing the build threshold while isRunning=true sets pendingScenarioBuild without invoking buildScenarios", async () => {
    const inner = memoryPipeline as unknown as {
      isRunning: boolean;
      pendingScenarioBuild: boolean;
      atomCounter: number;
      config: { buildScenariosEveryNAtoms: number };
      buildScenarios: () => Promise<void>;
    };
    inner.isRunning = true;
    inner.config.buildScenariosEveryNAtoms = 1;
    inner.atomCounter = 0;
    inner.pendingScenarioBuild = false;
    const buildSpy = vi
      .spyOn(inner, "buildScenarios")
      .mockResolvedValue(undefined);

    await memoryPipeline.onNewAtom();

    expect(buildSpy).not.toHaveBeenCalled();
    expect(inner.pendingScenarioBuild).toBe(true);
  });

  it("scenarioCounter crossing the persona threshold while isRunning=true sets pendingPersonaRegeneration without invoking regeneratePersona", async () => {
    const inner = memoryPipeline as unknown as {
      isRunning: boolean;
      pendingPersonaRegeneration: boolean;
      scenarioCounter: number;
      config: { regeneratePersonaEveryNScenarios: number };
      regeneratePersona: () => Promise<void>;
    };
    inner.isRunning = true;
    inner.config.regeneratePersonaEveryNScenarios = 1;
    inner.scenarioCounter = 0;
    inner.pendingPersonaRegeneration = false;
    const regenSpy = vi
      .spyOn(inner, "regeneratePersona")
      .mockResolvedValue(undefined);

    await memoryPipeline.onNewScenario();

    expect(regenSpy).not.toHaveBeenCalled();
    expect(inner.pendingPersonaRegeneration).toBe(true);
  });

  // extractAtoms / buildScenarios / regeneratePersona each begin with the
  // same `if (this.isRunning || generation !== this.lifecycleGeneration)
  // return;` guard. With isRunning=true the guard returns BEFORE the
  // await chain (initDB / db.memory.find / ... ) gets a chance to run,
  // so spying on a deeper layer that we don't replace gives us the
  // equivalent assertion.
  it("extractAtoms / buildScenarios / regeneratePersona short-circuit when isRunning=true", async () => {
    const inner = memoryPipeline as unknown as {
      isRunning: boolean;
      lifecycleGeneration: number;
    };
    inner.isRunning = true;
    inner.lifecycleGeneration = 1;
    // Spy on the LLM / ragEngine — those are called AFTER the guard, so
    // a clean short-circuit means they are NOT invoked.
    const { aiManager } = await import("../../services/ai/ProviderManager");
    const { ragEngine } = await import("../../services/ai/RAGEngine");
    const aiSpy = vi
      .spyOn(aiManager, "generateText")
      .mockResolvedValue({ text: "[]" } as never);
    const ragSpy = vi
      .spyOn(ragEngine, "generateEmbedding")
      .mockResolvedValue([] as never);

    const pipe = memoryPipeline as unknown as {
      extractAtoms: (id: string, g: number) => Promise<void>;
      buildScenarios: (g: number) => Promise<void>;
      regeneratePersona: (g: number) => Promise<void>;
    };
    await pipe.extractAtoms("sess", 1);
    await pipe.buildScenarios(1);
    await pipe.regeneratePersona(1);
    // Use the cast to silence noUnusedLocals.
    void pipe;

    expect(aiSpy).not.toHaveBeenCalled();
    expect(ragSpy).not.toHaveBeenCalled();
  });
});
