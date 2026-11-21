/**
 * Path sanitization utilities.
 *
 * Prevents injection attacks and malformed URLs by rejecting paths with
 * dangerous characters like quotes, backslashes, or control characters.
 */

/**
 * Characters that are forbidden in navigation paths to prevent injection
 * and malformed URLs. Includes quotes, backslashes, and control characters.
 */
const FORBIDDEN_PATH_CHARS = /[<>"'\\{}|\x00-\x1F]/;

/**
 * Checks if a path is valid for navigation.
 *
 * @param path - The path to validate
 * @returns true if the path is valid, false otherwise
 */
export function isValidPath(path: string): boolean {
  if (!path || typeof path !== "string") {
    return false;
  }

  // Reject paths with forbidden characters
  if (FORBIDDEN_PATH_CHARS.test(path)) {
    return false;
  }

  return true;
}
