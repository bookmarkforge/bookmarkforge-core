declare global {
  interface Navigator {
    gpu?: GPU;
    connection?: NetworkInformation;
    deviceMemory?: number;
    hardwareConcurrency?: number;
    serviceWorker?: ServiceWorkerContainer;
    getBattery?(): Promise<BatteryManager>;
  }

  interface NetworkInformation {
    saveData?: boolean;
    effectiveType?: "2g" | "3g" | "4g" | "slow-2g";
    downlink?: number;
    rtt?: number;
  }

  interface BatteryManager {
    charging: boolean;
    level: number;
  }

  interface Window {
    caches?: CacheStorage;
    aistudio?: unknown;
    requestIdleCallback?(
      callback: IdleRequestCallback,
      options?: IdleRequestOptions,
    ): number;
    webkitOfflineWebDatabaseStatusInformation?: unknown;
    __BMF_BUILD_HASH__?: string;
    bookmarkForgeInjected?: boolean;
  }

  interface GPU {
    requestAdapter(
      options?: GPURequestAdapterOptions,
    ): Promise<GPUAdapter | null>;
  }

  interface GPURequestAdapterOptions {
    powerPreference?: "low-power" | "high-performance" | "default";
  }

  interface GPUAdapter {
    limits: GPUSupportedLimits;
    features: GPUSupportedFeatures;
    requestAdapterInfo(): Promise<GPUAdapterInfo>;
  }

  interface GPUAdapterInfo {
    vendor: string;
    architecture: string;
    device: string;
    description: string;
  }

  interface GPUSupportedLimits {
    maxStorageBufferBindingSize: number;
    maxUniformBufferBindingSize: number;
  }

  interface GPUSupportedFeatures {
    values: Iterable<GPUFeatureName>;
  }

  type GPUFeatureName = string;

  interface Cache {
    match(
      request: RequestInfo | string,
      options?: CacheQueryOptions,
    ): Promise<Response | undefined>;
    matchAll(
      request?: RequestInfo | string,
      options?: CacheQueryOptions,
    ): Promise<CacheResponse[]>;
    add(request: RequestInfo | string): Promise<void>;
    addAll(requests: RequestInfo[]): Promise<void>;
    put(request: RequestInfo | string, response: Response): Promise<void>;
    delete(
      request: RequestInfo | string,
      options?: CacheQueryOptions,
    ): Promise<boolean>;
    keys(
      request?: RequestInfo | string,
      options?: CacheQueryOptions,
    ): Promise<Request[]>;
  }

  interface CacheStorage {
    open(cacheName: string): Promise<Cache>;
    match(
      request: RequestInfo | string,
      options?: CacheQueryOptions,
    ): Promise<Response | undefined>;
    has(cacheName: string): Promise<boolean>;
    keys(): Promise<string[]>;
    delete(cacheName: string): Promise<boolean>;
  }

  interface CacheQueryOptions {
    ignoreSearch?: boolean;
    ignoreMethod?: boolean;
    ignoreVary?: boolean;
    cacheName?: string;
  }

  type CacheResponse = Response;

  interface IdleRequestCallback {
    (deadline: IdleDeadline): void;
  }

  interface IdleRequestOptions {
    timeout?: number;
  }

  interface IdleDeadline {
    didTimeout: boolean;
    timeRemaining(): number;
  }

  interface Performance {
    memory?: PerformanceMemory;
  }

  interface PerformanceMemory {
    jsHeapSizeLimit: number;
    totalJSHeapSize: number;
    usedJSHeapSize: number;
  }

  const __PAID__: boolean;
  const __FREE__: boolean;
  const __TEST_MODE__: boolean | undefined;
}

export {};
