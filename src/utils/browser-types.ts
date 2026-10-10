/**
 * Type-safe accessor helpers for non-standard browser APIs.
 *
 * These replace scattered `as unknown as { ... }` casts throughout the codebase
 * with centralized, documented type definitions. Each helper performs the same
 * cast but is type-checked at compile time and easy to update if the spec changes.
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/API/Navigator/deviceMemory
 * @see https://developer.mozilla.org/en-US/docs/Web/API/Performance/memory
 * @see https://developer.mozilla.org/en-US/docs/Web/API/NetworkInformation
 */

// ─── Tour ID Mapping ──────────────────────────────────────────────

/** Valid tour step identifiers used by data-tour-id attributes. */
type TourStepId =
  | "tour-bookmarks"
  | "tour-views"
  | "tour-collaboration"
  | "tour-chat";

/**
 * Type-safe mapping from sidebar tab IDs to tour step IDs.
 * Use instead of `as Record<string, string>` for tour ID lookups.
 */
export const TOUR_ID_MAP: Record<string, TourStepId> = {
  bookmarks: "tour-bookmarks",
  gallery: "tour-views",
  collaboration: "tour-collaboration",
  chatLocal: "tour-chat",
} as const;

// ─── Navigator Extensions ──────────────────────────────────────────

/** Non-standard Navigator properties exposed by Chromium-based browsers. */
interface NavigatorExtensions {
  /** Device memory in GB (Chromium only). */
  deviceMemory?: number;
  /** Number of logical CPU cores. */
  hardwareConcurrency?: number;
  /** Network Information API (Chromium only). */
  connection?: {
    effectiveType?: string;
    type?: string;
    downlink?: number;
    rtt?: number;
    saveData?: boolean;
    addEventListener?: (type: string, listener: () => void) => void;
    removeEventListener?: (type: string, listener: () => void) => void;
  };
  /** Battery Status API (Chromium only). */
  getBattery?: () => Promise<{ level: number; charging: boolean }>;
}

/** iOS Safari standalone mode detection. */
interface NavigatorStandalone extends Navigator {
  standalone?: boolean;
}

/**
 * Returns navigator with non-standard extension properties.
 * Use instead of `navigator as unknown as { deviceMemory: number }`.
 *
 * @example
 * ```ts
 * const { deviceMemory } = getNavigatorExtensions();
 * const mem = deviceMemory || 4;
 * ```
 */
export function getNavigatorExtensions(): NavigatorExtensions {
  return navigator as unknown as NavigatorExtensions;
}

/**
 * Returns navigator with iOS standalone property.
 * Use instead of `window.navigator as unknown as { standalone?: boolean }`.
 */
export function getNavigatorStandalone(): NavigatorStandalone {
  return window.navigator as unknown as NavigatorStandalone;
}

// ─── Window Extensions ─────────────────────────────────────────────

/** BookmarkForge build hash injected at build time. */
interface WindowBuildHash {
  __BMF_BUILD_HASH__?: string;
}

/** Memory pressure event handler (experimental API). */
interface WindowMemoryPressure {
  onmemorypressure: ((this: Window, ev: Event & { pressure: string }) => void) | null;
}

/** Chrome extension API (browser-injected `window.chrome` runtime, if present). */
interface WindowChrome {
  chrome?: {
    runtime?: {
      id?: string;
    };
  };
}

/**
 * Returns window with the build hash property.
 * Use instead of `(window as unknown as { __BMF_BUILD_HASH__?: string })`.
 */
export function getWindowBuildHash(): WindowBuildHash {
  return window as unknown as WindowBuildHash;
}

/**
 * WebGPU surface (non-standard, Chromium only).
 * @see https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API
 */
interface WebGPUAdapterInfo {
  vendor: string;
  architecture: string;
  description: string;
}

interface WebGPUAdapter {
  requestAdapterInfo(): Promise<WebGPUAdapterInfo>;
}

interface NavigatorGPU {
  requestAdapter(options?: {
    powerPreference?: "low-power" | "high-performance";
  }): Promise<WebGPUAdapter | null>;
}

/**
 * Returns navigator.gpu with typed requestAdapter / requestAdapterInfo surfaces.
 * Use instead of `(navigator.gpu as any)?.requestAdapter(...)`.
 */
export function getNavigatorGPU(): NavigatorGPU | undefined {
  return (navigator as unknown as { gpu?: NavigatorGPU }).gpu;
}

/**
 * Returns window with memory pressure event handler.
 * Use instead of `window as unknown as { onmemorypressure: ... }`.
 */
export function getWindowMemoryPressure(): WindowMemoryPressure {
  return window as unknown as WindowMemoryPressure;
}

/**
 * Returns window with optional Chrome extension API surface.
 * Use instead of `window as unknown as { chrome?: { runtime?: { id?: string } } }`.
 */
export function getWindowChrome(): Window & WindowChrome {
  return window as unknown as Window & WindowChrome;
}

// ─── Web Speech API ──────────────────────────────────────────────

/** Single speech alternative from the Web Speech API. */
export interface SpeechRecognitionAlternative {
  transcript: string;
  confidence?: number;
}

/** Result (one utterance) containing alternatives. */
export interface SpeechRecognitionResult {
  0: SpeechRecognitionAlternative;
  isFinal: boolean;
}

/** Event received on recognition `onresult`. */
export interface SpeechRecognitionEventLike {
  results: ArrayLike<SpeechRecognitionResult>;
  resultIndex: number;
}

/** Error event received by the Web Speech API. */
export interface SpeechRecognitionErrorEventLike {
  error?: string;
}

/** Minimal surface of the (vendor-prefixed) SpeechRecognition instance. */
export interface SpeechRecognitionInstance {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event?: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

/** Constructor for the vendor-prefixed Web Speech API. */
type SpeechRecognitionCtor = new () => SpeechRecognitionInstance;

/** Window surface exposing vendor-prefixed SpeechRecognition constructors. */
interface WindowSpeechRecognition {
  SpeechRecognition?: SpeechRecognitionCtor;
  webkitSpeechRecognition?: SpeechRecognitionCtor;
}

/**
 * Returns the vendor-prefixed SpeechRecognition constructor, if present.
 * Use instead of `(window as any).SpeechRecognition || ...`.
 */
export function getSpeechRecognitionCtor(): SpeechRecognitionCtor | undefined {
  const w = window as unknown as WindowSpeechRecognition;
  return w.SpeechRecognition || w.webkitSpeechRecognition;
}

// ─── Clipboard API ────────────────────────────────────────────────

/** Safe clipboard write with fallback. */
export async function clipboardWriteText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

// ─── Layout Shift (CLS) ──────────────────────────────────────────

/** Chrome LayoutShift performance entry (non-standard). */
interface LayoutShiftEntry extends PerformanceEntry {
  hadRecentInput: boolean;
  value: number;
}

/** Returns entries filtered to LayoutShift type. */
export function getLayoutShiftEntries(
  list: PerformanceEntryList,
): LayoutShiftEntry[] {
  return list.filter((e) => e.name === "layout-shift") as LayoutShiftEntry[];
}

// ─── Performance Extensions ────────────────────────────────────────

/** Chrome's non-standard Performance.memory API. */
export interface PerformanceMemory {
  memory?: {
    usedJSHeapSize: number;
    totalJSHeapSize: number;
    jsHeapSizeLimit: number;
  };
}

/**
 * Returns performance with Chrome's memory API.
 * Use instead of `performance as unknown as { memory?: MemoryInfo }`.
 */
export function getPerformanceMemory(): PerformanceMemory {
  return performance as unknown as PerformanceMemory;
}

// ─── RxDB Dynamic Collection Access ────────────────────────────────

/** Generic RxDB collection interface for dynamic access patterns. */
interface DynamicRxCollection {
  find: (opts?: Record<string, unknown>) => {
    exec: () => Promise<Array<{ toJSON: () => unknown }>>;
    where: (field: string) => {
      lt: (val: string) => { remove: () => Promise<void> };
      gt: (val: string) => { exec: () => Promise<unknown[]> };
    };
    limit: (n: number) => { exec: () => Promise<unknown[]> };
  };
  findOne: (opts?: string | Record<string, unknown>) => {
    exec: () => Promise<{ toJSON: () => unknown } | null>;
  };
  insert: (doc: unknown) => Promise<unknown>;
  upsert: (doc: unknown) => Promise<unknown>;
  bulkInsert: (docs: unknown[]) => Promise<unknown>;
  remove: () => Promise<void>;
  count: () => { exec: () => Promise<number> };
}

/**
 * Type-safe dynamic access to RxDB collections.
 * Accepts `unknown` and handles the cast internally, so callers don't need
 * the `db as unknown as Record<string, unknown>` bridge.
 *
 * @example
 * ```ts
 * const col = getCollection(db, "bookmarks");
 * if (col) {
 *   const docs = await col.find().exec();
 * }
 * ```
 */
export function getCollection(
  db: unknown,
  name: string,
): DynamicRxCollection | undefined {
  return (db as Record<string, unknown>)?.[name] as DynamicRxCollection | undefined;
}
