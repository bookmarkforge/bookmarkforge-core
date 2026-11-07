/**
 * Centralised localStorage keys for BookmarkForge.
 * Single source of truth — import these instead of hardcoding strings.
 *
 * Naming convention: keys prefixed with `forge_` for namespace isolation.
 */
export const STORAGE_KEYS = {
  // Onboarding & tour
  ONBOARDING_COMPLETE: "forge_onboarding_complete",
  WELCOME_TOUR_COMPLETE: "forge_welcome_tour_complete",
  DISMISSED_TIPS: "forge_dismissed_tips",
  /** First-run checklist: hidden for good once dismissed. */
  FIRST_RUN_CHECKLIST_DISMISSED: "forge_first_run_checklist_dismissed",
  /** First-run checklist: set once the user opened search at least once. */
  FIRST_RUN_SEARCH_TRIED: "forge_first_run_search_tried",

  // Demo mode
  DEMO_ACTIVE: "forge_demo_active",
  DEMO_VAULT_CREATED: "forge_demo_vault_created",

  // Master password
  HAS_MASTER_PASSWORD: "forge_has_master_password",
  /** Flag set when user explicitly skips password setup on first run. */
  PASSWORD_SKIPPED: "forge_password_skipped",

  // CSP profile
  CSP_PROFILE: "forge_csp_profile",

  // Recovery
  RECOVERY_LAST_ATTEMPT: "forge_recovery_last_attempt",
  RECOVERY_ATTEMPT_COUNT: "forge_recovery_attempt_count",
  RECOVERY_DATA: "forge_recovery_data",

  // Sound settings
  SOUND_SETTINGS: "forge_sound_settings",

  // Sync
  AUTO_SYNC_CLOUD: "forge_auto_sync_cloud",
  FOLDER_SYNC_STATE: "forge_folder_sync_state",

  // UI banners
  EVICTION_BANNER_DISMISSED: "forge_eviction_banner_dismissed",
  BACKUP_BANNER_DISMISSED_UNTIL: "forge_backup_banner_dismissed_until",
  FREE_TIER_WALL_DISMISSED_AT: "forge_free_tier_wall_dismissed_at",
  FREE_TIER_WALL_HIT_PENDING: "forge_free_tier_wall_hit_pending",
  // Written by BackupService (its local const AUTO_BACKUP_KEY uses this
  // exact literal) and read synchronously by HomeDashboard's pre-paint
  // banner decision (ADR-055). Single source of truth is BackupService;
  // keep the two in lockstep.
  AUTO_BACKUP_TIMESTAMP: "bmf_last_auto_backup",
  LAST_MANUAL_BACKUP_DATE: "forge_last_manual_backup_date",
  LAST_DISK_BACKUP_RESULT: "forge_last_disk_backup_result",
  RESTORE_SUCCESS_PENDING: "forge_restore_success_pending",

  // AI
  LAST_DIGEST_TS: "forge_last_digest_ts",
  INTELLIGENT_MAINTENANCE_ENABLED: "forge_intelligent_maintenance_enabled",
  INTELLIGENT_MAINTENANCE_HISTORY: "forge_intelligent_maintenance_history",
  TEST_MODE: "forge_test_mode",

  // Nuclear forget audit
  NUCLEAR_AUDIT: "forge_nuclear_audit",

  // Theme
  THEME: "bookmarkforge-theme",
  USER_THEME_CSS: "forge_user_theme_css",

  // i18n
  I18N_LANGUAGE: "i18nextLng",

  // Appearance
  GLOBAL_FONT: "global_font",
  GLOBAL_FONT_SIZE: "global_font_size",

  // Feature flags
  DISTRACTION_FREE_MODE: "distraction_free_mode",
  AUTO_LOCK_VAULT: "auto_lock_vault",
  COMPACT_MODE: "compact-mode",
  AUTO_SAVE: "auto-save",
  AUTO_SAVE_INTERVAL: "auto-save-interval",
  SIDEBAR_COLLAPSED: "bookmarkforge_sidebar_collapsed",
  AUTO_LOCK_TIMEOUT: "auto_lock_timeout",

  // AI provider settings
  OLLAMA_URL: "ollama_url",
  OLLAMA_MODEL: "ollama_model",
  SELECTED_PROVIDER: "selected_provider",
  WEBLLM_MODEL: "webllm_model",
  CUSTOM_AI_BASE_URL: "custom_ai_base_url",

  // Custom prompts
  CUSTOM_PROMPTS: "custom_prompts",
  CUSTOM_PROMPTS_SUMMARIZE: "custom_prompts_summarize",
  CUSTOM_PROMPTS_TAGGING: "custom_prompts_tagging",
  CUSTOM_PROMPTS_CHAT: "custom_prompts_chat",
  PENDING_AI_QUERY: "pending_ai_query",

  // Vault
  VAULT_SALT: "vault_salt",
  VAULT_CRYPTO_KEY: "vault_crypto_key",

  // Support
  BMF_SUPPORT_HISTORY: "bmf_support_history",
  PENDING_IMPORT_ROLLBACK: "forge_pending_import_rollback",

  // Cloud backup
  BOOKMARKFORGE_CLOUD_PROVIDER: "bookmarkforge_cloud_provider",
  BOOKMARKFORGE_CLOUD_WEBDAV_URL: "bookmarkforge_cloud_webdav_url",
  BOOKMARKFORGE_CLOUD_AUTOBACKUP: "bookmarkforge_cloud_autobackup",
  BOOKMARKFORGE_CLOUD_SCHEDULE: "bookmarkforge_cloud_schedule",
  BOOKMARKFORGE_CLOUD_LASTBACKUP: "bookmarkforge_cloud_lastbackup",

  // Gamification
  BOOKMARKFORGE_LONGEST_STREAK: "bookmarkforge_longest_streak",
  BOOKMARKFORGE_CURRENT_STREAK: "bookmarkforge_current_streak",
  BOOKMARKFORGE_FENGSHUI_APPLIED: "bookmarkforge_fengshui_applied",
  BOOKMARKFORGE_PUBLISHED_SITES: "bookmarkforge_published_sites",
  BOOKMARKFORGE_PERSONALITY: "bookmarkforge_personality",
  BOOKMARKFORGE_BLINDSPOTS: "bookmarkforge_blindspots",
  BOOKMARKFORGE_RECENT_TOPICS: "bookmarkforge_recent_topics",
  BOOKMARKFORGE_READER_MOOD: "bookmarkforge_reader_mood",

  // Consent banner (GDPR / CCPA)
  CONSENT_DECISION_MADE: "forge_consent_decision_made",
  CONSENT_ANALYTICS: "forge_consent_analytics",
  /** Sentry/remote error reporting consent (independent purpose). */
  CONSENT_SENTRY: "forge_consent_sentry",
  /** @deprecated Historical local diagnostics consent; kept for migration. */
  CONSENT_ERROR_REPORTING: "forge_consent_error_reporting",
  CONSENT_CLIENT_EVENTS: "forge_consent_client_events",
  ANALYTICS_INSTALL_ID: "bmf_analytics_install_id",
  PENDING_CLIENT_EVENT: "bmf_pending_client_event",

  // Local error storage opt-in (I2, audit 2026-08-13): renamed from the
  // misleading bmf_telemetry_optin — this key NEVER enabled external
  // telemetry, only local IndexedDB error storage. Legacy key is honored
  // as a read-only migration fallback (see src/telemetry/errorReporter.ts).
  LOCAL_ERROR_STORAGE: "bmf_local_error_storage",
} as const;
