import { useCallback } from "react";
import { logger } from "../utils/logger";
import { downloadBlob } from "../utils/download";

declare global {
  interface Window {
    showOpenFilePicker?: (options?: {
      multiple?: boolean;
      excludeAcceptAllOption?: boolean;
      types?: Array<{
        description?: string;
        accept: Record<string, string[]>;
      }>;
    }) => Promise<FileSystemFileHandle[]>;
    showSaveFilePicker?: (options?: {
      suggestedName?: string;
      types?: Array<{
        description?: string;
        accept: Record<string, string[]>;
      }>;
    }) => Promise<FileSystemFileHandle>;
  }
}

export function useFileSystem(): {
  openFiles: (
    options?: NonNullable<typeof window.showOpenFilePicker> extends (
      opts: infer O,
    ) => Promise<unknown>
      ? O
      : never,
  ) => Promise<File[]>;
  saveFile: (
    content: string | Blob,
    suggestedName?: string,
  ) => Promise<boolean>;
  isSupported: boolean;
} {
  const isSupported = "showOpenFilePicker" in window;

  const openFiles = useCallback(
    async (options?: Record<string, unknown>): Promise<File[]> => {
      if (!isSupported) {
        return new Promise((resolve) => {
          const input = document.createElement("input");
          input.type = "file";
          input.multiple = (options?.multiple as boolean) ?? false;
          input.accept =
            (options?.types as Array<{ accept: Record<string, string[]> }>)
              ?.map((t) =>
                Object.entries(t.accept)
                  .map(([, exts]) => (exts as string[]).join(","))
                  .join(","),
              )
              .join(",") || "";
          input.onchange = () => resolve(Array.from(input.files || []));
          input.click();
        });
      }
      try {
        const picker = window.showOpenFilePicker;
        const handles = picker
          ? await picker(options as Parameters<typeof picker>[0])
          : [];
        return await Promise.all(handles.map((h) => h.getFile()));
      } catch (error) {
        if ((error as Error).name !== "AbortError")
          {logger.error("[PWA] Failed to open files", { error });}
        return [];
      }
    },
    [isSupported],
  );

  const saveFile = useCallback(
    async (
      content: string | Blob,
      suggestedName = "download.txt",
    ): Promise<boolean> => {
      if (!isSupported) {
        const blob =
          content instanceof Blob
            ? content
            : new Blob([content], { type: "text/plain" });
        downloadBlob(blob, suggestedName);
        return true;
      }
      try {
        const handle = await window.showSaveFilePicker?.({
          suggestedName,
          types: [
            { description: "Text Files", accept: { "text/plain": [".txt"] } },
          ],
        });
        if (handle) {
          const writable = await handle.createWritable();
          await writable.write(content);
          await writable.close();
          return true;
        }
      } catch (error) {
        if ((error as Error).name !== "AbortError")
          {logger.error("[PWA] Failed to save file", { error });}
      }
      return false;
    },
    [isSupported],
  );

  return { openFiles, saveFile, isSupported };
}
