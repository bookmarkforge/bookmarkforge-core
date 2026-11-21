/**
 * Centralised localStorage keys for BookmarkForge.
 * Single source of truth — import these instead of hardcoding strings.
 *
 * Naming convention: keys prefixed with `forge_` for namespace isolation.
 *
 * Sensitivity legend (PLAN-N6-N7-storage-hardening, Fase 0 — 2026-11-17):
 *   [secret]   user content/credentials — candidate for SecureStorage migration
 *   [personal] behavioral or user-authored data — candidate for SecureStorage
 *   [medium]   config/metadata with mild privacy signal — review per batch
 *   [low]      operational/UI flag — acceptable in localStorage
 *   [legacy]   superseded or dead — verify no readers remain, then remove
 */
export const STORAGE_KEYS = {
  // Onboarding & tour — [low]
  ONBOARDING_COMPLETE: "forge_onboarding_complete",
  WELCOME_TOUR_COMPLETE: "forge_welcome_tour_complete",
  DISMISSED_TIPS: "forge_dismissed_tips",
  /** First-run checklist: hidden for good once dismissed. [low] */
  FIRST_RUN_CHECKLIST_DISMISSED: "forge_first_run_checklist_dismissed",
  /** First-run checklist: set once the user opened search at least once. [low] */
  FIRST_RUN_SEARCH_TRIED: "forge_first_run_search_tried",

  // Demo mode — [low]
  DEMO_ACTIVE: "forge_demo_active",
  DEMO_VAULT_CREATED: "forge_demo_vault_created",

  // Master password — [low] (boolean flag only; no secret material)
  HAS_MASTER_PASSWORD: "forge_has_master_password",
  /** Flag set when user explicitly skips password setup on first run. [low] */
  PASSWORD_SKIPPED: "forge_password_skipped",

  // CSP profile — [low]
  CSP_PROFILE: "forge_csp_profile",

  // Recovery — [low] attempt counters; RECOVERY_DATA itself is [legacy]
  // (migrated to SecureStorage "recovery_data" via SecurityVault.migrateFromLocalStorage)
  RECOVERY_LAST_ATTEMPT: "forge_recovery_last_attempt",
  RECOVERY_ATTEMPT_COUNT: "forge_recovery_attempt_count",
  RECOVERY_DATA: "forge_recovery_data", // [legacy] — do not write new data here

  // Sound settings — [low]
  SOUND_SETTINGS: "forge_sound_settings",

  // Sync — [low] AUTO_SYNC_CLOUD is a preference flag; FOLDER_SYNC_STATE holds
  // only opaque kind:id keys + content hashes/revisions (verified Fase 2 —
  // no paths or content), so localStorage is acceptable.
  AUTO_SYNC_CLOUD: "forge_auto_sync_cloud",
  FOLDER_SYNC_STATE: "forge_folder_sync_state",

  // UI banners — [low]
  EVICTION_BANNER_DISMISSED: "forge_eviction_banner_dismissed",
  BACKUP_BANNER_DISMISSED_UNTIL: "forge_backup_banner_dismissed_until",
  FREE_TIER_WALL_DISMISSED_AT: "forge_free_tier_wall_dismissed_at",
  FREE_TIER_WALL_HIT_PENDING: "forge_free_tier_wall_hit_pending",
  // Written by BackupService (its local const AUTO_BACKUP_KEY uses this
  // exact literal) and read synchronously by HomeDashboard's pre-paint
  // banner decision (ADR-055). Single source of truth is BackupService;
  // keep the two in lockstep. [low]
  AUTO_BACKUP_TIMESTAMP: "bmf_last_auto_backup",
  LAST_MANUAL_BACKUP_DATE: "forge_last_manual_backup_date",
  LAST_DISK_BACKUP_RESULT: "forge_last_disk_backup_result", // [low] backup result metadata for first-paint banner
  RESTORE_SUCCESS_PENDING: "forge_restore_success_pending",

  // AI — [medium]/[personal]
  LAST_DIGEST_TS: "forge_last_digest_ts", // [low]
  INTELLIGENT_MAINTENANCE_ENABLED: "forge_intelligent_maintenance_enabled", // [low]
  INTELLIGENT_MAINTENANCE_HISTORY: "forge_intelligent_maintenance_history", // [low] timestamps + SafeRepairKind enums + counters, no content
  TEST_MODE: "forge_test_mode", // [low]

  // Nuclear forget audit — NOT a localStorage key: value is used as the
  // IndexedDB database name by NuclearForgetService. Kept here for
  // namespace documentation only.
  NUCLEAR_AUDIT: "forge_nuclear_audit",

  // Theme — [low]; USER_THEME_CSS must stay synchronous for first paint
  THEME: "bookmarkforge-theme",
  USER_THEME_CSS: "forge_user_theme_css",

  // i18n — [low]
  I18N_LANGUAGE: "i18nextLng",

  // Appearance — [low]
  GLOBAL_FONT: "global_font",
  GLOBAL_FONT_SIZE: "global_font_size",

  // Feature flags — [low]
  DISTRACTION_FREE_MODE: "distraction_free_mode",
  AUTO_LOCK_VAULT: "auto_lock_vault",
  COMPACT_MODE: "compact-mode",
  AUTO_SAVE: "auto-save",
  AUTO_SAVE_INTERVAL: "auto-save-interval",
  SIDEBAR_COLLAPSED: "bookmarkforge_sidebar_collapsed",
  AUTO_LOCK_TIMEOUT: "auto_lock_timeout",

  // AI provider settings — endpoint URLs moved fully to SecureStorage
  // `bmf_provider_*` (ProviderConfiguration, PLAN-N6-N7 Fase 2); the
  // localStorage URL keys below are [legacy] read-then-remove only.
  // Model/provider selection stays in localStorage BY DESIGN: it is
  // non-secret and portable via SettingsService.exportSettings().
  OLLAMA_URL: "ollama_url", // [legacy] migrated to bmf_provider_ollama_url
  OLLAMA_MODEL: "ollama_model", // [medium] portable, non-secret
  SELECTED_PROVIDER: "selected_provider", // [medium] portable, non-secret
  /** @deprecated Dual-write alias of SELECTED_PROVIDER read by ProviderConfiguration. [legacy] */
  SELECTED_AI_PROVIDER: "selected_ai_provider",
  WEBLLM_MODEL: "webllm_model", // [medium] portable, non-secret
  CUSTOM_AI_BASE_URL: "custom_ai_base_url", // [legacy] migrated to bmf_provider_custom_ai_base_url

  // Quick capture — [low] default privacy flag for new captures
  DEFAULT_PRIVATE: "default_private",

  // Custom prompts — [secret] user-authored prompt text
  CUSTOM_PROMPTS: "custom_prompts",
  CUSTOM_PROMPTS_SUMMARIZE: "custom_prompts_summarize",
  CUSTOM_PROMPTS_TAGGING: "custom_prompts_tagging",
  CUSTOM_PROMPTS_CHAT: "custom_prompts_chat",
  PENDING_AI_QUERY: "pending_ai_query", // [personal] raw user query text

  // Vault — [legacy] both migrated to SecureStorage/salt-registry
  // (ADR-053/046); database.ts performs read-then-remove migration only.
  VAULT_SALT: "vault_salt",
  VAULT_CRYPTO_KEY: "vault_crypto_key",

  // Support — [personal] support chat content
  BMF_SUPPORT_HISTORY: "bmf_support_history",
  PENDING_IMPORT_ROLLBACK: "forge_pending_import_rollback", // [low] actually sessionStorage (importer.journal), not localStorage

  // Cloud backup — [legacy] DEAD KEYS: zero readers/writers outside this
  // registry (verified 2026-11-17). Cloud config incl. WebDAV credentials is
  // persisted via securityVault.encryptSecret(..., "cloud_sync_config").
  BOOKMARKFORGE_CLOUD_PROVIDER: "bookmarkforge_cloud_provider",
  BOOKMARKFORGE_CLOUD_WEBDAV_URL: "bookmarkforge_cloud_webdav_url",
  BOOKMARKFORGE_CLOUD_AUTOBACKUP: "bookmarkforge_cloud_autobackup",
  BOOKMARKFORGE_CLOUD_SCHEDULE: "bookmarkforge_cloud_schedule",
  BOOKMARKFORGE_CLOUD_LASTBACKUP: "bookmarkforge_cloud_lastbackup", // [low] live timestamp

  // Gamification — [personal] derived from reading behavior
  BOOKMARKFORGE_LONGEST_STREAK: "bookmarkforge_longest_streak",
  BOOKMARKFORGE_CURRENT_STREAK: "bookmarkforge_current_streak",
  BOOKMARKFORGE_FENGSHUI_APPLIED: "bookmarkforge_fengshui_applied",
  /** Last feng-shui analysis payload — write-only cache today. [personal] */
  BOOKMARKFORGE_FENGSHUI_SUGGESTIONS: "bookmarkforge_fengshui",
  BOOKMARKFORGE_PUBLISHED_SITES: "bookmarkforge_published_sites",
  BOOKMARKFORGE_PERSONALITY: "bookmarkforge_personality",
  BOOKMARKFORGE_BLINDSPOTS: "bookmarkforge_blindspots",
  BOOKMARKFORGE_RECENT_TOPICS: "bookmarkforge_recent_topics",
  BOOKMARKFORGE_READER_MOOD: "bookmarkforge_reader_mood",

  // Consent banner (GDPR / CCPA) — [low] legal consent records; keep in
  // localStorage deliberately (tamper-evident plaintext is a feature here)
  CONSENT_DECISION_MADE: "forge_consent_decision_made",
  CONSENT_ANALYTICS: "forge_consent_analytics",
  /** Sentry/remote error reporting consent (independent purpose). [low] */
  CONSENT_SENTRY: "forge_consent_sentry",
  /** @deprecated Historical local diagnostics consent; kept for migration. [legacy] */
  CONSENT_ERROR_REPORTING: "forge_consent_error_reporting",
  CONSENT_CLIENT_EVENTS: "forge_consent_client_events",
  /** @deprecated Pre-rename consent key; read-only migration fallback. [legacy] */
  BMF_TELEMETRY_OPTIN: "bmf_telemetry_optin",

  // Local error storage opt-in: renamed from the
  // misleading bmf_telemetry_optin — this key NEVER enabled external
  // telemetry, only local IndexedDB error storage. Legacy key is honored
  // as a read-only migration fallback (see src/telemetry/errorReporter.ts).
  // [low]
  LOCAL_ERROR_STORAGE: "bmf_local_error_storage",
} as const;
