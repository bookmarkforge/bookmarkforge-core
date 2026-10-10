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
import { syncService as prodSyncService } from "../services/SyncService";
import { vectorIndexService as prodVectorIndexService } from "../services/ai/VectorIndexService";
import { ragEngine as prodRagEngine } from "../services/ai/RAGEngine";
import { cloudSyncService as prodCloudSyncService } from "../services/integrations/cloudSync";

export interface AppContainerDeps {
  encryptionService?: typeof prodEncryptionService;
  securityVault?: typeof prodSecurityVault;
  syncService?: typeof prodSyncService;
  vectorIndexService?: typeof prodVectorIndexService;
  ragEngine?: typeof prodRagEngine;
  cloudSyncService?: typeof prodCloudSyncService;
}

export class AppContainer {
  readonly encryptionService: typeof prodEncryptionService;
  readonly securityVault: typeof prodSecurityVault;
  readonly syncService: typeof prodSyncService;
  readonly vectorIndexService: typeof prodVectorIndexService;
  readonly ragEngine: typeof prodRagEngine;
  readonly cloudSyncService: typeof prodCloudSyncService;

  constructor(deps: AppContainerDeps = {}) {
    this.encryptionService = deps.encryptionService ?? prodEncryptionService;
    this.securityVault = deps.securityVault ?? prodSecurityVault;
    this.syncService = deps.syncService ?? prodSyncService;
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
