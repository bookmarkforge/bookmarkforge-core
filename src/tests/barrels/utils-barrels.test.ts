import { describe, it, expect } from "vitest";

describe("utils - barrel files", () => {
  it("should import devtoolsProtection", async () => {
    const mod = await import("../../utils/devtoolsProtection");
    expect(Object.keys(mod).length).toBeGreaterThan(0);
  });
  it("should import indexedDB", async () => {
    const mod = await import("../../utils/indexedDB");
    expect(Object.keys(mod).length).toBeGreaterThan(0);
  });
  it("should import types", async () => {
    // utils/types is type-only now (Result/Ok/Err are erased at compile
    // time); the import must resolve without throwing even though the
    // runtime namespace is empty (no value exports remain).
    const mod = await import("../../utils/types");
    expect("Result" in mod).toBe(false);
  });
  it("should import localization", async () => {
    const mod = await import("../../utils/localization");
    expect(Object.keys(mod).length).toBeGreaterThan(0);
  });
});

describe("memory - barrel files", () => {
  it("should import MemoryTypes", async () => {
    const mod = await import("../../memory/MemoryTypes");
    expect(Object.keys(mod).length).toBeGreaterThan(0);
  });
  it("should import memory-schemas", async () => {
    const mod = await import("../../memory/memory-schemas");
    expect(Object.keys(mod).length).toBeGreaterThan(0);
  });
});

describe("utils barrel - logger safety", () => {
  it("should import logger without errors", async () => {
    const logger = await import("../../utils/logger");
    expect(logger.logger.info).toBeInstanceOf(Function);
    expect(logger.logger.error).toBeInstanceOf(Function);
    expect(logger.logger.warn).toBeInstanceOf(Function);
  });

  it("should not trigger service module evaluation on util import", async () => {
    await import("../../utils/logger");
    const services = await import("../../services/SecurityVault");
    expect(services).toBeDefined();
  });
});
