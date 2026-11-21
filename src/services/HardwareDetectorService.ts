import { logger } from "../utils/logger";

type DeviceTier = "low-end" | "mid-range" | "high-end";

interface HardwareInfo {
  tier: DeviceTier;
  memory: number; // in GB
  concurrency: number; // cores
  webgpuSupported: boolean;
  webglSupported: boolean;
}

class HardwareDetectorService {
  private cachedInfo: HardwareInfo | null = null;

  public async getHardwareInfo(): Promise<HardwareInfo> {
    if (this.cachedInfo) {
      return this.cachedInfo;
    }

    const memory = this.getDeviceMemory();
    const concurrency = this.getHardwareConcurrency();
    const webgpuSupported = await this.checkWebGPUSupport();
    const webglSupported = this.checkWebGLSupport();

    const tier = this.determineTier(memory, concurrency, webgpuSupported);

    this.cachedInfo = {
      tier,
      memory,
      concurrency,
      webgpuSupported,
      webglSupported,
    };

    logger.info("[HardwareDetector] Device Profile:", {
      data: this.cachedInfo,
    });

    return this.cachedInfo;
  }

  public async getDeviceTier(): Promise<DeviceTier> {
    const info = await this.getHardwareInfo();
    return info.tier;
  }

  /**
   * Discards the cached hardware profile so the next getHardwareInfo()
   * re-probes the device. The WebGPU surface can appear AFTER the first
   * probe (e.g. a GPU stack still initializing after boot in embedded/E2E
   * environments, or a driver recovering from a transient failure): without
   * this, a device cached as low-end on boot would never re-classify, even
   * once the adapter is fully available. Read-only callers are unaffected;
   * call this when the environment may have changed since the last probe.
   */
  public reset(): void {
    this.cachedInfo = null;
  }

  private getDeviceMemory(): number {
    // navigator.deviceMemory is available in Chromium-based browsers
    // Returns approximate RAM in GB
    if ("deviceMemory" in navigator) {
      return (
        (navigator as Navigator & { deviceMemory: number }).deviceMemory || 4
      );
    }
    // Fallback: assume 4GB if not available (e.g. Safari, Firefox)
    return 4;
  }

  private getHardwareConcurrency(): number {
    return navigator.hardwareConcurrency || 4;
  }

  private async checkWebGPUSupport(): Promise<boolean> {
    type NavigatorWithGPU = Navigator & {
      gpu?: { requestAdapter: () => Promise<unknown> };
    };
    const nav = navigator as NavigatorWithGPU;
    if (!nav.gpu) {
      return false;
    }

    try {
      const adapter = await nav.gpu.requestAdapter();
      return !!adapter;
    } catch (e) {
      logger.warn(
        "[HardwareDetector] WebGPU supported but requestAdapter failed",
        { error: e },
      );
      return false;
    }
  }

  private checkWebGLSupport(): boolean {
    try {
      const canvas = document.createElement("canvas");
      return !!(
        window.WebGLRenderingContext &&
        (canvas.getContext("webgl") || canvas.getContext("experimental-webgl"))
      );
    } catch (_err) {
      return false;
    }
  }

  private determineTier(
    memory: number,
    concurrency: number,
    webgpuSupported: boolean,
  ): DeviceTier {
    // Low-end: < 8GB RAM OR < 4 cores OR no WebGPU
    if (memory < 8 || concurrency < 4 || !webgpuSupported) {
      return "low-end";
    }

    // High-end: >= 16GB RAM AND >= 8 cores AND WebGPU
    if (memory >= 16 && concurrency >= 8 && webgpuSupported) {
      return "high-end";
    }

    // Mid-range: everything else (e.g., 8GB RAM, 4-6 cores, WebGPU)
    return "mid-range";
  }
}

export const hardwareDetector = new HardwareDetectorService();
