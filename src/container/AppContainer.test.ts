import { describe, expect, it, vi } from "vitest";
import {
  AppContainer,
  appContainer,
  createTestContainer,
  type AppContainerDeps,
} from "./AppContainer";
import { encryptionService as prodEncryptionService } from "../services/EncryptionService";
import { securityVault as prodSecurityVault } from "../services/SecurityVault";
import { syncService as prodSyncService } from "../services/SyncService";
import { vectorIndexService as prodVectorIndexService } from "../services/ai/VectorIndexService";
import { ragEngine as prodRagEngine } from "../services/ai/RAGEngine";
import { cloudSyncService as prodCloudSyncService } from "../services/integrations/cloudSync";

// The heavy service modules are mocked so the container wiring can be tested
// hermetically. The "production" singletons below therefore resolve to the
// mock values; identity assertions still validate the constructor's
// defaulting (`deps.x ?? prodX`) and the singleton wiring.
vi.mock("../services/EncryptionService", () => ({
  encryptionService: { __prod: "encryptionService" },
}));
vi.mock("../services/SecurityVault", () => ({
  securityVault: { __prod: "securityVault" },
}));
vi.mock("../services/SyncService", () => ({
  syncService: { __prod: "syncService" },
}));
vi.mock("../services/ai/VectorIndexService", () => ({
  vectorIndexService: { __prod: "vectorIndexService" },
}));
vi.mock("../services/ai/RAGEngine", () => ({
  ragEngine: { __prod: "ragEngine" },
}));
vi.mock("../services/integrations/cloudSync", () => ({
  cloudSyncService: { __prod: "cloudSyncService" },
}));

/** Cast a plain mock object to a service dependency type for injection. */
const dep = <T>(value: unknown): T => value as unknown as T;

describe("AppContainer", () => {
  it("defaults every dependency to the production singleton", () => {
    const container = new AppContainer();
    expect(container.encryptionService).toBe(prodEncryptionService);
    expect(container.securityVault).toBe(prodSecurityVault);
    expect(container.syncService).toBe(prodSyncService);
    expect(container.vectorIndexService).toBe(prodVectorIndexService);
    expect(container.ragEngine).toBe(prodRagEngine);
    expect(container.cloudSyncService).toBe(prodCloudSyncService);
  });

  it("treats an empty deps object like the default constructor", () => {
    const container = new AppContainer({});
    expect(container.encryptionService).toBe(prodEncryptionService);
    expect(container.securityVault).toBe(prodSecurityVault);
    expect(container.syncService).toBe(prodSyncService);
    expect(container.vectorIndexService).toBe(prodVectorIndexService);
    expect(container.ragEngine).toBe(prodRagEngine);
    expect(container.cloudSyncService).toBe(prodCloudSyncService);
  });

  it("uses injected dependencies when every dependency is provided", () => {
    const deps: AppContainerDeps = {
      encryptionService: dep({ __test: "encryption" }),
      securityVault: dep({ __test: "vault" }),
      syncService: dep({ __test: "sync" }),
      vectorIndexService: dep({ __test: "vector" }),
      ragEngine: dep({ __test: "rag" }),
      cloudSyncService: dep({ __test: "cloud" }),
    };
    const container = new AppContainer(deps);
    expect(container.encryptionService).toBe(deps.encryptionService);
    expect(container.securityVault).toBe(deps.securityVault);
    expect(container.syncService).toBe(deps.syncService);
    expect(container.vectorIndexService).toBe(deps.vectorIndexService);
    expect(container.ragEngine).toBe(deps.ragEngine);
    expect(container.cloudSyncService).toBe(deps.cloudSyncService);
  });

  it("falls back to production for dependencies that are not injected", () => {
    const injected: AppContainerDeps["securityVault"] = dep({ __test: "custom-vault" });
    const container = new AppContainer({ securityVault: injected });
    expect(container.securityVault).toBe(injected);
    expect(container.encryptionService).toBe(prodEncryptionService);
    expect(container.syncService).toBe(prodSyncService);
    expect(container.vectorIndexService).toBe(prodVectorIndexService);
    expect(container.ragEngine).toBe(prodRagEngine);
    expect(container.cloudSyncService).toBe(prodCloudSyncService);
  });

  it("defaults explicitly-undefined deps and honors the provided ones", () => {
    const customVault: AppContainerDeps["securityVault"] = dep({
      __test: "custom-vault",
    });
    const container = new AppContainer({
      encryptionService: undefined,
      securityVault: customVault,
      syncService: undefined,
    });
    // Explicitly-undefined deps must behave like omitted ones (?? prod).
    expect(container.encryptionService).toBe(prodEncryptionService);
    expect(container.syncService).toBe(prodSyncService);
    // The provided dep is honored.
    expect(container.securityVault).toBe(customVault);
    // Omitted deps keep defaulting to production.
    expect(container.vectorIndexService).toBe(prodVectorIndexService);
    expect(container.ragEngine).toBe(prodRagEngine);
    expect(container.cloudSyncService).toBe(prodCloudSyncService);
  });

  it("createTestContainer returns a container wired to the injected deps", () => {
    const deps: AppContainerDeps = { syncService: dep({ __test: "test-sync" }) };
    const container = createTestContainer(deps);
    expect(container).toBeInstanceOf(AppContainer);
    expect(container.syncService).toBe(deps.syncService);
    expect(container.encryptionService).toBe(prodEncryptionService);
  });

  it("exposes a production singleton wired to the production deps", () => {
    expect(appContainer).toBeInstanceOf(AppContainer);
    expect(appContainer.encryptionService).toBe(prodEncryptionService);
    expect(appContainer.securityVault).toBe(prodSecurityVault);
    expect(appContainer.syncService).toBe(prodSyncService);
    expect(appContainer.vectorIndexService).toBe(prodVectorIndexService);
    expect(appContainer.ragEngine).toBe(prodRagEngine);
    expect(appContainer.cloudSyncService).toBe(prodCloudSyncService);
  });
});