/**
 * src/services/pro-access.ts — the single gate between Core code and Pro
 * implementations.
 *
 * Why this exists: Core UI calls Pro services (backups, PDF, P2P sync). Those
 * imports were static, so every Core chunk that mentioned a Pro feature also
 * *carried* it, and a Core refactor could silently re-link a Pro module.
 * Resolving Pro behind this loader changes the shape of the dependency: Core
 * keeps a reference to a *loader* (this file, MIT), and the Pro implementation
 * is fetched only when — and only if — the user actually has Pro access.
 *
 * Three guarantees, in order:
 *
 *   1. Gated. `loadProService` consults `licenseService.hasProAccess()` before
 *      the first byte of the Pro module is requested. A Free user never even
 *      downloads the Pro chunk: the network request itself is behind the gate,
 *      not just the execution.
 *
 *   2. Lazy. The Pro module is referenced only as a dynamic `import()` inside
 *      this file, so bundlers keep it in its own chunk and the application
 *      entry never statically depends on it. Core can boot, unlock, search and
 *      read with zero Pro bytes loaded.
 *
 *   3. Honest. When the gate says no — or the chunk fails to load, which is
 *      the Open Core case where the implementation does not exist — the
 *      promise rejects with `ProUnavailableError`, a typed, catchable error
 *      carrying the service name. Callers decide the UX (disable the button,
 *      show the upgrade nudge, log a warning); this module never fakes
 *      success.
 *
 * `requireProService` is the variant for call sites that cannot be async: it
 * throws synchronously when Pro is unavailable and returns the module when it
 * is already loaded. It must only be used where a prior `loadProService` (or
 * an equivalent guarantee) has warmed the cache.
 */
import { licenseService } from "./LicenseService";
import { logger } from "../utils/logger";

/** Typed rejection for every gated Pro resolution. */
export class ProUnavailableError extends Error {
  readonly service: string;
  readonly reason: "no-license" | "load-failed";

  constructor(service: string, reason: "no-license" | "load-failed", cause?: unknown) {
    super(
      reason === "no-license"
        ? `Pro feature "${service}" requires a Pro license.`
        : `Pro feature "${service}" could not be loaded in this build.`,
    );
    this.name = "ProUnavailableError";
    this.service = service;
    this.reason = reason;
    if (cause !== undefined) {
      (this as { cause?: unknown }).cause = cause;
    }
  }
}

/**
 * The one UI signal for "a Pro surface was needed and is not available".
 * Dispatched by the code paths that receive a `ProUnavailableError` and
 * listened to by `ProRequiredBoundary` (mounted once in MainApp), which opens
 * the "Available in Pro" panel instead of letting every surface invent its
 * own generic error toast. Kept next to the error type so the error and its
 * user-facing signal cannot diverge; `detail.feature` is the service name and
 * `detail.reason` selects the panel's wording (license vs. Open Core build).
 */
export function announceProUnavailable(error: ProUnavailableError): void {
  if (typeof window === "undefined") {return;}
  window.dispatchEvent(
    new CustomEvent("bmf:pro-unavailable", {
      detail: {
        feature: error.service,
        reason: error.reason,
      },
    }),
  );
}

/** Minimal shape the loader needs from the license gate. */
type ProGate = {
  hasProAccess(): boolean;
};

const gate: ProGate = licenseService;

/** Warmed modules: one loaded, gated module per service name. */
const loaded = new Map<string, Promise<unknown>>();

/** Resolvers registered by warmup calls, keyed per service. */
type ModuleLoader<T> = () => Promise<T>;

const loaders = new Map<string, ModuleLoader<unknown>>();

/**
 * Register how a Pro service is fetched. Called from the registry below; kept
 * separate so tests can stub loaders without touching the network layer.
 */
function registerLoader<T>(service: string, loader: ModuleLoader<T>): void {
  loaders.set(service, loader as ModuleLoader<unknown>);
  loaded.delete(service);
}

/**
 * Resolve a Pro service behind the entitlement gate.
 *
 * - Free user → rejects with `ProUnavailableError("no-license")` without
 *   fetching the chunk.
 * - Pro user → fetches once, caches the promise for the session.
 * - Fetch failure (Open Core export, offline, corrupt chunk) → rejects with
 *   `ProUnavailableError("load-failed")` and logs once per service.
 */
export function loadProService<T>(service: string): Promise<T> {
  const cached = loaded.get(service) as Promise<T> | undefined;
  if (cached) {
    return cached;
  }
  const promise = (async () => {
    if (!gate.hasProAccess()) {
      throw new ProUnavailableError(service, "no-license");
    }
    const loader = loaders.get(service);
    if (!loader) {
      throw new ProUnavailableError(service, "load-failed");
    }
    try {
      const resolved = await loader();
      // Defense in depth: a build that replaced the implementation with an
      // inert Open Core placeholder must NOT be handed out as success — the
      // caller would then silently no-op. Reject honestly instead.
      const maybe = resolved as { __isProPlaceholder?: unknown } | null;
      if (maybe && (maybe.__isProPlaceholder === true || (maybe as unknown as { constructor?: { __isProPlaceholder?: unknown } }).constructor?.__isProPlaceholder === true)) {
        throw new ProUnavailableError(service, "load-failed");
      }
      return resolved as T;
    } catch (error) {
      if (error instanceof ProUnavailableError) {
        throw error;
      }
      logger.warn(`[pro-access] failed to load Pro service "${service}"`, {
        error: error instanceof Error ? error.message : String(error),
      });
      throw new ProUnavailableError(service, "load-failed", error);
    }
  })();
  loaded.set(service, promise as Promise<unknown>);
  // Do not poison the cache with a permanent failure: a transient load error
  // (offline) should be retryable, and a later license upgrade should unblock
  // a previously rejected call.
  promise.catch(() => {
    if (loaded.get(service) === promise) {
      loaded.delete(service);
    }
  });
  return promise;
}

/**
 * Synchronous accessor for hot paths that cannot await. Throws when the
 * module is not already loaded; pair with `loadProService` at an async
 * boundary (mount effect, action handler) before going synchronous.
 */
export function requireProService<T>(service: string): T {
  const cached = loaded.get(service) as Promise<T> | undefined;
  if (!cached) {
    throw new ProUnavailableError(service, "no-license");
  }
  // The promise is cached, so it is settled-or-imminent; surface rejection
  // through the same error type rather than an unhandled rejection.
  void cached.catch(() => undefined);
  // A cached promise cannot be synchronously unwrapped, so the contract here
  // is: the loader for this service must expose a synchronous facade once
  // loaded. See each service registry entry for its facade.
  const facade = syncFacades.get(service) as T | undefined;
  if (facade === undefined) {
    throw new ProUnavailableError(service, "load-failed");
  }
  return facade;
}

const syncFacades = new Map<string, unknown>();

/** Install a synchronous facade after a successful load. */
export function setSyncFacade<T>(service: string, facade: T): void {
  syncFacades.set(service, facade);
}

// ---------------------------------------------------------------------------
// Service registry — the only place that knows Pro module paths.
// ---------------------------------------------------------------------------

import type { BackupService as BackupServiceClass } from "./BackupService";
import type { DiskBackupService as DiskBackupServiceType } from "./DiskBackupService";
// WebRTCSyncService's class is not exported; its instance type is derived via
// the module's typeof. Same for the pdf extractor (an async arrow const).
type WebRTCSyncServiceType = typeof import("./WebRTCSyncService")["webRTCSyncService"];
type ExtractTextFromPdfType = typeof import("./pdfService")["extractTextFromPdf"];
export interface BackupServiceFacade {
  exportBackup(password?: string | Uint8Array): Promise<void>;
  importBackup(file: File, password?: string | Uint8Array): Promise<void>;
  runAutoBackup(): Promise<unknown>;
  restoreFromAutoBackup(): Promise<boolean>;
  getAutoBackupInfo(): Promise<{
    available: boolean;
    metadata?: unknown;
    age?: number;
  }>;
  getDiskBackupInfo(): {
    method: "folder" | "download" | "download-blocked" | null;
    timestamp: number | null;
    error: string | null;
  };
  clearAutoBackup(): Promise<void>;
  createBackupData(password?: Uint8Array): Promise<{ blob: Blob }>;
}

registerLoader<typeof BackupServiceClass>("BackupService", async () => {
  const mod = await import("./BackupService");
  return mod.BackupService;
});
registerLoader<DiskBackupServiceType>("DiskBackupService", async () => {
  const mod = await import("./DiskBackupService");
  return mod.diskBackupService;
});
registerLoader<WebRTCSyncServiceType>("WebRTCSyncService", async () => {
  const mod = await import("./WebRTCSyncService");
  return mod.webRTCSyncService;
});
registerLoader<ExtractTextFromPdfType>("pdfService", async () => {
  const mod = await import("./pdfService");
  return mod.extractTextFromPdf;
});

// --- Pro AI surfaces (exact list in scripts/pro-boundary.mjs) -------------
//
// Core still needs to *reach* these singletons: the settings screen shows
// the device-capability verdict, diagnostics report engine health, memory
// pressure unloads engines, and the chat UI subscribes to progress. Those
// callers now go through the loader, so a Free session (or an Open Core
// export) never downloads the local-model runtime — the capability probe
// resolves false and optional features degrade quietly instead of shipping
// WebLLM bytes inside Core chunks.
import type { WebLLMService as WebLLMServiceClass } from "./ai/WebLLMService";
type GlobalRAGServiceClass = typeof import("./ai/GlobalRAGService")["globalRAGService"];
type SpecializedAgentsRegistry = typeof import("./ai/SpecializedAgentsService")["specializedAgentsService"];
type FlashcardServiceType = typeof import("./ai/FlashcardService")["flashcardService"];

registerLoader<WebLLMServiceClass>("WebLLMService", async () => {
  const mod = await import("./ai/WebLLMService");
  return mod.webLLMService;
});
registerLoader<GlobalRAGServiceClass>("GlobalRAGService", async () => {
  const mod = await import("./ai/GlobalRAGService");
  return mod.globalRAGService;
});
registerLoader<SpecializedAgentsRegistry>("SpecializedAgentsService", async () => {
  const mod = await import("./ai/SpecializedAgentsService");
  return mod.specializedAgentsService;
});
registerLoader<FlashcardServiceType>("FlashcardService", async () => {
  const mod = await import("./ai/FlashcardService");
  return mod.flashcardService;
});

/** Type-level exports so Core call sites keep full type safety. */
export type {
  BackupServiceClass,
  DiskBackupServiceType,
  WebRTCSyncServiceType,
  ExtractTextFromPdfType,
  WebLLMServiceClass,
  GlobalRAGServiceClass,
  SpecializedAgentsRegistry,
  FlashcardServiceType,
};
/** Typed helpers — the public surface Core code should call. */
export function loadBackupService(): Promise<BackupServiceFacade> {
  return loadProService<BackupServiceFacade>("BackupService");
}

export function loadDiskBackupService(): Promise<DiskBackupServiceType> {
  return loadProService<DiskBackupServiceType>("DiskBackupService");
}

export function loadWebRTCSyncService(): Promise<WebRTCSyncServiceType> {
  return loadProService<WebRTCSyncServiceType>("WebRTCSyncService");
}

export function loadPdfExtractor(): Promise<ExtractTextFromPdfType> {
  return loadProService<ExtractTextFromPdfType>("pdfService");
}

export function loadWebLLMService(): Promise<WebLLMServiceClass> {
  return loadProService<WebLLMServiceClass>("WebLLMService");
}

export function loadGlobalRAGService(): Promise<GlobalRAGServiceClass> {
  return loadProService<GlobalRAGServiceClass>("GlobalRAGService");
}

export function loadSpecializedAgents(): Promise<SpecializedAgentsRegistry> {
  return loadProService<SpecializedAgentsRegistry>("SpecializedAgentsService");
}

export function loadFlashcardService(): Promise<FlashcardServiceType> {
  return loadProService<FlashcardServiceType>("FlashcardService");
}
/** Test hook: reset caches between tests. */
export function resetProAccessForTests(): void {
  loaded.clear();
  syncFacades.clear();
}
