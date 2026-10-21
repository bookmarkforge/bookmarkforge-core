import { useState, useCallback } from "react";
import {
  getWhitelistedOrigins,
  addToWhitelist,
  removeFromWhitelist,
  invalidateWhitelistCache,
} from "../utils/networkFirewall";
import { logger } from "../utils/logger";
import { useGuardedDataLoad } from "./useGuardedDataLoad";

export function useNetworkWhitelist() {
  const [origins, setOrigins] = useState<string[]>([]);
  // Mount load via autoLoad + refresh after mutations; each load supersedes
  // the in-flight one (the original begin()-per-call semantics).
  const { load: refresh, loading } = useGuardedDataLoad<string[]>(
    async () => {
      invalidateWhitelistCache();
      return getWhitelistedOrigins();
    },
    {
      onSuccess: (list) => setOrigins(list),
      onError: (error) =>
        logger.error("[useNetworkWhitelist] refresh failed", { error }),
    },
  );

  const add = useCallback(
    async (origin: string) => {
      await addToWhitelist(origin);
      await refresh();
    },
    [refresh],
  );

  const remove = useCallback(
    async (origin: string) => {
      await removeFromWhitelist(origin);
      await refresh();
    },
    [refresh],
  );

  return { origins, loading, add, remove, refresh };
}
