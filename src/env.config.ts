// src/env.config.ts
//
// Single source of truth for all env reads across the codebase. The goal
// is twofold:
//
//   1. Boot-time validation — every required env var is checked at
//      module load (apps fail fast rather than 10 min later on an API
//      call). Optional vars without defaults are surfaced as warnings.
//
//   2. Static-checker friendliness — the registry exports
//      `ALLOWED_ENV_VAR_NAMES` (a `ReadonlySet<string>`) so the
//      `scripts/check-env-config.mjs` linter can verify that any
//      remaining direct `import.meta.env.X` / `process.env.X` reads in
//      `src/` are either (a) registered here or (b) listed in the
//      committed baseline. New direct reads fail CI immediately.
//
// Why dynamic key access (vs Vite's static property accesses):
//   Vite's transform plugin replaces `import.meta.env.X` with the
//   literal value at build time. Dynamic lookups like
//   `import.meta.env[name]` lose granular DCE per unused var, but Vite
//   still injects a serialized dictionary of all VITE_* prefixed vars
//   for runtime use. We pay a small bundle-size cost in exchange for
//   the type-level guarantees of a single registry.
//
// Vite-transform compatibility:
//   *Never* cast `import.meta` to a structurally-different shape. Vite's
//   AST walker depends on the literal identifier `import.meta.env` to
//   apply its transform. Use `typeof import.meta !== "undefined"` guards
//   instead of optional chaining through a cast.

interface EnvEntry<T> {
  /**
   * Full env var name as seen by Vite / Node.
   *   * Vite client bundle: must start with `VITE_` to be inlined.
   *   * Server-side / build-time: any name (HOST, PORT, NODE_ENV).
   */
  envVar: string;
  /**
   * If true, boot fails when this var is missing AND no default applies.
   * Defaults to false.
   */
  required?: boolean;
  /**
   * Parses raw `string | undefined` into the typed value. Throw here
   * to surface malformed values (`ABC` for a numeric var).
   */
  parser: (raw: string | undefined) => T;
  /**
   * Fallback applied when env var is unset AND parser returns undefined.
   * Per-key defaults open the door to runtime-fallbacks without
   * scattering `?? <default>` at every call site.
   */
  default?: T;
}

// ─── Parsers ─────────────────────────────────────────────────────────

/**
 * Bool parser with forgiving semantics:
 *   * `undefined` → `undefined` (caller decides via default)
 *   * `'true' | '1' | 'yes' | 'on'` (case-insensitive, trimmed) → `true`
 *   * `'false' | '0' | 'no' | 'off' | ''` (case-insensitive, trimmed) → `false`
 *   * anything else → throws (forces operator to fix the typo,
 *     hides bad data behind a `false`).
 *
 * Empty-string → false convention documented so operators know that
 * `VITE_FLAG=` differs from omitting `VITE_FLAG` entirely (the former
 * falls back to default-false; the latter invokes the default).
 */
/**
 * Parse a raw env var value into a boolean.
 * @internal Exported for testing only.
 */
export function parseBool(raw: string | undefined): boolean | undefined {
  if (raw === undefined) return undefined;
  const s = String(raw).trim().toLowerCase();
  if (s === "" || s === "false" || s === "0" || s === "no" || s === "off") return false;
  if (s === "true" || s === "1" || s === "yes" || s === "on") return true;
  throw new Error(`[env.config] expected boolean for "${raw}" (use true/false/1/0/yes/no/on/off)`);
}

/**
 * Parse a raw env var value into a number.
 * @internal Exported for testing only.
 */
export function parseNumber(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const s = String(raw).trim();
  if (s === "") throw new Error(`[env.config] expected number for "${raw}"`);
  const n = Number(s);
  if (Number.isNaN(n)) throw new Error(`[env.config] expected number for "${raw}"`);
  return n;
}

/**
 * String parser — undefined when unset, else the raw string.
 * @internal Exported for testing only.
 */
export function parseString(raw: string | undefined): string | undefined {
  return raw;
}

// ─── Registry ───────────────────────────────────────────────────────

export const ENV_REGISTRY = {
  // ─── Vite built-ins (replaced at build time, NOT env-vars) ───
  isDev:  { envVar: "DEV",       parser: parseBool,   default: false},
  isProd: { envVar: "PROD",      parser: parseBool,   default: false},
  mode:   { envVar: "MODE",      parser: parseString, default: "production"},
  baseUrl:{ envVar: "BASE_URL",  parser: parseString, default: "/"},
  ssr:    { envVar: "SSR",       parser: parseBool},
  packageVersion:{ envVar: "PACKAGE_VERSION", parser: parseString},

  // ─── App-specific Vite-injected vars ───
  appVersion:  { envVar: "VITE_APP_VERSION",     parser: parseString, default: "dev"},
  buildHash:   { envVar: "VITE_BUILD_HASH",      parser: parseString},
  dbName:      { envVar: "VITE_DB_NAME",         parser: parseString},
  devMode:     { envVar: "VITE_DEV_MODE",        parser: parseString},
  disableNetworkFirewall: { envVar: "VITE_DISABLE_NETWORK_FIREWALL", parser: parseBool, default: false},
  forceMemoryStorage:     { envVar: "VITE_FORCE_MEMORY_STORAGE",     parser: parseBool, default: false},
  forceDexieStorage:      { envVar: "VITE_FORCE_DEXIE_STORAGE",      parser: parseBool, default: false},
  // ADR-052 Fase 3 — bridge flag for the v5 legacy read-path cutoff.
  // UNSET (today's default) = cutoff NOT activated: `v5:` payloads keep
  // decrypting under the legacy static salt, exactly as before. An
  // explicit VITE_ALLOW_V5_LEGACY_READ=false is the Phase 3 cutoff
  // itself: every `v5:` read then fails closed with the typed
  // LegacyV5FormatRemovedError. Only cutoff builds set false.
  allowV5LegacyRead:      { envVar: "VITE_ALLOW_V5_LEGACY_READ",     parser: parseBool},
  // E2E-preview build flag: lets the production build publish the storage
  // backend diagnostic hook so the Playwright preview run can assert the
  // durable backend. NEVER set in real production builds (no hook shipped).
  e2ePreviewDiagnostics:  { envVar: "VITE_E2E_PREVIEW_DIAGNOSTICS", parser: parseBool, default: false},
  // E2E-preview build flag: publishes the resolved Argon2id parameters on
  // window so the mobile-device profile can PROVE the 64 MiB mobile KDF ran
  // (instead of inferring it from timing). Same contract as the flag above:
  // never set in real production builds, so the diagnostic hook ships nowhere.
  e2eKdfDiagnostics:      { envVar: "VITE_E2E_KDF_DIAGNOSTICS",     parser: parseBool, default: false},
  testBuild:              { envVar: "VITE_TEST_BUILD",              parser: parseBool, default: false},
  // Optional Sentry DSN for remote error reporting (opt-in, see
  // src/telemetry/remoteErrorReporter.ts). Empty by default: error reporting
  // stays strictly local unless the operator configures a DSN AND the user
  // consents via the banner.
  sentryDsn:              { envVar: "VITE_SENTRY_DSN",               parser: parseString},

  // ─── Network firewall / P2P overrides ───
  p2pSignalingUrl:    { envVar: "VITE_P2P_SIGNALING_URL",     parser: parseString},
  licenseSigningUrl:  { envVar: "VITE_LICENSE_SIGNING_URL",   parser: parseString},
  whopCheckoutUrl:     { envVar: "VITE_WHOP_CHECKOUT_URL",      parser: parseString},
  turnUrl:            { envVar: "VITE_TURN_URL",              parser: parseString},
  turnUsername:       { envVar: "VITE_TURN_USERNAME",           parser: parseString},
  turnCredential:     { envVar: "VITE_TURN_CREDENTIAL",         parser: parseString},
  fetchProxyUrl:      { envVar: "VITE_FETCH_PROXY_URL",       parser: parseString},
  modelSelfHostUrl:   { envVar: "VITE_MODEL_SELF_HOST_URL",   parser: parseString},

  // ─── Boot-mode flags (registered for unified access + gate coverage) ───
  // These flags govern `validateEnv()`'s policy at module load. They're
  // registered here (rather than read ad-hoc via readEnvVar) so that:
  //   * `scripts/check-env-config.mjs` (the static-checker gate) tracks
  //     them as legitimate registry reads — no false-positive comments.
  //   * Programmatic consumers (custom tooling, telemetry, tests) can
  //     read `env.bootStrict` / `env.prefixStrict` instead of duplicating
  //     the lookup. `validateEnv()` still reads them BEFORE the registry
  //     is fully built (the registry's own boot validation is the
  //     first consumer) via the direct readEnvVar() call below; the
  //     accessor paths only resolve once validateEnv() completes.
  bootStrict:   { envVar: "VITE_ENV_BOOT_STRICT",   parser: parseBool, default: false},
  prefixStrict: { envVar: "VITE_ENV_PREFIX_STRICT", parser: parseBool, default: false},
} as const satisfies Record<string, EnvEntry<any>>;

/**
 * Public dynamic-key escape hatch for callers that need to read an env var
 * whose name is decided at runtime (feature-flag gating, runtime-config
 * injection, etc.). For all STATIC env reads, prefer the typed `env.*`
 * accessors above.
 *
 * The fallback chain mirrors `readEnvVar`: Vite's `import.meta.env` first
 * (carrying VITE_* values + browser-provided fallback), then `process.env`
 * (Node / SSR / test overrides via `vi.stubEnv`).
 */
export function readDynamicEnv(name: string): string | undefined {
  return readEnvVar(name);
}

// ─── Lookup helper ───────────────────────────────────────────────────

/**
 * Read env var from Vite's `import.meta.env` (client + dev) or
 * `process.env` (Node / SSR / tests / scripts).
 *
 * Vite-transform compatibility:
 *   *Never* cast `import.meta` to a structurally-different shape. Vite's
 *   AST walker depends on the literal identifier `import.meta.env` to
 *   apply its transform. We use a single `(import.meta as { env?: ... })`
 *   cast ONLY for the `typeof` guard in a non-cast position; access the
 *   `.env` member directly through the typed `ImportMetaEnv` interface
 *   (augmented in `vite-env.d.ts`) so TypeScript narrows the value. The
 *   cast pattern matches the one used by Vite itself in its known-good
 *   typings and has been verified to keep the transform plugin happy.
 */
/**
 * Read env var from Vite's `import.meta.env` (client + dev) or `process.env`.
 * @internal
 */
function readEnvVar(envVar: string): string | undefined {
  const meta = typeof import.meta !== "undefined" ? import.meta.env : undefined;
  if (meta && envVar in meta) return meta[envVar] as string | undefined;
  if (typeof process !== "undefined" && process.env && envVar in process.env) {
    return process.env[envVar];
  }
  return undefined;
}

// ─── Boot validation ────────────────────────────────────────────────

/**
 * Run all parsers and apply defaults.
 *
 * Policy (per the user's spec, in priority order):
 *
 *   1. **Required keys** (`required: true`) ALWAYS fail at boot —
 *      the user explicitly demanded *"fail at boot if a required key
 *      is missing"*. Suppressing this in dev would defeat the
 *      entire point of the registry, so there is no mode gate.
 *      Note: a `required: true` entry's `default` is intentionally
 *      NEVER consulted — the throw fires before default application.
 *      If you want a fallback, set `required: false` and ship a
 *      `default`.
 *
 *   2. **Optional keys with `default`** never fail. The default is
 *      applied at the typed accessor boundary (see the `env` freeze
 *      below). This is the user's *"opens the door to
 *      runtime-fallbacks (a default value per key)"* requirement.
 *
 *   3. **Optional keys WITHOUT default** are warn-vs-throw by mode:
 *      set `VITE_ENV_BOOT_STRICT=1` (opt-in via the CI workflow's
 *      `env:` block, a `cross-env` script, or the operator's shell)
 *      to throw so the operator is forced to add a default or remove
 *      the var. Otherwise (dev default) `console.warn` so dev
 *      sessions don't white-screen on a missing optional.
 *
 *   4. **Parser failures** ALWAYS throw — malformed values can't be
 *      safely defaulted; we surface the type mismatch at boot
 *      rather than silently shipping `undefined`.
 *
 *   5. **VITE_* prefix guard** (`VITE_ENV_PREFIX_STRICT=1`): if a
 *      registry entry is `VITE_`-prefixed and the live env chain has
 *      the non-prefixed counterpart set (e.g. operator set
 *      `OPENAI_API_KEY` instead of `VITE_OPENAI_API_KEY`), warn.
 *      Vite silently strips non-prefixed vars from the client bundle
 *      → runtime returns `undefined` → API calls fail mysteriously.
 *      Off by default; toggle in production deployments. The flag
 *      itself is opt-in via `process.env` (CI shell, `cross-env`, or
 *      operator shell) because Vite's static-replace inlines the
 *      flag value at build time — production-built bundles won't see
 *      the flag unless it's set via `process.env` before the bundle
 *      is hydrated. The guard warns (never throws) because the var
 *      itself might still resolve via `process.env` in SSR / Node —
 *      only the client bundle is broken, and the operator's intent
 *      is at least visible.
 *
 *      **Asymmetric blind spot** (acknowledged): the prefix guard only
 *      sees `import.meta.env.X` vs `import.meta.env.VITE_X`. It does
 *      NOT catch SSR-side reads of `process.env.GEMINI_API_KEY`
 *      (without VITE_) which silently work in Node / SSR / tests and
 *      silently break in the client bundle. Closing this would require
 *      a separate audit: `process.env.X` direct reads where the
 *      registry has a `VITE_X` entry. Worth a follow-up gate.
 *
 * Called eagerly at module load. To skip in unit tests, set
 * `SKIP_ENV_BOOT_VALIDATION=1` (or rely on `process.env.NODE_ENV`
 * being `test` — handled implicitly) so the registry imports cleanly
 * in `vitest` / `jsdom` contexts where VITE_* vars may be absent.
 *
 * `entry.required` and `entry.default` are accessed via optional
 * chaining and a typed `EnvEntry<any>` cast. Reason: with `as const`,
 * TypeScript narrows each entry's literal type and drops optional
 * fields from the union. Casting `entry as EnvEntry<any>` re-introduces
 * the interface shape so the optional fields become accessible.
 */
/**
 * Run all parsers and apply defaults. Called eagerly at module load.
 * @internal Exported for testing only.
 */
export function validateEnv(): void {
  // Skip in test environments OR when explicitly opted out via env var.
  const skip =
    typeof process !== "undefined" &&
    (process.env?.SKIP_ENV_BOOT_VALIDATION === "1" ||
      process.env?.NODE_ENV === "test");
  if (skip) return;

  // Both flags are registered in ENV_REGISTRY above so downstream code
  // can read them via `env.bootStrict` / `env.prefixStrict`. At boot
  // time (right here) we read them via the low-level helper because
  // the typed `env.*` accessor isn't constructed yet — this is the one
  // place where the registry precedes itself.
  const strictOptional = readEnvVar("VITE_ENV_BOOT_STRICT") === "1";
  const prefixStrict = readEnvVar("VITE_ENV_PREFIX_STRICT") === "1";

  for (const [key, rawEntry] of Object.entries(ENV_REGISTRY)) {
    const entry = rawEntry as EnvEntry<any>;
    const raw = readEnvVar(entry.envVar);
    let v: unknown;
    try {
      v = entry.parser(raw);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(
        `[env.config] ${key} (envVar=${entry.envVar}) parser failed: ${msg}`,
      );
    }
    if (v === undefined) {
      if (entry.required) {
        // Required keys ALWAYS fail at boot — the user's spec demands
        // *"fail at boot if a required key is missing"*. Suppressing
        // this in dev would defeat the entire point of the registry.
        throw new Error(
          `[env.config] required env var missing: ${entry.envVar} (key=${key})`,
        );
      }
      if (entry.default !== undefined) {
        // Optional-with-default: silent fall-through; the typed
        // accessor below applies the default at construction time.
        // This honors the user's *"opens the door to
        // runtime-fallbacks (a default value per key)"* intent.
        continue;
      }
      // Optional-without-default: warn-or-throw by mode.
      const msg = `[env.config] optional env var unset, no default applied: ${entry.envVar} (key=${key})`;
      if (strictOptional) throw new Error(msg);
      else console.warn(msg);
    }
    // VITE_* prefix guard — only relevant for env vars that MUST be
    // exposed to the client bundle. Operators sometimes set the
    // non-prefixed name (e.g. GEMINI_API_KEY) which Vite silently
    // strips from the bundle; the result is `undefined` at runtime.
    // We WARN (never throw) here because the var itself might still
    // resolve via process.env in SSR / Node — only the client bundle
    // is broken, and the operator's intent is at least visible.
    if (prefixStrict && entry.envVar.startsWith("VITE_")) {
      const unprefixed = entry.envVar.replace(/^VITE_/, "");
      if (
        unprefixed !== entry.envVar &&
        readEnvVar(unprefixed) !== undefined &&
        raw === undefined
      ) {
        console.warn(
          `[env.config] prefix guard: ${entry.envVar} is unset but ` +
            `${unprefixed} IS set — Vite cannot expose non-prefixed ` +
            `vars to the client bundle. Either rename the operator's ` +
            `env to the VITE_ prefixed form or drop the prefix-strict ` +
            `guard.`,
        );
      }
    }
  }
}

validateEnv();

// ─── Typed accessors ─────────────────────────────────────────────────
//
// `env.forceMemoryStorage` → `boolean` (default: false narrows the type)
// `env.mode` → `string` (default: "production")
//
// Default values narrow the type — the value is whatever the parser
// returns OR the default, never undefined for entries that ship with
// one. For entries without a default, undefined is in the union so
// operators must handle the missing case at the call site.

type EnvKey = keyof typeof ENV_REGISTRY;

type EntryValue<E extends EnvEntry<any>> =
  // Default narrows the type to the default's type.
  E extends { default: infer D }
    ? D extends undefined
      ? NonNullable<ReturnType<E["parser"]>> | undefined
      : NonNullable<ReturnType<E["parser"]>> | D
    : ReturnType<E["parser"]>;

export const env: Readonly<{
  [K in EnvKey]: EntryValue<(typeof ENV_REGISTRY)[K]>;
}> = Object.freeze(
  Object.fromEntries(
    Object.entries(ENV_REGISTRY).map(([key, rawEntry]) => {
      const entry = rawEntry as EnvEntry<any>;
      const raw = readEnvVar(entry.envVar);
      let value: unknown;
      try {
        value = entry.parser(raw);
      } catch {
        // validateEnv() already threw earlier — we shouldn't get here.
        value = undefined;
      }
      if (value === undefined && entry.default !== undefined) value = entry.default;
      return [key, value];
    }),
  ) as { [K in EnvKey]: EntryValue<(typeof ENV_REGISTRY)[K]> },
);

// ─── Static-checker bridge ──────────────────────────────────────────
//
// `ALLOWED_ENV_VAR_NAMES` is consumed by `scripts/check-env-config.mjs`
// to verify that direct `import.meta.env.X` / `process.env.X` reads in
// `src/` map to a known registry entry (either the full name or the
// prefix-stripped form when Vite's static-replacement handles it).

export const ALLOWED_ENV_VAR_NAMES: ReadonlySet<string> = new Set(
  Object.values(ENV_REGISTRY).map((e) => e.envVar),
);
