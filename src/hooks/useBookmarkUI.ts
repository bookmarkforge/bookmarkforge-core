import { useState, useEffect } from "react";
import { Bookmark } from "../types";
import { ProviderInfo, AIProvider } from "../services/ai/types";
import { securityVault } from "../services/SecurityVault";

/**
 * Manages UI-only state for bookmark interactions:
 * - Content viewer modal
 * - Share modal
 * - API settings modal and provider info
 */
export function useBookmarkUI() {
  const [viewingContent, setViewingContent] = useState<Bookmark | null>(null);
  const [sharingBookmark, setSharingBookmark] = useState<Bookmark | null>(null);
  const [shareEmail, setShareEmail] = useState("");
  const [showApiSettings, setShowApiSettings] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [providerInfo, setProviderInfo] = useState<ProviderInfo>({
    provider: "unknown" as AIProvider,
    model: "",
    fullSupport: false,
    name: "",
    availableModels: [],
    isConfigured: false,
  });

  const handleViewContent = (bookmark: Bookmark) => {
    setViewingContent(bookmark);
  };

  // SECURITY (S9): apiKeyInput may hold a decrypted API key (it is seeded
  // from aiManager.getApiKey()). React state is out of the vault/config tree,
  // so it would survive a vault lock in memory. Purge it synchronously when
  // the vault locks so the decrypted key never outlives the lock.
  useEffect(() => {
    return securityVault.onLock(() => setApiKeyInput(""));
  }, []);

  return {
    viewingContent,
    setViewingContent,
    sharingBookmark,
    setSharingBookmark,
    shareEmail,
    setShareEmail,
    showApiSettings,
    setShowApiSettings,
    apiKeyInput,
    setApiKeyInput,
    providerInfo,
    setProviderInfo,
    handleViewContent,
  };
}
