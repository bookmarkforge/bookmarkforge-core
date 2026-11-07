import { useSoundStore } from "../store/useSoundStore";
import { logRateLimited } from "./boundedLog";

function getSoundState() {
  return useSoundStore.getState();
}

type SoundCategory = "notifications" | "backgroundTasks" | "uiFeedback";

interface ToneSpec {
  freq: number;
  duration: number;
  type: OscillatorType;
  volume: number;
  delay: number;
}

const PROFILES: Record<string, ToneSpec[]> = {
  notification: [
    { freq: 523, duration: 120, type: "sine", volume: 0.15, delay: 0 },
    { freq: 659, duration: 120, type: "sine", volume: 0.15, delay: 160 },
  ],
  taskComplete: [
    { freq: 392, duration: 100, type: "sine", volume: 0.12, delay: 0 },
    { freq: 523, duration: 100, type: "sine", volume: 0.12, delay: 130 },
    { freq: 659, duration: 180, type: "sine", volume: 0.12, delay: 260 },
  ],
  uiFeedback: [
    { freq: 880, duration: 35, type: "sine", volume: 0.06, delay: 0 },
  ],
  error: [
    { freq: 330, duration: 180, type: "sine", volume: 0.12, delay: 0 },
    { freq: 262, duration: 280, type: "sine", volume: 0.12, delay: 200 },
  ],
};

class SoundManager {
  private ctx: AudioContext | null = null;
  private initAttempted = false;

  private getContext(): AudioContext | null {
    if (this.ctx) {return this.ctx;}
    if (this.initAttempted) {return null;}
    this.initAttempted = true;
    try {
      this.ctx = new AudioContext();
      return this.ctx;
    } catch (_err) {
      return null;
    }
  }

  private playProfile(profile: ToneSpec[] | undefined): void {
    if (!profile) {return;}
    const state = getSoundState();
    if (!state.enabled) {return;}
    const ctx = this.getContext();
    if (!ctx) {return;}
    // Audit M-02: under the autoplay policy the context can sit in
    // "suspended" with a frozen clock — oscillators would be scheduled but
    // never heard. Resume on the first play attempt (user gesture already
    // required to enable sounds, so this rarely rejects).
    if (ctx.state === "suspended") {
      void ctx.resume().catch(() => {
        /* INTENTIONAL SILENCE: autoplay policy denial is an expected optional-audio fallback. */
      });
    }
    for (const spec of profile) {
      const startTime = ctx.currentTime + spec.delay / 1000;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = spec.type;
      osc.frequency.value = spec.freq;
      const vol = spec.volume * state.volume;
      gain.gain.setValueAtTime(vol, startTime);
      gain.gain.exponentialRampToValueAtTime(
        0.001,
        startTime + spec.duration / 1000,
      );
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(startTime);
      osc.stop(startTime + spec.duration / 1000);
    }
  }

  private canPlay(category: SoundCategory): boolean {
    const state = getSoundState();
    return !!(state.enabled && state.categories[category]);
  }

  playNotification(): void {
    if (!this.canPlay("notifications")) {return;}
    this.playProfile(PROFILES.notification);
  }

  playTaskComplete(): void {
    if (!this.canPlay("backgroundTasks")) {return;}
    this.playProfile(PROFILES.taskComplete);
  }

  playUIFeedback(): void {
    if (!this.canPlay("uiFeedback")) {return;}
    this.playProfile(PROFILES.uiFeedback);
  }

  playError(): void {
    if (!this.canPlay("notifications")) {return;}
    this.playProfile(PROFILES.error);
  }

  close(): void {
    if (this.ctx) {
      void this.ctx.close().catch((error: unknown) => {
        logRateLimited(
          "warn",
          "sound-manager-close",
          "Failed to close the audio context",
          { error: error instanceof Error ? error.message : String(error) },
        );
      });
      this.ctx = null;
    }
    this.initAttempted = false;
  }

  get muted(): boolean {
    return !getSoundState().enabled;
  }

  setMuted(muted: boolean): void {
    getSoundState().setEnabled(!muted);
    if (muted) {this.close();}
  }

  toggleMute(): void {
    const state = getSoundState();
    const wasEnabled = state.enabled;
    state.setEnabled(!wasEnabled);
    if (wasEnabled) {this.close();}
  }
}

export const soundManager = new SoundManager();
