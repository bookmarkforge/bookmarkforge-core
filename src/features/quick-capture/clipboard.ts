/**
 * clipboard.ts — pure classification + payload builders for the global
 * quick-capture flows (paste-anywhere, clipboard button, PWA shortcuts,
 * bookmarklet). No DOM access here so the logic stays unit-testable.
 */

export type ClipboardKind = "url" | "note" | "image" | "empty";

/** Text longer than this is treated as a note, not a URL/title. */
export const NOTE_PASTE_MIN_CHARS = 100;

const URL_RE = /^https?:\/\/[^\s]+$/i;
const BARE_DOMAIN_RE = /^[^\s/?#]+\.[a-zA-Z]{2,}(?:[/?#]\S*)?$/;

/** Same classification rule as QuickCapture.captureTargetUrl. */
export function classifyPastedText(text: string): ClipboardKind {
  const raw = text.trim();
  if (!raw) {
    return "empty";
  }
  if (URL_RE.test(raw) || BARE_DOMAIN_RE.test(raw)) {
    return "url";
  }
  if (raw.length >= NOTE_PASTE_MIN_CHARS) {
    return "note";
  }
  return "empty";
}

/** True when the paste event target is a text-editing surface. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  // isContentEditable covers inheritance in real browsers; the attribute
  // check keeps jsdom (which does not implement editing-host semantics)
  // honest for the same contract.
  if (target.isContentEditable || target.contentEditable === "true") {
    return true;
  }
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

export interface ClipboardImagePayload {
  blob: Blob;
  filename: string;
}

/** Extract the first image/* item from a paste/clipboardData payload. */
export function extractClipboardImage(
  items: ArrayLike<{ kind: string; type: string; getAsFile(): File | null }>,
): ClipboardImagePayload | null {
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item || item.kind !== "file" || !item.type.startsWith("image/")) {
      continue;
    }
    const file = item.getAsFile();
    if (file) {
      const ext = item.type.split("/")[1]?.split("+")[0] || "png";
      return { blob: file, filename: `pasted-image.${ext}` };
    }
  }
  return null;
}

/**
 * Bookmarklet source. Opens /capture with every payload field inside the
 * URL fragment — nothing reaches the server, matching the share_target
 * privacy model. `noAutoSave` keeps the compact modal open so the user can
 * add notes before saving.
 */
export function buildBookmarkletCode(origin: string): string {
  const base = `${origin.replace(/\/+$/, "")}/capture#`;
  return (
    "javascript:(function(){" +
    "var s='';try{s=(window.getSelection()||'').toString().slice(0,10000)}catch(e){}" +
    "var h='url='+encodeURIComponent(location.href)" +
    "+'&title='+encodeURIComponent(document.title||location.href)" +
    "+'&noAutoSave=true'" +
    "+(s?'&text='+encodeURIComponent(s):'');" +
    // JSON.stringify quotes/escapes the base so a hostile origin value can
    // never break out of the string literal inside the javascript: URL.
    `window.open(${JSON.stringify(base)}+h,'_blank','popup=yes,width=560,height=680');` +
    "})()"
  );
}

/** Payload for the `forge:quick-capture` window event. */
export interface QuickCaptureRequest {
  input?: string;
}

export const QUICK_CAPTURE_EVENT = "forge:quick-capture";

/**
 * QuickCapture mounts lazily (idle-deferred chunk). Requests fired before it
 * exists would be lost, so the latest request is parked module-side and
 * consumed on mount; later requests go straight through the window event.
 */
let pendingRequest: QuickCaptureRequest | null = null;

export function requestQuickCapture(input?: string): void {
  pendingRequest = { input };
  window.dispatchEvent(
    new CustomEvent<QuickCaptureRequest>(QUICK_CAPTURE_EVENT, {
      detail: { input },
    }),
  );
}

export function consumePendingQuickCapture(): QuickCaptureRequest | null {
  const request = pendingRequest;
  pendingRequest = null;
  return request;
}
