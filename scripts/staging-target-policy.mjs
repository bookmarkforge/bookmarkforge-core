#!/usr/bin/env node

const PRODUCTION_HOSTS = new Set(["bookmarkforgeapp.com", "www.bookmarkforgeapp.com", "api.bookmarkforgeapp.com", "signal.bookmarkforgeapp.com"]);

export function validateStagingUrl(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 2048) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.port) return false;
    if (url.pathname !== "/" && /%2f|%5c/i.test(url.pathname)) return false;
    const host = url.hostname.toLowerCase();
    if (!host || PRODUCTION_HOSTS.has(host)) return false;
    if (host.length > 253 || host.includes("..") || !/^[a-z0-9.-]+$/i.test(host)) return false;
    const labels = host.split(".");
    if (labels.some((label) => label.length === 0 || label.length > 63 || label.startsWith("-") || label.endsWith("-"))) return false;
    if (!host.includes("staging") && !host.includes("-stage") && !host.endsWith(".test")) return false;
    return true;
  } catch {
    return false;
  }
}
