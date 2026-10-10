import { create } from "zustand";

interface WebLLMState {
  progressText: string;
  progressValue: number;
  isDownloading: boolean;
  isWarmingUp: boolean;
  error: string | null;
  setProgress: (text: string, value: number) => void;
  setIsDownloading: (isDownloading: boolean) => void;
  setIsWarmingUp: (isWarmingUp: boolean) => void;
  setError: (error: string | null) => void;
}

export const useWebLLMStore = create<WebLLMState>((set) => ({
  progressText: "",
  progressValue: 0,
  isDownloading: false,
  isWarmingUp: false,
  error: null,
  setProgress: (text, value) =>
    set({ progressText: text, progressValue: value, isDownloading: value < 1 }),
  setIsDownloading: (isDownloading) => set({ isDownloading }),
  setIsWarmingUp: (isWarmingUp) => set({ isWarmingUp }),
  setError: (error) => set({ error }),
}));
