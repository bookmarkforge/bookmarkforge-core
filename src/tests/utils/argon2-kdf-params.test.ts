import { describe, it, expect, vi, afterEach } from "vitest";

const mockArgon2id = vi.hoisted(() => vi.fn());

vi.mock("@noble/hashes/argon2.js", () => ({
  argon2id: (...args: unknown[]) => mockArgon2id(args[0], args[1], args[2]),
}));

function stubNavigator(nav: unknown): void {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    writable: true,
    value: nav,
  });
}

afterEach(() => {
  stubNavigator({ maxTouchPoints: 0, userAgent: "Mozilla/5.0 (X11; Linux x86_64)" });
  vi.doUnmock("../../utils/env");
});

interface EnvStub {
  isProd: boolean;
  isTest: boolean;
}

async function importWithEnv(
  opts: EnvStub,
  nav: unknown,
): Promise<{ deriveArgon2idKey: (pw: Uint8Array, salt: Uint8Array) => Promise<Uint8Array> }> {
  vi.resetModules();
  vi.doMock("../../utils/env", () => ({
    getEnvVar: () => undefined,
    isProdBuild: () => opts.isProd,
    isTestMode: () => opts.isTest,
  }));
  stubNavigator(nav);
  const mod = await import("../../utils/argon2-kdf");
  return mod as {
    deriveArgon2idKey: (pw: Uint8Array, salt: Uint8Array) => Promise<Uint8Array>;
  };
}

function captureOpts(): Record<string, number> {
  const calls = mockArgon2id.mock.calls;
  const last = calls[calls.length - 1];
  const opts = last?.[2] as { t: number; m: number; p: number; dkLen: number };
  return { t: opts.t, m: opts.m, p: opts.p, dkLen: opts.dkLen };
}

describe("ARGON2_PARAMS selection (module re-import)", () => {
  const MOBILE = { t: 3, m: 65536, p: 1, dkLen: 32 };
  const DESKTOP = { t: 3, m: 131072, p: 1, dkLen: 32 };
  const TEST = { t: 1, m: 8192, p: 1, dkLen: 32 };

  const mobileNav = { maxTouchPoints: 5, userAgent: "iPhone" };
  const desktopNav = { maxTouchPoints: 0, userAgent: "Windows" };

  async function run(
    opts: EnvStub,
    nav: unknown,
  ): Promise<Record<string, number>> {
    mockArgon2id.mockImplementation(
      (pw: Uint8Array, salt: Uint8Array, o: { dkLen: number }) =>
        new Uint8Array(o.dkLen),
    );
    const mod = await importWithEnv(opts, nav);
    await mod.deriveArgon2idKey(new Uint8Array(4), new Uint8Array(4));
    return captureOpts();
  }

  it("uses mobile params in a prod build on a touch device", async () => {
    expect(await run({ isProd: true, isTest: false }, mobileNav)).toEqual(MOBILE);
  });

  it("uses desktop params in a prod build on a non-touch device", async () => {
    expect(await run({ isProd: true, isTest: false }, desktopNav)).toEqual(DESKTOP);
  });

  it("uses mobile params in a dev build on a touch device", async () => {
    expect(await run({ isProd: false, isTest: false }, mobileNav)).toEqual(MOBILE);
  });

  it("uses desktop params in a dev build on a non-touch device", async () => {
    expect(await run({ isProd: false, isTest: false }, desktopNav)).toEqual(DESKTOP);
  });

  it("uses test params in test mode regardless of device", async () => {
    expect(await run({ isProd: false, isTest: true }, mobileNav)).toEqual(TEST);
  });
});
