/**
 * Shared helper for parsing a JSON-array blob read from local / secure
 * storage.
 *
 * Three persistence-side services (TagColorService, DocumentTemplateService,
 * AuditLogService) previously re-implemented the same defensive load:
 *   1. JSON.parse on the raw stored string,
 *   2. accept the result only if it's an array,
 *   3. filter non-object entries before any per-field validation,
 *   4. swallow and log the parse failure so the rest of the system still
 *      boots on a tampered or truncated blob.
 *
 * That contract is now centralized here so future services do not re-roll
 * their own variant. The helper is intentionally **non-throwing**:
 *   - `null` / `undefined` / empty string → empty result, not a failure,
 *   - non-array JSON (object, number, "x") → empty entries + parseFailed,
 *   - per-entry arrays / primitives → dropped, not flagged as a failure.
 *
 * The `parseFailed` flag lets the caller decide whether to log/audit the
 * event. Returning the pre-filtered object array keeps the type-shaped
 * iteration logic at the call site where the field-level validation lives.
 */

interface LoadedJsonArray<T> {
  /** Entries that are non-null, non-array objects. */
  entries: T[];
  /** True iff the raw blob was present but not a valid array of objects. */
  parseFailed: boolean;
}

export function safeParseJsonArray<T extends object = Record<string, unknown>>(
  raw: string | null | undefined,
): LoadedJsonArray<T> {
  if (typeof raw !== "string" || raw.length === 0) {
    return { entries: [], parseFailed: false };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { entries: [], parseFailed: true };
  }

  if (!Array.isArray(parsed)) {
    return { entries: [], parseFailed: true };
  }

  const entries = parsed.filter(
    (e): e is T => !!e && typeof e === "object" && !Array.isArray(e),
  );
  return { entries, parseFailed: false };
}

interface LoadedJsonObject<T> {
  /** The parsed object if valid; `null` if missing/invalid. */
  value: T | null;
  /** True iff the raw blob was present but not a valid plain object. */
  parseFailed: boolean;
}

/**
 * Mirror of {@link safeParseJsonArray} for the case where the stored blob
 * is a single JSON object (e.g. a quota map keyed by provider). Returns
 * `{ value: null, parseFailed: true }` instead of throwing so callers can
 * decide whether to log or reset.
 */
export function safeParseJsonObject<
  T extends object = Record<string, unknown>,
>(raw: string | null | undefined): LoadedJsonObject<T> {
  if (typeof raw !== "string" || raw.length === 0) {
    return { value: null, parseFailed: false };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { value: null, parseFailed: true };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { value: null, parseFailed: true };
  }
  return { value: parsed as T, parseFailed: false };
}
