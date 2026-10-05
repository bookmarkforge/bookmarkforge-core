import { describe, it, expect, beforeEach } from "vitest";
import { useWebLLMStore } from "../../store/webllmStore";

describe("webllmStore", () => {
  // We reset the store before each test
  beforeEach(() => {
    useWebLLMStore.setState({
      progressText: "",
      progressValue: 0,
      isDownloading: false,
      isWarmingUp: false,
      error: null,
    });
  });

  describe("Estado inicial", () => {
    it("has correct default values", () => {
      const state = useWebLLMStore.getState();
      expect(state.progressText).toBe("");
      expect(state.progressValue).toBe(0);
      expect(state.isDownloading).toBe(false);
      expect(state.isWarmingUp).toBe(false);
      expect(state.error).toBeNull();
    });
  });

  describe("setProgress", () => {
    it("updates text and value, sets isDownloading true when value < 1", () => {
      useWebLLMStore.getState().setProgress("Descargando...", 0.5);
      const state = useWebLLMStore.getState();
      expect(state.progressText).toBe("Descargando...");
      expect(state.progressValue).toBe(0.5);
      expect(state.isDownloading).toBe(true);
    });

    it("sets isDownloading false when value is 1", () => {
      useWebLLMStore.setState({ isDownloading: true });
      useWebLLMStore.getState().setProgress("Completado", 1);
      const state = useWebLLMStore.getState();
      expect(state.progressText).toBe("Completado");
      expect(state.progressValue).toBe(1);
      expect(state.isDownloading).toBe(false);
    });
  });

  describe("setIsDownloading", () => {
    it("activates the download state", () => {
      useWebLLMStore.getState().setIsDownloading(true);
      expect(useWebLLMStore.getState().isDownloading).toBe(true);
    });

    it("clears the download state", () => {
      useWebLLMStore.setState({ isDownloading: true });
      useWebLLMStore.getState().setIsDownloading(false);
      expect(useWebLLMStore.getState().isDownloading).toBe(false);
    });
  });

  describe("setIsWarmingUp", () => {
    it("activa el estado de warming", () => {
      useWebLLMStore.getState().setIsWarmingUp(true);
      expect(useWebLLMStore.getState().isWarmingUp).toBe(true);
    });

    it("clears the warming state", () => {
      useWebLLMStore.setState({ isWarmingUp: true });
      useWebLLMStore.getState().setIsWarmingUp(false);
      expect(useWebLLMStore.getState().isWarmingUp).toBe(false);
    });
  });

  describe("setError", () => {
    it("sets an error message", () => {
      useWebLLMStore.getState().setError("Algo salió mal");
      expect(useWebLLMStore.getState().error).toBe("Algo salió mal");
    });

    it("clears the error with null", () => {
      useWebLLMStore.setState({ error: "Error previo" });
      useWebLLMStore.getState().setError(null);
      expect(useWebLLMStore.getState().error).toBeNull();
    });
  });
});
