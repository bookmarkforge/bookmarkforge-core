#!/usr/bin/env node

/**
 * Docker registry host policy shared by push, pull and rollback scripts.
 * Registry paths are intentionally forbidden; repositories are appended by
 * the callers under the fixed bookmarkforge namespace.
 */
export function validateRegistry(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 253) return false;
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value) || value.includes("..") || value.includes("/") || value.includes("\\")) return false;
  const host = value.split(":")[0];
  const port = value.includes(":") ? value.slice(value.lastIndexOf(":") + 1) : "";
  if (!host || host.split(".").some((label) => !label || label.length > 63 || label.startsWith("-") || label.endsWith("-"))) return false;
  return !value.includes(":") || /^[0-9]{1,5}$/.test(port) && Number(port) >= 1 && Number(port) <= 65535;
}

export function normalizeRegistry(value) {
  const normalized = typeof value === "string" ? value.trim().replace(/\/+$/, "") : "";
  return validateRegistry(normalized) ? normalized : "";
}
