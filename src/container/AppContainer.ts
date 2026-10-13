/**
 * AppContainer — lightweight DI container (P1-2)
 * Centralizes singleton wiring for testability. Existing `export const xxx = new Xxx()` remain as deprecated re-exports for gradual migration.
 *
 * Usage in production:
 *   import { appContainer } from "./container/AppContainer";
 *   appContainer.vectorIndexService // etc
 *
 * Usage in tests:
 *   const container = createTestContainer({ securityVault: mockVault, ... })
 */

import { encryptionService as prodEncryptionService } from "../services/EncryptionService";
import { securityVault as prodSecurityVault } from "../services/SecurityVault";
import { vectorIndexService as prodVectorIndexService } from "../services/ai/VectorIndexService";
import { ragEngine as prodRagEngine } from "../services/ai/RAGEngine";
import { cloudSyncService as prodCloudSyncService } from "../services/integrations/cloudSync";
// P2P sync is Pro (scripts/pro-boundary.mjs): the instance type travels
// as a type-only reference to the seam, so the container never links the Pro
// module into a Core chunk and there is no eager default to fall back to.
import type { SyncServiceType } from "../services/pro-access";

export interface AppContainerDeps {
  encryptionService?: typeof prodEncryptionService;
  securityVault?: typeof prodSecurityVault;
  /** Injected by tests only — P2P sync is resolved through the Pro seam. */
  syncService?: SyncServiceType;
  vectorIndexService?: typeof prodVectorIndexService;
  ragEngine?: typeof prodRagEngine;
  cloudSyncService?: typeof prodCloudSyncService;
}

export class AppContainer {
  readonly encryptionService: typeof prodEncryptionService;
  readonly securityVault: typeof prodSecurityVault;
  /**
   * Absent by default on purpose: the P2P replication manager is a Pro
   * module, and a Core-side default would make every Core consumer of this
   * container carry it. Core call sites resolve it at the point of use
   * through `loadSyncService()` (src/services/pro-access.ts), which gates it
   * on `hasProAccess()`.
   */
  readonly syncService?: SyncServiceType;
  readonly vectorIndexService: typeof prodVectorIndexService;
  readonly ragEngine: typeof prodRagEngine;
  readonly cloudSyncService: typeof prodCloudSyncService;

  constructor(deps: AppContainerDeps = {}) {
    this.encryptionService = deps.encryptionService ?? prodEncryptionService;
    this.securityVault = deps.securityVault ?? prodSecurityVault;
    this.syncService = deps.syncService;
    this.vectorIndexService = deps.vectorIndexService ?? prodVectorIndexService;
    this.ragEngine = deps.ragEngine ?? prodRagEngine;
    this.cloudSyncService = deps.cloudSyncService ?? prodCloudSyncService;
  }
}

// Production singleton container
export const appContainer = new AppContainer();

// Test helper
export function createTestContainer(deps: AppContainerDeps): AppContainer {
  return new AppContainer(deps);
}
