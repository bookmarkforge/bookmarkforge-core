type DownloadResult = { ok: boolean; blocked: boolean };

/**
 * Detect whether the current execution is inside a user-gesture event
 * handler. Browsers (Firefox, Safari) silently block programmatic
 * downloads triggered outside an event handler tied to a user gesture
 * (click, keydown, etc.).
 *
 * `window.event` is the event currently being dispatched — it exists
 * only inside synchronous event-handler call stacks and is `null` in
 * async callbacks, setTimeout, setInterval and microtasks.
 */
function isInUserGestureEvent(): boolean {
  try {
    const ev = window.event;
    if (ev && typeof ev === "object" && "isTrusted" in ev) {
      return (ev as MouseEvent).isTrusted === true;
    }
  } catch {
    /* non-browser environments */
  }
  return false;
}

/**
 * Starts a browser download for a Blob and always schedules its ObjectURL for
 * cleanup, including when DOM creation or click dispatch throws.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  let anchor: HTMLAnchorElement | null = null;
  let appended = false;

  try {
    anchor = document.createElement("a");
    if (typeof anchor.setAttribute === "function") {
      anchor.setAttribute("href", url);
      anchor.setAttribute("download", filename);
    } else {
      anchor.href = url;
      anchor.download = filename;
    }
    document.body.appendChild(anchor);
    appended = true;
    anchor.click();
  } finally {
    // Remove the node even when click() throws. Keeping a detached download
    // anchor alive retains the URL and its Blob in some browser runtimes.
    if (appended && anchor?.parentNode) {
      try {
        anchor.parentNode.removeChild(anchor);
      } catch {
        // The document may have been torn down between click and cleanup.
      }
    }

    // Give the browser one task to start the download before revoking the
    // URL. The fallback keeps cleanup fail-safe in non-browser test/runtime
    // shims where timers may be unavailable or throw synchronously.
    let scheduled = false;
    try {
      setTimeout(() => {
        try {
          URL.revokeObjectURL(url);
        } catch {
          // Object URL cleanup is best-effort after the download is queued.
        }
      }, 0);
      scheduled = true;
    } catch {
      // Fall through to synchronous cleanup below.
    }
    if (!scheduled) {
      try {
        URL.revokeObjectURL(url);
      } catch {
        // Nothing else can be done if the runtime rejects revocation.
      }
    }
  }
}

/**
 * Like `downloadBlob` but detects when the browser blocks the download
 * because there is no active user gesture (common in Firefox/Safari
 * for programmatic downloads triggered from async callbacks).
 *
 * When the download is likely blocked the returned `blocked` flag is
 * `true` — callers should surface a warning rather than silently
 * pretending the file was saved.
 *
 * The detection is heuristic: we know the download is blocked when
 * `window.event` is null at the moment of the click, which means the
 * call stack is NOT inside a trusted user-gesture event handler. This
 * happens in setTimeout, setInterval, Promise callbacks and RxDB
 * hooks — exactly the paths the auto-backup uses.
 *
 * In Chrome/Edge the File System Access API (showDirectoryPicker) is
 * used for disk writes, so this function is mainly reached on the
 * download-fallback path (Firefox/Safari) where the heuristic is
 * accurate.
 */
export async function downloadBlobWithDetection(
  blob: Blob,
  filename: string,
): Promise<DownloadResult> {
  const blocked = !isInUserGestureEvent();
  try {
    downloadBlob(blob, filename);
  } catch {
    return { ok: false, blocked: true };
  }
  return { ok: true, blocked };
}
