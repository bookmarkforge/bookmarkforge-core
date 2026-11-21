/**
 * Active storage-capability probe.
 *
 * Error-chain classification (isStorageBlockedError) can only recognize
 * failures whose shape matches known DOMException/RxDB patterns. Real-world
 * init failures often arrive as generic Errors — SecureStorage retries
 * exhausted, a hung indexedDB.open surfacing as DB_INIT_TIMEOUT, or WebCrypto
 * missing on an insecure (HTTP) context. When initDB fails with an
 * unclassified error, probing the environment directly answers the question
 * the error shape cannot: can this browser actually persist data?
 */

export interface StorageProbeResult {
  /** "ok" = a throwaway DB opened, wrote a store and deleted cleanly. */
  indexedDB: "ok" | "missing" | "error" | "timeout";
  /** crypto.subtle present (secure context: HTTPS or localhost). */
  cryptoSubtle: boolean;
  /** localStorage set/remove round-trip. */
  localStorage: boolean;
}

const PROBE_DB_PREFIX = "__bf_storage_probe__";
const DEFAULT_TIMEOUT_MS = 4000;

function probeLocalStorage(): boolean {
  try {
    const key = `${PROBE_DB_PREFIX}ls`;
    window.localStorage.setItem(key, "1");
    window.localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

async function probeCryptoSubtle(): Promise<boolean> {
  try {
    if (
      typeof crypto === "undefined" ||
      typeof crypto.subtle === "undefined" ||
      typeof crypto.subtle.digest !== "function"
    ) {
      return false;
    }
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode("bf-probe"),
    );
    return true;
  } catch {
    return false;
  }
}

function probeIndexedDB(timeoutMs: number): Promise<StorageProbeResult["indexedDB"]> {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined" || indexedDB === null) {
      resolve("missing");
      return;
    }
    const name = `${PROBE_DB_PREFIX}${Date.now()}_${Math.random()
      .toString(36)
      .slice(2)}`;
    let settled = false;
    const finish = (value: StorageProbeResult["indexedDB"]) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    // A blocked/hung open (enterprise policy, corrupted profile, another
    // process holding the factory) never fires onsuccess OR onerror — the
    // timeout is the only escape, and it is itself diagnostic: the browser
    // cannot serve IndexedDB requests at all.
    const timer = setTimeout(() => finish("timeout"), timeoutMs);
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(name, 1);
    } catch {
      finish("error");
      return;
    }
    request.onupgradeneeded = () => {
      try {
        const db = request.result;
        if (!db.objectStoreNames.contains("probe")) {
          db.createObjectStore("probe");
        }
      } catch {
        /* store creation failure surfaces via onerror below */
      }
    };
    request.onerror = () => finish("error");
    request.onblocked = () => finish("error");
    request.onsuccess = () => {
      const db = request.result;
      try {
        db.close();
      } catch {
        /* already closed */
      }
      try {
        const del = indexedDB.deleteDatabase(name);
        del.onsuccess = () => finish("ok");
        del.onerror = () => finish("ok"); // data deleted or not, IDB works
        del.onblocked = () => finish("ok");
      } catch {
        finish("ok");
      }
    };
  });
}

/**
 * Probes the three capabilities the vault needs: IndexedDB persistence,
 * WebCrypto (encryption) and localStorage (UI flags). Never throws — a
 * probe that itself fails reports the corresponding capability as absent.
 */
export async function probeStorageCapabilities(
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<StorageProbeResult> {
  const [indexedDB, cryptoSubtle] = await Promise.all([
    probeIndexedDB(timeoutMs),
    probeCryptoSubtle(),
  ]);
  return {
    indexedDB,
    cryptoSubtle,
    localStorage: probeLocalStorage(),
  };
}

/**
 * True when the probe shows the browser cannot persist or encrypt — i.e.
 * the init failure is environmental, not vault corruption. localStorage
 * alone failing is NOT sufficient (private modes often keep IDB while
 * blocking LS); IndexedDB or WebCrypto failing is decisive.
 */
export function isStorageEnvironmentBroken(
  probe: StorageProbeResult,
): boolean {
  return probe.indexedDB !== "ok" || probe.cryptoSubtle === false;
}
