import { describe, it, expect, vi, beforeEach } from "vitest";
import { useSoundStore } from "../../store/useSoundStore";

function createMockNode() {
  return {
    type: "",
    frequency: { value: 0 },
    connect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    gain: {
      setValueAtTime: vi.fn(),
      exponentialRampToValueAtTime: vi.fn(),
    },
  };
}

const audioCtxMock = {
  currentTime: 0,
  state: "running",
  createOscillator: vi.fn(() => createMockNode()),
  createGain: vi.fn(() => createMockNode()),
  destination: {},
  close: vi.fn().mockResolvedValue(undefined),
  resume: vi.fn().mockResolvedValue(undefined),
};

vi.stubGlobal(
  "AudioContext",
  vi.fn(function () {
    return audioCtxMock;
  }),
);

describe("soundManager", () => {
  beforeEach(() => {
    useSoundStore.setState({
      enabled: true,
      volume: 0.5,
      categories: {
        notifications: true,
        backgroundTasks: true,
        uiFeedback: true,
      },
    });
    audioCtxMock.currentTime = 0;
    vi.clearAllMocks();
  });

  it("exports soundManager singleton", async () => {
    const { soundManager } = await import("../../utils/soundManager");
    expect(soundManager).toBeDefined();
    expect(soundManager.muted).toBe(false);
  });

  it("playNotification creates audio nodes", async () => {
    const { soundManager } = await import("../../utils/soundManager");
    soundManager.playNotification();
    expect(audioCtxMock.createOscillator).toHaveBeenCalled();
    expect(audioCtxMock.createGain).toHaveBeenCalled();
  });

  it("playTaskComplete creates audio nodes", async () => {
    const { soundManager } = await import("../../utils/soundManager");
    soundManager.playTaskComplete();
    expect(audioCtxMock.createOscillator).toHaveBeenCalled();
    expect(audioCtxMock.createGain).toHaveBeenCalled();
  });

  it("playUIFeedback creates audio nodes", async () => {
    const { soundManager } = await import("../../utils/soundManager");
    soundManager.playUIFeedback();
    expect(audioCtxMock.createOscillator).toHaveBeenCalled();
    expect(audioCtxMock.createGain).toHaveBeenCalled();
  });

  it("playError creates audio nodes", async () => {
    const { soundManager } = await import("../../utils/soundManager");
    soundManager.playError();
    expect(audioCtxMock.createOscillator).toHaveBeenCalled();
    expect(audioCtxMock.createGain).toHaveBeenCalled();
  });

  it("does not play sounds when enabled=false", async () => {
    const { soundManager } = await import("../../utils/soundManager");
    useSoundStore.getState().setEnabled(false);
    soundManager.playNotification();
    expect(audioCtxMock.createOscillator).not.toHaveBeenCalled();
    expect(audioCtxMock.createGain).not.toHaveBeenCalled();
  });

  it("does not play sounds with a disabled category", async () => {
    const { soundManager } = await import("../../utils/soundManager");
    useSoundStore.getState().setCategory("notifications", false);
    soundManager.playNotification();
    expect(audioCtxMock.createOscillator).not.toHaveBeenCalled();
  });

  it("respects the store volume", async () => {
    const { soundManager } = await import("../../utils/soundManager");
    useSoundStore.getState().setVolume(0.1);
    soundManager.playNotification();
    expect(audioCtxMock.createGain).toHaveBeenCalled();
  });

  it("muted reflects the store's enabled", async () => {
    const { soundManager } = await import("../../utils/soundManager");
    expect(soundManager.muted).toBe(false);
    useSoundStore.getState().setEnabled(false);
    expect(soundManager.muted).toBe(true);
  });

  it("toggleMute changes enabled", async () => {
    const { soundManager } = await import("../../utils/soundManager");
    expect(useSoundStore.getState().enabled).toBe(true);
    soundManager.toggleMute();
    expect(useSoundStore.getState().enabled).toBe(false);
    soundManager.toggleMute();
    expect(useSoundStore.getState().enabled).toBe(true);
  });

  it("setMuted updates the store and closes the context", async () => {
    const { soundManager } = await import("../../utils/soundManager");
    const closeSpy = vi.spyOn(soundManager, "close");
    soundManager.setMuted(true);
    expect(useSoundStore.getState().enabled).toBe(false);
    expect(closeSpy).toHaveBeenCalled();
    closeSpy.mockRestore();
  });

  it("resumes a suspended AudioContext before scheduling tones (M-02)", async () => {
    const { soundManager } = await import("../../utils/soundManager");
    (audioCtxMock as any).state = "suspended";
    soundManager.playNotification();
    expect(audioCtxMock.resume).toHaveBeenCalled();
    expect(audioCtxMock.createOscillator).toHaveBeenCalled();
    (audioCtxMock as any).state = "running";
  });

  it("does not call resume when the context is already running", async () => {
    const { soundManager } = await import("../../utils/soundManager");
    (audioCtxMock as any).state = "running";
    soundManager.playNotification();
    expect(audioCtxMock.resume).not.toHaveBeenCalled();
  });
});
