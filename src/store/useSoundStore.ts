import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { createSafeStorageAdapter } from "./safeStorage";
import { STORAGE_KEYS } from "../constants/storage-keys";

interface SoundCategories {
  notifications: boolean;
  backgroundTasks: boolean;
  uiFeedback: boolean;
}

interface SoundStore {
  enabled: boolean;
  volume: number;
  categories: SoundCategories;
  setEnabled: (enabled: boolean) => void;
  setVolume: (volume: number) => void;
  setCategory: (category: keyof SoundCategories, value: boolean) => void;
}

const STORAGE_KEY = STORAGE_KEYS.SOUND_SETTINGS;

const safeStorageAdapter = createSafeStorageAdapter();

export const useSoundStore = create<SoundStore>()(
  persist(
    (set) => ({
      enabled: false,
      volume: 0.5,
      categories: {
        notifications: true,
        backgroundTasks: true,
        uiFeedback: false,
      },
      setEnabled: (enabled) => set({ enabled }),
      setVolume: (volume) => set({ volume }),
      setCategory: (category, value) =>
        set((state) => ({
          categories: { ...state.categories, [category]: value },
        })),
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => safeStorageAdapter),
    },
  ),
);
