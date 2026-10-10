import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { RxDatabase } from "rxdb";
import { initDB } from "../db/database";
import { securityVault } from "../services/SecurityVault";
import { logger } from "../utils/logger";

interface MainAppState {
  isInitialized: boolean;
  isDBReady: boolean;
  isAIReady: boolean;
  isVaultUnlocked: boolean;
  error: string | null;
  loading: boolean;
}

/**
 * useMainAppState - Manages the main application state including:
 * - Database initialization
 * - AI provider setup
 * - Security vault status
 * - Global error handling
 */
export function useMainAppState() {
  const { t } = useTranslation();
  const [state, setState] = useState<MainAppState>({
    isInitialized: false,
    isDBReady: false,
    isAIReady: false,
    isVaultUnlocked: false,
    error: null,
    loading: true,
  });

  // Deliberate leave: this is a bootstrap state machine (sequential field
  // updates + explicit reinitialize), not a UI data-load. initializationRef
  // prevents concurrent inits; mountedRef gates setState after unmount. The
  // guard family's single boolean isRunning/onSuccess contract cannot express
  // the isDBReady → isVaultUnlocked → isAIReady progression.
  const initializationRef = useRef(false);
  const dbRef = useRef<RxDatabase | null>(null);
  const mountedRef = useRef(true);

  const initializeApp = useCallback(async () => {
    if (initializationRef.current) {
      return;
    }
    initializationRef.current = true;

    if (!mountedRef.current) {return;}
    setState((prev) => ({ ...prev, loading: true, error: null }));

    try {
      // Initialize Database
      setState((prev) => ({ ...prev, error: null }));
      const db = await initDB();
      dbRef.current = db;
      setState((prev) => ({ ...prev, isDBReady: true }));

      // Initialize Security Vault
      const vaultStatus = !securityVault.isLocked();
      setState((prev) => ({ ...prev, isVaultUnlocked: vaultStatus }));

      // Initialize AI Manager (constructor handles initialization)
      // ProviderManager initializes in constructor, no separate init needed
      setState((prev) => ({ ...prev, isAIReady: true }));

      setState((prev) => ({
        ...prev,
        isInitialized: true,
        loading: false,
      }));
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown initialization error";
      setState((prev) => ({
        ...prev,
        error: message,
        loading: false,
      }));
      logger.error("[useMainAppState] Initialization failed:", error);
    }
  }, []);

  const unlockVault = useCallback(async (password: string) => {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    const success = await securityVault.unlock(password);
    if (success) {
      setState((prev) => ({ ...prev, isVaultUnlocked: true, loading: false }));
      return true;
    }
    setState((prev) => ({
      ...prev,
      error: t("app_vault_unlock_error", "Invalid password or too many attempts. Please wait 5 minutes."),
      loading: false,
    }));
    return false;
  }, [t]);

  const lockVault = useCallback(async () => {
    try {
      await securityVault.lock();
      setState((prev) => ({ ...prev, isVaultUnlocked: false }));
    } catch (error) {
      logger.error("[useMainAppState] Failed to lock vault:", error);
    }
  }, []);

  const resetError = useCallback(() => {
    setState((prev) => ({ ...prev, error: null }));
  }, []);

  const reinitialize = useCallback(async () => {
    initializationRef.current = false;
    await initializeApp();
  }, [initializeApp]);

  // Auto-initialize on mount
  useEffect(() => {
    mountedRef.current = true;
    // Wrap in Promise.resolve to avoid synchronous setState in effect
    Promise.resolve().then(() => initializeApp());
    return () => {
      mountedRef.current = false;
    };
  }, [initializeApp]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      // Cleanup resources if needed
      if (dbRef.current) {
        // Don't destroy DB on unmount, just clean up refs
        dbRef.current = null;
      }
    };
  }, []);

  return {
    ...state,
    db: dbRef.current,
    initializeApp,
    unlockVault,
    lockVault,
    resetError,
    reinitialize,
  };
}

/**
 * useAppInit - Simplified hook for basic app initialization
 * Returns only the essential state for components that don't need full control
 */
export function useAppInit() {
  const {
    isInitialized,
    isDBReady,
    isAIReady,
    isVaultUnlocked,
    error,
    loading,
    initializeApp,
    resetError,
  } = useMainAppState();

  return {
    isInitialized,
    isDBReady,
    isAIReady,
    isVaultUnlocked,
    error,
    loading,
    initializeApp,
    resetError,
  };
}
