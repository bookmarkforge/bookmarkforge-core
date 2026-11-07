/**
 * Human-Like Testing CI Profile
 *
 * Single source of truth for the CI-friendly simulator options consumed by
 * `ciHumanOptions` (utils/advanced-human-behavior.ts) and `ciBasicOptions`
 * (utils/human-behavior.ts).
 *
 * The historical framework config surface (defaultConfig,
 * configs.development/local, getConfig/mergeConfig/validateConfig,
 * ConfigurationManager) had zero consumers — no spec, core module, session
 * recorder or analytics module imported it — so it was removed. Only the
 * behavior profile the simulators actually read remains.
 */

export interface CiBehaviorProfile {
  /** Base delay between actions (ms) */
  baseDelay: number;
  /** Random variation in delays (ms) */
  delayVariation: number;
  /** Mouse movement speed */
  mouseSpeed: 'slow' | 'normal' | 'fast';
  /** Enable natural scrolling */
  naturalScrolling: boolean;
  /** Enable accidental clicks/mistakes */
  simulateMistakes: boolean;
}

/**
 * CI/CD behavior profile — keeps the human-like example suite inside the
 * 90s per-test budget: baseDelay 30, mouseSpeed fast, no natural scrolling,
 * no mistakes. baseDelay 30 keeps per-action delays ~30ms deterministic.
 */
export const ciBehavior: CiBehaviorProfile = {
  baseDelay: 30,
  delayVariation: 10,
  mouseSpeed: 'fast',
  naturalScrolling: false,
  simulateMistakes: false,
};
