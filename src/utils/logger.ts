type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const SENSITIVE_PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9][A-Za-z0-9_-]{12,}/g,
  /sk-ant-[A-Za-z0-9_-]{12,}/g,
  /AIza[0-9A-Za-z_-]{12,}/g,
  /ya29\.[0-9A-Za-z_-]+/g,
  /ghp_[A-Za-z0-9]{36,}/g,
  /gho_[A-Za-z0-9]{36,}/g,
  /ghu_[A-Za-z0-9]{36,}/g,
  /glpat-[A-Za-z0-9_-]{20,}/g,
  /gsk_[A-Za-z0-9_-]{20,}/g,
  /sk-or-[A-Za-z0-9_-]{20,}/g,
  /xox[baprs]-[A-Za-z0-9-]{10,}/g,
  /AKIA[0-9A-Z]{16}/g,
  /npm_[A-Za-z0-9]{36,}/g,
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  // URL userinfo: https://user:pass@host -> redact credentials
  /(https?:\/\/)[^:/\s]+:[^@/\s]+@/g,
  // Sensitive query parameters must not leak through diagnostic URLs.
  /([?&](?:key|api[_-]?key|token|secret|password|auth|signature|access[_-]?token|refresh[_-]?token)=)[^&#\s]*/gi,
  // Redact credentials embedded in stringified JSON/error bodies as well.
  /(["']?(?:key|api[_-]?key|token|secret|password|authorization|access[_-]?token|refresh[_-]?token)["']?\s*[:=]\s*["']?)[^"'\s,;}]+/gi,
];

export function redactSecrets(input: string): string {
  let result = input;
  for (const pattern of SENSITIVE_PATTERNS) {
    result = result.replace(pattern, (match) => {
      // URL userinfo pattern: redact the credentials entirely.
      if (/^https?:\/\//.test(match) && match.includes("@")) {
        return match.replace(
          /(https?:\/\/)[^:/\s]+:[^@/\s]+@/,
          "$1[REDACTED]:[REDACTED]@",
        );
      }
      // Query parameters and JSON-like key/value pairs must not retain a
      // suffix of the credential; the whole value is sensitive.
      const equalsIndex = match.indexOf("=");
      const colonIndex = match.indexOf(":");
      if (/^[?&]/.test(match) && equalsIndex >= 0) {
        return `${match.slice(0, equalsIndex + 1)}[REDACTED]`;
      }
      if (colonIndex >= 0 || equalsIndex >= 0) {
        const separatorIndex = colonIndex >= 0 ? colonIndex : equalsIndex;
        return `${match.slice(0, separatorIndex + 1)}[REDACTED]`;
      }
      if (match.length <= 4) {return match;}
      return match.slice(0, 4) + "****" + match.slice(-4);
    });
  }
  return result;
}

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
