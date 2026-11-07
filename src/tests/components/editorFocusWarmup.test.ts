import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../services/ai/ProviderManager", () => ({
  aiManager: {
    warmup: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../../utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { createEditorFocusHandler } from "../../components/block-editor/editorFocusWarmup";
import { aiManager } from "../../services/ai/ProviderManager";
import { logger } from "../../utils/logger";

const mockWarmup = vi.mocked(aiManager.warmup);

describe("createEditorFocusHandler", () => {
  let setAiError: ReturnType<typeof vi.fn<(v: string | null) => void>>;
  let isWarmedUpRef: { current: boolean };

  beforeEach(() => {
    vi.clearAllMocks();
    mockWarmup.mockResolvedValue(undefined);
    setAiError = vi.fn<(v: string | null) => void>();
    isWarmedUpRef = { current: false };
  });

  it("clears the AI error and warms up on the first focus", () => {
    const handler = createEditorFocusHandler({ setAiError, isWarmedUpRef });

    handler();

    expect(setAiError).toHaveBeenCalledWith(null);
    expect(mockWarmup).toHaveBeenCalledTimes(1);
  });

  it("is one-shot per editor instance: later focuses are no-ops", () => {
    const handler = createEditorFocusHandler({ setAiError, isWarmedUpRef });

    handler();
    handler();
    handler();

    expect(mockWarmup).toHaveBeenCalledTimes(1);
    // The error-clearing UX keeps working on every focus.
    expect(setAiError).toHaveBeenCalledTimes(3);
  });

  it("does not surface a warmup failure as an editor error", async () => {
    // The preload is opportunistic: a failure logs a warning and must never
    // pollute the editor's AI error banner.
    mockWarmup.mockRejectedValueOnce(new Error("preload failed"));
    const handler = createEditorFocusHandler({ setAiError, isWarmedUpRef });

    handler();
    await vi.waitFor(() => {
      expect(logger.warn).toHaveBeenCalled();
    });

    expect(setAiError).toHaveBeenCalledTimes(1); // only the initial clear
    expect(setAiError).not.toHaveBeenCalledWith(expect.any(String));
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("AI warmup failed on editor focus"),
      expect.objectContaining({ error: "preload failed" }),
    );
  });

  it("re-arms after a failure so a later focus can retry", async () => {
    mockWarmup
      .mockRejectedValueOnce(new Error("preload failed"))
      .mockResolvedValueOnce(undefined);
    const handler = createEditorFocusHandler({ setAiError, isWarmedUpRef });

    handler();
    await vi.waitFor(() => {
      expect(logger.warn).toHaveBeenCalled();
    });
    handler();

    expect(mockWarmup).toHaveBeenCalledTimes(2);
  });
});
