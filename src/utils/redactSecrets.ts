/**
 * Secret redaction for anything that leaves app memory: logs, user-facing
 * error text, telemetry payloads.
 *
 * Kept in its own module (no imports) so pure UI helpers can redact without
 * pulling the logger facade in. That matters for tests and for layering: a
 * component that formats an error must not require the logging module — and
 * its side effects — just to sanitize a string.
 */

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
