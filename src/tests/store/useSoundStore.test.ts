// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";

describe("useSoundStore", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    vi.resetModules();
  });

  const loadStore = async () => {
    const { useSoundStore } = await import("../../store/useSoundStore");
    return useSoundStore;
  };

  describe("default state", () => {
    it("has enabled=false by default", async () => {
      const store = await loadStore();
      expect(store.getState().enabled).toBe(false);
    });

    it("has volume=0.5 by default", async () => {
      const store = await loadStore();
      expect(store.getState().volume).toBe(0.5);
    });

    it("has correct default categories", async () => {
      const store = await loadStore();
      expect(store.getState().categories).toEqual({
        notifications: true,
        backgroundTasks: true,
        uiFeedback: false,
      });
    });
  });

  describe("actions", () => {
    it("setEnabled toggles enabled state", async () => {
      const store = await loadStore();
      store.getState().setEnabled(true);
      expect(store.getState().enabled).toBe(true);
      store.getState().setEnabled(false);
      expect(store.getState().enabled).toBe(false);
    });

    it("setVolume updates volume", async () => {
      const store = await loadStore();
      store.getState().setVolume(0.8);
      expect(store.getState().volume).toBe(0.8);
    });

    it("setCategory updates a specific category", async () => {
      const store = await loadStore();
      store.getState().setCategory("uiFeedback", true);
      expect(store.getState().categories.uiFeedback).toBe(true);
      // Other categories remain unchanged
      expect(store.getState().categories.notifications).toBe(true);
      expect(store.getState().categories.backgroundTasks).toBe(true);
    });

    it("setCategory can disable a category", async () => {
      const store = await loadStore();
      store.getState().setCategory("notifications", false);
      expect(store.getState().categories.notifications).toBe(false);
    });
  });

  describe("persistence via safeStorage", () => {
    it("persists state to localStorage under forge_sound_settings", async () => {
      const store = await loadStore();
      store.getState().setEnabled(true);
      store.getState().setVolume(0.9);

      await vi.waitFor(() => {
        const raw = localStorage.getItem("forge_sound_settings");
        expect(raw).not.toBeNull();
        const parsed = JSON.parse(raw!);
        expect(parsed.state.enabled).toBe(true);
        expect(parsed.state.volume).toBe(0.9);
      });
    });

    it("restores state from localStorage on load", async () => {
      // Pre-populate localStorage with persisted state
      const persistedState = {
        state: {
          enabled: true,
          volume: 0.7,
          categories: {
            notifications: false,
            backgroundTasks: true,
            uiFeedback: true,
          },
        },
        version: 0,
      };
      localStorage.setItem(
        "forge_sound_settings",
        JSON.stringify(persistedState),
      );

      const store = await loadStore();

      await vi.waitFor(() => {
        expect(store.getState().enabled).toBe(true);
        expect(store.getState().volume).toBe(0.7);
        expect(store.getState().categories).toEqual({
          notifications: false,
          backgroundTasks: true,
          uiFeedback: true,
        });
      });
    });

    it("ignores corrupted JSON in localStorage and falls back to defaults", async () => {
      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      localStorage.setItem("forge_sound_settings", "not-valid-json");

      const store = await loadStore();
      expect(store.getState().enabled).toBe(false);
      expect(store.getState().volume).toBe(0.5);
      consoleSpy.mockRestore();
    });

    it("persists category changes via safeStorage", async () => {
      const store = await loadStore();
      store.getState().setCategory("backgroundTasks", false);
      store.getState().setCategory("uiFeedback", true);

      await vi.waitFor(() => {
        const raw = localStorage.getItem("forge_sound_settings");
        expect(raw).not.toBeNull();
        const parsed = JSON.parse(raw!);
        expect(parsed.state.categories).toEqual({
          notifications: true,
          backgroundTasks: false,
          uiFeedback: true,
        });
      });
    });

    it("uses safeStorage adapter (getItem/setItem/removeItem)", async () => {
      // Verify the storage adapter delegates to safeStorage
      // by checking that state is persisted under the correct key
      const store = await loadStore();
      store.getState().setEnabled(true);

      await vi.waitFor(() => {
        const raw = localStorage.getItem("forge_sound_settings");
        expect(raw).not.toBeNull();
      });

      // Clear and verify state resets to defaults
      localStorage.removeItem("forge_sound_settings");
      vi.resetModules();
      const freshStore = await loadStore();
      expect(freshStore.getState().enabled).toBe(false);
    });
  });
});
