/**
 * Boot-time environment flags.
 *
 * Keep environment policy in the typed registry rather than embedding
 * `let`/`const` flag reads in index.html. The HTML entry stays declarative,
 * while this module remains testable and covered by the normal TypeScript
 * pipeline.
 */
import { env } from "../env.config";

export const envBoot = Object.freeze({
  isDev: env.isDev,
  isProd: env.isProd,
  bootStrict: env.bootStrict,
  prefixStrict: env.prefixStrict,
});

export type EnvBootFlags = Readonly<typeof envBoot>;
