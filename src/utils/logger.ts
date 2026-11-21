import { redactSecrets } from "./redactSecrets";

// Re-exported: `utils/logger` is the historic import site for this helper.
export { redactSecrets };

type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const SENSITIVE_KEYS = new Set([
  "password",
  "passphrase",
  "secret",
  "clientSecret",
  "client_secret",
  "token",
  "apiKey",
  "api_key",
  "apikey",
  "key",
  "vaultKey",
  "vault_key",
  "dbKey",
  "db_key",
  "encryptionKey",
  "encryption_key",
  "bearer",
  "credential",
  "credentials",
  "authorization",
  "auth",
  "accessToken",
  "refreshToken",
  "access_token",
  "refresh_token",
  "privateKey",
  "private_key",
  "sessionToken",
  "session_token",
  "masterPassword",
  "master_password",
]);

// Keys ending in these suffixes are treated as sensitive even if not
// present in the explicit set above (e.g. "geminiApiKey", "openAiKey").
const SENSITIVE_KEY_SUFFIXES = [
  "key",
  "secret",
  "token",
  "password",
  "passphrase",
  "credential",
  "credentials",
  "bearer",
];

function isSensitiveKey(key: string): boolean {
  if (SENSITIVE_KEYS.has(key)) {return true;}
  const lower = key.toLowerCase();
  return SENSITIVE_KEY_SUFFIXES.some(
    (suffix) => lower === suffix || lower.endsWith(suffix),
  );
}

function redactValue(value: unknown, depth = 0): unknown {
  if (depth > 10) {return "[MAX_DEPTH]";}
  if (value instanceof Error) {
    const redactedError = new Error(
      redactValue(value.message, depth + 1) as string,
    );
    redactedError.name = value.name;
    if (value.stack) {
      redactedError.stack = redactValue(value.stack, depth + 1) as string;
    }
    return redactedError;
  }
  if (typeof value === "string") {
    return redactSecrets(value);
  }
  if (Array.isArray(value)) {
    return value.map((v) => redactValue(v, depth + 1));
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(obj)) {
      if (isSensitiveKey(key)) {
        result[key] = "***REDACTED***";
      } else {
        result[key] = redactValue(obj[key], depth + 1);
      }
    }
    return result;
  }
  return value;
}

let currentLevel: LogLevel = import.meta.env.DEV ? "debug" : "warn";
let logBuffer: Array<{ level: LogLevel; args: unknown[]; timestamp: number }> =
  [];
const MAX_BUFFER_SIZE = 100;

type LogSink = (entry: {
  level: LogLevel;
  message: string;
  timestamp: number;
  data?: unknown[];
}) => void;
const sinks: LogSink[] = [];
let sinkReentrant = false;

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[currentLevel];
}

const isProduction =
  typeof window !== "undefined" && !import.meta.env.DEV && !import.meta.env.SSR;

function createReplacer(): (_key: string, value: unknown) => unknown {
  const seen = new WeakSet<object>();
  return (_key: string, value: unknown): unknown => {
    if (value !== null && typeof value === "object") {
      if (seen.has(value as object)) {
        return "[Circular]";
      }
      seen.add(value as object);
    }
    return value;
  };
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, createReplacer());
  } catch (_err) {
    try {
      return JSON.stringify(value, createReplacer(), 2);
    } catch (_err2) {
      return String(value);
    }
  }
}

function serializeArgs(args: unknown[]): string {
  return args
    .map((a) => {
      if (a instanceof Error) {
        const redacted = redactValue(a) as Error;
        return `Error: ${redacted.message}\n${redacted.stack || ""}`;
      }
      try {
        return safeStringify(redactValue(a));
      } catch (_err) {
        return String(redactValue(a));
      }
    })
    .join(" ");
}

function formatArgs(level: LogLevel, args: unknown[]): unknown[] {
  const prefix = `[${level.toUpperCase()}] ${new Date().toISOString()}`;
  return [prefix, ...args.map((a) => redactValue(a))];
}

function bufferLog(level: LogLevel, args: unknown[]): void {
  const sanitized = args.map((a) => redactValue(a));
  logBuffer.push({ level, args: sanitized, timestamp: Date.now() });
  if (logBuffer.length > MAX_BUFFER_SIZE) {
    logBuffer = logBuffer.slice(-MAX_BUFFER_SIZE);
  }
}

// Console access guarded so the logger itself never crashes when the console
// has been tampered with (e.g. `console.warn` deleted/overridden) — the very
// scenario the environment-detection module reports on.
function safeConsoleCall(method: "debug" | "info" | "warn" | "error", ...args: unknown[]): void {
  const fn = (console as unknown as Record<string, unknown>)[method];
  if (typeof fn === "function") {
    (fn as (...a: unknown[]) => void)(...args);
  }
}

function notifySinks(level: LogLevel, args: unknown[]): void {
  if (sinkReentrant) {return;}
  sinkReentrant = true;
  try {
    const sanitized = args.map((a) => redactValue(a));
    const message = serializeArgs(sanitized);
    const entry = { level, message, timestamp: Date.now(), data: sanitized };
    for (const sink of sinks) {
      try {
        sink(entry);
      } catch (e: unknown) {
        if (!isProduction) {
          safeConsoleCall("warn", "[Logger] Sink failed", {
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
    }
  } finally {
    sinkReentrant = false;
  }
}

export const logger = {
  setLevel(level: LogLevel): void {
    currentLevel = level;
  },

  getLevel(): LogLevel {
    return currentLevel;
  },

  getBuffer(): ReadonlyArray<{
    level: LogLevel;
    args: unknown[];
    timestamp: number;
  }> {
    return [...logBuffer];
  },

  clearBuffer(): void {
    logBuffer = [];
  },

  addSink(sink: LogSink): void {
    sinks.push(sink);
  },

  removeSink(sink: LogSink): void {
    const idx = sinks.indexOf(sink);
    if (idx !== -1) {sinks.splice(idx, 1);}
  },

  debug(...args: unknown[]): void {
    if (!shouldLog("debug")) {return;}
    bufferLog("debug", args);
    notifySinks("debug", args);
    if (!isProduction) {safeConsoleCall("debug", ...formatArgs("debug", args));}
  },

  info(...args: unknown[]): void {
    if (!shouldLog("info")) {return;}
    bufferLog("info", args);
    notifySinks("info", args);
    if (!isProduction) {safeConsoleCall("info", ...formatArgs("info", args));}
  },

  warn(...args: unknown[]): void {
    if (!shouldLog("warn")) {return;}
    bufferLog("warn", args);
    notifySinks("warn", args);
    if (!isProduction) {safeConsoleCall("warn", ...formatArgs("warn", args));}
  },

  error(...args: unknown[]): void {
    if (!shouldLog("error")) {return;}
    bufferLog("error", args);
    notifySinks("error", args);
    safeConsoleCall("error", ...formatArgs("error", args));
  },

  log(...args: unknown[]): void {
    this.info(...args);
  },
};
