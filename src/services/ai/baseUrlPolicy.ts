/**
 * baseUrlPolicy — shared endpoint-URL policy for AI provider settings.
 *
 * Single source of truth used by both the interactive setter
 * (ProviderConfiguration.setCustomBaseUrl) and the settings-import path
 * (SettingsService.importSecureProviderSettings) so an imported value can
 * never bypass the checks applied when the user types the URL into the UI.
 */

export interface CustomBaseUrlPolicyOptions {
  /**
   * Allow `http:` only for loopback hosts. Defaults to true (the settings
   * setter policy, which supports local OpenAI-compatible servers such as
   * LM Studio). Import paths pass false: the OpenAI-compatible provider
   * attaches `Authorization: Bearer <key>` to every request, so even a
   * loopback http endpoint would expose the key to any local process.
   */
  allowLoopbackHttp?: boolean;
}

const MAX_BASE_URL_LENGTH = 2048;
const SUSPICIOUS_PARAMS = ["api_key", "key", "token", "secret", "ak", "sk"];

function isLoopbackHostname(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    hostname === "::1"
  );
}

/**
 * Throws when `baseUrl` violates the provider endpoint policy; returns
 * nothing on success. Messages mirror the historical setter errors.
 */
export function assertValidCustomAiBaseUrl(
  baseUrl: string,
  options: CustomBaseUrlPolicyOptions = {},
): void {
  const allowLoopbackHttp = options.allowLoopbackHttp ?? true;
  if (typeof baseUrl !== "string" || baseUrl.length === 0) {
    throw new Error("Invalid custom base URL");
  }
  if (baseUrl.length > MAX_BASE_URL_LENGTH) {
    throw new Error("Invalid custom base URL");
  }
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch (_err) {
    throw new Error("Invalid custom base URL");
  }
  const isHttp = parsed.protocol === "http:";
  const isHttps = parsed.protocol === "https:";
  if (!isHttp && !isHttps) {
    throw new Error("Invalid custom base URL");
  }
  // SECURITY: reject plaintext http:// to prevent MITM/exfiltration of API
  // keys and prompts over an unencrypted channel. Loopback http stays allowed
  // for the interactive setter (local model servers) unless the caller opts
  // into the stricter import policy.
  if (isHttp && !(allowLoopbackHttp && isLoopbackHostname(parsed.hostname))) {
    throw new Error(
      allowLoopbackHttp
        ? "Custom AI base URL must use https:// (or http://localhost for local models)"
        : "Custom AI base URL must use https://",
    );
  }
  // SECURITY (F17): reject URLs that embed credentials or secret query params,
  // since they would otherwise be persisted and could leak API keys.
  if (parsed.username || parsed.password) {
    throw new Error("Custom AI base URL must not contain credentials");
  }
  for (const param of SUSPICIOUS_PARAMS) {
    if (parsed.searchParams.has(param)) {
      throw new Error(
        `Custom AI base URL must not contain a '${param}' parameter`,
      );
    }
  }
}

export function isValidCustomAiBaseUrl(
  baseUrl: string,
  options: CustomBaseUrlPolicyOptions = {},
): boolean {
  try {
    assertValidCustomAiBaseUrl(baseUrl, options);
    return true;
  } catch (_err) {
    return false;
  }
}
